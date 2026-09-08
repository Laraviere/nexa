-- Local-only regression: fixtures are rolled back. No schema changes.
-- docker exec -i supabase_db_nexa psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < tests/database/billing_same_day_end.sql
begin;
set local role authenticated;

do $$
declare
  test_customer uuid;
  started_today uuid;
  current_successor uuid;
  today date := (current_timestamp at time zone 'America/New_York')::date;
  original public.customer_billing_agreements%rowtype;
  ended public.customer_billing_agreements%rowtype;
  check_name text;
begin
  insert into public.customers (company_name)
    values ('Local same-day cancellation test') returning id into test_customer;

  -- Ordinary finite positive-duration agreement.
  insert into public.customer_billing_agreements
    (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date, end_date)
  values (test_customer, 500, 1.5, 125, today - 20, today - 10);
  raise notice 'PASS: effective_date < end_date';

  -- NULL remains supported. This models a retainer established today.
  insert into public.customer_billing_agreements
    (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date)
  values (test_customer, 650, 2.5, 150, today) returning id into started_today;
  select * into original from public.customer_billing_agreements where id = started_today;
  if original.end_date is not null then raise exception 'Expected NULL end date'; end if;
  raise notice 'PASS: NULL end_date';

  -- Same mutation used by End now: one guarded end_date UPDATE.
  update public.customer_billing_agreements set end_date = today
  where id = started_today and customer_id = test_customer
    and effective_date = today and is_active and end_date is null;
  if not found then raise exception 'End-now UPDATE failed'; end if;
  select * into ended from public.customer_billing_agreements where id = started_today;
  if ended.end_date is distinct from today
    or not isempty(daterange(ended.effective_date, ended.end_date, '[)')) then
    raise exception 'Same-day cancellation did not produce an empty range';
  end if;
  if (to_jsonb(original) - 'end_date' - 'updated_at') is distinct from
     (to_jsonb(ended) - 'end_date' - 'updated_at') then
    raise exception 'Cancellation changed historical terms';
  end if;
  if exists (select from public.customer_billing_agreements
    where customer_id = test_customer and is_active and effective_date <= today
      and (end_date is null or today < end_date)) then
    raise exception 'Cancelled agreement is incorrectly current';
  end if;
  raise notice 'PASS: same-day End now succeeds, preserves history and resolves to No retainer';

  -- A new current agreement may start on that same business date.
  insert into public.customer_billing_agreements
    (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date)
  values (test_customer, 750, 3, 175, today) returning id into current_successor;

  -- A zero-length range inside an existing period also covers no date.
  insert into public.customer_billing_agreements
    (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date, end_date)
  values (test_customer, 0, 0, 0, today + 2, today + 2);
  if (select count(*) from public.customer_billing_agreements
    where customer_id = test_customer and is_active and effective_date <= today
      and (end_date is null or today < end_date)) <> 1 then
    raise exception 'Expected exactly one current successor';
  end if;
  raise notice 'PASS: zero-length ranges do not overlap adjacent or containing agreements';

  begin
    update public.customer_billing_agreements set end_date = today - 1 where id = started_today;
    raise exception 'Reversed date range accepted';
  exception when check_violation then
    get stacked diagnostics check_name = constraint_name;
    if check_name <> 'customer_billing_agreements_dates_valid' then raise; end if;
  end;
  raise notice 'PASS: effective_date > end_date rejected by date constraint';

  begin
    insert into public.customer_billing_agreements
      (customer_id, monthly_fee, included_hours, overage_hourly_rate, effective_date)
    values (test_customer, 800, 4, 200, today + 1);
    raise exception 'Overlapping range accepted';
  exception when exclusion_violation then
    get stacked diagnostics check_name = constraint_name;
    if check_name <> 'customer_billing_agreements_no_overlapping_periods' then raise; end if;
  end;
  raise notice 'PASS: existing exclusion constraint still rejects real overlaps';

  if not has_table_privilege('authenticated', 'public.customer_billing_agreements', 'SELECT')
    or not has_table_privilege('authenticated', 'public.customer_billing_agreements', 'INSERT')
    or not has_table_privilege('authenticated', 'public.customer_billing_agreements', 'UPDATE')
    or has_table_privilege('authenticated', 'public.customer_billing_agreements', 'DELETE')
    or has_table_privilege('authenticated', 'public.customer_billing_agreements', 'TRUNCATE') then
    raise exception 'Unexpected billing agreement privileges';
  end if;
  begin
    delete from public.customer_billing_agreements where id = started_today;
    raise exception 'DELETE was allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: authenticated SELECT/INSERT/UPDATE work and DELETE is denied';
end;
$$;
reset role;
rollback;
