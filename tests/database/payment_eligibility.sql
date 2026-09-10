begin;
create function pg_temp.eligible_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
create function pg_temp.eligible_reject(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then
  if sqlstate=expected then return;end if;raise;
 end;
 raise exception 'Unexpected success: %',command;
end $$;
set local role authenticated;
do $$
declare c uuid;v uuid;p record;r record;preview record;n integer;workflow text;k uuid:=gen_random_uuid();
begin
 insert into public.customers(company_name) values('Payment eligibility') returning id into c;
 select invoice_id,invoice_number into v,n from public.create_manual_invoice(c,'2026-09-10','[{"description":"Work","quantity":1,"unit":"flat","unit_rate":100}]',gen_random_uuid());
 perform pg_temp.eligible_reject(format('select public.record_invoice_payment(%L,20,''2026-09-10'',''cash'',%L)',v,k),'P1001');
 perform pg_temp.eligible_reject(format('insert into public.invoice_payments(invoice_id,amount,payment_method,request_id) values(%L,20,''cash'',%L)',v,k),'P1001');
 perform pg_temp.eligible_assert((select payment_count=0 and amount_paid=0 and balance_due=100 from public.invoice_payment_summary where invoice_id=v),'Draft rejection has no ledger effect');
 update public.invoices set status='ready' where id=v;
 select * into p from public.record_invoice_payment(v,20,'2026-09-10','cash',k);
 update public.invoices set status='draft' where id=v;
 select * into r from public.record_invoice_payment(v,20,'2026-09-10','cash',k);
 perform pg_temp.eligible_assert(r.payment_id=p.payment_id and r.payment_count=1 and r.amount_paid=20 and r.balance_due=80,'Existing Draft payment exact retry and summary');
 perform pg_temp.eligible_reject(format('select public.record_invoice_payment(%L,1,''2026-09-10'',''cash'',%L)',v,gen_random_uuid()),'P1001');
 -- Corrections are allowed even on Draft; this rule is INSERT-only.
 perform public.void_invoice_payment(p.payment_id,'Historical correction');
 perform pg_temp.eligible_assert((select payment_count=0 and amount_paid=0 and balance_due=100 from public.invoice_payment_summary where invoice_id=v),'Draft historical void remains supported');
 select * into r from public.record_invoice_payment(v,20,'2026-09-10','cash',k);
 perform pg_temp.eligible_assert(r.payment_id=p.payment_id and r.payment_voided_at is not null and r.payment_count=0,'Draft retry cannot resurrect a voided payment');
 update public.invoices set status='ready' where id=v;
 perform public.record_invoice_payment(v,30,'2026-09-10','check',gen_random_uuid());
 foreach workflow in array array['ready','sent'] loop
  update public.invoices set status=workflow where id=v;
  select * into preview from public.preview_invoice_edit(v,'2026-09-10');
  perform public.update_composed_invoice(v,'2026-09-10','2026-09-10',gen_random_uuid(),preview.revision,'{}','[{"description":"Editable","quantity":1,"unit":"flat","unit_rate":100}]');
  set constraints all immediate;set constraints all deferred;
  perform pg_temp.eligible_assert((select status=workflow and invoice_number=n from public.invoices where id=v),'Ready/Sent edit preserves workflow and number');
  select * into preview from public.preview_invoice_edit(v,'2026-09-10');
  begin
   perform public.update_composed_invoice(v,'2026-09-10','2026-09-10',gen_random_uuid(),preview.revision,'{}','[{"description":"Too low","quantity":1,"unit":"flat","unit_rate":20}]');
   set constraints all immediate;
   raise exception 'Unexpected below-payment edit';
  exception when check_violation then null;end;
  perform pg_temp.eligible_assert((select invoice_total=100 and amount_paid=30 and balance_due=70 from public.invoice_payment_summary where invoice_id=v),'Ready/Sent below-payment edit rolls back');
 end loop;
 perform public.record_invoice_payment(v,70,'2026-09-10','card',gen_random_uuid());
 perform pg_temp.eligible_assert((select payment_status='paid' and balance_due=0 and amount_paid=100 from public.invoice_payment_summary where invoice_id=v),'Sent payment fills exact remaining balance');
 perform pg_temp.eligible_reject(format('select public.record_invoice_payment(%L,1,''2026-09-10'',''cash'',%L)',v,gen_random_uuid()),'22023');
 update public.invoices set status='void',void_reason='Eligibility test' where id=v;
 perform pg_temp.eligible_reject(format('select public.record_invoice_payment(%L,1,''2026-09-10'',''cash'',%L)',v,gen_random_uuid()),'22023');
 perform pg_temp.eligible_reject(format('insert into public.invoice_payments(invoice_id,amount,payment_method,request_id) values(%L,1,''cash'',%L)',v,gen_random_uuid()),'22023');
 perform pg_temp.eligible_assert((select count(*)=3 from public.invoice_payments where invoice_id=v),'All history remains, including correction');
end $$;
set constraints all immediate;
rollback;
