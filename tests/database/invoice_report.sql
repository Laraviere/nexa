begin;
create function pg_temp.report_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
create function pg_temp.report_invalid(command text) returns void language plpgsql as $$begin
 begin execute command;exception when sqlstate '22023' then return;end;
 raise exception 'Unexpected accepted input: %',command;
end $$;
create function pg_temp.report_invoice(c uuid,d date,due date,amount numeric,state text) returns uuid language plpgsql as $$declare v uuid;begin
 select invoice_id into v from public.create_manual_invoice(c,d,jsonb_build_array(jsonb_build_object('description','Report fixture','quantity',1,'unit','flat','unit_rate',amount)),gen_random_uuid());
 update public.invoices set due_date=due where id=v;
 if state<>'draft' then update public.invoices set status=state where id=v;end if;
 return v;
end $$;
set local role authenticated;
create temp table report_fixture(label text,id uuid);
do $$
declare c1 uuid;c2 uuid;v uuid;r record;all_report record;bad text;expected jsonb;before_data jsonb;original_timezone text:=current_setting('TimeZone');
begin
 insert into public.customers(company_name) values('Market 58') returning id into c1;
 insert into public.customers(company_name) values('Alpha 100%_literal') returning id into c2;
 insert into report_fixture values('draft',pg_temp.report_invoice(c1,'2026-09-01','2026-09-02',100,'draft'));
 v:=pg_temp.report_invoice(c1,'2026-09-02','2026-09-10',200,'ready');insert into report_fixture values('ready',v);
 perform public.record_invoice_payment(v,50,'2026-09-03','cash',gen_random_uuid());
 v:=pg_temp.report_invoice(c1,'2026-09-03','2026-09-04',300,'sent');insert into report_fixture values('sent',v);
 perform public.record_invoice_payment(v,150,'2026-09-04','check',gen_random_uuid());
 v:=pg_temp.report_invoice(c2,'2026-09-04','2026-09-05',400,'ready');insert into report_fixture values('paid',v);
 perform public.record_invoice_payment(v,400,'2026-09-05','card',gen_random_uuid());
 v:=pg_temp.report_invoice(c2,'2026-09-05','2026-09-06',500,'ready');insert into report_fixture values('void',v);
 perform public.record_invoice_payment(v,100,'2026-09-06','cash',gen_random_uuid());
 update public.invoices set status='void',void_reason='Historical reporting' where id=v;
 insert into report_fixture values('zero',pg_temp.report_invoice(c2,'2026-09-06','2026-09-07',0,'ready'));
 update public.customers set company_name='Renamed market',is_active=false where id=c1;
 select jsonb_build_object('invoices',(select jsonb_agg(to_jsonb(i) order by id) from public.invoices i),'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.invoice_payments p)) into before_data;
 select * into all_report from public.get_invoice_report(p_as_of_date=>'2026-09-10');
 perform pg_temp.report_assert(all_report.total_rows=6 and all_report.invoice_count=6 and all_report.total_pages=1 and all_report.page=1 and all_report.page_size=25 and jsonb_array_length(all_report.rows)=6,'No filters/default pagination');
 perform pg_temp.report_assert(all_report.total_invoiced=1000 and all_report.amount_paid=600 and all_report.outstanding_balance=400,'All includes Void count but excludes Void money');
 perform pg_temp.report_assert(all_report.resolved_as_of_date='2026-09-10','Explicit as-of date');
 perform pg_temp.report_assert((select jsonb_agg(x->>'invoice_id' order by ord) from jsonb_array_elements(all_report.rows) with ordinality j(x,ord))=(select jsonb_agg(i.id::text order by i.issue_date desc,i.invoice_number desc) from public.invoices i),'Newest sorting');
 select * into r from public.get_invoice_report(p_sort=>'oldest',p_as_of_date=>'2026-09-10');
 perform pg_temp.report_assert((select jsonb_agg(x->>'invoice_id' order by ord) from jsonb_array_elements(r.rows) with ordinality j(x,ord))=(select jsonb_agg(i.id::text order by i.issue_date,i.invoice_number) from public.invoices i),'Oldest sorting');
 select * into r from public.get_invoice_report(p_sort=>'highest_balance',p_as_of_date=>'2026-09-10');
 perform pg_temp.report_assert((select jsonb_agg(x->>'invoice_id' order by ord) from jsonb_array_elements(r.rows) with ordinality j(x,ord))=(select jsonb_agg(i.id::text order by s.balance_due desc,i.issue_date desc,i.invoice_number desc) from public.invoices i join public.invoice_payment_summary s on s.invoice_id=i.id),'Highest balance sorting, ties and historical Void balance');
 select * into r from public.get_invoice_report(p_search=>(select invoice_number::text from public.invoices where id=(select id from report_fixture where label='ready')));
 perform pg_temp.report_assert(r.total_rows=1 and r.rows->0->>'invoice_id'=(select id::text from report_fixture where label='ready'),'Exact invoice number search');
 select * into r from public.get_invoice_report(p_search=>'  mArKeT 58  ',p_customer_id=>c1);
 perform pg_temp.report_assert(r.total_rows=3 and r.rows->0->>'company_name_snapshot'='Market 58','Case-insensitive trimmed snapshot search, archived/renamed customer');
 perform pg_temp.report_assert((select total_rows=0 from public.get_invoice_report(p_search=>'Renamed market')),'Search historical snapshot, not current name');
 perform pg_temp.report_assert((select total_rows=3 from public.get_invoice_report(p_search=>'%_')),'Search wildcards are literal');
 perform pg_temp.report_assert((select total_rows=0 from public.get_invoice_report(p_search=>c1::text)),'No UUID search');
 perform pg_temp.report_assert((select total_rows=0 from public.get_invoice_report(p_search=>''' OR true --')),'SQL text cannot broaden search');
 perform pg_temp.report_assert((select total_rows=6 from public.get_invoice_report(p_search=>E' \t\n ')),'Whitespace search is All');
 perform pg_temp.report_assert((select total_rows=1 from public.get_invoice_report(p_workflow_status=>'draft')),'Draft filter');
 perform pg_temp.report_assert((select total_rows=3 from public.get_invoice_report(p_workflow_status=>'ready')),'Ready filter');
 perform pg_temp.report_assert((select total_rows=1 from public.get_invoice_report(p_workflow_status=>'sent')),'Sent filter');
 select * into r from public.get_invoice_report(p_workflow_status=>'void',p_as_of_date=>'2026-09-10');
 perform pg_temp.report_assert(r.total_rows=1 and r.invoice_count=1 and r.total_invoiced=500 and r.amount_paid=100 and r.outstanding_balance=0 and not(r.rows->0->>'overdue')::boolean,'Void historical totals, no outstanding/overdue');
 perform pg_temp.report_assert((select total_rows=1 from public.get_invoice_report(p_payment_status=>'unpaid')),'Unpaid filter');
 perform pg_temp.report_assert((select total_rows=3 from public.get_invoice_report(p_payment_status=>'partially_paid')),'Partial filter');
 perform pg_temp.report_assert((select total_rows=2 from public.get_invoice_report(p_payment_status=>'paid')),'Paid/zero filter');
 perform pg_temp.report_assert((select total_rows=3 from public.get_invoice_report(p_customer_id=>c1)),'Archived customer filter');
 perform pg_temp.report_assert((select total_rows=4 from public.get_invoice_report(p_issue_date_from=>'2026-09-03')),'Inclusive From');
 perform pg_temp.report_assert((select total_rows=3 from public.get_invoice_report(p_issue_date_to=>'2026-09-03')),'Inclusive To');
 perform pg_temp.report_assert((select total_rows=2 from public.get_invoice_report(p_issue_date_from=>'2026-09-03',p_issue_date_to=>'2026-09-04')),'Combined date range');
 select * into r from public.get_invoice_report(p_customer_id=>c1,p_search=>'market',p_workflow_status=>'ready',p_payment_status=>'partially_paid',p_issue_date_from=>'2026-09-02',p_issue_date_to=>'2026-09-02',p_as_of_date=>'2026-09-10');
 perform pg_temp.report_assert(r.invoice_count=1 and r.total_invoiced=200 and r.amount_paid=50 and r.outstanding_balance=150 and not(r.rows->0->>'overdue')::boolean,'Combined filters and due today not overdue');
 select * into r from public.get_invoice_report(p_overdue_only=>true,p_as_of_date=>'2026-09-10');
 perform pg_temp.report_assert(r.total_rows=2 and r.total_invoiced=400 and r.amount_paid=150 and r.outstanding_balance=250,'Overdue-only exact aggregates');
 perform pg_temp.report_assert(not exists(select from jsonb_array_elements(all_report.rows) j where ((j->>'workflow_status'='void' or j->>'payment_status'='paid') and (j->>'overdue')::boolean)),'Paid/zero/Void never overdue');
 select * into r from public.get_invoice_report(p_page=>2,p_page_size=>2,p_as_of_date=>'2026-09-10');
 perform pg_temp.report_assert(r.page=2 and r.page_size=2 and r.total_rows=6 and r.total_pages=3 and jsonb_array_length(r.rows)=2 and r.rows->0=all_report.rows->2 and r.rows->1=all_report.rows->3,'Correct page order');
 perform pg_temp.report_assert(r.invoice_count=6 and r.total_invoiced=1000 and r.amount_paid=600 and r.outstanding_balance=400,'Aggregates span every page');
 select * into r from public.get_invoice_report(p_page=>2147483647,p_page_size=>100);
 perform pg_temp.report_assert(r.total_rows=6 and r.total_pages=1 and r.rows='[]'::jsonb and r.total_invoiced=1000,'Out-of-range page still has totals, offset does not overflow');
 select * into r from public.get_invoice_report(p_search=>'No match');
 perform pg_temp.report_assert(r.total_rows=0 and r.total_pages=0 and r.invoice_count=0 and r.total_invoiced=0 and r.amount_paid=0 and r.outstanding_balance=0 and r.rows='[]'::jsonb,'Empty contract');
 perform pg_temp.report_assert(not exists(select from jsonb_array_elements(all_report.rows) j join public.invoice_payment_summary s on s.invoice_id=(j->>'invoice_id')::uuid where (j->>'invoice_total')::numeric<>s.invoice_total or (j->>'amount_paid')::numeric<>s.amount_paid or (j->>'balance_due')::numeric<>s.balance_due or j->>'payment_status'<>s.payment_status),'Every financial row field matches authoritative summary');
 perform pg_temp.report_assert(not exists(select from jsonb_array_elements(all_report.rows) j where (select count(*) from jsonb_object_keys(j))<>12),'Stable twelve-field JSON row, no internal sort key/items');
 foreach bad in array array[
  'p_workflow_status=>''approved''','p_workflow_status=>''all''','p_payment_status=>''unknown''','p_sort=>''bad''','p_sort=>null',
  'p_page=>0','p_page=>-1','p_page=>null','p_page_size=>0','p_page_size=>101','p_page_size=>null','p_overdue_only=>null',
  'p_issue_date_from=>''2026-09-10'',p_issue_date_to=>''2026-09-01''','p_issue_date_from=>''infinity''','p_issue_date_to=>''-infinity''','p_as_of_date=>''infinity''','p_search=>repeat(''a'',501)'
 ] loop perform pg_temp.report_invalid('select * from public.get_invoice_report('||bad||')');end loop;
 perform set_config('TimeZone','Pacific/Auckland',true);
 perform pg_temp.report_assert((select resolved_as_of_date=(now() at time zone 'America/New_York')::date from public.get_invoice_report()),'NY default independent of session timezone');
 perform set_config('TimeZone',original_timezone,true);
 perform pg_temp.report_assert(before_data=jsonb_build_object('invoices',(select jsonb_agg(to_jsonb(i) order by id) from public.invoices i),'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.invoice_payments p)),'Reports do not mutate invoice/payment history');
end $$;
-- Exact decimal sums and same-date invoice-number tie breakers.
do $$declare c uuid;a uuid;b uuid;r record;begin
 insert into public.customers(company_name) values('Decimal fixture') returning id into c;
 a:=pg_temp.report_invoice(c,'2026-10-01','2026-10-02',0.10,'ready');
 b:=pg_temp.report_invoice(c,'2026-10-01','2026-10-02',0.20,'ready');
 perform public.record_invoice_payment(a,0.10,'2026-10-01','cash',gen_random_uuid());
 select * into r from public.get_invoice_report(p_customer_id=>c);
 perform pg_temp.report_assert(r.total_invoiced=0.30 and r.amount_paid=0.10 and r.outstanding_balance=0.20,'Exact fractional-cent-free numeric sums');
 perform pg_temp.report_assert(r.rows->0->>'invoice_id'=b::text,'Newest same-date invoice number descending');
 select * into r from public.get_invoice_report(p_customer_id=>c,p_sort=>'oldest');
 perform pg_temp.report_assert(r.rows->0->>'invoice_id'=a::text,'Oldest same-date invoice number ascending');
end $$;
reset role;
select pg_temp.report_assert((select not prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where oid='public.get_invoice_report(text,text,text,uuid,date,date,boolean,text,integer,integer,date)'::regprocedure),'Stable invoker and empty search_path');
select pg_temp.report_assert(has_function_privilege('authenticated','public.get_invoice_report(text,text,text,uuid,date,date,boolean,text,integer,integer,date)','EXECUTE'),'Authenticated execute');
select pg_temp.report_assert(not has_function_privilege('anon','public.get_invoice_report(text,text,text,uuid,date,date,boolean,text,integer,integer,date)','EXECUTE') and not has_function_privilege('service_role','public.get_invoice_report(text,text,text,uuid,date,date,boolean,text,integer,integer,date)','EXECUTE'),'Anon and service_role cannot execute');
-- Restrict SELECT to one fixture: both the page and all aggregates must follow RLS.
create policy report_test_invoice_subset on public.invoices as restrictive for select to authenticated using (id=(select id from report_fixture where label='ready'));
set local role authenticated;
select pg_temp.report_assert(total_rows=1 and invoice_count=1 and total_invoiced=200 and amount_paid=50 and outstanding_balance=150 and jsonb_array_length(rows)=1,'Caller RLS applies to rows AND totals') from public.get_invoice_report();
reset role;
set local role anon;
do $$begin
 begin perform public.get_invoice_report();raise exception 'Anon unexpectedly executed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
