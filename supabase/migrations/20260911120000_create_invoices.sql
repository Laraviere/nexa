-- USD invoice foundation. No generation, payment, delivery or recurring jobs.
-- Existing btree_gist supports UUID equality in the source exclusion constraints.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number integer generated always as identity (start with 1001) unique not null,
  customer_id uuid not null references public.customers(id) on update restrict on delete restrict,
  company_name_snapshot text not null,
  primary_contact_name_snapshot text,
  email_snapshot text,
  phone_snapshot text,
  billing_address_line1_snapshot text,
  billing_address_line2_snapshot text,
  billing_city_snapshot text,
  billing_state_snapshot text,
  billing_postal_code_snapshot text,
  billing_country_snapshot text,
  issue_date date not null default (now() at time zone 'America/New_York')::date,
  due_date date not null,
  payment_terms_days_snapshot integer not null,
  status text not null default 'draft' check (status in ('draft','sent','void')),
  notes text,
  terms text,
  sent_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (invoice_number >= 1001),
  check (company_name_snapshot ~ '[^[:space:]]'),
  check (isfinite(issue_date) and isfinite(due_date) and due_date >= issue_date),
  check (payment_terms_days_snapshot >= 0),
  check (isfinite(created_at) and isfinite(updated_at) and updated_at >= created_at),
  check (sent_at is null or isfinite(sent_at)),
  check ((status = 'draft' and sent_at is null) or (status = 'sent' and sent_at is not null) or status = 'void'),
  check ((status <> 'void' and voided_at is null and void_reason is null)
    or (status = 'void' and voided_at is not null and isfinite(voided_at)
      and void_reason is not null and void_reason ~ '[^[:space:]]'))
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on update restrict on delete restrict,
  position integer not null check (position > 0),
  description text not null check (description ~ '[^[:space:]]'),
  source_type text not null default 'manual' check (source_type in ('manual','retainer_fee','hourly_time','retainer_overage')),
  quantity numeric(20,8) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  unit text not null check (unit in ('hour','minute','flat','each','mile','month','custom')),
  unit_rate numeric(12,2) not null check (unit_rate >= 0 and unit_rate <> 'NaN'::numeric),
  -- Time lines retain exact integer minutes; never multiply a rounded hours
  -- display quantity to calculate their charge. unit_rate is the hourly snapshot.
  billed_minutes bigint,
  amount numeric(24,2) generated always as (
    case when billed_minutes is not null then round(billed_minutes::numeric * unit_rate / 60, 2)
      else round(quantity * unit_rate, 2) end
  ) stored not null,
  tax_amount numeric(24,2) not null default 0 check (tax_amount >= 0 and tax_amount <> 'NaN'::numeric),
  billing_agreement_id uuid references public.customer_billing_agreements(id) on update restrict on delete restrict,
  period_start date,
  period_end date,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, position) deferrable initially immediate,
  check ((source_type in ('hourly_time','retainer_overage') and billed_minutes is not null and billed_minutes > 0 and unit = 'hour')
    or (source_type in ('manual','retainer_fee') and billed_minutes is null)),
  check ((source_type in ('retainer_fee','retainer_overage') and billing_agreement_id is not null
      and period_start is not null and period_end is not null
      and isfinite(period_start) and isfinite(period_end) and period_end > period_start)
    or (source_type in ('manual','hourly_time') and billing_agreement_id is null and period_start is null and period_end is null)),
  check (source_type <> 'retainer_fee' or (quantity = 1 and unit = 'month')),
  check (isfinite(created_at) and isfinite(updated_at) and updated_at >= created_at),
  check (released_at is null or isfinite(released_at)),
  -- Stronger than exact-date uniqueness: overlapping claims cannot disguise a
  -- duplicate fee by using slightly different period boundaries.
  constraint invoice_items_retainer_fee_once exclude using gist (
    billing_agreement_id with =, daterange(period_start,period_end,'[)') with &&
  ) where (source_type = 'retainer_fee' and released_at is null)
);

