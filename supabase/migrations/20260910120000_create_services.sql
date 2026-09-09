-- Current catalog defaults only; historical financial records must snapshot values.
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_description text,
  default_rate numeric(12,2) not null,
  billing_unit text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_name_not_blank check (name ~ '[^[:space:]]'),
  constraint services_default_rate_valid check (default_rate >= 0 and default_rate <> 'NaN'::numeric),
  constraint services_billing_unit_valid check (billing_unit in ('hour', 'flat', 'each', 'mile', 'month')),
  constraint services_timestamps_valid check (
    isfinite(created_at) and isfinite(updated_at) and updated_at >= created_at
  )
);

-- Also supports active catalog ordering by this normalized expression.
-- Archived duplicates are allowed; reactivation must satisfy active uniqueness.
create unique index services_active_name_unique_idx
  on public.services (lower(btrim(name))) where is_active;

create trigger services_set_updated_at before update on public.services
  for each row execute function public.set_updated_at();

alter table public.services enable row level security;
create policy "Authenticated users can view services" on public.services
  for select to authenticated using (true);
create policy "Authenticated users can create services" on public.services
  for insert to authenticated with check (true);
create policy "Authenticated users can update services" on public.services
  for update to authenticated using (true) with check (true);

revoke all on table public.services from public, anon, authenticated;
grant select, insert, update on table public.services to authenticated;

comment on table public.services is
  'Reusable current service defaults, not historical prices or customer recurring terms. Archive rather than delete. Future time entries and invoice lines must snapshot the values actually used; catalog edits must never recalculate prior work or billed amounts.';
comment on column public.services.default_rate is
  'Explicit current USD default per billing_unit; zero allowed. No implicit free rate. Future consumers copy the applied rate into immutable historical snapshots.';
comment on column public.services.billing_unit is
  'Catalog unit: hour, flat, each, mile, month. Only hourly services are suitable as hourly time-entry defaults. Month does not enable recurring billing or replace a customer billing agreement.';
comment on column public.services.is_active is
  'Archive flag. Inactive services remain available for historical traceability; active names are unique under lower(btrim(name)).';
