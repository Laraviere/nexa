-- Derived allowance calculation only: no writes, persisted totals or invoice state.
-- STABLE gives all reads within a call the same statement snapshot. SECURITY
-- INVOKER deliberately retains the caller's table privileges and RLS visibility.
create or replace function public.get_retainer_period_usage(
  p_billing_agreement_id uuid,
  p_reference_date date
)
returns table (
  customer_id uuid,
  billing_agreement_id uuid,
  period_start date,
  period_end date,
  included_minutes_available numeric,
  rounded_minutes_used numeric,
  included_minutes_used numeric,
  remaining_included_minutes numeric,
  overage_minutes numeric,
  overage_amount numeric,
  allocations jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  agreement public.customer_billing_agreements%rowtype;
  cycle_day integer;
  distinct_days integer;
  distinct_allowances integer;
  distinct_rollover integer;
  distinct_rates integer;
  period_rate numeric;
  allowance_hours numeric;
  has_rollover boolean;
  anchor date;
  start_date date;
  end_date date;
  allowance_minutes numeric;
begin
  if p_billing_agreement_id is null or p_reference_date is null or not isfinite(p_reference_date) then
    raise exception using errcode = '22023', message = 'An agreement ID and finite reference date are required.';
  end if;
  select a.* into agreement from public.customer_billing_agreements a
  where a.id = p_billing_agreement_id;
  if not found then
    -- Same error for nonexistent and RLS-hidden agreements; never reveal others.
    raise exception using errcode = 'P0002', message = 'The billing agreement is unavailable.';
  end if;
  if not (daterange(agreement.effective_date, agreement.end_date, '[)') @> p_reference_date) then
    raise exception using errcode = '22023', message = 'The reference date must be inside the agreement effective period.';
  end if;

  -- A version has one billing calendar. Prefer captured history to mutable
  -- parent terms. Mixed captured days cannot be interpreted safely: financial
  -- changes must create successor versions, not modify a used version in place.
  -- No is_active filter: disabling an agreement never erases captured history.
  select min(t.billing_cycle_day_snapshot), count(distinct t.billing_cycle_day_snapshot)
  into cycle_day, distinct_days
  from public.time_entries t
  where t.customer_id = agreement.customer_id and t.billing_agreement_id = agreement.id
    and t.is_billable and t.voided_at is null
    and t.work_date >= agreement.effective_date
    and (agreement.end_date is null or t.work_date < agreement.end_date);
  if distinct_days > 1 then
    raise exception using errcode = '22023', message = 'Conflicting billing-day snapshots in this agreement. Reconcile its history before calculating usage.';
  end if;
  cycle_day := coalesce(cycle_day, agreement.billing_cycle_day);
  -- Date-only calendar arithmetic; no implicit business timezone or browser input.
  anchor := date_trunc('month', p_reference_date::timestamp)::date + (cycle_day - 1);
  if anchor > p_reference_date then
    anchor := (anchor - interval '1 month')::date;
  end if;
  start_date := greatest(anchor, agreement.effective_date);
  end_date := least((anchor + interval '1 month')::date, agreement.end_date);

  select min(t.included_hours_snapshot), count(distinct t.included_hours_snapshot),
    bool_or(t.rollover_enabled_snapshot), count(distinct t.rollover_enabled_snapshot),
    min(t.hourly_rate), count(distinct t.hourly_rate)
  into allowance_hours, distinct_allowances, has_rollover, distinct_rollover, period_rate, distinct_rates
  from public.time_entries t
  where t.customer_id = agreement.customer_id and t.billing_agreement_id = agreement.id
    and t.is_billable and t.voided_at is null
    and t.work_date >= start_date and t.work_date < end_date;
  if distinct_allowances > 1 or distinct_rollover > 1 then
    raise exception using errcode = '22023', message = 'Conflicting allowance snapshots in this period. Reconcile its history before calculating usage.';
  end if;
  if distinct_rates > 1 then
    raise exception using errcode = '22023', message = 'Conflicting hourly-rate snapshots in this period. Reconcile its history before calculating usage.';
  end if;
  -- Empty periods have no captured allowance: use the governing version's terms.
  allowance_hours := coalesce(allowance_hours, agreement.included_hours);
  has_rollover := coalesce(has_rollover, agreement.rollover_enabled);
  period_rate := coalesce(period_rate, agreement.overage_hourly_rate);
  if has_rollover then
    raise exception using errcode = '0A000', message = 'Retainer rollover calculation is not supported.';
  end if;
  allowance_minutes := allowance_hours * 60;
  if allowance_minutes <> trunc(allowance_minutes) then
    raise exception using errcode = '22023', message = 'Included hours must convert to whole minutes; fractional-minute allowances are not supported.';
  end if;

  return query
  with ordered as (
    select t.id, t.work_date, t.created_at, t.rounded_minutes::numeric as minutes, t.hourly_rate,
      coalesce(sum(t.rounded_minutes::numeric) over (
        order by t.work_date, t.created_at, t.id
        rows between unbounded preceding and 1 preceding
      ), 0::numeric) as earlier_minutes
    from public.time_entries t
    where t.customer_id = agreement.customer_id and t.billing_agreement_id = agreement.id
      and t.is_billable and t.voided_at is null
      and t.work_date >= start_date and t.work_date < end_date
  ), allocated as (
    select o.*, least(o.minutes, greatest(allowance_minutes - o.earlier_minutes, 0::numeric)) as included
    from ordered o
  ), usage as (
    select a.*, a.minutes - a.included as overage
    from allocated a
  )
  select agreement.customer_id, agreement.id, start_date, end_date, allowance_minutes,
    coalesce(sum(p.minutes), 0::numeric), coalesce(sum(p.included), 0::numeric),
    allowance_minutes - coalesce(sum(p.included), 0::numeric),
    coalesce(sum(p.overage), 0::numeric),
    -- One summarized period charge at its unambiguous captured rate. Multiply
    -- before division and round to cents only once, after totaling all minutes.
    round(coalesce(sum(p.overage), 0::numeric) * period_rate / 60::numeric, 2),
    coalesce(jsonb_agg(jsonb_build_object(
      'time_entry_id', p.id, 'work_date', p.work_date, 'created_at', p.created_at,
      'rounded_minutes', p.minutes, 'included_minutes', p.included,
      'overage_minutes', p.overage, 'hourly_rate', p.hourly_rate
    ) order by p.work_date, p.created_at, p.id), '[]'::jsonb)
  from usage p;
end;
$function$;

-- Do not inherit broad function EXECUTE defaults from the hosted project.
revoke all on function public.get_retainer_period_usage(uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.get_retainer_period_usage(uuid, date) to authenticated;

comment on function public.get_retainer_period_usage(uuid, date) is
  'Read-only caller-RLS retainer usage for an agreement and applicable business date. Each version starts a full allowance; monthly cycles are clipped to its [effective_date,end_date). Captured day/allowance/rate terms govern usage. Empty periods use agreement terms. Conflicting snapshots including hourly rates, rollover and fractional-minute allowances fail explicitly. Entry allocations order by work_date,created_at,id and contain minutes, not dollar amounts. USD overage is total period overage minutes times its consistent captured rate divided by 60, rounded to cents once. No persisted classification, rollover, fee proration or invoice state.';
