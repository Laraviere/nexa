begin;
create function pg_temp.c_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.c_reject(command text,state text default '22023') returns void language plpgsql as $$
begin
  begin execute command; exception when others then if sqlstate=state then return; end if; raise; end;
  raise exception 'Unexpected success: %',command;
end $$;
set local role authenticated;
do $$
declare c uuid; a uuid; p record; p2 record; r record; again record; ids text[]; key uuid:=gen_random_uuid();
  n bigint; m bigint; fee text; overage text; old_entry uuid; recent_entry uuid; raw jsonb;
begin
  insert into public.customers(company_name,default_payment_terms_days) values('Composer retainer',30) returning id into c;
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,billing_cycle_day,effective_date)
    values(c,500,1,120,15,'2025-06-15') returning id into a;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-07-16','Older missed period',90) returning id into old_entry;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-08-16','Complete prior period',90) returning id into recent_entry;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-09-16','In-progress overage',90);
  select count(*) into n from public.invoices;select count(*) into m from public.invoice_time_allocations;
  select * into strict p from public.preview_customer_invoice(c,'2025-09-20');
  select * into strict p2 from public.preview_customer_invoice(c,'2025-09-20');
  perform pg_temp.c_assert(p.revision=p2.revision and p.candidates=p2.candidates,'Deterministic preview');
  set local timezone='Pacific/Honolulu';
  select * into strict p2 from public.preview_customer_invoice(c,'2025-09-20');
  perform pg_temp.c_assert(p.revision=p2.revision,'Revision independent of session timezone');
  set local timezone='UTC';
  perform pg_temp.c_assert((select count(*)=n from public.invoices) and (select count(*)=m from public.invoice_time_allocations),'Preview performs no financial writes');
  perform pg_temp.c_assert(jsonb_array_length(p.candidates)=2,'Current fee and completed overage only');
  perform pg_temp.c_assert(not exists(select from jsonb_array_elements(p.candidates) e where e ? 'allocations'),'Public preview hides ranges');
  select e->>'candidate_id' into fee from jsonb_array_elements(p.candidates) e where e->>'source_type'='retainer_fee';
  select e->>'candidate_id' into overage from jsonb_array_elements(p.candidates) e where e->>'source_type'='retainer_overage';
  perform pg_temp.c_assert((select (e->>'amount')::numeric=500 and e->>'period_start'='2025-09-15' from jsonb_array_elements(p.candidates) e where e->>'candidate_id'=fee),'Full current fee');
  perform pg_temp.c_assert((select (e->>'amount')::numeric=60 and e->>'period_start'='2025-08-15' from jsonb_array_elements(p.candidates) e where e->>'candidate_id'=overage),'Only prior overage');
  perform pg_temp.c_reject(format('select * from public.create_composed_invoice(%L,''2025-09-20'',''2025-09-20'',gen_random_uuid(),%L,ARRAY[''forged''],''[]'')',c,p.revision));
  perform pg_temp.c_reject(format('select * from public.create_composed_invoice(%L,''2025-09-20'',''2025-09-20'',gen_random_uuid(),%L,''{}'',''[]'')',c,p.revision));
  raw:='[{"description":"Custom first","quantity":"1.5","unit":"hour","unit_rate":"100","tax_amount":"3"},{"description":"Custom second","quantity":1,"unit":"each","unit_rate":20}]';
  select * into strict r from public.create_composed_invoice(c,'2025-09-20','2025-09-20',key,p.revision,array[overage],raw,'Notes','Terms');
  perform pg_temp.c_assert(r.total=233 and r.subtotal=230 and r.tax_total=3 and r.status='draft' and r.due_date='2025-10-20' and r.company_name_snapshot='Composer retainer','Mixed totals, snapshots and due date');
  perform pg_temp.c_assert((select array_agg(source_type order by position)=array['retainer_overage','manual','manual'] from public.invoice_items where invoice_id=r.invoice_id),'Generated first then custom order');
  perform pg_temp.c_assert(not exists(select from public.invoice_items where billing_agreement_id=a and source_type='retainer_fee'),'Deselected fee unclaimed');
  perform pg_temp.c_assert((select count(*)=1 and bool_and(x.time_entry_id=recent_entry and minute_start=60 and minute_end=90) from public.invoice_time_allocations x join public.invoice_items i on i.id=x.invoice_item_id where i.invoice_id=r.invoice_id),'Complete overage exact ranges only');
  select * into strict again from public.create_composed_invoice(c,'2025-09-20','2025-09-20',key,p.revision,array[overage],raw,'Notes','Terms');
  perform pg_temp.c_assert(again.invoice_id=r.invoice_id,'Retry before stale revalidation returns same invoice');
  perform pg_temp.c_reject(format('select * from public.create_composed_invoice(%L,''2025-09-21'',''2025-09-20'',%L,%L,ARRAY[%L],%L,''Notes'',''Terms'')',c,key,p.revision,overage,raw));
  perform pg_temp.c_reject(format('select * from public.create_composed_invoice(%L,''2025-09-20'',''2025-09-20'',gen_random_uuid(),%L,ARRAY[%L],''[]'')',c,p.revision,fee),'P0001');
  select * into strict p2 from public.preview_customer_invoice(c,'2025-09-20');
  perform pg_temp.c_assert(p2.revision<>p.revision and jsonb_array_length(p2.candidates)=1 and p2.candidates->0->>'candidate_id'=fee,'Claim disappears, remaining candidate stable');
  select * into strict again from public.create_composed_invoice(c,'2025-09-20','2025-09-20',gen_random_uuid(),p2.revision,array[fee],'[]');
  perform pg_temp.c_assert(again.total=500,'Generated-only fee saves');
  select * into strict p from public.preview_customer_invoice(c,'2025-09-20');
  perform pg_temp.c_assert(p.candidates='[]','Claimed sources disappear; no historical fallback');
  update public.invoices set status='sent' where id=r.invoice_id;
  perform pg_temp.c_reject(format('update public.invoice_items set unit_rate=1 where invoice_id=%L',r.invoice_id),'P0001');
  perform pg_temp.c_assert(not exists(select from public.invoice_time_allocations where time_entry_id=old_entry),'Historical missed period unclaimed');
  raise notice 'PASS: preview determinism/read-only, period selection, selection/deselection, mixed/only-source saves, precise overage, retries, stale/forged/empty rejection, snapshots, totals and approved immutability';
