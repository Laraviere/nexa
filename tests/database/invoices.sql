begin;
create function pg_temp.invoice_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.invoice_reject(command text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then return; end;
  raise exception 'Unexpected success: %',command;
end $$;
set local role authenticated;
do $$
declare c uuid; other_c uuid; inv uuid; other_inv uuid; line uuid; timed_line uuid; entry uuid; agreement uuid;
  retainer_inv uuid; fee uuid; overage_line uuid; entry_a uuid; entry_b uuid; partial_inv uuid; n integer;
begin
  insert into public.customers(company_name,email,billing_city,default_payment_terms_days)
    values ('Snapshot company','original@example.test','Boston',30) returning id into c;
  insert into public.customers(company_name) values ('Other customer') returning id into other_c;
  insert into public.invoices(customer_id,issue_date) values(c,'2026-09-01') returning id,invoice_number into inv,n;
  perform pg_temp.invoice_assert(n=1001,'First invoice is 1001');
  perform pg_temp.invoice_assert((select due_date='2026-10-01' and payment_terms_days_snapshot=30 from public.invoices where id=inv),'Due date snapshots payment terms');
  update public.customers set company_name='Renamed',email='changed@example.test',billing_city='Miami',default_payment_terms_days=0 where id=c;
  perform pg_temp.invoice_assert((select company_name_snapshot='Snapshot company' and email_snapshot='original@example.test' and billing_city_snapshot='Boston' and due_date='2026-10-01' from public.invoices where id=inv),'Customer edits do not change snapshots');
  insert into public.invoice_items(invoice_id,position,description,quantity,unit,unit_rate,tax_amount)
    values(inv,2,'Switch',1,'each',250,20) returning id into line;
  insert into public.invoice_items(invoice_id,position,description,quantity,unit,unit_rate)
    values(inv,1,'Travel',15,'mile',0.70);
  perform pg_temp.invoice_assert((select array_agg(description order by position)=array['Travel','Switch'] from public.invoice_items where invoice_id=inv),'Line ordering');
  perform pg_temp.invoice_assert((select subtotal=260.50 and tax_amount=20 and total=280.50 from public.invoice_totals where invoice_id=inv),'Exact totals');
  perform pg_temp.invoice_reject(format('update public.invoice_items set unit_rate=-1 where id=%L',line));
  perform pg_temp.invoice_reject(format('update public.invoice_items set unit_rate=''NaN'' where id=%L',line));
  perform pg_temp.invoice_reject(format('update public.invoice_items set quantity=''NaN'' where id=%L',line));
  perform pg_temp.invoice_reject(format('update public.invoice_items set quantity=0 where id=%L',line));
  perform pg_temp.invoice_reject(format('update public.invoice_items set quantity=-1 where id=%L',line));
  perform pg_temp.invoice_reject(format('update public.invoice_items set unit_rate=''Infinity'' where id=%L',line));
  perform pg_temp.invoice_reject(format('insert into public.invoices(customer_id,issue_date) values(%L,''infinity'')',c));
  perform pg_temp.invoice_reject(format('insert into public.invoices(customer_id,issue_date,due_date) values(%L,''2026-09-01'',''2026-08-01'')',c));
  perform pg_temp.invoice_reject(format('update public.invoice_items set tax_amount=-1 where id=%L',line));
  perform pg_temp.invoice_reject(format('update public.invoice_items set tax_amount=''NaN'' where id=%L',line));
  perform pg_temp.invoice_reject(format('update public.invoice_items set released_at=now() where id=%L',line));
  update public.invoice_items set description='Network switch' where id=line;
  update public.invoices set status='sent' where id=inv;
  perform pg_temp.invoice_assert((select sent_at is not null from public.invoices where id=inv),'Issue timestamp');
  perform pg_temp.invoice_reject(format('update public.invoice_items set unit_rate=2 where id=%L',line));
  perform pg_temp.invoice_reject(format('update public.invoices set notes=''Changed'' where id=%L',inv));
  perform pg_temp.invoice_reject(format('update public.invoices set status=''draft'' where id=%L',inv));
  perform pg_temp.invoice_reject(format('delete from public.invoices where id=%L',inv));
  perform pg_temp.invoice_reject(format('delete from public.invoice_items where id=%L',line));
  perform pg_temp.invoice_reject(format('delete from public.customers where id=%L',c));
  update public.invoices set status='void',void_reason='Correction' where id=inv;
  perform pg_temp.invoice_assert((select total=280.50 from public.invoice_totals where invoice_id=inv),'Void retains financial history');
  perform pg_temp.invoice_reject(format('update public.invoices set status=''sent'' where id=%L',inv));

  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate)
    values(c,'2026-08-10','Hourly source',90,120) returning id into entry;
  insert into public.invoices(customer_id) values(c) returning id into other_inv;
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes)
    values(other_inv,1,'Hourly work','hourly_time',1,'hour',120,90) returning id into timed_line;
  perform pg_temp.invoice_reject(format('update public.invoices set status=''sent'' where id=%L',other_inv));
  insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end) values(timed_line,entry,0,90);
  perform pg_temp.invoice_assert((select quantity=1.5 and amount=180 from public.invoice_items where id=timed_line),'Exact hours and amount');
  perform pg_temp.invoice_assert(not exists(select from public.unbilled_time_entries where id=entry),'Fully claimed entry excluded');
  perform pg_temp.invoice_reject(format('update public.time_entries set actual_minutes=100 where id=%L',entry));
  perform pg_temp.invoice_reject(format('update public.time_entries set voided_at=now(),void_reason=''Changed'' where id=%L',entry));
  perform pg_temp.invoice_reject(format('update public.invoice_time_allocations set minute_end=80 where invoice_item_id=%L',timed_line));
  perform pg_temp.invoice_reject(format('delete from public.invoice_time_allocations where invoice_item_id=%L',timed_line));
  insert into public.invoices(customer_id) values(c) returning id into partial_inv;
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes)
    values(partial_inv,1,'Duplicate','hourly_time',1,'hour',120,15) returning id into line;
  perform pg_temp.invoice_reject(format('insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end) values(%L,%L,0,15)',line,entry));
  update public.invoices set status='sent' where id=other_inv;
  update public.invoices set status='void',void_reason='Rebill' where id=other_inv;
  perform pg_temp.invoice_assert((select uninvoiced_minutes=90 from public.unbilled_time_entries where id=entry),'Void releases time');
  insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end) values(line,entry,0,15);
  perform pg_temp.invoice_assert((select invoiced_minutes=15 and uninvoiced_minutes=75 from public.unbilled_time_entries where id=entry),'Partial claim preserves remainder');
  perform pg_temp.invoice_assert((select count(*)=2 from public.invoice_time_allocations where time_entry_id=entry),'Rebill preserves both historical claims');
  perform pg_temp.invoice_reject(format('update public.time_entries set description=''Changed'' where id=%L',entry));

  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date)
    values(c,500,1,125,'2026-09-01') returning id into agreement;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2026-09-02','A',45) returning id into entry_a;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2026-09-03','B',30) returning id into entry_b;
  insert into public.invoices(customer_id) values(c) returning id into retainer_inv;
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billing_agreement_id,period_start,period_end)
    values(retainer_inv,1,'Monthly retainer','retainer_fee',1,'month',0,agreement,'2026-09-01','2026-10-01') returning id into fee;
  perform pg_temp.invoice_assert((select amount=500 from public.invoice_items where id=fee),'Fee captures agreement amount');
  perform pg_temp.invoice_reject(format('insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billing_agreement_id,period_start,period_end) values(%L,2,''Duplicate'',''retainer_fee'',1,''month'',500,%L,''2026-09-01'',''2026-10-01'')',retainer_inv,agreement));
  perform pg_temp.invoice_reject(format('insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billing_agreement_id,period_start,period_end) values(%L,2,''Wrong period'',''retainer_fee'',1,''month'',500,%L,''2026-09-02'',''2026-10-01'')',retainer_inv,agreement));
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes,billing_agreement_id,period_start,period_end)
    values(retainer_inv,2,'Overage','retainer_overage',1,'hour',125,15,agreement,'2026-09-01','2026-10-01') returning id into overage_line;
  perform pg_temp.invoice_reject(format('insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end) values(%L,%L,0,15)',overage_line,entry_b));
  insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end) values(overage_line,entry_b,15,30);
  perform pg_temp.invoice_assert((select amount=31.25 and quantity=0.25 from public.invoice_items where id=overage_line),'15 overage minutes from 30-minute entry');
  perform pg_temp.invoice_assert((select uninvoiced_minutes=15 from public.unbilled_time_entries where id=entry_b),'Included minutes remain unclaimed, not automatically chargeable');
  update public.invoices set status='sent' where id=retainer_inv;
  update public.customer_billing_agreements set monthly_fee=900 where id=agreement;
  perform pg_temp.invoice_assert((select total=531.25 from public.invoice_totals where invoice_id=retainer_inv),'Agreement edits never reprice history');
  update public.invoices set status='void',void_reason='Rebill retainer' where id=retainer_inv;
  insert into public.invoices(customer_id) values(c) returning id into retainer_inv;
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billing_agreement_id,period_start,period_end)
    values(retainer_inv,1,'Replacement fee','retainer_fee',1,'month',0,agreement,'2026-09-01','2026-10-01');
  perform pg_temp.invoice_assert((select count(*)=2 from public.invoice_items where source_type='retainer_fee' and billing_agreement_id=agreement),'Fee rebilling retains old claim');
  insert into public.invoices(customer_id) values(other_c) returning id into other_inv;
  perform pg_temp.invoice_reject(format('insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billing_agreement_id,period_start,period_end) values(%L,1,''Wrong customer'',''retainer_fee'',1,''month'',500,%L,''2026-10-01'',''2026-11-01'')',other_inv,agreement));
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes)
    values(other_inv,1,'Wrong customer time','hourly_time',1,'hour',120,15) returning id into line;
  perform pg_temp.invoice_reject(format('insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end) values(%L,%L,30,45)',line,entry));
  raise notice 'PASS: numbering, snapshots, dates, exact amounts/totals, lifecycle, manual/fee/time/partial overage, duplicate prevention, history and rebilling';
