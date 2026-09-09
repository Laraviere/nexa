-- Time Tracking foundation only. No timer, allocation engine or invoice tables.
-- The composite key is required for a declarative agreement/customer FK; it
-- also prevents moving a referenced agreement to a different customer later.
alter table public.customer_billing_agreements
  add constraint customer_billing_agreements_id_customer_unique unique (id, customer_id);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  billing_agreement_id uuid,
  work_date date not null,
  description text not null,
  actual_minutes integer not null,
  is_billable boolean not null default true,
  rounding_increment_minutes integer not null default 15,
  -- Cast before arithmetic to avoid integer overflow. Each row is rounded
  -- independently. Non-billable work never consumes allowance or incurs fees.
  rounded_minutes bigint generated always as (
    case when is_billable then
      ((actual_minutes::bigint + rounding_increment_minutes - 1)
        / nullif(rounding_increment_minutes, 0)) * rounding_increment_minutes
    else 0::bigint end
  ) stored not null,
  hourly_rate numeric(12,2),
  billing_cycle_day_snapshot integer,
  included_hours_snapshot numeric(10,2),
  rollover_enabled_snapshot boolean,
  started_at timestamptz,
  ended_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint time_entries_customer_fk foreign key (customer_id)
    references public.customers(id) on update restrict on delete restrict,
  constraint time_entries_agreement_customer_fk foreign key (billing_agreement_id, customer_id)
    references public.customer_billing_agreements(id, customer_id) on update restrict on delete restrict,
  constraint time_entries_work_date_finite check (isfinite(work_date)),
  constraint time_entries_description_not_blank check (description ~ '[^[:space:]]'),
  constraint time_entries_actual_positive check (actual_minutes > 0),
  constraint time_entries_rounding_positive check (rounding_increment_minutes > 0),
  constraint time_entries_rounded_nonnegative check (rounded_minutes >= 0),
  constraint time_entries_hourly_rate_valid
    check (hourly_rate is null or (hourly_rate >= 0 and hourly_rate <> 'NaN'::numeric)),
  constraint time_entries_billable_rate_required check (not is_billable or hourly_rate is not null),
  constraint time_entries_retainer_snapshot_consistent check (
    (billing_agreement_id is null and billing_cycle_day_snapshot is null
      and included_hours_snapshot is null and rollover_enabled_snapshot is null)
    or (billing_agreement_id is not null and hourly_rate is not null
      and billing_cycle_day_snapshot is not null and billing_cycle_day_snapshot between 1 and 28
      and included_hours_snapshot is not null and included_hours_snapshot >= 0
      and included_hours_snapshot <> 'NaN'::numeric and rollover_enabled_snapshot is not null)
  ),
  -- Optional completed timer evidence. Manual entries need neither timestamp.
  -- A completed entry belongs to one NY work date; timers must later split at
  -- midnight (an exclusive end exactly at midnight is allowed). Exact seconds
  -- remain in timestamps; actual_minutes is the duration rounded up to a minute.
  constraint time_entries_timer_valid check (
    (started_at is null and ended_at is null)
    or (started_at is not null and ended_at is not null
      and isfinite(started_at) and isfinite(ended_at) and ended_at > started_at
      and (started_at at time zone 'America/New_York')::date = work_date
      and ended_at <= ((work_date + 1)::timestamp at time zone 'America/New_York')
      and actual_minutes::numeric = ceil(extract(epoch from (ended_at - started_at)) / 60))
  ),
  constraint time_entries_void_consistent check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and isfinite(voided_at)
      and void_reason is not null and void_reason ~ '[^[:space:]]')
  ),
  constraint time_entries_timestamps_valid
    check (isfinite(created_at) and isfinite(updated_at) and updated_at >= created_at)
);

create function public.capture_time_entry_billing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  agreement public.customer_billing_agreements%rowtype;
  resolved_agreement_id uuid;