end $$;
do $$
declare c uuid; t1 uuid; inv uuid; line uuid; p record; p2 record; r record; ids text[]; k uuid:=gen_random_uuid(); n bigint;
begin
  insert into public.customers(company_name) values('Composer hourly') returning id into c;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-01','Partial',18,120) returning id into t1;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-02','Same rate',60,120),(c,'2025-08-03','Other rate',30,150);
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,is_billable) values(c,'2025-08-04','Nonbillable',60,false);
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate,voided_at,void_reason) values(c,'2025-08-04','Voided',60,120,now(),'Fixture');
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-10-01','Future',60,120);
  insert into public.invoices(customer_id) values(c) returning id into inv;
  insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes) values(inv,1,'Partial claim','hourly_time',1,'hour',120,10) returning id into line;
  insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end) values(line,t1,10,20);
  select * into strict p from public.preview_customer_invoice(c,'2025-09-01');
  perform pg_temp.c_assert(jsonb_array_length(p.candidates)=2 and (p.candidates->0->>'billed_minutes')::bigint=80 and (p.candidates->0->>'amount')::numeric=160,'Rate grouping exact remaining minutes');
  select array_agg(e->>'candidate_id' order by ord desc) into ids from jsonb_array_elements(p.candidates) with ordinality j(e,ord);
  select * into strict r from public.create_composed_invoice(c,'2025-09-01','2025-09-01',k,p.revision,ids,'[]');
  perform pg_temp.c_assert(r.total=235,'Hourly totals authoritative');
  perform pg_temp.c_assert((select array_agg(unit_rate order by position)=array[120,150]::numeric[] from public.invoice_items where invoice_id=r.invoice_id),'Canonical rate order regardless selection array order');
  perform pg_temp.c_assert((select array_agg(int8range(minute_start,minute_end,'[)') order by minute_start)=array[int8range(0,10,'[)'),int8range(20,30,'[)')] from public.invoice_time_allocations x join public.invoice_items i on i.id=x.invoice_item_id where i.invoice_id=r.invoice_id and x.time_entry_id=t1),'Partial range holes preserved');
  select * into strict p2 from public.preview_customer_invoice(c,'2025-09-01');
  perform pg_temp.c_assert(p2.candidates='[]','All selected hourly claimed');
  -- Custom-only still validates review, normalizes decimals and accepts tax.
  select * into strict r from public.create_composed_invoice(c,'2025-09-01','2025-09-01',gen_random_uuid(),p2.revision,'{}','[{"description":"Custom","quantity":2,"unit":"each","unit_rate":5,"tax_amount":1}]');
  perform pg_temp.c_assert(r.total=11,'Custom-only works');
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-05','New backdated work',15,120);
  select count(*) into n from public.invoices;
  perform pg_temp.c_reject(format('select * from public.create_composed_invoice(%L,''2025-09-01'',''2025-09-01'',gen_random_uuid(),%L,''{}'',''[{"description":"Custom","quantity":1,"unit":"each","unit_rate":5}]'')',c,p2.revision),'P0001');
  perform pg_temp.c_assert((select count(*)=n from public.invoices),'Stale source change has no mutation');
  select * into strict p from public.preview_customer_invoice(c,'2025-09-01');
  perform pg_temp.c_assert(p.revision<>p2.revision and (p.candidates->0->>'amount')::numeric=30,'Backdated hourly work changes preview');
  foreach line in array array[gen_random_uuid()] loop
    perform pg_temp.c_reject(format('select * from public.create_composed_invoice(%L,''2025-09-01'',''2025-09-01'',%L,%L,''{}'',''[{"description":"Bad","quantity":1,"unit":"each","unit_rate":5,"amount":5}]'')',c,line,p.revision));
  end loop;
  raise notice 'PASS: hourly grouping, partial allocations, exclusions, source changes, custom-only, protected fields and canonical ordering';