create table public.invoice_time_allocations (
  id uuid primary key default gen_random_uuid(),
  invoice_item_id uuid not null references public.invoice_items(id) on update restrict on delete restrict,
  time_entry_id uuid not null references public.time_entries(id) on update restrict on delete restrict,
  -- Zero-based offsets into the entry's rounded billable minutes. [15,30)
  -- records precisely the last 15 minutes, not a whole-entry billed flag.
  minute_start bigint not null check (minute_start >= 0),
  minute_end bigint not null check (minute_end > minute_start),
  allocated_minutes bigint generated always as (minute_end - minute_start) stored not null,
  released_at timestamptz,
  created_at timestamptz not null default now() check (isfinite(created_at)),
  check (released_at is null or isfinite(released_at)),
  constraint invoice_time_allocations_no_double_billing exclude using gist (
    time_entry_id with =, int8range(minute_start,minute_end,'[)') with &&
  ) where (released_at is null)
);

create index invoices_customer_issue_idx on public.invoices(customer_id,issue_date desc);
create index invoices_sent_due_idx on public.invoices(due_date) where status = 'sent';
create index invoices_issue_idx on public.invoices(issue_date desc);
create index invoice_items_agreement_idx on public.invoice_items(billing_agreement_id) where billing_agreement_id is not null;
-- One complete period overage charge belongs to one active line/invoice.
-- Drafts reserve the period too; voiding releases it without erasing history.
-- Do not split retainer overage across invoices (or across lines of one invoice).
create unique index invoice_items_retainer_overage_once_idx
  on public.invoice_items(billing_agreement_id, period_start, period_end)
  where source_type = 'retainer_overage' and released_at is null;
create index invoice_time_allocations_item_idx on public.invoice_time_allocations(invoice_item_id);
-- Includes released historical links, unlike the active exclusion index.
create index invoice_time_allocations_entry_idx on public.invoice_time_allocations(time_entry_id);

create function public.guard_invoice()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare c public.customers%rowtype;
begin
  if tg_op = 'DELETE' then raise exception 'Invoices cannot be deleted; void instead.'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.sent_at is not null or new.voided_at is not null then
      raise exception 'Invoices must start as drafts.';
    end if;
    select * into strict c from public.customers where id = new.customer_id for share;
    new.company_name_snapshot := c.company_name;
    new.primary_contact_name_snapshot := c.primary_contact_name;
    new.email_snapshot := c.email; new.phone_snapshot := c.phone;
    new.billing_address_line1_snapshot := c.billing_address_line1;
    new.billing_address_line2_snapshot := c.billing_address_line2;
    new.billing_city_snapshot := c.billing_city; new.billing_state_snapshot := c.billing_state;
    new.billing_postal_code_snapshot := c.billing_postal_code; new.billing_country_snapshot := c.billing_country;
    new.payment_terms_days_snapshot := c.default_payment_terms_days;
    new.due_date := coalesce(new.due_date, new.issue_date + c.default_payment_terms_days);
    return new;
  end if;
  if row(new.id,new.invoice_number,new.customer_id,new.created_at) is distinct from
    row(old.id,old.invoice_number,old.customer_id,old.created_at) then raise exception 'Invoice identity is immutable.'; end if;
  if new.sent_at is distinct from old.sent_at or new.voided_at is distinct from old.voided_at then
    raise exception 'Lifecycle timestamps are server managed.';
  end if;
  if old.status <> 'draft' and
    (to_jsonb(new) - array['status','void_reason','updated_at']) is distinct from
    (to_jsonb(old) - array['status','void_reason','updated_at']) then
    raise exception 'Issued invoice financial and display snapshots are immutable.';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'void' or new.status = 'draft' then raise exception 'Invalid invoice lifecycle transition.'; end if;
    if new.status = 'sent' then
      if not exists (select 1 from public.invoice_items where invoice_id = new.id) then raise exception 'An invoice needs line items.'; end if;
      if exists (
        select 1 from public.invoice_items i where i.invoice_id = new.id and i.billed_minutes is not null
        and i.billed_minutes <> (select coalesce(sum(a.allocated_minutes),0) from public.invoice_time_allocations a
          where a.invoice_item_id = i.id and a.released_at is null)
      ) then raise exception 'Time line minutes must exactly match source allocations before issue.'; end if;
      new.sent_at := clock_timestamp();
    elsif new.status = 'void' then
      new.voided_at := clock_timestamp();
    end if;
  elsif new.void_reason is distinct from old.void_reason then
    raise exception 'Void reason can only be assigned while voiding.';
  end if;
  return new;
