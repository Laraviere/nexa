-- Change terms by closing one period and inserting its successor atomically.
-- Existing table constraints, RLS and table privileges remain authoritative.
create function public.change_customer_billing_terms(
  p_predecessor_id uuid,
  p_effective_date date,
  p_monthly_fee numeric,
  p_included_hours numeric,
  p_overage_hourly_rate numeric,
  p_billing_cycle_day integer,
  p_bill_in_advance boolean,
  p_rounding_increment_minutes integer,
  p_rollover_enabled boolean,
  p_end_date date default null
)
returns public.customer_billing_agreements
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  predecessor public.customer_billing_agreements%rowtype;
  successor public.customer_billing_agreements%rowtype;
  business_today date;
  successor_end date;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select * into predecessor
  from public.customer_billing_agreements
  where id = p_predecessor_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Agreement not found.';
  end if;

  -- Calculate after acquiring the lock, including when a wait crosses midnight.
  business_today := (clock_timestamp() at time zone 'America/New_York')::date;
  if not predecessor.is_active
    or predecessor.end_date = predecessor.effective_date
    or predecessor.end_date <= business_today then
    raise exception using errcode = '55000', message = 'Agreement cannot be changed.';
  end if;

  if p_effective_date is null or not isfinite(p_effective_date)
    or p_effective_date < business_today
    or p_effective_date < predecessor.effective_date
    or p_effective_date >= predecessor.end_date then
    raise exception using errcode = '22023', message = 'Invalid effective date.';
  end if;

  -- Omitted/NULL end preserves an existing cancellation, or stays unbounded.
  -- Changing terms cannot silently extend an already scheduled cancellation.
  successor_end := coalesce(p_end_date, predecessor.end_date);
  if successor_end is not null and (
    not isfinite(successor_end) or successor_end < p_effective_date
    or successor_end > predecessor.end_date
  ) then
    raise exception using errcode = '22023', message = 'Invalid successor end date.';
  end if;

  -- Only the latest nonempty agreement may be replaced. In particular, after
  -- waiting on another RPC's row lock, its newly inserted successor makes this
  -- predecessor ineligible even if the change was scheduled for the future.
  -- Empty historical cancellations cover no dates and are safely ignored.
  if exists (
    select from public.customer_billing_agreements as other
    where other.customer_id = predecessor.customer_id
      and other.id <> predecessor.id
      and other.effective_date >= predecessor.effective_date
      and not isempty(daterange(other.effective_date, other.end_date, '[)'))
  ) then
    raise exception using errcode = '55000',
      message = 'Agreement already has a later agreement. Change the latest agreement instead.';
  end if;

  update public.customer_billing_agreements
  set end_date = p_effective_date
  where id = predecessor.id;
  if not found then
    raise exception using errcode = '42501', message = 'Agreement cannot be updated.';
  end if;

  insert into public.customer_billing_agreements (
    customer_id, effective_date, end_date, monthly_fee, included_hours,
    overage_hourly_rate, billing_cycle_day, bill_in_advance,
    rounding_increment_minutes, rollover_enabled
  ) values (
    predecessor.customer_id, p_effective_date, successor_end, p_monthly_fee,
    p_included_hours, p_overage_hourly_rate, p_billing_cycle_day,
    p_bill_in_advance, p_rounding_increment_minutes, p_rollover_enabled
  ) returning * into successor;

  return successor;
exception
  -- This exception block rolls back its UPDATE as well as its INSERT before
  -- returning an error. Keep SQLSTATEs useful without returning row contents.
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'Billing agreement overlaps another agreement.';
  when check_violation or not_null_violation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Invalid billing agreement terms.';
  when serialization_failure or deadlock_detected then
    raise exception using errcode = '40001', message = 'Agreement changed concurrently. Reload and try again.';
end;
$function$;

-- Supabase projects can have different default function ACLs. No API role
-- other than authenticated may execute this RPC; the owner retains control.
revoke all on function public.change_customer_billing_terms(
  uuid, date, numeric, numeric, numeric, integer, boolean, integer, boolean, date
) from public, anon, service_role;
grant execute on function public.change_customer_billing_terms(
  uuid, date, numeric, numeric, numeric, integer, boolean, integer, boolean, date
) to authenticated;

comment on function public.change_customer_billing_terms(
  uuid, date, numeric, numeric, numeric, integer, boolean, integer, boolean, date
) is 'Atomically replace the latest enabled, nonempty current/future agreement. Dates use America/New_York and [). NULL successor end preserves a scheduled cancellation; a supplied end may shorten but not extend it. Returns the successor row. SECURITY INVOKER preserves caller RLS. Errors: 42501 auth, P0002 missing, 55000 ineligible, 22023 invalid input, 23P01 overlap, 40001 concurrent conflict.';
