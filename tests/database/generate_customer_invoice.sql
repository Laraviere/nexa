begin;
create function pg_temp.g_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.g_reject(command text,state text default '22023') returns void language plpgsql as $$
begin
  begin execute command; exception when others then if sqlstate=state then return; end if; raise; end;
  raise exception 'Unexpected success: %',command;
end $$;
set local role authenticated;
do $$
declare c uuid; a uuid; r record; again record; usage record; empty_key uuid:=gen_random_uuid(); fee_id uuid;
  completed_key uuid:=gen_random_uuid(); t1 uuid; t2 uuid; late uuid; original jsonb; original_items jsonb; count_before bigint;
begin
  insert into public.customers(company_name,email,default_payment_terms_days) values('Generation retainer','billing@example.test',30) returning id into c;
  perform pg_temp.g_reject(format('select * from public.generate_customer_invoice(%L,''2025-09-01'',gen_random_uuid(),%L)',c,(now() at time zone 'America/New_York')::date+1));
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,billing_cycle_day,effective_date)
    values(c,500,1,125,15,'2025-08-15') returning id into a;
  select count(*) into count_before from public.invoices;
  select * into strict r from public.generate_customer_invoice(c,'2025-08-14',empty_key,'2025-08-14');
  perform pg_temp.g_assert(r.outcome='nothing_to_invoice' and r.invoice_id is null and r.total is null,'Before period start creates no invoice');
  perform pg_temp.g_assert((select count(*)=count_before from public.invoices),'Empty generation has no header');
  select * into strict again from public.generate_customer_invoice(c,'2025-08-14',empty_key,'2025-08-14');
  perform pg_temp.g_assert(to_jsonb(r)=to_jsonb(again),'Empty retry returns same result');
  perform pg_temp.g_reject(format('select * from public.create_manual_invoice(%L,''2025-08-14'',''[{"description":"Conflict","quantity":1,"unit":"each","unit_rate":1}]'',%L)',c,empty_key));
  select * into strict r from public.generate_customer_invoice(c,'2025-08-15',gen_random_uuid(),'2025-08-15','Generated notes','Generated terms');
  fee_id:=r.invoice_id;
  perform pg_temp.g_assert(r.total=500 and r.status='draft' and r.invoice_number>=1001 and r.due_date='2025-09-14','Fee eligible on start, number and terms derived');
  perform pg_temp.g_assert((select company_name_snapshot='Generation retainer' and email_snapshot='billing@example.test' from public.invoices where id=fee_id),'Customer snapshots');
  perform pg_temp.g_assert((select count(*)=1 and bool_and(source_type='retainer_fee') from public.invoice_items where invoice_id=fee_id),'Only advance fee at period start');
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-08-16','Included first',45) returning id into t1;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-08-17','Partial overage',45) returning id into t2;
  select * into strict r from public.generate_customer_invoice(c,'2025-08-20',gen_random_uuid(),'2025-08-20');
  perform pg_temp.g_assert(r.outcome='nothing_to_invoice','Open overage not eligible and fixed fee not duplicated');
  perform pg_temp.g_assert((select covered_minutes=15 and deferred_minutes=30 and chargeable_minutes=0 from public.get_time_entry_invoiceability(t2,'2025-08-20')),'Open period overage deferred, allowance covered');
  select * into strict usage from public.get_retainer_period_usage(a,'2025-08-20');
  select * into strict r from public.generate_customer_invoice(c,'2025-09-15',completed_key,'2025-09-15');
  perform pg_temp.g_assert(r.total=500+usage.overage_amount and r.total=562.50,'Current advance fee plus completed authoritative overage');
  perform pg_temp.g_assert((select array_agg(source_type order by position)=array['retainer_fee','retainer_overage'] from public.invoice_items where invoice_id=r.invoice_id),'Deterministic fee then overage ordering');
  perform pg_temp.g_assert((select description like '%August 15, 2025%September 14, 2025%' from public.invoice_items where invoice_id=r.invoice_id and source_type='retainer_overage'),'Exclusive period rendered inclusive');
  perform pg_temp.g_assert((select count(*)=1 and bool_and(minute_start=15 and minute_end=45 and time_entry_id=t2) from public.invoice_time_allocations x join public.invoice_items i on i.id=x.invoice_item_id where i.invoice_id=r.invoice_id),'Only precise overage ranges allocated');
  perform pg_temp.g_assert(not exists(select from public.invoice_time_allocations where time_entry_id=t1),'Included entry not charged');
  perform pg_temp.g_assert((select invoiced_minutes=30 and covered_minutes=15 and chargeable_minutes=0 from public.get_time_entry_invoiceability(t2,'2025-09-15')),'Claimed and covered partition');
  select * into strict again from public.generate_customer_invoice(c,'2025-09-15',completed_key,'2025-09-15');
  perform pg_temp.g_assert(to_jsonb(r)=to_jsonb(again),'Nonempty retry returns same persisted invoice');
  perform pg_temp.g_reject(format('select * from public.generate_customer_invoice(%L,''2025-09-16'',%L,''2025-09-15'')',c,completed_key));
  update public.invoices set status='sent' where id=r.invoice_id;
  select to_jsonb(v) into original from public.invoices v where id=r.invoice_id;
  select jsonb_agg(to_jsonb(i) order by position) into original_items from public.invoice_items i where invoice_id=r.invoice_id;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-08-20','Late retainer work',15) returning id into late;
  select * into strict again from public.generate_customer_invoice(c,'2025-09-15',gen_random_uuid(),'2025-09-15');
  perform pg_temp.g_assert(again.outcome='nothing_to_invoice','Late retainer work cannot create second period claim');
  perform pg_temp.g_assert((select chargeable_minutes=0 and blocked_minutes=15 from public.get_time_entry_invoiceability(late,'2025-09-15')),'Late overage explicitly blocked');
  perform pg_temp.g_assert((select to_jsonb(v)=original from public.invoices v where id=r.invoice_id),'Finalized invoice not rewritten');
  perform pg_temp.g_assert((select jsonb_agg(to_jsonb(i) order by position)=original_items from public.invoice_items i where invoice_id=r.invoice_id),'Historical line snapshots unchanged');
  update public.invoices set status='void',void_reason='Explicit rebill' where id=r.invoice_id;
  select * into strict again from public.generate_customer_invoice(c,'2025-09-15',gen_random_uuid(),'2025-09-15');
  perform pg_temp.g_assert(again.total=593.75,'Released fee and complete updated overage rebill');
  perform pg_temp.g_assert((select count(*)=2 from public.invoice_items where source_type='retainer_overage' and billing_agreement_id=a),'Old claim history retained');

  insert into public.customers(company_name) values('Shortened generation') returning id into c;
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date,end_date)
    values(c,500,1,125,'2025-09-08','2025-09-20') returning id into a;
  select * into strict r from public.generate_customer_invoice(c,'2025-09-08',gen_random_uuid(),'2025-09-08');
  perform pg_temp.g_assert(r.total=500,'Shortened period full fee without proration');
  perform pg_temp.g_assert((select included_minutes_available=60 from public.get_retainer_period_usage(a,'2025-09-08')),'Shortened period full allowance');
  perform pg_temp.g_assert((select period_start='2025-09-08' and period_end='2025-09-20' from public.invoice_items where invoice_id=r.invoice_id),'Version-specific clipped period');
  insert into public.customers(company_name) values('Generation version reset') returning id into c;
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date,end_date)
    values(c,500,1,125,'2025-09-01','2025-09-08');
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date)
    values(c,900,2,150,'2025-09-08');
  select * into strict r from public.generate_customer_invoice(c,'2025-09-08',gen_random_uuid(),'2025-09-08');
  perform pg_temp.g_assert(r.total=900 and (select count(distinct billing_agreement_id)=1 from public.invoice_items where invoice_id=r.invoice_id),'Only current version fee is generated without proration');
  insert into public.customers(company_name) values('Generation arrears') returning id into c;
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date,bill_in_advance)
    values(c,300,1,125,'2025-08-01',false);
  select * into strict r from public.generate_customer_invoice(c,'2025-08-01',gen_random_uuid(),'2025-08-01');
  perform pg_temp.g_assert(r.outcome='nothing_to_invoice','Arrears fee not charged at period start');
  select * into strict r from public.generate_customer_invoice(c,'2025-09-01',gen_random_uuid(),'2025-09-01');
  perform pg_temp.g_assert(r.total=300,'Arrears fee eligible at end');
  insert into public.customers(company_name) values('Generation disabled') returning id into c;
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date)
    values(c,500,0,125,'2025-08-01') returning id into a;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-08-02','Captured before disable',30);
  update public.customer_billing_agreements set is_active=false where id=a;
  select * into strict r from public.generate_customer_invoice(c,'2025-09-01',gen_random_uuid(),'2025-09-01');
  perform pg_temp.g_assert(r.total=62.50 and (select bool_and(source_type='retainer_overage') from public.invoice_items where invoice_id=r.invoice_id),'Disabled captured overage survives without fixed fees');
  raise notice 'PASS: advance dates, no duplicate fees, clipped full fees, completed whole overage, exact allocations, empty/nonempty retries, blocked late overage, history and rebilling';