end $$;

create function public.guard_invoice_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare p public.invoices%rowtype; a public.customer_billing_agreements%rowtype;
  anchor date; expected_start date; expected_end date;
begin
  if tg_op = 'DELETE' then raise exception 'Invoice items cannot be deleted; void and replace the draft.'; end if;
  if tg_op = 'UPDATE' and row(new.id,new.invoice_id,new.created_at) is distinct from row(old.id,old.invoice_id,old.created_at) then
    raise exception 'Line identity is immutable.';
  end if;
  -- A real parent UPDATE serializes child writes against issue/void, including
  -- REPEATABLE READ (which must retry rather than finalize a stale snapshot).
  update public.invoices set updated_at = updated_at where id = new.invoice_id returning * into p;
  if not found then raise exception 'Invoice unavailable.'; end if;
  if tg_op = 'UPDATE' and p.status = 'void' and old.released_at is null
    and new.released_at = p.voided_at
    and (to_jsonb(new) - array['released_at','updated_at','amount']) = (to_jsonb(old) - array['released_at','updated_at','amount']) then
    return new;
  end if;
  if p.status <> 'draft' then raise exception 'Only draft lines can be edited.'; end if;
  if new.released_at is not null then raise exception 'Source claims are released only by invoice voiding.'; end if;
  if tg_op = 'UPDATE' and exists (select 1 from public.invoice_time_allocations where invoice_item_id = old.id) then
    raise exception 'Allocated lines are immutable; void and replace the draft to correct sources.';
  end if;
  if new.billed_minutes is not null then new.quantity := round(new.billed_minutes::numeric / 60, 8); end if;
  if new.billing_agreement_id is not null then
    select * into strict a from public.customer_billing_agreements where id = new.billing_agreement_id for share;
    if a.customer_id <> p.customer_id then raise exception 'Agreement belongs to a different customer.'; end if;
    anchor := date_trunc('month',new.period_start::timestamp)::date + a.billing_cycle_day - 1;
    if anchor > new.period_start then anchor := (anchor - interval '1 month')::date; end if;
    expected_start := greatest(anchor,a.effective_date);
    expected_end := least((anchor + interval '1 month')::date,a.end_date);
    if new.period_start is distinct from expected_start or new.period_end is distinct from expected_end
      or expected_end <= expected_start then raise exception 'Source period must be one agreement-specific billing period.'; end if;
    -- Nexa policy: a clipped first/last period still receives the full fixed
    -- monthly fee, just as the usage engine grants the full included allowance.
    -- No day/percentage proration. Future explicit adjustments are separate.
    if new.source_type = 'retainer_fee' then new.unit_rate := a.monthly_fee; end if;
  end if;
  return new;
end $$;

create function public.guard_invoice_allocation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare i public.invoice_items%rowtype; p public.invoices%rowtype; t public.time_entries%rowtype;
  u record; included bigint;