end $$;
reset role;
-- A valid custom line fails late, after generated claims were inserted.
create function pg_temp.composer_failure() returns trigger language plpgsql as $$
begin if new.description='Injected custom failure' then raise exception using errcode='23514',message='Injected failure'; end if;return new;end $$;
create trigger test_composer_failure before insert on public.invoice_items for each row execute function pg_temp.composer_failure();
set local role authenticated;
do $$
declare c uuid; p record; n bigint; m bigint; k uuid:=gen_random_uuid();
begin
  insert into public.customers(company_name) values('Composer atomic rollback') returning id into c;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-01','Source',30,120);
  select * into strict p from public.preview_customer_invoice(c,'2025-09-01');
  select count(*) into n from public.invoices;select count(*) into m from public.invoice_time_allocations;
  perform pg_temp.c_reject(format('select * from public.create_composed_invoice(%L,''2025-09-01'',''2025-09-01'',%L,%L,ARRAY[%L],''[{"description":"Injected custom failure","quantity":1,"unit":"each","unit_rate":1}]'')',c,k,p.revision,p.candidates->0->>'candidate_id'),'23514');
  perform pg_temp.c_assert((select count(*)=n from public.invoices) and (select count(*)=m from public.invoice_time_allocations) and not exists(select from public.invoices where creation_request_id=k),'Late custom failure rolls back header and source claims');
