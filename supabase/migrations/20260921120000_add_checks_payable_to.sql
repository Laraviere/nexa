-- Current remittance instructions, not historical invoice financial data.
alter table public.payment_settings add column checks_payable_to text
  constraint payment_settings_checks_payable_to_length check (checks_payable_to is null or length(checks_payable_to) <= 200);

create function public.update_checks_payable_to(p_checks_payable_to text)
returns public.payment_settings language plpgsql security invoker set search_path='' as $$
declare settings public.payment_settings%rowtype; payee text;
begin
  payee := nullif(regexp_replace(p_checks_payable_to,'^\s+|\s+$','','g'),'');
  if length(payee)>200 then
    raise exception using errcode='22023',message='Checks payable to must be at most 200 characters.';
  end if;
  update public.payment_settings set checks_payable_to=payee where singleton returning * into settings;
  if not found then raise exception using errcode='P0002',message='Payment settings unavailable.'; end if;
  return settings;
end $$;
revoke all on function public.update_checks_payable_to(text) from public,anon,authenticated,service_role;
grant execute on function public.update_checks_payable_to(text) to authenticated;
comment on column public.payment_settings.checks_payable_to is 'Optional current payee instruction loaded for every invoice PDF, including existing invoices. Blank hides it. Never used on quotes; no financial snapshots changed.';
