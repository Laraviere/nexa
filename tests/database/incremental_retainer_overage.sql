begin;
create function pg_temp.check_overage(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.overage(c uuid,d date) returns jsonb language sql as $$
 select e from public.preview_customer_invoice(c,d) p cross join lateral jsonb_array_elements(p.candidates) e where e->>'source_type'='retainer_overage' limit 1;
$$;
create function pg_temp.bill_overage(c uuid,d date) returns uuid language plpgsql as $$
declare s record; k text; v uuid;
begin
 select * into s from public.preview_customer_invoice(c,d);
 select e->>'candidate_id' into strict k from jsonb_array_elements(s.candidates) e where e->>'source_type'='retainer_overage';
 select invoice_id into v from public.create_composed_invoice(c,d,d,gen_random_uuid(),s.revision,array[k],'[]');return v;
end $$;
set local role authenticated;
do $$
declare c uuid;a uuid;t uuid;early uuid;late uuid;v uuid;w uuid;z uuid;item uuid;preview record;state jsonb;before_number integer;candidate jsonb;
begin
 insert into public.customers(company_name) values('Market58 incremental') returning id into c;
 insert into public.customer_billing_agreements(customer_id,effective_date,monthly_fee,included_hours,overage_hourly_rate,billing_cycle_day)
 values(c,'2025-09-08',75,1,75,1) returning id into a;
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-08',45,'Included') returning id into early;
 perform pg_temp.check_overage(pg_temp.overage(c,'2025-09-30') is null,'below allowance');
 update public.time_entries set actual_minutes=60 where id=early;
 perform pg_temp.check_overage(pg_temp.overage(c,'2025-09-30') is null,'exact allowance');
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-30',225,'Overage') returning id into t;
 candidate:=pg_temp.overage(c,'2025-09-30');
 perform pg_temp.check_overage((candidate->>'billed_minutes')::int=225 and (candidate->>'amount')::numeric=281.25,'Market58 225 / 281.25 before close');
 perform pg_temp.check_overage(pg_temp.overage(c,'2025-09-29') is null,'as-of excludes September30');
 select * into preview from public.preview_customer_invoice(c,'2025-09-30');
 v:=pg_temp.bill_overage(c,'2025-09-30');
 perform pg_temp.check_overage(pg_temp.overage(c,'2025-09-30') is null,'claimed overage disappears');
 begin
   perform public.create_composed_invoice(c,'2025-09-30','2025-09-30',gen_random_uuid(),preview.revision,array[candidate->>'candidate_id'],'[]');
   raise exception 'stale preview succeeded';
 exception when sqlstate 'P0001' then if sqlerrm not like 'STALE_INVOICE_PREVIEW%' then raise;end if;end;
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-30',60,'Later') returning id into late;
 candidate:=pg_temp.overage(c,'2025-09-30');
 perform pg_temp.check_overage((candidate->>'billed_minutes')::int=60 and (candidate->>'amount')::numeric=75,'increment is 60 / 75');
 w:=pg_temp.bill_overage(c,'2025-09-30');
 perform pg_temp.check_overage((select count(*)=2 from public.invoice_items where billing_agreement_id=a and source_type='retainer_overage'),'multiple overage lines');
 perform pg_temp.check_overage((select sum(x.allocated_minutes)=285 from public.invoice_time_allocations x join public.time_entries e on e.id=x.time_entry_id where e.customer_id=c and x.released_at is null),'no repeated 225');
 -- Earlier work can safely expose additional offsets on an unclaimed included
 -- entry. Existing claimed later offsets never turn into included minutes.
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-08',30,'Backdated before claimed work');
 perform pg_temp.check_overage((pg_temp.overage(c,'2025-09-30')->>'billed_minutes')::int=30,'backdate before claims exposes 30');
 begin update public.time_entries set actual_minutes=1 where id=early;raise exception 'unsafe reduction accepted';
 exception when check_violation then null;end;
 begin update public.time_entries set voided_at=clock_timestamp(),void_reason='Earlier correction' where id=early;raise exception 'unsafe void accepted';
 exception when check_violation then null;end;
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-30',15,'Backdated after claimed work');
 perform pg_temp.check_overage((pg_temp.overage(c,'2025-09-30')->>'billed_minutes')::int=45,'backdate after claims adds 15');
 perform pg_temp.check_overage((select included_minutes_used=60 from public.get_retainer_period_usage(a,'2025-09-30')),'allowance not reset by invoicing');
 -- Void releases exact ranges without deleting allocation history.
 update public.invoices set status='void',void_reason='Regression release' where id=v;
 perform pg_temp.check_overage((pg_temp.overage(c,'2025-09-30')->>'billed_minutes')::int=270,'void releases original225 plus45');
 perform pg_temp.check_overage((select count(*)=1 from public.invoice_time_allocations x join public.invoice_items i on i.id=x.invoice_item_id where i.invoice_id=v and x.released_at is not null),'released history retained');
 -- Retain the second invoice unchanged, then remove its overage via atomic edit.
 select invoice_number into before_number from public.invoices where id=w;
 state:=public.invoice_edit_preview_state(w,'2025-09-30');
 perform public.update_composed_invoice(w,'2025-09-30','2025-09-30',gen_random_uuid(),state->>'revision',
   array(select e->>'candidate_id' from jsonb_array_elements(state->'candidates') e where e->>'retained'='true'),'[]');
 perform pg_temp.check_overage((select invoice_number=before_number from public.invoices where id=w),'retained edit number');
 state:=public.invoice_edit_preview_state(w,'2025-09-30');
 perform public.update_composed_invoice(w,'2025-09-30','2025-09-30',gen_random_uuid(),state->>'revision','{}',
   '[{"description":"Replacement manual","quantity":1,"unit":"each","unit_rate":10}]');
 perform pg_temp.check_overage((pg_temp.overage(c,'2025-09-30')->>'billed_minutes')::int=330,'edit releases second60');
 z:=pg_temp.bill_overage(c,'2025-09-30');
 perform pg_temp.check_overage(pg_temp.overage(c,'2025-09-30') is null,'released ranges rebilled once');
 select id into item from public.invoice_items where invoice_id=z;
 begin insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end) values(item,t,0,15);raise exception 'duplicate accepted';
 exception when others then if sqlerrm='duplicate accepted' then raise;end if;end;
 perform pg_temp.check_overage((select count(*)=1 from public.preview_customer_invoice(c,'2025-09-30') p cross join lateral jsonb_array_elements(p.candidates) e where e->>'source_type'='retainer_fee'),'fee still independently available');
 perform pg_temp.check_overage((select chargeable_minutes=0 and deferred_minutes=0 from public.get_time_entry_invoiceability(t,'2025-09-30')),'claimed classification');
 -- Partial source entry, stale range identity and generator share the planner.
 insert into public.customers(company_name) values('Partial incremental') returning id into c;
 insert into public.customer_billing_agreements(customer_id,effective_date,monthly_fee,included_hours,overage_hourly_rate)
 values(c,'2025-09-01',75,1,75) returning id into a;
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-01',45,'45 included');
 insert into public.time_entries(customer_id,work_date,actual_minutes,description,created_at) values(c,'2025-09-02',30,'15 included15overage','2025-09-02 01:00:00+00') returning id into t;
 v:=pg_temp.bill_overage(c,'2025-09-02');
 perform pg_temp.check_overage((select minute_start=15 and minute_end=30 from public.invoice_time_allocations where time_entry_id=t and released_at is null),'partial exact [15,30)');
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-02',30,'new work');
 select * into preview from public.preview_customer_invoice(c,'2025-09-02');candidate:=pg_temp.overage(c,'2025-09-02');
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-02',15,'more work');
 perform pg_temp.check_overage(pg_temp.overage(c,'2025-09-02')->>'candidate_id'<>candidate->>'candidate_id','identity contains exact ranges');
 begin perform public.create_composed_invoice(c,'2025-09-02','2025-09-02',gen_random_uuid(),preview.revision,array[candidate->>'candidate_id'],'[]');raise exception 'stale work accepted';
 exception when sqlstate 'P0001' then if sqlerrm not like 'STALE_INVOICE_PREVIEW%' then raise;end if;end;
 select invoice_id into w from public.generate_customer_invoice(c,'2025-09-02',gen_random_uuid(),'2025-09-02');
 perform pg_temp.check_overage((select billed_minutes=45 and amount=56.25 from public.invoice_items where invoice_id=w and source_type='retainer_overage'),'generator incremental amount');
 perform pg_temp.check_overage((select count(*)=1 from public.invoice_items where invoice_id=w and source_type='retainer_fee'),'full monthly fee unchanged');
 -- A backdated insertion exposes the previously included prefix of the
 -- already partially claimed entry. It must not re-offer its claimed suffix.
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-01',45,'Backdate before partial claim');
 state:=public.invoice_preview_state(c,'2025-09-02');
 perform pg_temp.check_overage((pg_temp.overage(c,'2025-09-02')->>'billed_minutes')::int=45,'backdate exposes exactly45 new overage');
 perform pg_temp.check_overage((select count(*)=1 from jsonb_array_elements(state->'candidates') e cross join lateral jsonb_array_elements(e->'allocations') x where x->>'time_entry_id'=t::text and (x->>'minute_start')::int=0 and (x->>'minute_end')::int=15),'only newly exposed prefix [0,15) offered');
 perform pg_temp.check_overage(pg_temp.overage(c,'2025-12-01') is null,'no historical catch-up');
 -- Fractional-hour money is rounded once per incremental invoice line.
 insert into public.customers(company_name) values('Exact numeric incremental') returning id into c;
 insert into public.customer_billing_agreements(customer_id,effective_date,monthly_fee,included_hours,overage_hourly_rate,rounding_increment_minutes)
 values(c,'2025-09-01',75,0,125,1);
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-02',17,'Fractional hour');
 perform pg_temp.check_overage((pg_temp.overage(c,'2025-09-02')->>'amount')::numeric=35.42,'17min at125 rounds to35.42');
 v:=pg_temp.bill_overage(c,'2025-09-02');
 insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-09-02',1,'Next minute');
 perform pg_temp.check_overage((pg_temp.overage(c,'2025-09-02')->>'amount')::numeric=2.08,'incremental1min rounds to2.08');
 perform pg_temp.check_overage((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.unbilled_time_entries'::regclass),'view security invoker retained');
end $$;
set constraints all immediate;
rollback;