end $$;
-- Approved billing policies: short periods, exclusive overage claim, late work,
-- and preservation of released historical time. Runs in the outer transaction.
do $$
declare c uuid; a uuid; inv uuid; competitor uuid; line uuid; fee uuid;
  t1 uuid; t2 uuid; late uuid; replacement uuid; before_invoice jsonb; before_items jsonb;
begin
  insert into public.customers(company_name) values ('Invoice policies') returning id into c;
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date)
    values(c,500,1,125,'2026-09-08') returning id into a;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes)
    values(c,'2026-09-09','First 45 minutes',45) returning id into t1;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes)
    values(c,'2026-09-10','Partially over allowance',30) returning id into t2;
  perform pg_temp.invoice_assert((select period_start='2026-09-08' and period_end='2026-10-01'
    and included_minutes_available=60 and overage_minutes=15 from public.get_retainer_period_usage(a,'2026-09-10')),
    'Shortened first period receives full allowance without proration');
  insert into public.invoices(customer_id) values(c) returning id into inv;
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billing_agreement_id,period_start,period_end)
    values(inv,1,'Full short-period fee','retainer_fee',1,'month',0,a,'2026-09-08','2026-10-01') returning id into fee;
  perform pg_temp.invoice_assert((select unit_rate=500 and amount=500 from public.invoice_items where id=fee),'Shortened period receives full fixed fee');
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes,billing_agreement_id,period_start,period_end)
    values(inv,2,'Whole period overage','retainer_overage',1,'hour',125,15,a,'2026-09-08','2026-10-01') returning id into line;
  insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end) values(line,t2,15,30);
  insert into public.invoices(customer_id) values(c) returning id into competitor;
  begin
    insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes,billing_agreement_id,period_start,period_end)
      values(competitor,1,'Competing period claim','retainer_overage',1,'hour',125,15,a,'2026-09-08','2026-10-01');
    raise exception 'Second active overage invoice was accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes,billing_agreement_id,period_start,period_end)
      values(inv,3,'Same invoice duplicate','retainer_overage',1,'hour',125,15,a,'2026-09-08','2026-10-01');
    raise exception 'Second active overage line on same invoice was accepted';
  exception when unique_violation then null; end;
  update public.invoices set status='sent' where id=inv;
  select to_jsonb(v) into before_invoice from public.invoices v where id=inv;
  select jsonb_agg(to_jsonb(i) order by position) into before_items from public.invoice_items i where invoice_id=inv;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes)
    values(c,'2026-09-20','Missed September work',15) returning id into late;
  perform pg_temp.invoice_assert((select to_jsonb(v)=before_invoice from public.invoices v where id=inv),'Backdated work does not change sent header');
  perform pg_temp.invoice_assert((select jsonb_agg(to_jsonb(i) order by position)=before_items from public.invoice_items i where invoice_id=inv),'Backdated work does not change sent line snapshots');
  perform pg_temp.invoice_assert((select total=531.25 from public.invoice_totals where invoice_id=inv),'Backdated work does not change sent total');
  perform pg_temp.invoice_assert((select invoiced_minutes=0 and uninvoiced_minutes=15 from public.unbilled_time_entries where id=late),'Late work remains uninvoiced');
  perform pg_temp.invoice_reject(format('update public.invoice_items set billed_minutes=30 where id=%L',line));
  update public.invoices set status='void',void_reason='Explicit full-period rebill' where id=inv;
  perform pg_temp.invoice_assert((select released_at is not null from public.invoice_time_allocations where invoice_item_id=line),'Void retains and releases old allocation');
  perform pg_temp.invoice_reject(format('update public.time_entries set hourly_rate=1 where id=%L',t2));
  perform pg_temp.invoice_reject(format('update public.time_entries set billing_agreement_id=null where id=%L',t2));
  perform pg_temp.invoice_reject(format('update public.time_entries set work_date=''2026-09-21'' where id=%L',t2));
  perform pg_temp.invoice_reject(format('update public.time_entries set included_hours_snapshot=0 where id=%L',t2));
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes,billing_agreement_id,period_start,period_end)
    values(competitor,1,'Complete updated period overage','retainer_overage',1,'hour',125,30,a,'2026-09-08','2026-10-01') returning id into replacement;
  insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end)
    values(replacement,t2,15,30),(replacement,late,0,15);
  update public.invoices set status='sent' where id=competitor;
  perform pg_temp.invoice_assert((select amount=62.50 from public.invoice_items where id=replacement),'Explicit rebill includes full revised period');
  perform pg_temp.invoice_assert((select count(*)=2 from public.invoice_items where source_type='retainer_overage' and billing_agreement_id=a),'Rebill preserves both claims');
  perform pg_temp.invoice_assert((select amount=31.25 and released_at is not null from public.invoice_items where id=line),'Old overage amount remains historical');
  -- A separate agreement with a shortened end also gets the full fee/allowance.
  insert into public.customers(company_name) values ('Short final period') returning id into c;
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date,end_date)
    values(c,500,1,125,'2026-09-01','2026-09-20') returning id into a;
  insert into public.invoices(customer_id) values(c) returning id into inv;
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billing_agreement_id,period_start,period_end)
    values(inv,1,'Full last-period fee','retainer_fee',1,'month',0,a,'2026-09-01','2026-09-20');
  perform pg_temp.invoice_assert((select total=500 from public.invoice_totals where invoice_id=inv),'Shortened final period has full fee');
  perform pg_temp.invoice_assert((select included_minutes_available=60 from public.get_retainer_period_usage(a,'2026-09-19')),'Shortened final period has full allowance');
  raise notice 'PASS: no first/last period proration, unique active overage period, released rebill, immutable sent invoices after late work, immutable released source context';