begin
  if tg_op = 'DELETE' then raise exception 'Source allocation history cannot be deleted.'; end if;
  select * into strict i from public.invoice_items where id = new.invoice_item_id;
  update public.invoices set updated_at = updated_at where id = i.invoice_id returning * into p;
  -- Re-read after acquiring the parent lock: a line may have changed while waiting.
  select * into strict i from public.invoice_items where id = new.invoice_item_id;
  if tg_op = 'UPDATE' then
    if p.status = 'void' and old.released_at is null and new.released_at = p.voided_at
      and (to_jsonb(new) - array['released_at','allocated_minutes']) = (to_jsonb(old) - array['released_at','allocated_minutes']) then return new; end if;
    raise exception 'Source allocations are immutable except release by invoice voiding.';
  end if;
  if p.status <> 'draft' or new.released_at is not null then raise exception 'Allocations require an unreleased draft.'; end if;
  if i.source_type not in ('hourly_time','retainer_overage') then raise exception 'This line does not accept time allocations.'; end if;
  -- Touch creates a row version as well as taking the lock, protecting against
  -- concurrent source corrections and repeatable-read stale snapshots.
  update public.time_entries set updated_at = updated_at where id = new.time_entry_id returning * into t;
  if not found or t.customer_id <> p.customer_id or not t.is_billable or t.voided_at is not null
    or new.minute_end > t.rounded_minutes then raise exception 'Invalid billable time source or minute bounds.'; end if;
  if t.hourly_rate is distinct from i.unit_rate then raise exception 'Time rate must equal its captured hourly rate.'; end if;
  if i.source_type = 'hourly_time' then
    if t.billing_agreement_id is not null then raise exception 'Retainer work must use overage allocations.'; end if;
  else
    if t.billing_agreement_id is distinct from i.billing_agreement_id then raise exception 'Time agreement mismatch.'; end if;
    select * into strict u from public.get_retainer_period_usage(i.billing_agreement_id,t.work_date);
    if row(u.period_start,u.period_end) is distinct from row(i.period_start,i.period_end) then raise exception 'Time period mismatch.'; end if;
    select (e->>'included_minutes')::numeric::bigint into included from jsonb_array_elements(u.allocations) e where (e->>'time_entry_id')::uuid = t.id;
    if included is null or new.minute_start < included then raise exception 'Included minutes cannot be invoiced as overage.'; end if;
  end if;
  if new.minute_end - new.minute_start + (select coalesce(sum(allocated_minutes),0) from public.invoice_time_allocations
    where invoice_item_id = i.id and released_at is null) > i.billed_minutes then raise exception 'Allocations exceed line minutes.'; end if;
  return new;
end $$;

create function public.protect_invoiced_time()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (tg_op = 'DELETE' or (to_jsonb(new) - array['updated_at','rounded_minutes']) is distinct from (to_jsonb(old) - array['updated_at','rounded_minutes']))
    and exists (select 1 from public.invoice_time_allocations where time_entry_id = old.id) then
    raise exception 'Invoiced time history cannot be edited, voided or deleted, including released claims.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create function public.release_void_invoice_sources()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    update public.invoice_items set released_at = new.voided_at where invoice_id = new.id;
    update public.invoice_time_allocations set released_at = new.voided_at
      where invoice_item_id in (select id from public.invoice_items where invoice_id = new.id);
  end if;
  return new;
end $$;

create trigger invoices_guard before insert or update or delete on public.invoices for each row execute function public.guard_invoice();
create trigger invoices_set_updated_at before update on public.invoices for each row execute function public.set_updated_at();
create trigger invoices_release_sources after update on public.invoices for each row execute function public.release_void_invoice_sources();
create trigger invoice_items_guard before insert or update or delete on public.invoice_items for each row execute function public.guard_invoice_item();
create trigger invoice_items_set_updated_at before update on public.invoice_items for each row execute function public.set_updated_at();
create trigger invoice_time_allocations_guard before insert or update or delete on public.invoice_time_allocations for each row execute function public.guard_invoice_allocation();
create trigger time_entries_invoice_guard before update or delete on public.time_entries for each row execute function public.protect_invoiced_time();

-- Calculated from exact immutable lines: no cached subtotal/total that can drift.
create view public.invoice_totals with (security_invoker = true) as
  select v.id as invoice_id, coalesce(sum(i.amount),0)::numeric as subtotal,
    coalesce(sum(i.tax_amount),0)::numeric as tax_amount,
    coalesce(sum(i.amount + i.tax_amount),0)::numeric as total
  from public.invoices v left join public.invoice_items i on i.invoice_id = v.id group by v.id;