end $$;
do $$
declare c uuid; e1 uuid; e2 uuid; e3 uuid; missing uuid; prior uuid; line uuid; r record; again record; key uuid:=gen_random_uuid(); prior_json jsonb;
begin
  insert into public.customers(company_name) values('Generation hourly') returning id into c;
  -- Nothing result remains terminal even after backdated time appears.
  select * into strict r from public.generate_customer_invoice(c,'2025-09-01',key,'2025-09-01');
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-01','18 rounds to 30',18,120) returning id into e1;
  select * into strict again from public.generate_customer_invoice(c,'2025-09-01',key,'2025-09-01');
  perform pg_temp.g_assert(again.outcome='nothing_to_invoice','Empty retry never reevaluates new work');
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-02','Same rate',60,120) returning id into e2;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-03','Different rate',18,150) returning id into e3;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate,voided_at,void_reason) values(c,'2025-08-04','Voided',60,120,now(),'Mistake');
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,is_billable) values(c,'2025-08-04','Nonbillable',60,false);
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-10-01','After reference date',60,120);
  insert into public.invoices(customer_id) values(c) returning id into prior;
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes)
    values(prior,1,'Existing middle claim','hourly_time',1,'hour',120,10) returning id into line;
  insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end) values(line,e1,10,20);
  select * into strict r from public.generate_customer_invoice(c,'2025-09-01',gen_random_uuid(),'2025-09-01');
  perform pg_temp.g_assert(r.total=235,'Same-rate grouped 80 minutes at 120 plus 30 at 150');
  perform pg_temp.g_assert((select array_agg(unit_rate order by position)=array[120,150]::numeric[] and array_agg(billed_minutes order by position)=array[80,30]::bigint[] from public.invoice_items where invoice_id=r.invoice_id),'Grouping by captured rates, stored rounded minutes');
  perform pg_temp.g_assert((select array_agg(int8range(minute_start,minute_end,'[)') order by minute_start)=array[int8range(0,10,'[)'),int8range(20,30,'[)')] from public.invoice_time_allocations x join public.invoice_items i on i.id=x.invoice_item_id where i.invoice_id=r.invoice_id and time_entry_id=e1),'Exact gaps around middle claim');
  perform pg_temp.g_assert((select count(*)=4 from public.invoice_time_allocations x join public.invoice_items i on i.id=x.invoice_item_id where i.invoice_id=r.invoice_id),'Only eligible rounded minutes allocated');
  update public.invoices set status='sent' where id=r.invoice_id;
  select to_jsonb(v) into prior_json from public.invoices v where id=r.invoice_id;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-06','Missed hourly work',15,120) returning id into missing;
  select * into strict again from public.generate_customer_invoice(c,'2025-09-01',gen_random_uuid(),'2025-09-01');
  perform pg_temp.g_assert(again.total=30,'Backdated hourly work creates future invoice');
  perform pg_temp.g_assert((select to_jsonb(v)=prior_json from public.invoices v where id=r.invoice_id),'Old hourly invoice untouched');
  update public.invoices set status='void',void_reason='Rebill' where id=r.invoice_id;
  select * into strict again from public.generate_customer_invoice(c,'2025-09-01',gen_random_uuid(),'2025-09-01');
  perform pg_temp.g_assert(again.total=235,'Released hourly ranges invoiceable again');
  raise notice 'PASS: hourly grouping/rates, stored rounding, exact partial gaps, excluded work, durable empty results, backdated work and released ranges';
