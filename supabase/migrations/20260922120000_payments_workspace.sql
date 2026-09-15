-- Extend the existing ledger; preserve method choices already configured.
alter table public.payment_settings
 add column ach_enabled boolean not null default true,
 add column other_enabled boolean not null default true;
alter table public.payment_settings drop constraint payment_settings_one_method;
alter table public.payment_settings add constraint payment_settings_one_method
 check(cash_enabled or check_enabled or card_enabled or ach_enabled or other_enabled);
alter table public.invoice_payments drop constraint invoice_payments_method;
alter table public.invoice_payments add constraint invoice_payments_method
 check(payment_method in ('cash','check','card','ach','other'));
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
  -- INSERT only: historical future dates remain readable, voidable and retryable.
  if new.payment_date > (now() at time zone 'America/New_York')::date then
    raise exception using errcode='22023',message='Payment date cannot be in the future.';
  end if;
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
  if not coalesce(case new.payment_method when 'cash' then settings.cash_enabled when 'check' then settings.check_enabled when 'card' then settings.card_enabled when 'ach' then settings.ach_enabled when 'other' then settings.other_enabled else false end,false) then
    raise exception using errcode='22023',message='This payment method is not enabled.';
  end if;
  select balance_due into due from public.invoice_payment_summary where invoice_id=new.invoice_id;
  if due is null then raise exception using errcode='P0002',message='Invoice payment summary unavailable.';end if;
  if new.amount>due then raise exception using errcode='22023',message='Payment exceeds the remaining invoice balance.';end if;
  new.created_at:=now();new.updated_at:=new.created_at;
  return new;
end $$;

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,p_amount numeric,p_payment_date date,p_payment_method text,p_request_id uuid,
  p_reference text default null,p_notes text default null
) returns table(payment_id uuid,invoice_id uuid,payment_voided_at timestamptz,invoice_total numeric,amount_paid numeric,balance_due numeric,payment_status text,payment_count bigint,latest_payment_date date)
language plpgsql security invoker set search_path='' as $$
declare saved public.invoice_payments%rowtype;ref text:=nullif(btrim(p_reference),'');note text:=nullif(btrim(p_notes),'');
begin
  if p_invoice_id is null or p_request_id is null or p_amount is null or not(p_amount>0 and p_amount<=9999999999.99 and p_amount=trunc(p_amount,2))
    or p_payment_date is null or not isfinite(p_payment_date) or p_payment_method is null or p_payment_method not in ('cash','check','card','ach','other')
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


-- Optional new flags preserve settings when older callers supply three arguments.
drop function public.update_payment_settings(boolean,boolean,boolean);
create function public.update_payment_settings(p_cash_enabled boolean,p_check_enabled boolean,p_card_enabled boolean,
 p_ach_enabled boolean default null,p_other_enabled boolean default null)
returns public.payment_settings language plpgsql security invoker set search_path='' as $$
declare settings public.payment_settings%rowtype;
begin
 select * into settings from public.payment_settings where singleton for update;
 if not found then raise exception using errcode='55000',message='Payment settings unavailable.';end if;
 if p_cash_enabled is null or p_check_enabled is null or p_card_enabled is null
 or not(p_cash_enabled or p_check_enabled or p_card_enabled or coalesce(p_ach_enabled,settings.ach_enabled) or coalesce(p_other_enabled,settings.other_enabled)) then
  raise exception using errcode='22023',message='Enable at least one payment method.';
 end if;
 update public.payment_settings set cash_enabled=p_cash_enabled,check_enabled=p_check_enabled,card_enabled=p_card_enabled,
  ach_enabled=coalesce(p_ach_enabled,ach_enabled),other_enabled=coalesce(p_other_enabled,other_enabled)
  where singleton returning * into settings;
 return settings;
end $$;
revoke all on function public.update_payment_settings(boolean,boolean,boolean,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.update_payment_settings(boolean,boolean,boolean,boolean,boolean) to authenticated;

-- Existing indexes start with invoice_id. This index supports global date ordering.
create index invoice_payments_date_idx on public.invoice_payments(payment_date desc,created_at desc,id desc);
create function public.get_payment_report(
 p_search text default null,p_payment_date_from date default null,p_payment_date_to date default null,
 p_customer_id uuid default null,p_method text default null,p_status text default 'active',
 p_page integer default 1,p_page_size integer default 25
) returns table(page integer,page_size integer,total_rows bigint,total_pages bigint,
 payments_received numeric,payment_count bigint,average_payment numeric,rows jsonb)
language plpgsql stable security invoker set search_path='' as $$
declare search_text text:=nullif(regexp_replace(p_search,'^\s+|\s+$','','g'),'');
begin
 if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100
 or p_status is null or p_status not in ('active','voided','all')
 or (p_method is not null and p_method not in ('cash','check','card','ach','other'))
 or (p_payment_date_from is not null and not isfinite(p_payment_date_from))
 or (p_payment_date_to is not null and not isfinite(p_payment_date_to))
 or p_payment_date_from>p_payment_date_to or length(search_text)>500 then
  raise exception using errcode='22023',message='Check payment report filters.';
 end if;
 return query
 with filtered as materialized (
  select p.id as payment_id,p.invoice_id,i.invoice_number,i.customer_id,i.company_name_snapshot,
    i.status as invoice_status,p.payment_date,p.created_at,p.amount,p.payment_method,p.reference,p.notes,
    p.voided_at,p.void_reason,case when p.voided_at is null then 'active' else 'voided' end as payment_status
  from public.invoice_payments p join public.invoices i on i.id=p.invoice_id
  where (search_text is null or i.invoice_number::text=search_text
     or strpos(lower(i.company_name_snapshot),lower(search_text))>0 or strpos(lower(coalesce(p.reference,'')),lower(search_text))>0)
   and (p_customer_id is null or i.customer_id=p_customer_id)
   and (p_method is null or p.payment_method=p_method)
   and (p_payment_date_from is null or p.payment_date>=p_payment_date_from)
   and (p_payment_date_to is null or p.payment_date<=p_payment_date_to)
   and (p_status='all' or (p_status='active' and p.voided_at is null) or (p_status='voided' and p.voided_at is not null))
 ), summary as (
  select count(*) as matched,
   coalesce(sum(f.amount) filter(where f.voided_at is null and f.invoice_status<>'void'),0::numeric) as received,
   count(*) filter(where f.voided_at is null and f.invoice_status<>'void') as received_count,
   coalesce(round(avg(f.amount) filter(where f.voided_at is null and f.invoice_status<>'void'),2),0::numeric) as average
  from filtered f
 ), paged as (
  select * from filtered order by payment_date desc,created_at desc,payment_id desc
  limit p_page_size offset ((p_page::bigint-1)*p_page_size)
 )
 select p_page,p_page_size,s.matched,(s.matched+p_page_size-1)/p_page_size,s.received,s.received_count,s.average,
  coalesce((select jsonb_agg(to_jsonb(p) order by p.payment_date desc,p.created_at desc,p.payment_id desc) from paged p),'[]'::jsonb)
 from summary s;
end $$;
revoke all on function public.get_payment_report(text,date,date,uuid,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_payment_report(text,date,date,uuid,text,text,integer,integer) to authenticated;
comment on function public.get_payment_report(text,date,date,uuid,text,text,integer,integer) is
 'Read-only caller-RLS receipt-date report. Rows and full-filter totals share one statement snapshot. Headlines exclude voided payments and currently Void invoices; ledger rows preserve both histories. No refund or credit accounting.';