-- Keep existing columns/order, append authoritative claimed/remaining minutes.
-- Remaining retainer minutes include allowance: this is NOT an overage quote.
create or replace view public.unbilled_time_entries with (security_invoker = true) as
  select t.*, coalesce(a.minutes,0)::bigint as invoiced_minutes,
    (t.rounded_minutes - coalesce(a.minutes,0))::bigint as uninvoiced_minutes
  from public.time_entries t left join lateral (
    select sum(x.allocated_minutes) as minutes from public.invoice_time_allocations x
    where x.time_entry_id = t.id and x.released_at is null
  ) a on true
  where t.is_billable and t.voided_at is null and t.rounded_minutes > coalesce(a.minutes,0);

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_time_allocations enable row level security;
create policy "Authenticated invoice reads" on public.invoices for select to authenticated using (true);
create policy "Authenticated invoice creation" on public.invoices for insert to authenticated with check (true);
create policy "Authenticated invoice updates" on public.invoices for update to authenticated using (true) with check (true);
create policy "Authenticated item reads" on public.invoice_items for select to authenticated using (true);
create policy "Authenticated item creation" on public.invoice_items for insert to authenticated with check (true);
create policy "Authenticated item updates" on public.invoice_items for update to authenticated using (true) with check (true);
create policy "Authenticated allocation reads" on public.invoice_time_allocations for select to authenticated using (true);
create policy "Authenticated allocation creation" on public.invoice_time_allocations for insert to authenticated with check (true);
create policy "Authenticated allocation release" on public.invoice_time_allocations for update to authenticated using (true) with check (true);
revoke all on public.invoices, public.invoice_items, public.invoice_time_allocations, public.invoice_totals, public.unbilled_time_entries from public, anon, authenticated;
grant select, insert, update on public.invoices, public.invoice_items, public.invoice_time_allocations to authenticated;
grant select on public.invoice_totals, public.unbilled_time_entries to authenticated;
revoke all on sequence public.invoices_invoice_number_seq from public, anon, authenticated;
-- Identity INSERT needs no direct sequence privilege: callers cannot reset numbering.
revoke all on function public.guard_invoice(), public.guard_invoice_item(), public.guard_invoice_allocation(),
  public.protect_invoiced_time(), public.release_void_invoice_sources() from public, anon, authenticated, service_role;

comment on table public.invoices is 'USD historical invoice snapshots. Draft -> sent (issued/finalized, not proof of email delivery) -> void; drafts can also be voided. No paid state until a payment ledger exists. Overdue is derived from NY business date and outstanding balance in the future. Numbers may have gaps. No hard deletion.';
comment on table public.invoice_items is 'Authoritative USD line snapshots. Manual quantity/rate or exact time minutes/hourly rate generate amount. Explicit tax_amount defaults to zero, not a tax engine. Issued and allocated lines are immutable. Retainer fee source ranges reserve a whole version-specific period until invoice void.';
comment on table public.invoice_time_allocations is 'Immutable source minute [start,end) claims within rounded time. Active draft and issued claims prevent double billing. Voiding releases but never deletes history. No per-allocation dollar rounding: the summarized line owns its exact cents.';
comment on view public.invoice_totals is 'Caller-RLS totals from lines; includes historical void invoice amounts. Exclude void invoices in receivables, never erase their totals.';
comment on view public.unbilled_time_entries is 'Caller-RLS unclaimed rounded billable minutes. Draft claims reserve minutes; void claims release them. Partial rows remain. Retainer included minutes are not invoiceable overage; consult usage allocations before generation.';
comment on table public.time_entries is 'Per-entry actual minutes and immutable billing-context snapshots. Invoice_time_allocations records exact claimed rounded-minute ranges. Once linked, the source record cannot be corrected, voided or deleted, even after invoice voiding; preserve audit history. Entries without invoice history retain their existing correction/soft-void behavior. Usage still excludes non-billable/voided work and is calculated independently of invoice claims.';
