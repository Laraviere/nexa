-- Monthly agreement terms, versioned by inserting a new row when terms change.
-- Dates are business dates in America/New_York: [effective_date, end_date).
-- GiST equality support for customer UUIDs, alongside the built-in range index.
create extension if not exists btree_gist with schema extensions;

create table public.customer_billing_agreements (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  monthly_fee numeric(12,2) not null,
  included_hours numeric(10,2) not null,
  overage_hourly_rate numeric(12,2) not null,
  billing_cycle_day integer not null default 1,
  bill_in_advance boolean not null default true,
  rounding_increment_minutes integer not null default 15,
  rollover_enabled boolean not null default false,
  effective_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_billing_agreements_customer_fk
    foreign key (customer_id) references public.customers(id) on delete restrict,
  constraint customer_billing_agreements_monthly_fee_valid
    check (monthly_fee >= 0 and monthly_fee <> 'NaN'::numeric),
  constraint customer_billing_agreements_included_hours_valid
    check (included_hours >= 0 and included_hours <> 'NaN'::numeric),
  constraint customer_billing_agreements_overage_rate_valid
    check (overage_hourly_rate >= 0 and overage_hourly_rate <> 'NaN'::numeric),
  -- Days 1-28 exist in every month, so no month-end fallback is needed.
  constraint customer_billing_agreements_billing_day_valid
    check (billing_cycle_day between 1 and 28),
  constraint customer_billing_agreements_rounding_positive
    check (rounding_increment_minutes > 0),
  constraint customer_billing_agreements_dates_valid
    check (
      isfinite(effective_date)
      and (end_date is null or (isfinite(end_date) and end_date > effective_date))
    ),
  -- Applies to every row, including inactive/historical agreements. A NULL
  -- upper bound is unbounded; adjacent [) periods do not overlap.
  constraint customer_billing_agreements_no_overlapping_periods
    exclude using gist (
      customer_id with =,
      daterange(effective_date, end_date, '[)') with &&
    )
);

-- Retain ordered customer history lookups: the exclusion GiST index does not
-- replace this B-tree's effective_date ordering. Also serves FK lookups.
create index customer_billing_agreements_customer_effective_idx
  on public.customer_billing_agreements (customer_id, effective_date desc);

create trigger customer_billing_agreements_set_updated_at
before update on public.customer_billing_agreements
for each row
execute function public.set_updated_at();

alter table public.customer_billing_agreements enable row level security;

create policy "Authenticated users can view customer billing agreements"
on public.customer_billing_agreements
for select to authenticated
using (true);

create policy "Authenticated users can create customer billing agreements"
on public.customer_billing_agreements
for insert to authenticated
with check (true);

create policy "Authenticated users can update customer billing agreements"
on public.customer_billing_agreements
for update to authenticated
using (true)
with check (true);

-- Explicit privileges avoid relying on project default grants for this table.
-- There is deliberately no authenticated DELETE policy or privilege.
revoke all on public.customer_billing_agreements from public, anon, authenticated;
grant select, insert, update on public.customer_billing_agreements to authenticated;

comment on table public.customer_billing_agreements is
  'Monthly terms per customer. Preserve used terms by ending the old row and inserting a successor; overlapping effective periods for the same customer are prohibited, including inactive agreements. Adjacent periods are allowed. Future time entries should retain agreement_id and rounded usage, and invoices must snapshot billed terms.';
comment on column public.customer_billing_agreements.effective_date is
  'Inclusive first business date (America/New_York). Required explicitly; no timezone-dependent current_date default.';
comment on column public.customer_billing_agreements.end_date is
  'Exclusive end business date; null means open-ended. A successor may start on this exact date.';
comment on column public.customer_billing_agreements.is_active is
  'Administrative enabled/disabled flag, not a computed current-date status. Eligibility also requires the date range; historical records must not be resolved using this flag alone.';
comment on column public.customer_billing_agreements.monthly_fee is
  'Fixed fee per monthly period. Currency is the application business currency; this table does not implement multiple currencies or proration.';
comment on column public.customer_billing_agreements.included_hours is
  'Exact decimal support hours available each monthly period. Resets each period; compare against the sum of individually rounded entry minutes using numeric arithmetic.';
comment on column public.customer_billing_agreements.overage_hourly_rate is
  'Hourly price for rounded usage exceeding the monthly included allowance.';
comment on column public.customer_billing_agreements.billing_cycle_day is
  'Monthly period starts on this day (1-28); default 1 gives calendar-month periods.';
comment on column public.customer_billing_agreements.bill_in_advance is
  'True bills the fixed monthly fee at period start. Overage depends on actual usage and is calculated after usage occurs.';
comment on column public.customer_billing_agreements.rounding_increment_minutes is
  'Round each individual time entry upward to this many minutes before totaling allowance usage or overage; default 15 makes 18 minutes count as 30.';
comment on column public.customer_billing_agreements.rollover_enabled is
  'False means unused included hours expire at the end of each monthly period. Rollover calculation is not implemented by this table.';
