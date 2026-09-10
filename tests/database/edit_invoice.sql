begin;
create function pg_temp.e_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
set local role authenticated;
do $$
declare c uuid;v uuid; p record;r record; oldnumber integer; k uuid:=gen_random_uuid(); before_total numeric;
begin
 insert into public.customers(company_name,default_payment_terms_days) values('Edit fixture',30) returning id into c;
 select invoice_id into v from public.create_manual_invoice(c,'2025-09-01','[{"description":"Old","quantity":1,"unit":"each","unit_rate":10}]',gen_random_uuid());
 select invoice_number into oldnumber from public.invoices where id=v;
 update public.invoices set status='sent' where id=v;
 select * into strict p from public.preview_invoice_edit(v,'2025-09-01');
 select * into strict r from public.update_composed_invoice(v,'2025-09-05','2025-09-01',k,p.revision,'{}','[{"description":"Changed","quantity":2,"unit":"hour","unit_rate":30},{"description":"Added","quantity":1,"unit":"each","unit_rate":5}]','{}','Notes','Terms');
 perform pg_temp.e_assert(r.invoice_id=v and r.invoice_number=oldnumber and r.total=65 and r.due_date='2025-10-05' and r.status=case when exists(select from pg_constraint where conrelid='public.invoices'::regclass and conname='invoices_status_timestamp_check') then 'sent' else 'draft' end,'Edit replaces composition, preserves number, respects current lifecycle policy, recomputes due date');
 perform pg_temp.e_assert((select count(*)=1 from public.invoice_items where invoice_id=v and superseded_at is not null),'Old custom line retained');
 perform pg_temp.e_assert((select previous_invoice->>'status'='sent' from public.invoice_edit_requests where request_id=k),'Legacy status recorded');
 perform pg_temp.e_assert((select company_name_snapshot='Edit fixture' and payment_terms_days_snapshot=30 from public.invoices where id=v),'Customer snapshots fixed');
 select * into strict r from public.update_composed_invoice(v,'2025-09-05','2025-09-01',k,p.revision,'{}','[{"description":"Changed","quantity":2,"unit":"hour","unit_rate":30},{"description":"Added","quantity":1,"unit":"each","unit_rate":5}]','{}','Notes','Terms');
 perform pg_temp.e_assert((select count(*)=2 from public.invoice_items where invoice_id=v and superseded_at is null),'Retry does not repeat replacement');
 begin perform public.update_composed_invoice(v,'2025-09-06','2025-09-01',gen_random_uuid(),p.revision,'{}','[{"description":"Stale","quantity":1,"unit":"each","unit_rate":1}]');raise exception 'Unexpected success';exception when sqlstate 'P0001' then if sqlerrm not like 'STALE_INVOICE_PREVIEW:%' then raise;end if;end;
 begin perform public.generate_customer_invoice(c,'2025-09-01',k,'2025-09-01');raise exception 'Unexpected key reuse';exception when sqlstate '22023' then null;end;
 insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-01','Hourly source',30,120);
 select * into strict p from public.preview_invoice_edit(v,'2025-09-01');
 select * into strict r from public.update_composed_invoice(v,'2025-09-05','2025-09-01',gen_random_uuid(),p.revision,array[p.candidates->0->>'candidate_id'],'[]');
 perform pg_temp.e_assert(r.total=60 and (select sum(x.allocated_minutes)=30 from public.invoice_time_allocations x join public.invoice_items i on i.id=x.invoice_item_id where i.invoice_id=v and x.released_at is null),'Generated addition claims exact time');
 select * into strict p from public.preview_invoice_edit(v,'2025-09-01');
 select * into strict r from public.update_composed_invoice(v,'2025-09-05','2025-09-01',gen_random_uuid(),p.revision,array[p.candidates->0->>'candidate_id'],'[]',jsonb_build_object(p.candidates->0->>'candidate_id','Changed source description'));
 perform pg_temp.e_assert((select description='Changed source description' from public.invoice_items where invoice_id=v and superseded_at is null),'Retained generated description editable');
 select * into strict p from public.preview_invoice_edit(v,'2025-09-01');
 select * into strict r from public.update_composed_invoice(v,'2025-09-05','2025-09-01',gen_random_uuid(),p.revision,'{}','[{"description":"Replacement","quantity":1,"unit":"flat","unit_rate":5}]');
 perform pg_temp.e_assert(not exists(select from public.invoice_time_allocations x join public.invoice_items i on i.id=x.invoice_item_id where i.invoice_id=v and x.released_at is null),'Removed generated allocations released');
 select * into strict p from public.preview_customer_invoice(c,'2025-09-01');
 perform pg_temp.e_assert((p.candidates->0->>'billed_minutes')::integer=30,'Released source eligible again');
 update public.invoices set status='void',void_reason='Fixture complete' where id=v;
 perform pg_temp.e_assert((select total=5 from public.invoice_totals where invoice_id=v),'Void retains final composition only');
