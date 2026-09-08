-- Local-only fixtures and helpers; every change is rolled back.
-- docker exec -i supabase_db_nexa psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < tests/database/change_customer_billing_terms.sql
begin;

create function pg_temp.agreement(starts date, ends date default null, enabled boolean default true,
  customer uuid default null) returns public.customer_billing_agreements language plpgsql as $$
declare result public.customer_billing_agreements;
begin
  if customer is null then
    insert into public.customers(company_name) values ('Atomic terms regression') returning id into customer;
  end if;
  insert into public.customer_billing_agreements
    (customer_id, effective_date, end_date, is_active, monthly_fee, included_hours, overage_hourly_rate)
  values (customer, starts, ends, enabled, 500, 1, 125) returning * into result;
  return result;
end;
$$;

create function pg_temp.change_terms(predecessor uuid, starts date, terms jsonb default '{}')
returns public.customer_billing_agreements language sql as $$
  select public.change_customer_billing_terms(predecessor, starts,
    (case when terms ? 'fee' then terms->>'fee' else '650' end)::numeric,
    (case when terms ? 'hours' then terms->>'hours' else '2' end)::numeric,
    (case when terms ? 'rate' then terms->>'rate' else '150' end)::numeric,
    (case when terms ? 'day' then terms->>'day' else '12' end)::integer,
    (case when terms ? 'advance' then terms->>'advance' else 'false' end)::boolean,
    (case when terms ? 'rounding' then terms->>'rounding' else '30' end)::integer,
    (case when terms ? 'rollover' then terms->>'rollover' else 'true' end)::boolean,
    (terms->>'end')::date);
$$;

create function pg_temp.rejected(predecessor uuid, starts date, expected_state text,
  terms jsonb default '{}') returns void language plpgsql as $$
declare
  before_rows jsonb;
  after_rows jsonb;
  actual_state text;
begin
  select jsonb_agg(to_jsonb(a) order by id) into before_rows
    from public.customer_billing_agreements a
    where customer_id = (select customer_id from public.customer_billing_agreements where id = predecessor);
  begin
    perform pg_temp.change_terms(predecessor, starts, terms);
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
  end;
  if actual_state is distinct from expected_state then
    raise exception 'Expected rejection %, got % for %', expected_state, actual_state, terms;
  end if;
  select jsonb_agg(to_jsonb(a) order by id) into after_rows
    from public.customer_billing_agreements a
    where customer_id = (select customer_id from public.customer_billing_agreements where id = predecessor);
  if before_rows is distinct from after_rows then
    raise exception 'Failure changed predecessor or left a successor behind';
  end if;
end;
$$;

set local role authenticated;
-- Synthetic local JWT context, not a credential or a production auth user.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  today date := (clock_timestamp() at time zone 'America/New_York')::date;
  original public.customer_billing_agreements;
  ended public.customer_billing_agreements;
  successor public.customer_billing_agreements;
  candidate public.customer_billing_agreements;
  bad_terms jsonb;
  signature regprocedure := 'public.change_customer_billing_terms(uuid,date,numeric,numeric,numeric,integer,boolean,integer,boolean,date)'::regprocedure;
  table_name text;