end $$;
-- Normal generation selects periods before checking claims: a claimed latest
-- period must never cause fallback to an older missed period.
do $$
declare c uuid; a uuid; old_version uuid; newest uuid; r record; u record; missed uuid;
begin
  insert into public.customers(company_name) values('No silent catch-up') returning id into c;
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,billing_cycle_day,effective_date)
    values(c,500,1,120,15,'2025-06-15') returning id into a;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes)
    values(c,'2025-07-16','Missed older overage',90) returning id into missed;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes)
    values(c,'2025-08-16','Immediately completed overage',90);
  select * into strict r from public.generate_customer_invoice(c,'2025-09-15',gen_random_uuid(),'2025-09-15');
  perform pg_temp.g_assert(r.total=560 and (select count(*)=2 from public.invoice_items where invoice_id=r.invoice_id),'Current full fee plus only prior overage');
  perform pg_temp.g_assert((select period_start='2025-09-15' and period_end='2025-10-15' from public.invoice_items where invoice_id=r.invoice_id and source_type='retainer_fee'),'Current day-15 fee period');
  perform pg_temp.g_assert((select period_start='2025-08-15' and period_end='2025-09-15' from public.invoice_items where invoice_id=r.invoice_id and source_type='retainer_overage'),'Immediately preceding day-15 overage');
  perform pg_temp.g_assert(not exists(select from public.invoice_items where billing_agreement_id=a and period_start<'2025-08-15'),'Older missed fees and overage remain unclaimed');
  select * into strict u from public.get_time_entry_invoiceability(missed,'2025-09-15');
  perform pg_temp.g_assert(u.chargeable_minutes=30 and u.invoiced_minutes=0,'Missed historical overage remains detectable');
  select * into strict u from public.get_retainer_period_usage(a,'2025-07-16');
  perform pg_temp.g_assert(u.overage_minutes=30 and not exists(select from public.invoice_items i where i.billing_agreement_id=a and i.released_at is null and daterange(i.period_start,i.period_end,'[)') && daterange(u.period_start,u.period_end,'[)')),'Historical usage and absent claims identify missed fee/overage');
  select * into strict r from public.generate_customer_invoice(c,'2025-09-20',gen_random_uuid(),'2025-09-20');
  perform pg_temp.g_assert(r.outcome='nothing_to_invoice','Within-cycle retry never falls back to older missed periods');

  insert into public.customers(company_name) values('Adjacent version selection') returning id into c;
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,billing_cycle_day,effective_date,end_date)
    values(c,300,1,120,15,'2025-07-15','2025-08-15');
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-07-16','Unrelated missed version',90);
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,billing_cycle_day,effective_date,end_date)
    values(c,500,1,120,15,'2025-08-15','2025-09-08') returning id into old_version;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-08-16','Shortened predecessor',90);
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,billing_cycle_day,effective_date)
    values(c,900,2,150,15,'2025-09-08') returning id into newest;
  select * into strict r from public.generate_customer_invoice(c,'2025-09-08',gen_random_uuid(),'2025-09-08');
  perform pg_temp.g_assert(r.total=960 and (select count(*)=2 from public.invoice_items where invoice_id=r.invoice_id),'New full fee and just-ended version overage only');
  perform pg_temp.g_assert((select billing_agreement_id=newest and period_start='2025-09-08' and period_end='2025-09-15' and amount=900 from public.invoice_items where invoice_id=r.invoice_id and source_type='retainer_fee'),'Shortened successor receives full fee');
  perform pg_temp.g_assert((select billing_agreement_id=old_version and period_end='2025-09-08' and billed_minutes=30 from public.invoice_items where invoice_id=r.invoice_id and source_type='retainer_overage'),'Clipped predecessor retains full allowance');
  -- Ending the latest agreement retains only its final period for overage.
  update public.customer_billing_agreements set end_date='2025-09-12' where id=newest;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-09-09','Final period usage',150);
  select * into strict r from public.generate_customer_invoice(c,'2025-09-12',gen_random_uuid(),'2025-09-12');
  perform pg_temp.g_assert(r.total=75 and (select bool_and(source_type='retainer_overage') from public.invoice_items where invoice_id=r.invoice_id),'Cancellation collects only final overage without historical fees');
  -- A later version after a gap must not select the old version again.
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,billing_cycle_day,effective_date)
    values(c,1000,2,150,15,'2025-10-01');
  select * into strict r from public.generate_customer_invoice(c,'2025-10-01',gen_random_uuid(),'2025-10-01');
  perform pg_temp.g_assert(r.total=1000 and (select count(*)=1 from public.invoice_items where invoice_id=r.invoice_id),'No predecessor lookup across a service gap');