end $$;

reset role;
-- Check destructive operations as the owner too, beyond missing DELETE grants.
select pg_temp.invoice_reject('delete from public.invoices');
select pg_temp.invoice_reject('delete from public.invoice_items');
select pg_temp.invoice_reject('delete from public.invoice_time_allocations');
select pg_temp.invoice_reject('delete from public.time_entries where id in (select time_entry_id from public.invoice_time_allocations)');
select pg_temp.invoice_reject('delete from public.customers');
select pg_temp.invoice_reject('delete from public.customer_billing_agreements');
do $$
declare tab text; op text;
begin
  foreach tab in array array['invoices','invoice_items','invoice_time_allocations'] loop
    perform pg_temp.invoice_assert((select relrowsecurity from pg_class where oid=('public.'||tab)::regclass),'RLS enabled');
    foreach op in array array['SELECT','INSERT','UPDATE'] loop
      perform pg_temp.invoice_assert(has_table_privilege('authenticated','public.'||tab,op),'Authenticated privilege');
    end loop;
    foreach op in array array['DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      perform pg_temp.invoice_assert(not has_table_privilege('authenticated','public.'||tab,op),'No excess authenticated grants');
    end loop;
    perform pg_temp.invoice_assert(not has_table_privilege('anon','public.'||tab,'SELECT'),'No anon table reads');
  end loop;
  perform pg_temp.invoice_assert(not has_sequence_privilege('authenticated','public.invoices_invoice_number_seq','UPDATE'),'Cannot reset numbering');
  perform pg_temp.invoice_assert(not exists(select from pg_constraint where conrelid in ('public.invoices'::regclass,'public.invoice_items'::regclass,'public.invoice_time_allocations'::regclass) and contype='f' and (confdeltype<>'r' or confupdtype<>'r')),'Restrictive FKs only');
end $$;
set local role anon;
select pg_temp.invoice_reject('select * from public.invoices');
select pg_temp.invoice_reject('select * from public.invoice_items');
select pg_temp.invoice_reject('select * from public.invoice_time_allocations');
select pg_temp.invoice_reject('select * from public.invoice_totals');
select pg_temp.invoice_reject('select * from public.unbilled_time_entries');
reset role;
-- A normal owner-security view would leak these rows. Explicit denial verifies
-- the new totals view and the revised unbilled view use caller RLS.
create policy invoice_test_deny on public.invoices as restrictive for select to authenticated using(false);
create policy invoice_time_test_deny on public.time_entries as restrictive for select to authenticated using(false);
set local role authenticated;
select pg_temp.invoice_assert((select count(*)=0 from public.invoice_totals),'Totals respect invoice RLS');
select pg_temp.invoice_assert((select count(*)=0 from public.unbilled_time_entries),'Unbilled respects time RLS');
reset role;
rollback;
