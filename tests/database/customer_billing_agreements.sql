-- Local-only regression checks. Run with:
-- docker exec -i supabase_db_nexa psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < tests/database/customer_billing_agreements.sql
-- All fixtures and helper functions are rolled back, including on disconnect.
begin;

create function pg_temp.assert_true(result boolean, description text)
returns void language plpgsql as $$
begin
  if result is distinct from true then
    raise exception 'FAIL: %', description;
  end if;
  raise notice 'PASS: %', description;
end;
$$;

create function pg_temp.expect_error(statement text, expected_state text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE % for %', expected_state, statement;
end;
$$;

insert into public.customers (id, company_name)
values ('a9719710-1000-4000-8000-000000000001', 'Local billing agreement test');

-- Run real CRUD as the same database role used by authenticated API requests.
set local role authenticated;
insert into public.customer_billing_agreements
  (id, customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date, updated_at)
values
  ('a9719710-2000-4000-8000-000000000001', 'a9719710-1000-4000-8000-000000000001',
   1000.25, 10.25, 125.50, '2026-01-01', '2000-01-01T00:00:00Z');

select pg_temp.assert_true(
  (select billing_cycle_day = 1 and bill_in_advance and rounding_increment_minutes = 15
     and not rollover_enabled and is_active and end_date is null
     and monthly_fee = 1000.25 and included_hours = 10.25 and overage_hourly_rate = 125.50
   from public.customer_billing_agreements where id = 'a9719710-2000-4000-8000-000000000001'),
  'Authenticated INSERT/SELECT, defaults and exact fractional values');

update public.customer_billing_agreements
set end_date = '2026-02-01', is_active = false
where id = 'a9719710-2000-4000-8000-000000000001';

select pg_temp.assert_true(
  (select updated_at = now() and created_at = now() and not is_active
   from public.customer_billing_agreements where id = 'a9719710-2000-4000-8000-000000000001'),
  'Authenticated UPDATE and shared updated_at trigger');

insert into public.customer_billing_agreements
  (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date)
values ('a9719710-1000-4000-8000-000000000001', 1200, 12.50, 150, '2026-02-01');

select pg_temp.assert_true(
  (select count(*) = 2 from public.customer_billing_agreements
   where customer_id = 'a9719710-1000-4000-8000-000000000001'),
  'Successor row preserves agreement history for the same customer');
select pg_temp.assert_true(
  (select monthly_fee = 1000.25 from public.customer_billing_agreements
   where customer_id = 'a9719710-1000-4000-8000-000000000001'
     and effective_date <= '2026-01-31' and (end_date is null or '2026-01-31' < end_date)),
  'Historical lookup uses dates even when the old agreement is inactive');
select pg_temp.assert_true(
  (select count(*) = 1 from public.customer_billing_agreements
   where customer_id = 'a9719710-1000-4000-8000-000000000001'
     and effective_date <= '2026-02-01' and (end_date is null or '2026-02-01' < end_date)),
  'Exclusive end date avoids double-counting the successor boundary');

-- Numeric arithmetic example verifies the meaning of the stored setting only;
-- it is not an implementation of time tracking or billing.
select pg_temp.assert_true(
  (select ceil(18::numeric / rounding_increment_minutes) * rounding_increment_minutes = 30
   from public.customer_billing_agreements where id = 'a9719710-2000-4000-8000-000000000001'),
  'Stored rounding setting represents 18 minutes as 30 minutes');

select pg_temp.expect_error(
  $$delete from public.customer_billing_agreements where id = 'a9719710-2000-4000-8000-000000000001'$$, '42501');
reset role;

-- Table-driven constraint checks on INSERT and UPDATE semantics.
do $checks$
declare
  field_name text;
  bad_value text;
begin
  foreach field_name in array array['monthly_fee', 'included_hours', 'overage_hourly_rate'] loop
    foreach bad_value in array array['-1', '''NaN''', '''Infinity''', '''-Infinity'''] loop
      perform pg_temp.expect_error(
        format('update public.customer_billing_agreements set %I = %s where id = %L',
          field_name, bad_value, 'a9719710-2000-4000-8000-000000000001'),
        case when bad_value like '%Infinity%' then '22003' else '23514' end);
    end loop;
  end loop;
  foreach field_name in array array['customer_id', 'monthly_fee', 'included_hours', 'overage_hourly_rate',
    'billing_cycle_day', 'bill_in_advance', 'rounding_increment_minutes', 'rollover_enabled',
    'effective_date', 'is_active', 'created_at'] loop
    perform pg_temp.expect_error(
      format('update public.customer_billing_agreements set %I = null where id = %L',
        field_name, 'a9719710-2000-4000-8000-000000000001'), '23502');
  end loop;
  foreach bad_value in array array['0', '29', '32'] loop
    perform pg_temp.expect_error(format(
      'update public.customer_billing_agreements set billing_cycle_day = %s', bad_value), '23514');
  end loop;
  foreach bad_value in array array['0', '-15'] loop
    perform pg_temp.expect_error(format(
      'update public.customer_billing_agreements set rounding_increment_minutes = %s', bad_value), '23514');
  end loop;
  foreach bad_value in array array['2025-12-31', '2026-01-01', 'infinity', '-infinity'] loop
    perform pg_temp.expect_error(format(
      'update public.customer_billing_agreements set end_date = %L where id = %L',
      bad_value, 'a9719710-2000-4000-8000-000000000001'), '23514');
  end loop;
  perform pg_temp.expect_error(
    $$update public.customer_billing_agreements set effective_date = '-infinity'$$, '23514');
  raise notice 'PASS: negative/nonfinite numerics, null required fields, billing days, rounding and date constraints';
end;
$checks$;

select pg_temp.expect_error(
  $$update public.customer_billing_agreements set customer_id = 'a9719710-9999-4000-8000-000000000001'$$, '23503');
select pg_temp.expect_error(
  $$delete from public.customers where id = 'a9719710-1000-4000-8000-000000000001'$$, '23503');
select pg_temp.assert_true(
  (select count(*) = 2 from public.customer_billing_agreements where customer_id = 'a9719710-1000-4000-8000-000000000001'),
  'Foreign key rejects missing customer and customer deletion preserves history');

-- Exercise overlap enforcement as authenticated, including updates and inactive rows.
set local role authenticated;
do $ranges$
declare
  first_customer uuid;
  second_customer uuid;
  predecessor uuid;
  successor uuid;
  failure_constraint text;
begin
  insert into public.customers (company_name) values ('Local range test A') returning id into first_customer;
  insert into public.customers (company_name) values ('Local range test B') returning id into second_customer;

  insert into public.customer_billing_agreements
    (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date, end_date, is_active)
  values (first_customer, 100, 1, 50, '2026-01-01', '2026-04-01', false)
  returning id into predecessor;

  -- Separated periods with a gap are valid.
  insert into public.customer_billing_agreements
    (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date, end_date)
  values (first_customer, 100, 1, 50, '2025-10-01', '2025-12-01');
  raise notice 'PASS: separated periods for one customer';

  -- A conflicting INSERT must fail even though the existing row is inactive.
  begin
    insert into public.customer_billing_agreements
      (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date, end_date, is_active)
    values (first_customer, 100, 1, 50, '2026-03-01', '2026-05-01', false);
    raise exception 'Overlapping inactive agreements were accepted';
  exception when exclusion_violation then
    get stacked diagnostics failure_constraint = constraint_name;
    if failure_constraint <> 'customer_billing_agreements_no_overlapping_periods' then raise; end if;
  end;
  raise notice 'PASS: same-customer overlap rejected, including inactive agreements';

  insert into public.customer_billing_agreements
    (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date)
  values (first_customer, 100, 1, 50, '2026-04-01') returning id into successor;
  raise notice 'PASS: adjacent [) periods with open-ended successor';

  perform pg_temp.assert_true(
    (select upper_inf(daterange(effective_date, end_date, '[)'))
     from public.customer_billing_agreements where id = successor),
    'NULL end_date is an unbounded upper range');

  begin
    insert into public.customer_billing_agreements
      (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date)
    values (first_customer, 100, 1, 50, '2027-01-01');
    raise exception 'Later agreement overlapping an open-ended range was accepted';
  exception when exclusion_violation then null;
  end;
  raise notice 'PASS: open-ended agreement rejects a later agreement';

  begin
    update public.customer_billing_agreements set effective_date = '2026-03-31' where id = successor;
    raise exception 'Overlapping date UPDATE was accepted';
  exception when exclusion_violation then null;
  end;
  begin
    update public.customer_billing_agreements set end_date = null where id = predecessor;
    raise exception 'Removing predecessor end date created an overlap';
  exception when exclusion_violation then null;
  end;
  raise notice 'PASS: date updates cannot introduce overlaps';

  insert into public.customer_billing_agreements
    (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date)
  values (second_customer, 100, 1, 50, '2026-03-01');
  raise notice 'PASS: overlapping dates for different customers';

  begin
    update public.customer_billing_agreements set customer_id = second_customer where id = successor;
    raise exception 'Changing customer created an overlap';
  exception when exclusion_violation then null;
  end;
  raise notice 'PASS: customer updates cannot introduce overlaps';
end;
$ranges$;
reset role;

select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.customer_billing_agreements', 'SELECT')
  and has_table_privilege('authenticated', 'public.customer_billing_agreements', 'INSERT')
  and has_table_privilege('authenticated', 'public.customer_billing_agreements', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.customer_billing_agreements', 'DELETE'),
  'Authenticated table privileges remain SELECT/INSERT/UPDATE without DELETE');

set local role anon;
select pg_temp.expect_error($$select * from public.customer_billing_agreements$$, '42501');
select pg_temp.expect_error(
  $$insert into public.customer_billing_agreements (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date)
    values ('a9719710-1000-4000-8000-000000000001', 0, 0, 0, '2026-03-01')$$, '42501');
select pg_temp.expect_error($$update public.customer_billing_agreements set is_active = false$$, '42501');
select pg_temp.expect_error($$delete from public.customer_billing_agreements$$, '42501');
reset role;
select pg_temp.assert_true(
  (select relrowsecurity from pg_class where oid = 'public.customer_billing_agreements'::regclass)
  and (select count(*) = 3 from pg_policies where schemaname = 'public' and tablename = 'customer_billing_agreements')
  and not exists (select from pg_policies where schemaname = 'public' and tablename = 'customer_billing_agreements' and cmd in ('DELETE', 'ALL')),
  'RLS enabled with exactly three policies and no DELETE/ALL policy');

rollback;