end $$;
reset role;
-- Fail during allocation insertion after a header and item already exist.
create function pg_temp.fail_generation_allocation() returns trigger language plpgsql as $$
begin raise exception using errcode='23514',message='Injected allocation failure'; end $$;
create trigger test_fail_generation before insert on public.invoice_time_allocations for each row execute function pg_temp.fail_generation_allocation();
set local role authenticated;
do $$
declare c uuid; n bigint; m bigint; requests bigint; key uuid:=gen_random_uuid();
begin
  insert into public.customers(company_name) values('Generation rollback') returning id into c;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-01','Rollback fixture',18,120);
  select count(*) into n from public.invoices; select count(*) into m from public.invoice_items;
  select count(*) into requests from public.invoice_generation_requests;
  perform pg_temp.g_reject(format('select * from public.generate_customer_invoice(%L,''2025-09-01'',%L,''2025-09-01'')',c,key),'23514');
  perform pg_temp.g_assert((select count(*)=n from public.invoices) and (select count(*)=m from public.invoice_items)
    and (select count(*)=requests from public.invoice_generation_requests),'Failure rolls back invoice, lines, claims and request');
end $$;
reset role;
drop trigger test_fail_generation on public.invoice_time_allocations;
-- Explicit grants, caller-RLS and no anonymous reads/execution.
select pg_temp.g_assert((select bool_and(invoiced_minutes+covered_minutes+chargeable_minutes+deferred_minutes+blocked_minutes=rounded_minutes)
  from public.unbilled_time_entries),'View partitions minutes without double-counting covered work');
select pg_temp.g_assert(not (select prosecdef from pg_proc where oid='public.generate_customer_invoice(uuid,date,uuid,date,text,text)'::regprocedure),'Generation is invoker');
select pg_temp.g_assert(not has_table_privilege('authenticated','public.invoice_generation_requests','UPDATE') and not has_table_privilege('authenticated','public.invoice_generation_requests','DELETE'),'Request ledger is append-only');
select pg_temp.g_assert((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.unbilled_time_entries'::regclass),'View uses caller RLS');
create policy generation_customer_deny on public.customers as restrictive for select to authenticated using(false);
set local role authenticated;
select pg_temp.g_reject('select * from public.generate_customer_invoice((select customer_id from public.invoices limit 1),''2025-09-01'',gen_random_uuid(),''2025-09-01'')','P0002');
reset role;
set local role anon;
select pg_temp.g_reject('select * from public.generate_customer_invoice(gen_random_uuid(),''2025-09-01'',gen_random_uuid())','42501');
select pg_temp.g_reject('select * from public.get_time_entry_invoiceability(gen_random_uuid(),''2025-09-01'')','42501');
select pg_temp.g_reject('select * from public.invoice_generation_requests','42501');
reset role;
rollback;
