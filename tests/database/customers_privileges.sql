-- Local-only checks; fixtures are always rolled back.
-- docker exec -i supabase_db_nexa psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < tests/database/customers_privileges.sql
begin;

do $$
declare
  operation text;
begin
  foreach operation in array array['SELECT', 'INSERT', 'UPDATE'] loop
    if not has_table_privilege('authenticated', 'public.customers', operation) then
      raise exception 'Missing authenticated % privilege', operation;
    end if;
  end loop;
  foreach operation in array array['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.customers', operation) then
      raise exception 'Unexpected authenticated % privilege', operation;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.customers'::regclass) then
    raise exception 'Customers RLS must remain enabled';
  end if;
  raise notice 'PASS: authenticated has only the required table privileges; RLS is enabled';
end;
$$;

set local role authenticated;
do $$
declare
  test_id uuid;
  affected integer;
begin
  insert into public.customers (company_name)
  values ('Transactional customer privilege test') returning id into test_id;

  if not exists (select from public.customers where id = test_id) then
    raise exception 'Authenticated SELECT failed';
  end if;

  update public.customers set company_name = 'Updated transactional test'
  where id = test_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Authenticated UPDATE failed'; end if;

  begin
    delete from public.customers where id = test_id;
    raise exception 'Authenticated DELETE should have been denied';
  exception when insufficient_privilege then
    null;
  end;

  raise notice 'PASS: authenticated INSERT, SELECT and UPDATE work; DELETE is denied';
end;
$$;
reset role;
rollback;
