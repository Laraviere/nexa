-- Business-wide payment configuration and an append-only USD payment ledger.
-- Invoice workflow status and all financial calculation/source rules are unchanged.
create table public.payment_settings (
  singleton boolean primary key default true check (singleton),
  cash_enabled boolean not null default true,
  check_enabled boolean not null default true,
  card_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_settings_one_method check (cash_enabled or check_enabled or card_enabled),
  constraint payment_settings_timestamps check (isfinite(created_at) and isfinite(updated_at) and updated_at >= created_at)
);
insert into public.payment_settings(singleton) values (true);

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on update restrict on delete restrict,
  -- Unconstrained numeric plus explicit bounds rejects excess fractional cents
  -- on direct INSERT too; numeric(12,2) would silently round before a CHECK runs.
  amount numeric not null,
  payment_date date not null default (now() at time zone 'America/New_York')::date,
  payment_method text not null,
  reference text,
  notes text,
  request_id uuid not null unique,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_payments_amount check (amount > 0 and amount <= 9999999999.99 and amount = trunc(amount,2)),
  constraint invoice_payments_method check (payment_method in ('cash','check','card')),
  constraint invoice_payments_date check (isfinite(payment_date)),
  constraint invoice_payments_reference check (reference is null or (length(reference) <= 500 and reference ~ '[^[:space:]]')),
  constraint invoice_payments_notes check (notes is null or (length(notes) <= 10000 and notes ~ '[^[:space:]]')),
  constraint invoice_payments_void check (
    (voided_at is null and void_reason is null) or
    (voided_at is not null and isfinite(voided_at) and voided_at >= created_at and void_reason is not null
      and length(void_reason) <= 2000 and void_reason ~ '[^[:space:]]')),
  constraint invoice_payments_timestamps check (isfinite(created_at) and isfinite(updated_at) and updated_at >= created_at)
);
create index invoice_payments_history_idx on public.invoice_payments(invoice_id,payment_date desc,created_at desc,id);
create index invoice_payments_active_idx on public.invoice_payments(invoice_id) where voided_at is null;

alter table public.payment_settings enable row level security;
alter table public.invoice_payments enable row level security;
create policy "Authenticated payment settings read" on public.payment_settings for select to authenticated using (true);
create policy "Authenticated payment settings update" on public.payment_settings for update to authenticated using (true) with check (true);
create policy "Authenticated payment history read" on public.invoice_payments for select to authenticated
  using (exists(select from public.invoices i where i.id=invoice_id));
create policy "Authenticated payment record" on public.invoice_payments for insert to authenticated
  with check (exists(select from public.invoices i where i.id=invoice_id));
create policy "Authenticated payment correction" on public.invoice_payments for update to authenticated
  using (exists(select from public.invoices i where i.id=invoice_id))
  with check (exists(select from public.invoices i where i.id=invoice_id));
revoke all on public.payment_settings,public.invoice_payments from public,anon,authenticated;
grant select,update on public.payment_settings to authenticated;
grant select,insert,update on public.invoice_payments to authenticated;

create function public.guard_payment_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Payment settings cannot be deleted.';end if;
  if row(new.singleton,new.created_at) is distinct from row(old.singleton,old.created_at) then
    raise exception using errcode='55000',message='Payment settings identity is immutable.';
  end if;
  return new;
end $$;
create trigger payment_settings_guard before update or delete on public.payment_settings for each row execute function public.guard_payment_settings();
create trigger payment_settings_set_updated_at before update on public.payment_settings for each row execute function public.set_updated_at();

create view public.invoice_payment_summary with (security_invoker=true) as
select i.id as invoice_id,i.status as invoice_status,t.total as invoice_total,
  p.amount_paid,t.total-p.amount_paid as balance_due,
  case when t.total=p.amount_paid then 'paid' when p.amount_paid>0 then 'partially_paid' else 'unpaid' end as payment_status,
  p.payment_count,p.latest_payment_date
from public.invoices i join public.invoice_totals t on t.invoice_id=i.id
cross join lateral (
  select coalesce(sum(x.amount),0)::numeric as amount_paid,count(*) as payment_count,max(x.payment_date) as latest_payment_date
  from public.invoice_payments x where x.invoice_id=i.id and x.voided_at is null
) p;
revoke all on public.invoice_payment_summary from public,anon,authenticated;
grant select on public.invoice_payment_summary to authenticated;

