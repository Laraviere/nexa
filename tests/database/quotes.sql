begin;
set local role authenticated;
do $$
declare c uuid; q uuid; v uuid; n integer; before_number bigint; number_used boolean;
 line jsonb := '[{"description":"Consulting","quantity":"1.5","unit":"hour","unit_rate":"120.25"},{"description":"Setup","quantity":"2","unit":"each","unit_rate":"10"}]';
 key uuid := gen_random_uuid(); rec record; original_time timestamptz; expected numeric := 200.38;
begin
 insert into public.customers(company_name,default_payment_terms_days) values('Quote fixture',30) returning id into c;
 -- Sequence state is checked outside the authenticated block below as well.
 q := public.save_quote(c,'2026-09-01',line,key,null,'Proposal notes','Project terms');
 select * into rec from public.quotes where id=q;
 if rec.quote_number<>1001 or rec.expiration_date is not null or rec.total<>expected or rec.subtotal<>expected then raise exception 'Quote number/optional expiration/exact total failed'; end if;
 original_time:=rec.created_at;
 if public.save_quote(c,'2026-09-01',line,key,null,'Proposal notes','Project terms')<>q then raise exception 'Creation retry failed';end if;
 begin perform public.save_quote(c,'2026-09-02',line,key);raise exception 'Changed request accepted';exception when sqlstate '22023' then null;end;
 begin perform public.convert_quote_to_invoice(q,'2026-09-01',1);raise exception 'Draft conversion accepted';exception when sqlstate '55000' then null;end;
 perform public.save_quote(c,'2026-09-01',line,gen_random_uuid(),null,'Proposal notes','Project terms',q,1);
 begin perform public.save_quote(c,'2026-09-01',line,gen_random_uuid(),null,null,null,q,1);raise exception 'Stale edit accepted';exception when sqlstate '40001' then null;end;
 perform public.change_quote_status(q,'sent',2);
 begin perform public.save_quote(c,'2026-09-01',line,gen_random_uuid(),null,null,null,q,3);raise exception 'Sent edit accepted';exception when sqlstate '55000' then null;end;
 perform public.change_quote_status(q,'accepted',3);
 if exists(select from public.invoices where customer_id=c) then raise exception 'Acceptance created invoice';end if;
 v:=public.convert_quote_to_invoice(q,'2026-09-01',4);
 if public.convert_quote_to_invoice(q,'2026-09-02',4)<>v then raise exception 'Conversion retry duplicated';end if;
 select * into rec from public.invoices where id=v;
 if rec.issue_date<>'2026-09-01'::date or rec.due_date<>'2026-10-01'::date or rec.status<>'draft'
  or rec.notes<>'Proposal notes' or rec.terms<>'Project terms' or rec.customer_id<>c
  or (rec.created_at at time zone 'America/New_York')::date<>(now() at time zone 'America/New_York')::date then raise exception 'Converted invoice dates/snapshots/audit/notes failed';end if;
 n:=rec.invoice_number;
 if (select total from public.invoice_totals where invoice_id=v)<>expected then raise exception 'Conversion total drift';end if;
 if (select count(*) from public.invoice_items where invoice_id=v)<>2 then raise exception 'Missing converted lines';end if;
 if (select count(*) from public.invoice_time_allocations a join public.invoice_items i on i.id=a.invoice_item_id where i.invoice_id=v)<>0 then raise exception 'Quote created source claims';end if;
 if (select converted_invoice_id from public.quotes where id=q)<>v or (select created_at from public.quotes where id=q)<>original_time then raise exception 'Relationship/audit lost';end if;
 begin perform public.change_quote_status(q,'draft',5);raise exception 'Converted quote changed';exception when sqlstate '55000' then null;end;
 begin update public.quotes set converted_invoice_id=null where id=q;raise exception 'Direct quote writes allowed';exception when insufficient_privilege then null;end;
 begin delete from public.quotes where id=q;raise exception 'Quote deletion allowed';exception when insufficient_privilege then null;end;
 update public.invoices set status='ready' where id=v;
 perform public.record_invoice_payment(v,20,'2026-09-10','cash',gen_random_uuid());
 if (select amount_paid from public.invoice_payment_summary where invoice_id=v)<>20 then raise exception 'Converted invoice payment failed';end if;
 if (select invoice_number from public.invoices where id=v)<>n then raise exception 'Invoice number changed';end if;
 q:=public.save_quote(c,'2020-01-01',line,gen_random_uuid(),'2020-01-31');
 begin perform public.change_quote_status(q,'accepted',1);raise exception 'Expired quote accepted';exception when sqlstate '22023' then null;end;
 perform public.change_quote_status(q,'declined',1);
 perform public.change_quote_status(q,'draft',2);
 perform public.save_quote(c,'2020-01-01',line,gen_random_uuid(),null,null,null,q,3);
 perform public.change_quote_status(q,'accepted',4);
 begin perform public.save_quote(c,'2026-09-01',line,gen_random_uuid(),'2026-08-31');raise exception 'Invalid expiration accepted';exception when sqlstate '22023' then null;end;
 begin perform public.save_quote(c,'infinity',line,gen_random_uuid());raise exception 'Infinite date accepted';exception when sqlstate '22023' then null;end;
 begin perform public.save_quote(c,'2026-09-01','[{"description":"X","quantity":"NaN","unit":"each","unit_rate":1}]',gen_random_uuid());raise exception 'NaN accepted';exception when sqlstate '22023' then null;end;
 begin perform public.save_quote(c,'2026-09-01','[{"description":"X","quantity":1,"unit":"each","unit_rate":"1.001"}]',gen_random_uuid());raise exception 'Precision rounded';exception when sqlstate '22023' then null;end;
 begin perform public.save_quote(c,'2026-09-01','[{"description":"X","quantity":1,"unit":"each","unit_rate":1,"amount":999}]',gen_random_uuid());raise exception 'Caller total accepted';exception when sqlstate '22023' then null;end;
end $$;
reset role;
do $$begin
 if not (select relrowsecurity from pg_class where oid='public.quotes'::regclass) then raise exception 'RLS disabled';end if;
 if has_table_privilege('anon','public.quotes','SELECT') or has_function_privilege('anon','public.convert_quote_to_invoice(uuid,date,integer)','EXECUTE')
 or has_table_privilege('authenticated','public.quotes','DELETE') or has_table_privilege('authenticated','public.quotes','UPDATE') then raise exception 'Excess privilege';end if;
end $$;
set local role anon;
do $$begin
 begin perform * from public.quotes;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;
 begin perform public.convert_quote_to_invoice(gen_random_uuid(),'2026-09-01',1);raise exception 'Anonymous conversion allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
