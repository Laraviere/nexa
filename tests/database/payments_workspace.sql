begin;
create function pg_temp.assert_payment(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
set local role authenticated;
do $$
declare c uuid;v uuid;w uuid;p uuid;r record;num bigint;d date:=(now() at time zone 'America/New_York')::date;method text;
begin
 perform public.update_payment_settings(true,true,true,true,true);
 begin perform public.update_payment_settings(false,false,false,false,false);raise exception 'Empty settings allowed';exception when sqlstate '22023' then null;end;
 insert into public.customers(company_name) values('Workspace Ledger Alpha') returning id into c;
 select invoice_id,invoice_number into v,num from public.create_manual_invoice(c,d,'[{"description":"Work","quantity":1,"unit":"flat","unit_rate":1000}]',gen_random_uuid());
 update public.invoices set status='ready' where id=v;
 foreach method in array array['cash','check','card','ach','other'] loop
   perform public.record_invoice_payment(v,10,d-1,method,gen_random_uuid(),'Workspace receipt 123');
 end loop;
 select * into r from public.get_payment_report(p_customer_id=>c,p_page_size=>2);
 perform pg_temp.assert_payment(r.total_rows=5 and r.total_pages=3 and jsonb_array_length(r.rows)=2 and r.payments_received=50 and r.payment_count=5 and r.average_payment=10,'Complete filtered totals across pages');
 select * into r from public.get_payment_report(p_search=>num::text,p_customer_id=>c,p_page=>3,p_page_size=>2);
 perform pg_temp.assert_payment(r.total_rows=5 and jsonb_array_length(r.rows)=1 and r.payments_received=50,'Invoice search and last page');
 select * into r from public.get_payment_report(p_search=>'ledger alpha',p_customer_id=>c,p_method=>'ach');
 perform pg_temp.assert_payment(r.total_rows=1 and r.payments_received=10,'Customer search and ACH filter');
 select * into r from public.get_payment_report(p_search=>'receipt 123',p_customer_id=>c,p_payment_date_from=>d-1,p_payment_date_to=>d-1);
 perform pg_temp.assert_payment(r.total_rows=5,'Reference and inclusive payment date range');
 select * into r from public.get_payment_report(p_customer_id=>c,p_payment_date_from=>d);
 perform pg_temp.assert_payment(r.total_rows=0 and r.payments_received=0,'Payment date not invoice issue date');
 select id into p from public.invoice_payments where invoice_id=v and payment_method='ach';
 perform public.void_invoice_payment(p,'Correction');
 select * into r from public.get_payment_report(p_customer_id=>c,p_status=>'all');
 perform pg_temp.assert_payment(r.total_rows=5 and r.payment_count=4 and r.payments_received=40,'Voided history excluded from cards');
 select * into r from public.get_payment_report(p_customer_id=>c,p_status=>'voided');
 perform pg_temp.assert_payment(r.total_rows=1 and r.payment_count=0 and r.rows->0->>'payment_status'='voided','Voided filter and distinct status');
 perform public.update_payment_settings(true,true,true,false,false);
 foreach method in array array['ach','other'] loop
  begin perform public.record_invoice_payment(v,1,d,method,gen_random_uuid());raise exception 'Disabled method accepted';exception when sqlstate '22023' then null;end;
 end loop;
 perform public.update_payment_settings(true,true,true,true,true);
 begin perform public.record_invoice_payment(v,1,d+1,'cash',gen_random_uuid());raise exception 'Future RPC accepted';exception when sqlstate '22023' then null;end;
 begin insert into public.invoice_payments(invoice_id,amount,payment_date,payment_method,request_id) values(v,1,d+1,'cash',gen_random_uuid());raise exception 'Future direct insert accepted';exception when sqlstate '22023' then null;end;
 select invoice_id into w from public.create_manual_invoice(c,d,'[{"description":"Other","quantity":1,"unit":"flat","unit_rate":100}]',gen_random_uuid());
 update public.invoices set status='sent' where id=w;
 perform public.record_invoice_payment(w,20,d,'other',gen_random_uuid());
 update public.invoices set status='void',void_reason='Historical invoice' where id=w;
 select * into r from public.get_payment_report(p_customer_id=>c);
 perform pg_temp.assert_payment(r.total_rows=5 and r.payments_received=40 and r.payment_count=4,'Void parent excluded from cards only');
 perform pg_temp.assert_payment(exists(select from jsonb_array_elements(r.rows) x where x->>'invoice_status'='void' and x->>'payment_status'='active'),'Active payment with separate invoice Void');
 begin update public.invoice_payments set amount=1 where id=p;raise exception 'Edit accepted';exception when sqlstate '55000' then null;end;
 perform pg_temp.assert_payment(not has_table_privilege('authenticated','public.invoice_payments','DELETE'),'No DELETE');
 perform pg_temp.assert_payment(not has_function_privilege('anon','public.get_payment_report(text,date,date,uuid,text,text,integer,integer)','EXECUTE'),'Anon denied');
 perform pg_temp.assert_payment((select not prosecdef and provolatile='s' from pg_proc where oid='public.get_payment_report(text,date,date,uuid,text,text,integer,integer)'::regprocedure),'Stable invoker report');
end $$;
reset role;
-- A restrictive test policy must affect both the report rows and totals.
create policy workspace_test_no_rows on public.invoice_payments as restrictive for select to authenticated using(false);
set local role authenticated;
select pg_temp.assert_payment((select total_rows=0 and payment_count=0 and payments_received=0 and rows='[]'::jsonb from public.get_payment_report(p_status=>'all')),'Report cannot bypass caller RLS');
rollback;