create function public.guard_invoice_payment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v public.invoices%rowtype;settings public.payment_settings%rowtype;due numeric;
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Payment history cannot be deleted; void the payment instead.';end if;
  if tg_op='UPDATE' then
    if (to_jsonb(new)-array['voided_at','void_reason','updated_at']) is distinct from (to_jsonb(old)-array['voided_at','void_reason','updated_at']) then
      raise exception using errcode='55000',message='Recorded payment details are immutable; void and record a correction.';
    end if;
    if old.voided_at is not null then
      if row(new.voided_at,new.void_reason) is distinct from row(old.voided_at,old.void_reason) then
        raise exception using errcode='55000',message='Voided payment history is immutable.';
      end if;
      return new;
    end if;
    if new.voided_at is null or new.void_reason is null or not(new.void_reason ~ '[^[:space:]]') then
      raise exception using errcode='22023',message='Payment corrections require voiding with a reason.';
    end if;
    -- Touch the shared parent, serializing payment corrections with payments,
    -- invoice edits and invoice voids. No financial or workflow field is changed.
    update public.invoices set updated_at=updated_at where id=new.invoice_id returning * into v;
    if not found then raise exception using errcode='P0002',message='Invoice unavailable.';end if;
    new.voided_at:=clock_timestamp();new.void_reason:=btrim(new.void_reason);
    return new;
  end if;
  if new.voided_at is not null or new.void_reason is not null then raise exception using errcode='22023',message='New payments cannot start voided.';end if;
  perform pg_advisory_xact_lock(hashtextextended(new.request_id::text,17120000));
  -- A real row version, not only a SELECT lock, forces stale repeatable-read
  -- transactions to retry instead of using an obsolete balance.
  update public.invoices set updated_at=updated_at where id=new.invoice_id returning * into v;
  if not found then raise exception using errcode='P0002',message='Invoice unavailable.';end if;
  if v.status='void' then raise exception using errcode='22023',message='Void invoices cannot receive payments.';end if;
  select * into settings from public.payment_settings where singleton for share;
  if not found then raise exception using errcode='55000',message='Payment settings unavailable.';end if;
  if not coalesce(case new.payment_method when 'cash' then settings.cash_enabled when 'check' then settings.check_enabled when 'card' then settings.card_enabled else false end,false) then
    raise exception using errcode='22023',message='This payment method is not enabled.';
  end if;
  select balance_due into due from public.invoice_payment_summary where invoice_id=new.invoice_id;
  if due is null then raise exception using errcode='P0002',message='Invoice payment summary unavailable.';end if;
  if new.amount>due then raise exception using errcode='22023',message='Payment exceeds the remaining invoice balance.';end if;
  new.created_at:=now();new.updated_at:=new.created_at;
  return new;
end $$;
create trigger invoice_payments_guard before insert or update or delete on public.invoice_payments for each row execute function public.guard_invoice_payment();
create trigger invoice_payments_set_updated_at before update on public.invoice_payments for each row execute function public.set_updated_at();

-- Preserve the no-credit invariant when editable invoice lines change too.
-- Deferred evaluation permits atomic edits to retire old lines before inserting
-- replacements. All involved writers already serialize through the parent row.
create function public.check_invoice_payment_balance() returns trigger
language plpgsql security invoker set search_path='' as $$
declare paid numeric;total numeric;
begin
  select coalesce(sum(amount),0) into paid from public.invoice_payments where invoice_id=new.invoice_id and voided_at is null;
  if paid=0 then return null;end if;
  select t.total into total from public.invoice_totals t where t.invoice_id=new.invoice_id;
  if total is null or paid>total then raise exception using errcode='23514',message='Invoice total cannot be less than its valid payments. Correct the payment ledger first.';end if;
  return null;
end $$;
create constraint trigger invoice_items_payment_balance after insert or update on public.invoice_items
  deferrable initially deferred for each row execute function public.check_invoice_payment_balance();
create constraint trigger invoice_payments_balance after insert or update on public.invoice_payments
  deferrable initially deferred for each row execute function public.check_invoice_payment_balance();