begin
  if tg_op = 'UPDATE' then
    -- Corrections to duration/description/billability and soft voiding are
    -- allowed while no invoices exist. Correct billing context by voiding and
    -- inserting a replacement, never by silently resnapshotting history.
    if row(new.id, new.customer_id, new.billing_agreement_id, new.work_date,
      new.rounding_increment_minutes, new.hourly_rate, new.billing_cycle_day_snapshot,
      new.included_hours_snapshot, new.rollover_enabled_snapshot, new.created_at)
      is distinct from row(old.id, old.customer_id, old.billing_agreement_id, old.work_date,
      old.rounding_increment_minutes, old.hourly_rate, old.billing_cycle_day_snapshot,
      old.included_hours_snapshot, old.rollover_enabled_snapshot, old.created_at) then
      raise exception using errcode = '55000',
        message = 'Billing context cannot be changed. Void this time entry and create a replacement.';
    end if;
    return new;
  end if;

  if new.work_date is null or not isfinite(new.work_date) then
    raise exception using errcode = '22023', message = 'A finite work date is required.';
  end if;

  -- New entries require an enabled, date-applicable agreement, including past
  -- versions. UPDATE above never re-resolves captured history. The exclusion constraint
  -- ensures at most one result, and empty [d,d) periods match no work date.
  select id into resolved_agreement_id from public.customer_billing_agreements
  where customer_id = new.customer_id
    and is_active
    and daterange(effective_date, end_date, '[)') @> new.work_date;
  if resolved_agreement_id is not null then
    -- Lock by identity, then recheck the period and administrative status. A
    -- concurrent change can shorten or disable it while this INSERT waits. Filtering by date in the
    -- locking SELECT could then miss both it and its not-yet-visible successor.
    select * into agreement from public.customer_billing_agreements
    where id = resolved_agreement_id for share;
    if not found or agreement.customer_id is distinct from new.customer_id
      or not agreement.is_active
      or not (daterange(agreement.effective_date, agreement.end_date, '[)') @> new.work_date) then
      raise exception using errcode = '40001', message = 'Billing terms changed while recording time. Reload and try again.';
    end if;
  end if;

  if new.billing_agreement_id is not null and new.billing_agreement_id is distinct from agreement.id then
    raise exception using errcode = '23503', message = 'The billing agreement does not match this customer and work date.';
  end if;
  if agreement.id is not null then
    new.billing_agreement_id := agreement.id;
    new.rounding_increment_minutes := agreement.rounding_increment_minutes;
    new.hourly_rate := agreement.overage_hourly_rate;
    new.billing_cycle_day_snapshot := agreement.billing_cycle_day;
    new.included_hours_snapshot := agreement.included_hours;
    new.rollover_enabled_snapshot := agreement.rollover_enabled;
  else
    -- No retainer: retain the explicitly supplied hourly rate and rounding
    -- increment (default 15). Never invent a free/zero hourly rate.
    new.billing_agreement_id := null;
    new.billing_cycle_day_snapshot := null;
    new.included_hours_snapshot := null;
    new.rollover_enabled_snapshot := null;
  end if;
  return new;
end;
$function$;

create trigger time_entries_capture_billing
before insert or update on public.time_entries
for each row execute function public.capture_time_entry_billing();

create trigger time_entries_set_updated_at
before update on public.time_entries
for each row execute function public.set_updated_at();

-- Customer history/period queries and deterministic same-day allocation order.
create index time_entries_customer_work_date_idx
  on public.time_entries(customer_id, work_date, created_at, id);
-- Agreement usage, and the referencing side of the composite FK.
create index time_entries_agreement_work_date_idx
  on public.time_entries(billing_agreement_id, work_date) where billing_agreement_id is not null;
-- Cross-customer work-date lists.
create index time_entries_work_date_idx on public.time_entries(work_date, created_at, id);
-- Initially all live billable time is unbilled; no invoices exist yet.
create index time_entries_unbilled_customer_date_idx
  on public.time_entries(customer_id, work_date, created_at, id)
  where is_billable and voided_at is null;

