-- Local database regression. All fixtures and helper functions roll back.
-- docker exec -i supabase_db_nexa psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < tests/database/time_entries.sql
begin;
create function pg_temp.time_assert(result boolean, description text)
returns void language plpgsql as $$
begin
  if result is distinct from true then raise exception 'FAIL: %', description; end if;
end;
$$;
create function pg_temp.time_reject(statement text, expected_states text[] default array['23514'])
returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute statement;
  exception when others then get stacked diagnostics actual_state = returned_sqlstate;
  end;
  if actual_state is null or not actual_state = any(expected_states) then
    raise exception 'Expected %, got %: %', expected_states, actual_state, statement;
  end if;
end;
$$;

set local role authenticated;
do $$
declare
  retainer_customer uuid;
  hourly_customer uuid;
  old_agreement uuid;
  later_agreement uuid;
  original public.time_entries;
  hourly public.time_entries;
  updated public.time_entries;
  sample public.time_entries;
  actual integer;
  expected bigint;
  bad text;
  assignment text;
begin
  insert into public.customers(company_name) values ('Local time retainer test') returning id into retainer_customer;
  insert into public.customers(company_name) values ('Local time hourly test') returning id into hourly_customer;
  perform set_config('nexa.test_hourly_customer', hourly_customer::text, true);

  insert into public.customer_billing_agreements(customer_id, monthly_fee, included_hours, overage_hourly_rate,
    effective_date, end_date, billing_cycle_day, is_active)
  values (retainer_customer, 500, 1, 125, '2026-08-01', '2026-09-01', 15, true) returning id into old_agreement;
  insert into public.customer_billing_agreements(customer_id, monthly_fee, included_hours, overage_hourly_rate,
    effective_date, billing_cycle_day, rounding_increment_minutes, rollover_enabled)
  values (retainer_customer, 650, 2.5, 150, '2026-09-01', 20, 30, true) returning id into later_agreement;
  perform set_config('nexa.test_time_agreement', old_agreement::text, true);

  insert into public.time_entries(customer_id, work_date, description, actual_minutes,
    hourly_rate, rounding_increment_minutes, billing_cycle_day_snapshot)
  values (retainer_customer, '2026-08-31', 'Printer troubleshooting', 18, 1, 1, 28) returning * into original;
  perform pg_temp.time_assert(original.actual_minutes = 18 and original.rounded_minutes = 30,
    'Manual actual 18 and rounded 30 are both preserved');
  perform pg_temp.time_assert(original.billing_agreement_id = old_agreement and original.hourly_rate = 125
    and original.rounding_increment_minutes = 15 and original.billing_cycle_day_snapshot = 15
    and original.included_hours_snapshot = 1 and not original.rollover_enabled_snapshot,
    'Enabled date-applicable agreement supplies authoritative billing snapshots, including for past work');
  perform pg_temp.time_assert(original.started_at is null and original.ended_at is null, 'Manual timestamps optional');
  raise notice 'PASS: 18 actual / 30 rounded, historical agreement resolution and authoritative snapshots';

  insert into public.time_entries(customer_id, billing_agreement_id, work_date, description, actual_minutes)
  values (retainer_customer, later_agreement, '2026-09-01', 'New terms boundary', 31) returning * into sample;
  perform pg_temp.time_assert(sample.billing_agreement_id = later_agreement and sample.rounded_minutes = 60
    and sample.hourly_rate = 150 and sample.billing_cycle_day_snapshot = 20
    and sample.included_hours_snapshot = 2.5 and sample.rollover_enabled_snapshot,
    'Inclusive successor/exclusive predecessor boundary uses the new agreement and increment');
  insert into public.time_entries(customer_id, work_date, description, actual_minutes, hourly_rate)
  values (retainer_customer, '2026-07-31', 'Before any retainer', 18, 110) returning * into sample;
  perform pg_temp.time_assert(sample.billing_agreement_id is null and sample.hourly_rate = 110, 'No dated agreement before start');
  raise notice 'PASS: agreement reference and date boundaries; non-retainer dates remain supported';

  insert into public.time_entries(customer_id, work_date, description, actual_minutes, hourly_rate)
  values (hourly_customer, '2026-09-08', 'Hourly work', 18, 110.25) returning * into hourly;
  perform pg_temp.time_assert(hourly.billing_agreement_id is null and hourly.hourly_rate = 110.25
    and hourly.rounded_minutes = 30 and hourly.rounding_increment_minutes = 15
    and hourly.billing_cycle_day_snapshot is null and hourly.included_hours_snapshot is null
    and hourly.rollover_enabled_snapshot is null, 'Non-retainer explicit numeric rate and default rounding');
  for actual, expected in select * from (values (1,15), (15,15), (16,30), (18,30), (31,45), (46,60)) pairs loop
    insert into public.time_entries(customer_id, work_date, description, actual_minutes, hourly_rate)
    values (hourly_customer, '2026-09-08', 'Rounding example', actual, 100) returning * into sample;
    perform pg_temp.time_assert(sample.actual_minutes = actual and sample.rounded_minutes = expected, 'Per-entry rounding example');
  end loop;
  insert into public.time_entries(customer_id, work_date, description, actual_minutes, hourly_rate)
  values (hourly_customer, '2026-09-08', 'Per-entry sum', 18, 100),
    (hourly_customer, '2026-09-08', 'Per-entry sum', 18, 100);
  perform pg_temp.time_assert((select sum(actual_minutes) = 36 and sum(rounded_minutes) = 60
    from public.time_entries where customer_id = hourly_customer and description = 'Per-entry sum'),
    'Two 18-minute entries consume 60 minutes, not a rounded monthly total of 45');
  insert into public.time_entries(customer_id, work_date, description, actual_minutes, hourly_rate, rounding_increment_minutes)
  values (hourly_customer, '2026-09-08', 'Overflow boundary', 2147483647, 1, 2147483646) returning * into sample;
  perform pg_temp.time_assert(sample.rounded_minutes = 4294967292, 'Rounding arithmetic does not overflow integer');
  raise notice 'PASS: explicit non-retainer rates, all six rounding examples, per-entry sums and overflow safety';

  insert into public.time_entries(customer_id, work_date, description, actual_minutes, is_billable)
  values (retainer_customer, '2026-08-31', 'Courtesy work', 18, false) returning * into sample;
  perform pg_temp.time_assert(sample.actual_minutes = 18 and sample.rounded_minutes = 0
    and sample.billing_agreement_id = old_agreement, 'Non-billable retainer time consumes zero allowance');
  perform pg_temp.time_assert(not exists (select from public.unbilled_time_entries where id = sample.id), 'Non-billable excluded from unbilled');
  insert into public.time_entries(customer_id, work_date, description, actual_minutes, is_billable)
  values (hourly_customer, '2026-09-08', 'Non-billable hourly work', 18, false) returning * into sample;
  perform pg_temp.time_assert(sample.actual_minutes = 18 and sample.rounded_minutes = 0 and sample.hourly_rate is null, 'Non-billable work does not need an invented hourly rate');
  raise notice 'PASS: non-billable entries preserve actual work and contribute zero billing minutes';

  foreach bad in array array['0', '-1', 'null'] loop
    perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values (%L,%L,%L,%s,100)',
      hourly_customer, '2026-09-08', 'Invalid duration', bad), array['23514','23502']);
  end loop;
  foreach bad in array array['-1', '0', 'null'] loop
    perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate,rounding_increment_minutes) values (%L,%L,%L,18,100,%s)',
      hourly_customer, '2026-09-08', 'Invalid rounding', bad), array['23514','23502']);
  end loop;
  foreach bad in array array['-0.01', 'NaN', 'Infinity', '-Infinity', '10000000000'] loop
    perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values (%L,%L,%L,18,%L::numeric)',
      hourly_customer, '2026-09-08', 'Invalid rate', bad), array['23514','22003']);
  end loop;
  perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,work_date,description,actual_minutes) values (%L,%L,%L,18)',
    hourly_customer, '2026-09-08', 'Missing billable rate'));
  foreach bad in array array['', '   ', E'\n\t'] loop
    perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values (%L,%L,%L,18,100)',
      hourly_customer, '2026-09-08', bad));
  end loop;
  foreach bad in array array['infinity', '-infinity'] loop
    perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values (%L,%L,%L,18,100)',
      hourly_customer, bad, 'Nonfinite date'), array['22023']);
  end loop;
  perform pg_temp.time_reject(format('update public.time_entries set rounded_minutes=1 where id=%L', hourly.id), array['428C9']);
  raise notice 'PASS: invalid duration, rounding, rates, descriptions and dates rejected; generated duration cannot be overwritten';

  perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values (%L,%L,%L,18,100)',
    gen_random_uuid(), '2026-09-08', 'Missing customer'), array['23503']);
  perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,billing_agreement_id,work_date,description,actual_minutes,hourly_rate) values (%L,%L,%L,%L,18,100)',
    hourly_customer, gen_random_uuid(), '2026-09-08', 'Missing agreement'), array['23503']);
  perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,billing_agreement_id,work_date,description,actual_minutes,hourly_rate) values (%L,%L,%L,%L,18,100)',
    hourly_customer, old_agreement, '2026-08-31', 'Wrong customer agreement'), array['23503']);
  perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,billing_agreement_id,work_date,description,actual_minutes) values (%L,%L,%L,%L,18)',
    retainer_customer, old_agreement, '2026-09-01', 'Expired agreement'), array['23503']);
  perform pg_temp.time_reject(format('update public.customer_billing_agreements set customer_id=%L where id=%L',
    hourly_customer, old_agreement), array['23503']);
  raise notice 'PASS: missing customer/agreement and cross-customer/date mismatches rejected; parent movement blocked by composite FK';

  update public.customer_billing_agreements set is_active=false where id=old_agreement;
  perform pg_temp.time_assert((select billing_agreement_id=old_agreement and hourly_rate=125
    and billing_cycle_day_snapshot=15 and included_hours_snapshot=1
    from public.time_entries where id=original.id),
    'Disabling an agreement preserves the existing captured reference and snapshots');
  insert into public.time_entries(customer_id, work_date, description, actual_minutes, hourly_rate)
  values (retainer_customer, '2026-08-31', 'Recorded after disabling', 18, 111) returning * into sample;
  perform pg_temp.time_assert(sample.billing_agreement_id is null and sample.hourly_rate=111
    and sample.rounding_increment_minutes=15 and sample.billing_cycle_day_snapshot is null
    and sample.included_hours_snapshot is null and sample.rollover_enabled_snapshot is null,
    'Disabled date-applicable agreement is not captured for a new entry');
  perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,billing_agreement_id,work_date,description,actual_minutes,hourly_rate) values (%L,%L,%L,%L,18,111)',
    retainer_customer, old_agreement, '2026-08-31', 'Explicit disabled agreement'), array['23503']);
  perform pg_temp.time_reject(format('insert into public.time_entries(customer_id,work_date,description,actual_minutes) values (%L,%L,%L,18)',
    retainer_customer, '2026-08-31', 'Disabled agreement cannot supply a missing hourly rate'));
  raise notice 'PASS: disabled agreements excluded from new automatic/explicit capture; historical references and snapshots remain intact';

  -- Deliberate source-term correction must not silently rewrite time snapshots.
  update public.customer_billing_agreements set overage_hourly_rate=200, rounding_increment_minutes=30,
    billing_cycle_day=28, included_hours=10, rollover_enabled=true where id=old_agreement;
  update public.time_entries set actual_minutes=31, description='Corrected duration' where id=original.id returning * into updated;
  perform pg_temp.time_assert(updated.billing_agreement_id=old_agreement
    and updated.actual_minutes=31 and updated.rounded_minutes=45 and updated.hourly_rate=125
    and updated.rounding_increment_minutes=15 and updated.billing_cycle_day_snapshot=15
    and updated.included_hours_snapshot=1 and not updated.rollover_enabled_snapshot,
    'Ordinary corrections use frozen snapshots, not changed source agreement');
  perform pg_temp.time_assert(updated.updated_at=now(), 'Existing set_updated_at trigger executes');
  foreach assignment in array array['hourly_rate=200', 'rounding_increment_minutes=30', 'billing_cycle_day_snapshot=28',
    'included_hours_snapshot=10', 'rollover_enabled_snapshot=true', 'billing_agreement_id=null',
    'work_date=''2026-08-30''', 'id=gen_random_uuid()', 'created_at=''2000-01-01'''] loop
    perform pg_temp.time_reject(format('update public.time_entries set %s where id=%L', assignment, original.id), array['55000']);
  end loop;
  perform pg_temp.time_assert(exists(select from public.unbilled_time_entries where id=original.id), 'Live billable entry discoverable');
  perform pg_temp.time_reject(format('update public.time_entries set voided_at=now() where id=%L', original.id));
  update public.time_entries set voided_at=now(), void_reason='Duplicate work record' where id=original.id returning * into updated;
  perform pg_temp.time_assert(updated.actual_minutes=31 and updated.rounded_minutes=45
    and not exists(select from public.unbilled_time_entries where id=original.id), 'Void preserves history while excluding unbilled usage');
  perform pg_temp.time_reject(format('delete from public.time_entries where id=%L', original.id), array['42501']);
  raise notice 'PASS: billing snapshots remain immutable, duration corrections reround safely, soft void preserves history and DELETE is denied';

  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate,started_at,ended_at)
  values (hourly_customer,'2026-09-08','Completed timer',18,100,'2026-09-08 13:00Z','2026-09-08 13:18Z') returning * into sample;
  perform pg_temp.time_assert(sample.actual_minutes=18 and sample.rounded_minutes=30, 'Optional completed timer');
  perform pg_temp.time_reject(format('update public.time_entries set ended_at=null where id=%L', sample.id));
  perform pg_temp.time_reject(format('update public.time_entries set ended_at=started_at where id=%L', sample.id));
  perform pg_temp.time_reject(format('update public.time_entries set ended_at=''infinity'' where id=%L', sample.id));
  perform pg_temp.time_reject(format('update public.time_entries set actual_minutes=17 where id=%L', sample.id));
  perform pg_temp.time_reject(format('update public.time_entries set started_at=''2026-09-09 13:00Z'', ended_at=''2026-09-09 13:18Z'' where id=%L', sample.id));
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate,started_at,ended_at)
  values (hourly_customer,'2026-09-08','Exact timer seconds',19,100,'2026-09-08 13:00Z','2026-09-08 13:18:01Z');
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate,started_at,ended_at)
  values (hourly_customer,'2026-09-08','Exclusive midnight end',18,100,'2026-09-09 03:42Z','2026-09-09 04:00Z') returning * into sample;
  perform pg_temp.time_reject(format('update public.time_entries set actual_minutes=19, ended_at=''2026-09-09 04:01Z'' where id=%L', sample.id));
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate,started_at,ended_at)
  values (hourly_customer,'2026-11-01','DST long business date',1500,100,'2026-11-01 04:00Z','2026-11-02 05:00Z');
  raise notice 'PASS: completed timer evidence, exact seconds, exclusive midnight, New York date and DST constraints';

  perform pg_temp.time_assert(has_table_privilege('authenticated','public.time_entries','SELECT')
    and has_table_privilege('authenticated','public.time_entries','INSERT')
    and has_table_privilege('authenticated','public.time_entries','UPDATE')
    and not has_table_privilege('authenticated','public.time_entries','DELETE')
    and not has_table_privilege('authenticated','public.time_entries','TRUNCATE'), 'Authenticated table privileges');
  perform pg_temp.time_assert(has_table_privilege('authenticated','public.unbilled_time_entries','SELECT')
    and not has_table_privilege('authenticated','public.unbilled_time_entries','INSERT')
    and not has_table_privilege('authenticated','public.unbilled_time_entries','UPDATE')
    and not has_table_privilege('authenticated','public.unbilled_time_entries','DELETE'), 'Unbilled view is read-only');
  perform pg_temp.time_assert((select relrowsecurity from pg_class where oid='public.time_entries'::regclass)
    and (select count(*)=3 from pg_policies where schemaname='public' and tablename='time_entries')
    and not exists(select from pg_policies where schemaname='public' and tablename='time_entries' and cmd in ('ALL','DELETE')), 'RLS SELECT/INSERT/UPDATE only');
  perform pg_temp.time_assert((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.unbilled_time_entries'::regclass), 'Unbilled view uses invoker RLS');
  perform pg_temp.time_assert(not has_function_privilege('authenticated','public.capture_time_entry_billing()','EXECUTE'), 'Trigger helper not exposed as an application RPC');
  raise notice 'PASS: authenticated SELECT/INSERT/UPDATE only, caller RLS, read-only unbilled view and no helper RPC access';
end;
$$;
reset role;

-- Privilege-independent FK checks: even the local owner cannot cascade away
-- a referenced customer or agreement. All affected IDs are test fixtures.
select pg_temp.time_reject(format('delete from public.customers where id=%L', current_setting('nexa.test_hourly_customer')), array['23503']);
select pg_temp.time_reject(format('delete from public.customer_billing_agreements where id=%L', current_setting('nexa.test_time_agreement')), array['23503']);

set local role anon;
select pg_temp.time_reject('select * from public.time_entries', array['42501']);
select pg_temp.time_reject('select * from public.unbilled_time_entries', array['42501']);
select pg_temp.time_reject('insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values (gen_random_uuid(),current_date,''Anon'',18,100)', array['42501']);
select pg_temp.time_reject('update public.time_entries set actual_minutes=1', array['42501']);
select pg_temp.time_reject('delete from public.time_entries', array['42501']);
reset role;
do $$ begin raise notice 'PASS: restrictive parent FKs and actual anonymous SELECT/INSERT/UPDATE/DELETE denial'; end; $$;

-- Production's policies currently permit all authenticated rows. Add a temporary
-- restrictive policy to prove the view actually enforces the caller's RLS.
-- Customer UUIDs double as synthetic JWT subjects; no real users/data are used.
do $$
declare a uuid; b uuid;
begin
  insert into public.customers(company_name) values ('Local RLS user A') returning id into a;
  insert into public.customers(company_name) values ('Local RLS user B') returning id into b;
  perform set_config('nexa.test_rls_a', a::text, true);
  perform set_config('nexa.test_rls_b', b::text, true);
  insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate)
  values (a,'2026-09-08','RLS fixture A',18,100), (b,'2026-09-08','RLS fixture B',18,100);
end;
$$;
create policy time_entries_test_caller_scope on public.time_entries
  as restrictive for select to authenticated using (customer_id=auth.uid());
select pg_temp.time_assert((select count(*)=2 from public.unbilled_time_entries
  where customer_id in (current_setting('nexa.test_rls_a')::uuid,current_setting('nexa.test_rls_b')::uuid)),
  'Owner can see both fixtures: an owner-privilege view would leak the other row');
set local role authenticated;
do $$
declare subject text; other_subject text;
begin
  foreach subject in array array[current_setting('nexa.test_rls_a'),current_setting('nexa.test_rls_b')] loop
    other_subject := case when subject=current_setting('nexa.test_rls_a')
      then current_setting('nexa.test_rls_b') else current_setting('nexa.test_rls_a') end;
    perform set_config('request.jwt.claim.sub', subject, true);
    perform set_config('request.jwt.claims', json_build_object('sub',subject,'role','authenticated')::text, true);
    perform pg_temp.time_assert(auth.uid()=subject::uuid, 'Synthetic querying user established');
    perform pg_temp.time_assert((select count(*)=1 from public.time_entries where customer_id=subject::uuid)
      and not exists(select from public.time_entries where customer_id=other_subject::uuid),
      'Underlying table RLS permits own row and hides other user row');
    perform pg_temp.time_assert((select count(*)=1 from public.unbilled_time_entries where customer_id=subject::uuid)
      and not exists(select from public.unbilled_time_entries where customer_id=other_subject::uuid),
      'Invoker view permits own unbilled row and cannot bypass caller RLS');
  end loop;
  raise notice 'PASS: two authenticated caller identities see only their RLS-permitted rows through the unbilled view';
end;
$$;
reset role;
rollback;
