begin;
set local role authenticated;
do $$
declare before_settings public.payment_settings%rowtype; saved public.payment_settings%rowtype;
begin
 select * into before_settings from public.payment_settings where singleton;
 saved:=public.update_checks_payable_to('  Example Payee LLC  ');
 if saved.checks_payable_to<>'Example Payee LLC' or (select checks_payable_to from public.payment_settings where singleton)<>'Example Payee LLC' then raise exception 'Payee save/reload failed';end if;
 if row(saved.cash_enabled,saved.check_enabled,saved.card_enabled,saved.created_at) is distinct from row(before_settings.cash_enabled,before_settings.check_enabled,before_settings.card_enabled,before_settings.created_at) then raise exception 'Unrelated settings changed';end if;
 perform public.update_payment_settings(before_settings.cash_enabled,before_settings.check_enabled,before_settings.card_enabled);
 if (select checks_payable_to from public.payment_settings where singleton)<>'Example Payee LLC' then raise exception 'Payment method save overwrote payee';end if;
 saved:=public.update_checks_payable_to(E' \n\t ');
 if saved.checks_payable_to is not null then raise exception 'Whitespace should clear payee';end if;
 begin perform public.update_checks_payable_to(repeat('x',201));raise exception 'Overlong payee allowed';exception when sqlstate '22023' then null;end;
 if has_table_privilege('authenticated','public.payment_settings','DELETE') or has_function_privilege('anon','public.update_checks_payable_to(text)','EXECUTE') then raise exception 'Excess permission';end if;
end $$;
rollback;