end $$;
reset role;
create function pg_temp.fail_edit_item() returns trigger language plpgsql as $$begin if new.description='Reject late edit' then raise exception using errcode='23514',message='Injected edit failure';end if;return new;end $$;
create trigger test_fail_edit_item before insert on public.invoice_items for each row execute function pg_temp.fail_edit_item();
set local role authenticated;
do $$
declare c uuid;v uuid;a uuid;p record;r record;before_rows jsonb;before_header jsonb; key uuid:=gen_random_uuid();
begin
 insert into public.customers(company_name) values('Edit retainer rollback') returning id into c;
 insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date) values(c,500,1,120,'2025-08-01') returning id into a;
 insert into public.time_entries(customer_id,work_date,description,actual_minutes) values(c,'2025-08-02','Prior overage',90);
 select invoice_id into v from public.generate_customer_invoice(c,'2025-09-01',gen_random_uuid(),'2025-09-01');
 select jsonb_agg(to_jsonb(i) order by i.position) into before_rows from public.invoice_items i where invoice_id=v;
 select to_jsonb(i) into before_header from public.invoices i where id=v;
 select * into strict p from public.preview_invoice_edit(v,'2025-09-01');
 begin
  perform public.update_composed_invoice(v,'2025-09-02','2025-09-01',key,p.revision,'{}','[{"description":"Reject late edit","quantity":1,"unit":"each","unit_rate":1}]');
  raise exception 'Unexpected success';
 exception when check_violation then null;end;
 perform pg_temp.e_assert((select jsonb_agg(to_jsonb(i) order by i.position)=before_rows from public.invoice_items i where invoice_id=v) and (select to_jsonb(i)=before_header from public.invoices i where id=v),'Late failure restores original invoice/lines');
 perform pg_temp.e_assert(not exists(select from public.invoice_edit_requests where request_id=key) and not exists(select from public.invoice_time_allocations x join public.invoice_items i on i.id=x.invoice_item_id where i.invoice_id=v and x.released_at is not null),'Late failure rolls back journal and released allocations');
 select * into strict r from public.update_composed_invoice(v,'2025-09-02','2025-09-01',key,p.revision,'{}','[{"description":"Replacement","quantity":1,"unit":"flat","unit_rate":5}]');
 select * into strict p from public.preview_customer_invoice(c,'2025-09-01');
 perform pg_temp.e_assert(jsonb_array_length(p.candidates)=2,'Removed retainer fee and complete overage become eligible');
 select * into strict p from public.preview_invoice_edit(v,'2025-09-01');
 select * into strict r from public.update_composed_invoice(v,'2025-09-02','2025-09-01',gen_random_uuid(),p.revision,array[p.candidates->0->>'candidate_id',p.candidates->1->>'candidate_id'],'[]');
 perform pg_temp.e_assert(r.total=560 and (select sum(x.allocated_minutes)=30 from public.invoice_time_allocations x join public.invoice_items i on i.id=x.invoice_item_id where i.invoice_id=v and x.released_at is null),'Reclaim complete retainer overage once');
 perform pg_temp.e_assert((select count(*)=1 from public.invoice_items where invoice_id=v and source_type='retainer_fee' and released_at is null),'No double fee claim');
end $$;
reset role;
drop trigger test_fail_edit_item on public.invoice_items;
set local role anon;
do $$begin
 begin perform public.preview_invoice_edit(gen_random_uuid(),'2025-09-01');raise exception 'Unexpected anonymous access';exception when insufficient_privilege then null;end;
 begin perform public.update_composed_invoice(gen_random_uuid(),'2025-09-01','2025-09-01',gen_random_uuid(),'x','{}','[]');raise exception 'Unexpected anonymous access';exception when insufficient_privilege then null;end;
end $$;
reset role;
select pg_temp.e_assert(not has_table_privilege('authenticated','public.invoice_items','DELETE') and not has_table_privilege('authenticated','public.invoice_edit_requests','DELETE'),'No hard delete privileges');
create policy edit_customer_deny on public.customers as restrictive for select to authenticated using(false);
set local role authenticated;
do $$begin
 begin perform public.preview_invoice_edit((select id from public.invoices where status='draft' limit 1),'2025-09-01');raise exception 'Unexpected RLS bypass';exception when no_data_found then null;end;
end $$;
reset role;
rollback;