begin
  original := pg_temp.agreement(today - 30);
  successor := pg_temp.change_terms(original.id, today);
  select * into ended from public.customer_billing_agreements where id = original.id;
  if ended.end_date is distinct from successor.effective_date or successor.end_date is not null
    or successor.customer_id <> original.customer_id or successor.id = original.id
    or not successor.is_active or successor.created_at is null or successor.updated_at is null then
    raise exception 'Open-ended replacement or adjacency incorrect';
  end if;
  if (to_jsonb(ended) - 'end_date' - 'updated_at') is distinct from
    (to_jsonb(original) - 'end_date' - 'updated_at') then
    raise exception 'Original historical terms changed';
  end if;
  if successor.monthly_fee <> 650 or successor.included_hours <> 2
    or successor.overage_hourly_rate <> 150 or successor.billing_cycle_day <> 12
    or successor.bill_in_advance or successor.rounding_increment_minutes <> 30
    or not successor.rollover_enabled then
    raise exception 'Successor terms incorrect';
  end if;
  if (select count(*) from public.customer_billing_agreements where customer_id = original.customer_id) <> 2 then
    raise exception 'Expected both history and successor';
  end if;
  raise notice 'PASS: authenticated open-ended replacement, adjacency, old history and all new terms';

  original := pg_temp.agreement(today - 30);
  -- These constraints fail during INSERT, after the predecessor UPDATE.
  for bad_terms in select value from jsonb_array_elements('[
    {"fee":-1}, {"fee":"NaN"}, {"fee":"Infinity"}, {"fee":null}, {"fee":10000000000},
    {"hours":-1}, {"hours":"NaN"}, {"rate":-1}, {"rate":"NaN"},
    {"day":0}, {"day":29}, {"rounding":0}, {"rounding":-1},
    {"advance":null}, {"rollover":null}
  ]'::jsonb) loop
    perform pg_temp.rejected(original.id, today, '22023', bad_terms);
  end loop;
  raise notice 'PASS: 15 failed successor INSERTs each roll back the entire operation';

  perform pg_temp.rejected(original.id, null, '22023');
  perform pg_temp.rejected(original.id, 'infinity', '22023');
  perform pg_temp.rejected(original.id, '-infinity', '22023');
  perform pg_temp.rejected(original.id, today - 1, '22023');
  perform pg_temp.rejected(original.id, today, '22023', jsonb_build_object('end', today - 1));
  perform pg_temp.rejected(original.id, today, '22023', '{"end":"infinity"}');
  perform pg_temp.rejected(original.id, today, '22023', '{"end":"-infinity"}');
  perform pg_temp.rejected(gen_random_uuid(), today, 'P0002');
  raise notice 'PASS: invalid/missing dates and missing predecessor rejected without mutation';

  original := pg_temp.agreement(today - 30, today);
  perform pg_temp.rejected(original.id, today, '55000');
  original := pg_temp.agreement(today, today);
  perform pg_temp.rejected(original.id, today, '55000');
  original := pg_temp.agreement(today + 10, today + 10);
  perform pg_temp.rejected(original.id, today + 10, '55000');
  original := pg_temp.agreement(today - 1, null, false);
  perform pg_temp.rejected(original.id, today, '55000');
  raise notice 'PASS: historical, zero-length and disabled predecessors rejected';

  original := pg_temp.agreement(today + 10);
  perform pg_temp.rejected(original.id, today + 9, '22023');
  successor := pg_temp.change_terms(original.id, today + 20);
  if successor.effective_date <> today + 20 or successor.end_date is not null then
    raise exception 'Future replacement failed';
  end if;
  -- Old row is still future/nonempty, but a successor now exists. Neither a
  -- repeated call nor an attempted overlapping extension can rewrite it.
  perform pg_temp.rejected(original.id, today + 15, '55000');
  raise notice 'PASS: future replacement succeeds; repeat/overlap attempt preserves both rows';

  original := pg_temp.agreement(today - 10, today + 30);
  perform pg_temp.rejected(original.id, today + 30, '22023');
  perform pg_temp.rejected(original.id, today, '22023', jsonb_build_object('end', today + 31));
  successor := pg_temp.change_terms(original.id, today + 1);
  if successor.end_date <> today + 30 then raise exception 'Lost scheduled cancellation'; end if;
  candidate := pg_temp.change_terms(successor.id, today + 2, jsonb_build_object('end', today + 20));
  if candidate.end_date <> today + 20 then raise exception 'Explicit earlier end ignored'; end if;
  raise notice 'PASS: scheduled cancellation preserved; shortening allowed, extension rejected';

  original := pg_temp.agreement(today);
  successor := pg_temp.change_terms(original.id, today);
  select * into ended from public.customer_billing_agreements where id = original.id;
  if not isempty(daterange(ended.effective_date, ended.end_date, '[)'))
    or successor.effective_date <> today or successor.end_date is not null then
    raise exception 'Same-day replacement incorrect';
  end if;
  if (select count(*) from public.customer_billing_agreements where customer_id = original.customer_id
    and is_active and effective_date <= today and (end_date is null or end_date > today)) <> 1 then
    raise exception 'Same-day replacement did not resolve exactly one current agreement';
  end if;
  perform pg_temp.rejected(original.id, today, '55000');
  -- Empty history is ignored when replacing its live successor.
  candidate := pg_temp.change_terms(successor.id, today + 2, jsonb_build_object('end', today + 2));
  if not isempty(daterange(candidate.effective_date, candidate.end_date, '[)')) then
    raise exception 'Same-day successor end should be allowed';
  end if;
  raise notice 'PASS: same-day predecessor/successor empty ranges and current resolution';

  original := pg_temp.agreement(today - 1, today + 10);
  candidate := pg_temp.agreement(today + 20, null, false, original.customer_id);
  perform pg_temp.rejected(original.id, today, '55000');
  raise notice 'PASS: later inactive agreement still protects chronology';

  if not has_function_privilege('authenticated', signature, 'EXECUTE')
    or has_function_privilege('anon', signature, 'EXECUTE')
    or has_function_privilege('service_role', signature, 'EXECUTE')
    or exists (select from pg_proc p, lateral aclexplode(p.proacl) acl
      where p.oid = signature and acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
    or exists (select from pg_proc where oid = signature and prosecdef)
    or not exists (select from pg_proc where oid = signature and proconfig @> array['search_path=""']) then
    raise exception 'Incorrect RPC security or grants';
  end if;
  foreach table_name in array array['public.customers', 'public.customer_billing_agreements'] loop
    if not has_table_privilege('authenticated', table_name, 'SELECT')
      or not has_table_privilege('authenticated', table_name, 'INSERT')
      or not has_table_privilege('authenticated', table_name, 'UPDATE')
      or has_table_privilege('authenticated', table_name, 'DELETE')
      or has_table_privilege('authenticated', table_name, 'TRUNCATE') then
      raise exception 'Unexpected table privileges: %', table_name;
    end if;
    if not (select relrowsecurity from pg_class where oid = table_name::regclass) then
      raise exception 'RLS disabled: %', table_name;
    end if;
  end loop;
  begin
    delete from public.customer_billing_agreements where id = original.id;
    raise exception 'DELETE unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: invoker, safe search_path, explicit function ACL, table grants, RLS and DELETE denial';

  perform set_config('request.jwt.claims', '{}', true);
  perform pg_temp.rejected(original.id, today, '42501');
  raise notice 'PASS: missing authenticated identity rejected';
end;
$$;

set local role anon;
do $$
begin
  begin
    perform public.change_customer_billing_terms(gen_random_uuid(), current_date, 1, 1, 1, 1, true, 15, false);
    raise exception 'anon unexpectedly executed the function';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: actual anon RPC execution denied';
end;
$$;
reset role;
rollback;