create function public.record_invoice_payment(
  p_invoice_id uuid,p_amount numeric,p_payment_date date,p_payment_method text,p_request_id uuid,
  p_reference text default null,p_notes text default null
) returns table(payment_id uuid,invoice_id uuid,payment_voided_at timestamptz,invoice_total numeric,amount_paid numeric,balance_due numeric,payment_status text,payment_count bigint,latest_payment_date date)
language plpgsql security invoker set search_path='' as $$
declare saved public.invoice_payments%rowtype;ref text:=nullif(btrim(p_reference),'');note text:=nullif(btrim(p_notes),'');
begin
  if p_invoice_id is null or p_request_id is null or p_amount is null or not(p_amount>0 and p_amount<=9999999999.99 and p_amount=trunc(p_amount,2))
    or p_payment_date is null or not isfinite(p_payment_date) or p_payment_method is null or p_payment_method not in ('cash','check','card')
    or length(ref)>500 or length(note)>10000 then
    raise exception using errcode='22023',message='Provide an invoice, request key, positive cent amount, finite payment date and supported method.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,17120000));
  select * into saved from public.invoice_payments p where p.request_id=p_request_id;
  if found then
    if row(saved.invoice_id,saved.amount,saved.payment_date,saved.payment_method,saved.reference,saved.notes)
      is distinct from row(p_invoice_id,p_amount,p_payment_date,p_payment_method,ref,note) then
      raise exception using errcode='22023',message='Payment request key was already used with different details.';
    end if;
    -- A retry returns the original payment, even after disabling its method or
    -- voiding it/the invoice. It never records a second payment or resurrects one.
    perform 1 from public.invoices where id=saved.invoice_id;
    if not found then raise exception using errcode='P0002',message='Invoice unavailable.';end if;
  else
    insert into public.invoice_payments(invoice_id,amount,payment_date,payment_method,request_id,reference,notes)
      values(p_invoice_id,p_amount,p_payment_date,p_payment_method,p_request_id,ref,note) returning * into saved;
  end if;
  return query select saved.id,s.invoice_id,saved.voided_at,s.invoice_total,s.amount_paid,s.balance_due,s.payment_status,s.payment_count,s.latest_payment_date
    from public.invoice_payment_summary s where s.invoice_id=saved.invoice_id;
end $$;

create function public.void_invoice_payment(p_payment_id uuid,p_reason text)
returns public.invoice_payments language plpgsql security invoker set search_path='' as $$
declare saved public.invoice_payments%rowtype;reason text:=nullif(btrim(p_reason),'');
begin
  if p_payment_id is null or reason is null or length(reason)>2000 then raise exception using errcode='22023',message='Payment and correction reason are required.';end if;
  select * into saved from public.invoice_payments where id=p_payment_id for update;
  if not found then raise exception using errcode='P0002',message='Payment unavailable.';end if;
  if saved.voided_at is not null then
    if saved.void_reason<>reason then raise exception using errcode='22023',message='Payment already voided with a different reason.';end if;
    return saved;
  end if;
  update public.invoice_payments set voided_at=clock_timestamp(),void_reason=reason where id=p_payment_id returning * into saved;
  return saved;
end $$;

create function public.update_payment_settings(p_cash_enabled boolean,p_check_enabled boolean,p_card_enabled boolean)
returns public.payment_settings language plpgsql security invoker set search_path='' as $$
declare settings public.payment_settings%rowtype;
begin
  if p_cash_enabled is null or p_check_enabled is null or p_card_enabled is null or not(p_cash_enabled or p_check_enabled or p_card_enabled) then
    raise exception using errcode='22023',message='Enable at least one payment method.';
  end if;
  update public.payment_settings set cash_enabled=p_cash_enabled,check_enabled=p_check_enabled,card_enabled=p_card_enabled where singleton returning * into settings;
  if not found then raise exception using errcode='55000',message='Payment settings unavailable.';end if;
  return settings;
end $$;

revoke all on function public.guard_payment_settings(),public.guard_invoice_payment(),public.check_invoice_payment_balance() from public,anon,authenticated,service_role;
revoke all on function public.record_invoice_payment(uuid,numeric,date,text,uuid,text,text),public.void_invoice_payment(uuid,text),public.update_payment_settings(boolean,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.record_invoice_payment(uuid,numeric,date,text,uuid,text,text),public.void_invoice_payment(uuid,text),public.update_payment_settings(boolean,boolean,boolean) to authenticated;

comment on table public.payment_settings is 'One business-wide seeded configuration; at least one of Cash/Check/Card enabled. Disabling a method affects new payments only.';
comment on table public.invoice_payments is 'Immutable payment details; correct by irreversible soft void with reason and a new payment/request key. No refunds, deletes or invoice workflow transitions.';
comment on column public.invoice_payments.amount is 'Exact USD cents, strictly validated rather than silently rounded; range (0, 9999999999.99].';
comment on view public.invoice_payment_summary is 'Caller-RLS payment totals from active ledger rows and authoritative invoice totals. Workflow status is separate; Void balances are historical, not collectible. Zero-total invoices with no payments have zero balance and payment_status paid.';
