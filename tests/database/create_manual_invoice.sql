begin;
create function pg_temp.manual_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.manual_reject(command text, expected_state text default '22023') returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise exception 'Unexpected SQLSTATE %, expected %: %',sqlstate,expected_state,sqlerrm;
  end;
  raise exception 'Unexpected success: %',command;
end $$;
set local role authenticated;
do $$
declare c uuid; req uuid := gen_random_uuid(); result record; retry record; items jsonb;
  bad jsonb; invoice_count bigint; item_count bigint;
begin
  insert into public.customers(company_name,email,billing_city,default_payment_terms_days)
    values('RPC snapshot','rpc@example.test','Boston',30) returning id into c;
  items := '[{"description":"Consulting","quantity":1.5,"unit":"hour","unit_rate":120,"tax_amount":2.50},
    {"description":"Travel","quantity":15,"unit":"mile","unit_rate":0.70}]';
  select * into strict result from public.create_manual_invoice(c,'2026-09-01',items,req,'Notes','Terms');
  perform pg_temp.manual_assert(result.invoice_number>=1001 and result.status='draft','Database number and draft');
  perform pg_temp.manual_assert(result.company_name_snapshot='RPC snapshot' and result.due_date='2026-10-01','Snapshots and due date');
  perform pg_temp.manual_assert(result.subtotal=190.50 and result.tax_total=2.50 and result.total=193,'Authoritative totals');
  perform pg_temp.manual_assert((select email_snapshot='rpc@example.test' and billing_city_snapshot='Boston' and payment_terms_days_snapshot=30 from public.invoices where id=result.invoice_id),'Full customer snapshots');
  perform pg_temp.manual_assert((select array_agg(description order by position)=array['Consulting','Travel'] and array_agg(position order by position)=array[1,2] and bool_and(source_type='manual' and billing_agreement_id is null and billed_minutes is null) from public.invoice_items where invoice_id=result.invoice_id),'Ordered manual-only rows');
  perform pg_temp.manual_assert(not exists(select from public.invoice_time_allocations),'No source allocations');
  select count(*) into invoice_count from public.invoices;
  select count(*) into item_count from public.invoice_items;
  -- currval is deliberately unavailable to authenticated; compare through the
  -- privileged outer harness below for the sequence-not-consumed assertion.
  select * into strict retry from public.create_manual_invoice(c,'2026-09-01',items,req,'Notes','Terms');
  perform pg_temp.manual_assert(retry.invoice_id=result.invoice_id and retry.invoice_number=result.invoice_number,'Identical retry');
  items := '[{"unit_rate":"120.00","unit":"hour","quantity":"1.50000000","description":"Consulting","tax_amount":"2.5"},
    {"quantity":"15","description":"Travel","unit":"mile","tax_amount":0,"unit_rate":"0.70"}]';
  select * into strict retry from public.create_manual_invoice(c,'2026-09-01',items,req,'Notes','Terms');
  perform pg_temp.manual_assert(retry.invoice_id=result.invoice_id,'Equivalent decimal representations normalize');
  perform pg_temp.manual_assert((select count(*)=invoice_count from public.invoices) and (select count(*)=item_count from public.invoice_items),'Retries create no rows');
  perform pg_temp.manual_reject(format('select * from public.create_manual_invoice(%L,''2026-09-02'',%L,%L,''Notes'',''Terms'')',c,items,req));
  perform pg_temp.manual_reject(format('select * from public.create_manual_invoice(%L,''2026-09-01'',%L,%L,''Different notes'',''Terms'')',c,items,req));
  perform pg_temp.manual_reject(format('select * from public.create_manual_invoice(%L,''2026-09-01'',%L,%L,''Notes'',''Terms'')',c,jsonb_build_array((items->0)||'{"quantity":2}',items->1),req));
  perform pg_temp.manual_reject(format('select * from public.create_manual_invoice(%L,''infinity'',%L,gen_random_uuid())',c,items));
  perform pg_temp.manual_reject(format('select * from public.create_manual_invoice(%L,''2026-09-01'',''[]'',gen_random_uuid())',c));
  perform pg_temp.manual_reject(format('select * from public.create_manual_invoice(%L,''2026-09-01'',null,gen_random_uuid())',c));
  perform pg_temp.manual_reject(format('select * from public.create_manual_invoice(%L,''2026-09-01'',%L,null)',c,items));
  perform pg_temp.manual_reject(format('select * from public.create_manual_invoice(gen_random_uuid(),''2026-09-01'',%L,gen_random_uuid())',items),'P0002');
  for bad in select value from jsonb_array_elements('[
    {"description":"  "},{"quantity":0},{"quantity":-1},{"quantity":"NaN"},{"quantity":"Infinity"},
    {"quantity":"0.000000001"},{"quantity":"1000000000000"},{"quantity":null},
    {"unit_rate":-1},{"unit_rate":"NaN"},{"unit_rate":"Infinity"},{"unit_rate":"1.001"},{"unit_rate":"10000000000"},
    {"unit":"unknown"},{"tax_amount":-1},{"tax_amount":"NaN"},{"tax_amount":"0.001"},{"tax_amount":null},
    {"amount":1},{"source_type":"manual"},{"source_type":"retainer_fee"},{"position":9},
    {"billing_agreement_id":null},{"period_start":"2026-09-01"},{"released_at":null},{"created_at":null}
  ]') loop
    perform pg_temp.manual_reject(format('select * from public.create_manual_invoice(%L,''2026-09-01'',%L,gen_random_uuid())',
      c,jsonb_build_array(items->0,(items->1)||bad)));
  end loop;
  perform pg_temp.manual_assert((select count(*)=invoice_count from public.invoices) and (select count(*)=item_count from public.invoice_items),'Invalid second lines leave no header or first line');
  select * into strict retry from public.create_manual_invoice(c,'2026-09-01',jsonb_build_array(items->0),gen_random_uuid());
  perform pg_temp.manual_assert(retry.invoice_id<>result.invoice_id,'New key creates distinct one-line invoice');
  perform pg_temp.manual_reject(format('update public.invoices set creation_request_id=gen_random_uuid() where id=%L',result.invoice_id),'55000');
  perform pg_temp.manual_reject(format('update public.invoices set creation_request_payload=''{}'' where id=%L',result.invoice_id),'55000');
  update public.invoices set notes='Edited draft' where id=result.invoice_id;
  select * into strict retry from public.create_manual_invoice(c,'2026-09-01',items,req,'Notes','Terms');
  perform pg_temp.manual_assert((select notes='Edited draft' from public.invoices where id=retry.invoice_id),'Retry does not undo draft changes');
  update public.invoices set status='sent' where id=result.invoice_id;
  select * into strict retry from public.create_manual_invoice(c,'2026-09-01',items,req,'Notes','Terms');
  perform pg_temp.manual_assert(retry.status='sent','Retry returns persisted lifecycle');
  raise notice 'PASS: manual creation, snapshots, order, totals, precision, protected fields, no partial rows, normalized retries, conflicting reuse and immutable request metadata';
