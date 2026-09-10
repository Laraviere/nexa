begin;
create function pg_temp.ready_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
set local role authenticated;
do $$
declare c uuid;v uuid;p record;r record;n integer;s text;stamp timestamptz;before_rows jsonb;before_total numeric;
begin
 insert into public.customers(company_name) values('Ready lifecycle fixture') returning id into c;
 insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values(c,'2025-08-01','Ready source',30,120);
 select invoice_id,invoice_number into v,n from public.create_manual_invoice(c,'2025-09-01','[{"description":"Original","quantity":1,"unit":"each","unit_rate":10}]',gen_random_uuid());
 select jsonb_agg(to_jsonb(i)) into before_rows from public.invoice_items i where invoice_id=v;
 update public.invoices set status='ready' where id=v;
 perform pg_temp.ready_assert((select status='ready' and sent_at is null from public.invoices where id=v),'Draft to Ready without delivery timestamp');
 update public.invoices set status='draft' where id=v;
 perform pg_temp.ready_assert((select status='draft' from public.invoices where id=v),'Ready to Draft');
 perform pg_temp.ready_assert((select jsonb_agg(to_jsonb(i))=before_rows from public.invoice_items i where invoice_id=v) and (select total=10 from public.invoice_totals where invoice_id=v),'Workflow transitions do not rewrite lines or totals');
 foreach s in array array['ready','sent'] loop
  update public.invoices set status=s where id=v;
  select * into strict p from public.preview_invoice_edit(v,'2025-09-01');
  select * into strict r from public.update_composed_invoice(v,'2025-09-02','2025-09-01',gen_random_uuid(),p.revision,array[p.candidates->0->>'candidate_id'],'[{"description":"Editable","quantity":2,"unit":"each","unit_rate":8}]');
  perform pg_temp.ready_assert(r.status=s and r.invoice_number=n and r.total=76,'Ready/Sent edit preserves status, number and totals');
  perform pg_temp.ready_assert((select sum(a.allocated_minutes)=30 from public.invoice_time_allocations a join public.invoice_items i on i.id=a.invoice_item_id where i.invoice_id=v and a.released_at is null),'Ready/Sent edits preserve exact source claims');
 end loop;
 select sent_at into stamp from public.invoices where id=v;
 update public.invoices set status='ready' where id=v;
 perform pg_temp.ready_assert((select status='ready' and sent_at=stamp from public.invoices where id=v),'Sent to Ready preserves recorded timestamp');
 update public.invoices set status='draft' where id=v;
 update public.invoices set status='sent' where id=v;
 perform pg_temp.ready_assert((select status='sent' and sent_at=stamp from public.invoices where id=v),'Draft to Sent supported, recorded timestamp preserved');
 perform pg_temp.ready_assert((select count(*)=2 from public.invoice_edit_requests where invoice_id=v) and (select count(*)=2 from public.invoice_items where invoice_id=v and superseded_at is not null),'Edit before-images and superseded lines preserved');
 -- Ready may be voided; void remains historical and rejects both edits and reopening.
 update public.invoices set status='ready' where id=v;
 update public.invoices set status='void',void_reason='Local regression' where id=v;
 perform pg_temp.ready_assert((select total=76 from public.invoice_totals where invoice_id=v),'Void retains totals');
 begin update public.invoices set notes='Bad edit' where id=v;raise exception using errcode='ZX001',message='Unexpected edit';exception when sqlstate 'P0001' then null;end;
 begin update public.invoices set status='ready' where id=v;raise exception using errcode='ZX001',message='Unexpected reopen';exception when sqlstate 'P0001' then null;end;
 begin perform public.preview_invoice_edit(v,'2025-09-01');raise exception using errcode='ZX001',message='Unexpected void editor';exception when sqlstate 'P0002' then null;end;
 begin perform public.update_composed_invoice(v,'2025-09-02','2025-09-01',gen_random_uuid(),p.revision,'{}','[{"description":"Bad edit","quantity":1,"unit":"each","unit_rate":10}]');raise exception using errcode='ZX001',message='Unexpected void RPC edit';exception when sqlstate 'P0002' then null;end;
 perform pg_temp.ready_assert(not exists(select from public.invoice_time_allocations a join public.invoice_items i on i.id=a.invoice_item_id where i.invoice_id=v and a.released_at is null),'Voiding releases source claims');
 insert into public.invoices(customer_id,issue_date) values(c,'2025-09-01') returning id into v;
 begin update public.invoices set status='ready' where id=v;raise exception using errcode='ZX001',message='Empty invoice ready';exception when sqlstate 'P0001' then null;end;
end $$;
reset role;
select pg_temp.ready_assert(not has_table_privilege('authenticated','public.invoices','DELETE'),'No DELETE grant');
rollback;