alter table public.time_entries enable row level security;
create policy "Authenticated users can view time entries"
  on public.time_entries for select to authenticated using (true);
create policy "Authenticated users can create time entries"
  on public.time_entries for insert to authenticated with check (true);
create policy "Authenticated users can update time entries"
  on public.time_entries for update to authenticated using (true) with check (true);

revoke all on public.time_entries from public, anon, authenticated;
grant select, insert, update on public.time_entries to authenticated;
-- This is a trigger helper, not a callable application RPC.
revoke all on function public.capture_time_entry_billing() from public, anon, authenticated, service_role;

-- No fake invoice identifier, manually maintained billed flag, or placeholder
-- invoice table. Future invoice linkage MUST refine this view/index and protect
-- linked entries in the same migration that introduces invoice generation.
create view public.unbilled_time_entries with (security_invoker = true) as
  select * from public.time_entries where is_billable and voided_at is null;
revoke all on public.unbilled_time_entries from public, anon, authenticated;
grant select on public.unbilled_time_entries to authenticated;

comment on table public.time_entries is
  'Per-entry actual minutes and immutable billing-context snapshots. All entries are uninvoiced in this foundation. Exclude voided/non-billable rows from allowance and fee calculations. Correct customer/date/billing context by voiding and replacing the row. Future invoices must establish authoritative linkage and prevent edits/voids of linked time.';
comment on column public.time_entries.work_date is
  'Explicit America/New_York business date used to resolve [effective_date,end_date) agreement history. No current-agreement lookup or timezone-dependent date default.';
comment on column public.time_entries.billing_agreement_id is
  'Resolved on INSERT from an is_active agreement covering work_date. NULL means no enabled dated retainer. Explicit mismatches are rejected. Later disabling or changing an agreement never reassigns existing entries or refreshes their snapshots.';
comment on column public.time_entries.actual_minutes is
  'Positive whole minutes worked, independent of billing. Optional timestamps preserve exact timer seconds; completed timer duration rounds up to whole actual minutes.';
comment on column public.time_entries.rounded_minutes is
  'Stored generated billing duration: ceil(actual_minutes / rounding_increment_minutes) * rounding_increment_minutes per entry, or zero for non-billable work. Never round a monthly sum of actual time. Voided rows retain their duration for history and must be excluded from usage.';
comment on column public.time_entries.rounding_increment_minutes is
  'Immutable per-entry snapshot: copied from the dated retainer, or supplied explicitly for non-retainer work with a default of 15.';
comment on column public.time_entries.hourly_rate is
  'Immutable numeric USD rate snapshot. Retainer: overage rate, not a claim that this whole entry is overage. Non-retainer: explicitly supplied hourly rate for billable work; NULL allowed only for non-billable work.';
comment on column public.time_entries.billing_cycle_day_snapshot is
  'Retainer monthly anchor, 1-28; NULL for non-retainer work. Allowance periods are clipped to the governing agreement [effective_date,end_date). Each version starts a fresh allowance on effective_date, then renews on this billing day.';
comment on column public.time_entries.included_hours_snapshot is
  'Full allowance per customer, governing billing_agreement_id and agreement-specific billing period; never prorate between versions or merge their allowance pools. Do not sum this column across entries. Allocation remains a future engine, not a permanent included/overage classification on time entries.';
comment on column public.time_entries.rollover_enabled_snapshot is
  'Captured agreement setting, NULL for non-retainer work. No rollover engine is implemented by this table.';
comment on column public.time_entries.started_at is
  'Optional completed timer evidence, paired with ended_at. Running timers belong in a future separate lifecycle; split completed time at New York midnight before inserting entries.';
comment on column public.time_entries.voided_at is
  'Soft void with required reason. Preserves the record; excluded from unbilled/usage queries. No authenticated hard DELETE is granted.';
comment on view public.unbilled_time_entries is
  'Read-only authenticated view using caller RLS. All non-voided billable time is unbilled until invoice linkage exists. The invoice migration must exclude linked time and lock linked entries against correction or voiding; this view is not an allocation engine.';
