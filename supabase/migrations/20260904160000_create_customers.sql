create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  primary_contact_name text,
  email text,
  phone text,
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city text,
  billing_state text,
  billing_postal_code text,
  billing_country text,
  notes text,
  default_payment_terms_days integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customers_company_name_not_blank
    check (length(trim(company_name)) > 0),
  constraint customers_default_payment_terms_days_non_negative
    check (default_payment_terms_days >= 0)
);

create index customers_active_company_name_idx
  on public.customers (company_name)
  where is_active = true;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create trigger customers_set_updated_at
before update on public.customers
for each row
execute function public.set_updated_at();

alter table public.customers enable row level security;

create policy "Authenticated users can view customers"
on public.customers
for select
to authenticated
using (true);

create policy "Authenticated users can create customers"
on public.customers
for insert
to authenticated
with check (true);

create policy "Authenticated users can update customers"
on public.customers
for update
to authenticated
using (true)
with check (true);
