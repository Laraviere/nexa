-- New payment eligibility only. Existing ledger rows and exact-key RPC retries
-- remain unchanged, including payments on invoices moved back to Draft.
-- Replace the existing trigger function without changing its privileges.
-- The shared parent UPDATE serializes eligibility with workflow transitions.
create or replace function public.guard_invoice_payment() returns trigger
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
  if v.status not in ('ready','sent') then
    raise exception using errcode='P1001',message='This invoice must be marked Ready before a payment can be recorded.';
  end if;
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