end $$;
reset role;
drop trigger test_composer_failure on public.invoice_items;
create function pg_temp.composer_claim_failure() returns trigger language plpgsql as $$
begin raise exception using errcode='23P01',message='Injected source conflict';end $$;
create trigger test_composer_claim_failure before insert on public.invoice_time_allocations for each row execute function pg_temp.composer_claim_failure();
set local role authenticated;
do $$
declare c uuid; p record; n bigint; m bigint; a bigint; k uuid:=gen_random_uuid();
begin
  insert into public.customers(company_name) values('Composer source failure') returning id into c;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-01','Source',30,120);
  select * into strict p from public.preview_customer_invoice(c,'2025-09-01');
  select count(*) into n from public.invoices;select count(*) into m from public.invoice_items;select count(*) into a from public.invoice_time_allocations;
  perform pg_temp.c_reject(format('select * from public.create_composed_invoice(%L,''2025-09-01'',''2025-09-01'',%L,%L,ARRAY[%L],''[{"description":"Custom alongside source","quantity":1,"unit":"each","unit_rate":1}]'')',c,k,p.revision,p.candidates->0->>'candidate_id'),'40001');
  perform pg_temp.c_assert((select count(*)=n from public.invoices) and (select count(*)=m from public.invoice_items) and (select count(*)=a from public.invoice_time_allocations),'Source conflict leaves no header, custom/generated items or allocations');
end $$;
reset role;
drop trigger test_composer_claim_failure on public.invoice_time_allocations;
-- Fee-only selection leaves complete overage untouched. Cross-operation request
-- keys remain incompatible, including generation's durable empty results.
set local role authenticated;
do $$
declare c uuid; a uuid; p record; r record; k uuid:=gen_random_uuid(); empty_key uuid:=gen_random_uuid();
begin
  insert into public.customers(company_name) values('Composer fee selection') returning id into c;
  perform public.generate_customer_invoice(c,'2025-09-01',empty_key,'2025-09-01');
  insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date)
    values(c,500,1,120,'2025-08-01') returning id into a;
  insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-08-02','Unselected overage',90);
  select * into strict p from public.preview_customer_invoice(c,'2025-09-01');
  perform pg_temp.c_reject(format('select * from public.create_composed_invoice(%L,''2025-09-01'',''2025-09-01'',%L,%L,ARRAY[%L],''[]'')',c,empty_key,p.revision,p.candidates->0->>'candidate_id'));
  select * into strict r from public.create_composed_invoice(c,'2025-09-01','2025-09-01',k,p.revision,array[p.candidates->0->>'candidate_id'],'[]');
  perform pg_temp.c_assert(r.total=500 and not exists(select from public.invoice_items where billing_agreement_id=a and source_type='retainer_overage'),'Deselected overage remains unclaimed');
  perform pg_temp.c_reject(format('select * from public.create_manual_invoice(%L,''2025-09-01'',''[{"description":"Other operation","quantity":1,"unit":"each","unit_rate":1}]'',%L)',c,k));
  perform pg_temp.c_reject(format('select * from public.generate_customer_invoice(%L,''2025-09-01'',%L,''2025-09-01'')',c,k));
end $$;
reset role;
select pg_temp.c_assert((select bool_and(not prosecdef) from pg_proc where oid in ('public.preview_customer_invoice(uuid,date)'::regprocedure,'public.create_composed_invoice(uuid,date,date,uuid,text,text[],jsonb,text,text)'::regprocedure)),'Invoker security');
create policy composer_deny_customer on public.customers as restrictive for select to authenticated using(false);
set local role authenticated;
select pg_temp.c_reject('select * from public.preview_customer_invoice((select customer_id from public.time_entries limit 1),''2025-09-01'')','P0002');
reset role;
set local role anon;
select pg_temp.c_reject('select * from public.preview_customer_invoice(gen_random_uuid(),''2025-09-01'')','42501');
select pg_temp.c_reject('select * from public.create_composed_invoice(gen_random_uuid(),''2025-09-01'',''2025-09-01'',gen_random_uuid(),repeat(''a'',64),''{}'',''[]'')','42501');
reset role;
rollback;