end $$;
reset role;
-- Force an error during the actual second-row INSERT, after the header and
-- first row were written (rather than only proving prevalidation rejection).
create function pg_temp.reject_second_invoice_line() returns trigger language plpgsql as $$
begin if new.position=2 then raise check_violation using message='Injected second-line failure'; end if; return new; end $$;
create trigger test_reject_second_line before insert on public.invoice_items for each row execute function pg_temp.reject_second_invoice_line();
do $$
declare c uuid; key uuid := gen_random_uuid(); headers bigint; lines bigint;
begin
  select id into c from public.customers where company_name='RPC snapshot';
  select count(*) into headers from public.invoices; select count(*) into lines from public.invoice_items;
  perform pg_temp.manual_reject(format('select * from public.create_manual_invoice(%L,''2026-09-01'',%L,%L)',c,
    '[{"description":"First","quantity":1,"unit":"flat","unit_rate":1},{"description":"Second","quantity":1,"unit":"flat","unit_rate":1}]',key));
  perform pg_temp.manual_assert((select count(*)=headers from public.invoices) and (select count(*)=lines from public.invoice_items),'Actual second INSERT failure rolls back header and first item');
  perform pg_temp.manual_assert(not exists(select from public.invoices where creation_request_id=key),'Failed request key is not reserved');
end $$;
drop trigger test_reject_second_line on public.invoice_items;
-- Caller RLS, not owner privileges.
create policy manual_rpc_customer_deny on public.customers as restrictive for select to authenticated using(false);
set local role authenticated;
select pg_temp.manual_reject('select * from public.create_manual_invoice((select customer_id from public.invoices limit 1),''2026-09-01'',''[{"description":"Hidden","quantity":1,"unit":"flat","unit_rate":0}]'',gen_random_uuid())','P0002');
reset role;
set local role anon;
select pg_temp.manual_reject('select * from public.create_manual_invoice(gen_random_uuid(),''2026-09-01'',''[]'',gen_random_uuid())','42501');
reset role;
select pg_temp.manual_assert(not has_function_privilege('anon','public.create_manual_invoice(uuid,date,jsonb,uuid,text,text)','EXECUTE'),'No anonymous EXECUTE');
select pg_temp.manual_assert(not has_function_privilege('service_role','public.create_manual_invoice(uuid,date,jsonb,uuid,text,text)','EXECUTE'),'No service role EXECUTE');
select pg_temp.manual_assert(not (select prosecdef from pg_proc where oid='public.create_manual_invoice(uuid,date,jsonb,uuid,text,text)'::regprocedure),'Security invoker');
rollback;
