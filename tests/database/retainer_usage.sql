-- All fixtures, temporary policies and helpers roll back; local Docker only.
begin;
create function pg_temp.usage_assert(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
end;
$$;
create function pg_temp.usage_reject(statement text, expected_state text, expected_message text default null)
returns void language plpgsql as $$
declare actual_state text; actual_message text;
begin
  begin execute statement;
  exception when others then get stacked diagnostics actual_state=returned_sqlstate, actual_message=message_text;
  end;
  if actual_state is distinct from expected_state or (expected_message is not null and position(expected_message in actual_message)=0) then
    raise exception 'Expected % (%), got % (%): %', expected_state, expected_message, actual_state, actual_message, statement;
  end if;
end;
$$;
create function pg_temp.usage_agreement(hours numeric default 1, day integer default 15,
  starts date default '2026-08-15', ends date default null, rate numeric default 120, increment integer default 15,
  rollover boolean default false)
returns public.customer_billing_agreements language plpgsql as $$
declare customer uuid; result public.customer_billing_agreements;
begin
  insert into public.customers(company_name) values ('Local allowance regression') returning id into customer;
  insert into public.customer_billing_agreements(customer_id,effective_date,end_date,monthly_fee,included_hours,
    overage_hourly_rate,billing_cycle_day,rounding_increment_minutes,rollover_enabled)
  values(customer,starts,ends,500,hours,rate,day,increment,rollover) returning * into result;
  return result;
end;
$$;
create function pg_temp.usage_entry(customer uuid, day date, minutes integer, billable boolean default true,
  entry_id uuid default gen_random_uuid(), recorded timestamptz default '2026-01-01T00:00:00Z')
returns uuid language plpgsql as $$
begin
  insert into public.time_entries(id,customer_id,work_date,description,actual_minutes,is_billable,hourly_rate,created_at)
  values(entry_id,customer,day,'Local allowance work',minutes,billable,120,recorded);
  return entry_id;
end;
$$;

set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare a public.customer_billing_agreements; b public.customer_billing_agreements;
  u record; v record; e uuid; f uuid; ignored uuid; original jsonb;
begin
  a := pg_temp.usage_agreement();
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(u.period_start='2026-08-15' and u.period_end='2026-09-15'
    and u.included_minutes_available=60 and u.remaining_included_minutes=60
    and u.rounded_minutes_used=0 and u.overage_amount=0 and u.allocations='[]', 'No usage gives full allowance and empty allocations');
  select * into u from public.get_retainer_period_usage(a.id,'2030-01-01');
  perform pg_temp.usage_assert(u.period_start='2029-12-15' and u.period_end='2030-01-15', 'Future period and year boundary');
  e := pg_temp.usage_entry(a.customer_id,'2026-09-01',18);
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(u.rounded_minutes_used=30 and u.included_minutes_used=30
    and u.remaining_included_minutes=30 and u.overage_minutes=0, '18 actual uses stored 30 rounded; 60 available / 30 used');
  f := pg_temp.usage_entry(a.customer_id,'2026-09-02',31);
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(u.rounded_minutes_used=75 and u.included_minutes_used=60
    and u.remaining_included_minutes=0 and u.overage_minutes=15 and u.overage_amount=30.00
    and (u.allocations->1->>'included_minutes')::numeric=30
    and (u.allocations->1->>'overage_minutes')::numeric=15, '60 allowance / 75 usage = 15 overage at 120 per hour gives 30 USD');
  original := to_jsonb(u);
  perform pg_temp.usage_entry(a.customer_id,'2026-09-03',180,false);
  ignored := pg_temp.usage_entry(a.customer_id,'2026-09-04',180);
  update public.time_entries set voided_at=now(),void_reason='Regression void' where id=ignored;
  perform pg_temp.usage_entry(a.customer_id,'2026-09-15',180);
  perform pg_temp.usage_entry(a.customer_id,'2026-08-14',180); -- non-retainer
  b := pg_temp.usage_agreement();
  perform pg_temp.usage_entry(b.customer_id,'2026-09-01',180);
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(to_jsonb(u)=original, 'Non-billable, voided, other customer/agreement, non-retainer and outside-period work excluded');
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-15');
  perform pg_temp.usage_assert(u.included_minutes_available=60 and u.included_minutes_used=60 and u.overage_minutes=120,
    'Next period resets without rollover');
  raise notice 'PASS: empty/future/year periods, stored rounding, partial allocation, exact amounts and excluded work';

  -- Historical captured terms survive direct parent changes (including disable).
  update public.customer_billing_agreements set included_hours=10,billing_cycle_day=20,
    overage_hourly_rate=999,rollover_enabled=true,is_active=false where id=a.id;
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(to_jsonb(u)=original, 'Captured historical day, allowance, rollover and rate survive changed parent terms and disable');
  update public.time_entries set actual_minutes=46 where id=f;
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(u.rounded_minutes_used=90 and u.overage_amount=60, 'Duration corrections immediately recompute usage, no cached totals');
  update public.time_entries set voided_at=now(),void_reason='Remove duplicate' where id=f;
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(u.rounded_minutes_used=30 and u.remaining_included_minutes=30, 'Voiding recalculates remaining allowance');

  -- Insert deliberately out of allocation order. Earlier work date takes priority
  -- over capture timestamp, then timestamp beats UUID, then UUID breaks ties.
  a := pg_temp.usage_agreement();
  perform pg_temp.usage_entry(a.customer_id,'2026-09-02',15,true,'00000000-0000-4000-8000-000000000004','2026-01-01Z');
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',30,true,'00000000-0000-4000-8000-000000000003','2026-01-02Z');
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',15,true,'00000000-0000-4000-8000-000000000002','2026-01-02Z');
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',30,true,'00000000-0000-4000-8000-000000000005','2026-01-01Z');
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(u.allocations->0->>'time_entry_id'='00000000-0000-4000-8000-000000000005'
    and u.allocations->1->>'time_entry_id'='00000000-0000-4000-8000-000000000002'
    and u.allocations->2->>'time_entry_id'='00000000-0000-4000-8000-000000000003'
    and u.allocations->3->>'time_entry_id'='00000000-0000-4000-8000-000000000004'
    and (u.allocations->2->>'included_minutes')::numeric=15
    and (u.allocations->2->>'overage_minutes')::numeric=15
    and (u.allocations->3->>'included_minutes')::numeric=0,
    'Deterministic date/timestamp/UUID ordering and 45 earlier + 30 splits 15/15');
  select * into v from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(to_jsonb(u)=to_jsonb(v), 'Repeated calls deterministic');
  raise notice 'PASS: historical snapshots, changed source records, soft void and deterministic three-key partial boundary';

  a := pg_temp.usage_agreement();
  perform pg_temp.usage_entry(a.customer_id,'2026-09-07',60);
  -- Real atomic version change: old closes Sep 8; new receives its own allowance.
  b := public.change_customer_billing_terms(a.id,'2026-09-08',600,2,150,15,true,15,false);
  perform pg_temp.usage_entry(b.customer_id,'2026-09-08',90);
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-07');
  select * into v from public.get_retainer_period_usage(b.id,'2026-09-08');
  perform pg_temp.usage_assert(u.period_start='2026-08-15' and u.period_end='2026-09-08'
    and u.included_minutes_available=60 and u.rounded_minutes_used=60
    and v.period_start='2026-09-08' and v.period_end='2026-09-15'
    and v.included_minutes_available=120 and v.remaining_included_minutes=30,
    'Mid-period version change truncates old range and starts fresh full allowance without pooling');
  select * into v from public.get_retainer_period_usage(b.id,'2026-09-15');
  perform pg_temp.usage_assert(v.period_start='2026-09-15' and v.period_end='2026-10-15'
    and v.remaining_included_minutes=120, 'Successor resumes monthly billing anchor after initial partial period');
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',a.id,'2026-09-08'),'22023');
  update public.customer_billing_agreements set end_date='2026-09-12' where id=b.id;
  select * into v from public.get_retainer_period_usage(b.id,'2026-09-10');
  perform pg_temp.usage_assert(v.period_end='2026-09-12' and v.included_minutes_available=120, 'Scheduled cancellation truncates end, no allowance proration');
  a := pg_temp.usage_agreement(1,28,'2024-01-01');
  select * into u from public.get_retainer_period_usage(a.id,'2024-02-29');
  perform pg_temp.usage_assert(u.period_start='2024-02-28' and u.period_end='2024-03-28', 'Leap day and billing day 28');
  a := pg_temp.usage_agreement(1,1,'2026-01-01');
  select * into u from public.get_retainer_period_usage(a.id,'2026-03-31');
  perform pg_temp.usage_assert(u.period_start='2026-03-01' and u.period_end='2026-04-01', 'Day 1 calendar boundary');
  perform set_config('TimeZone','Pacific/Auckland',true);
  select * into v from public.get_retainer_period_usage(a.id,'2026-03-31');
  perform pg_temp.usage_assert(to_jsonb(u)=to_jsonb(v), 'Date-only periods unaffected by database timezone');
  perform set_config('TimeZone','UTC',true);
  raise notice 'PASS: version resets, exclusive boundaries, cancellation, leap/year boundaries and timezone-independent dates';

  a := pg_temp.usage_agreement(1.5);
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',31);
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(u.included_minutes_available=90 and u.remaining_included_minutes=45,'1.5 hours exactly 90 minutes');
  a := pg_temp.usage_agreement(0.25);
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(u.included_minutes_available=15,'0.25 hours exactly 15 minutes');
  a := pg_temp.usage_agreement(0.01);
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',a.id,'2026-09-01'),'22023','fractional-minute');
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',18);
  update public.customer_billing_agreements set included_hours=1 where id=a.id;
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',a.id,'2026-09-01'),'22023','fractional-minute');
  a := pg_temp.usage_agreement(0,15,'2026-08-15',null,0.30,1);
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',1);
  update public.customer_billing_agreements set overage_hourly_rate=0.90 where id=a.id;
  perform pg_temp.usage_entry(a.customer_id,'2026-09-02',1);
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(u.included_minutes_available=0 and u.overage_minutes=2
    and u.overage_amount=0.03 and (u.allocations->0->>'overage_amount')::numeric=0.01
    and (u.allocations->1->>'overage_amount')::numeric=0.02,
    'Zero allowance: exact captured rates, half-cent ties rounded per entry, summary sums line cents');
  a := pg_temp.usage_agreement(0,15,'2026-08-15',null,9999999999.99,2147483646);
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',2147483647);
  select * into u from public.get_retainer_period_usage(a.id,'2026-09-01');
  perform pg_temp.usage_assert(u.rounded_minutes_used=4294967292
    and u.overage_amount=round(4294967292::numeric*9999999999.99/60,2), 'Large generated duration and exact numeric money avoid integer overflow');

  a := pg_temp.usage_agreement(1,15,'2026-08-15',null,120,15,true);
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',a.id,'2026-09-01'),'0A000','rollover');
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',18);
  update public.customer_billing_agreements set rollover_enabled=false where id=a.id;
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',a.id,'2026-09-01'),'0A000','rollover');
  a := pg_temp.usage_agreement();
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',18);
  update public.customer_billing_agreements set included_hours=2 where id=a.id;
  perform pg_temp.usage_entry(a.customer_id,'2026-09-02',18);
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',a.id,'2026-09-01'),'22023','Conflicting allowance');
  a := pg_temp.usage_agreement();
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',18);
  update public.customer_billing_agreements set billing_cycle_day=20 where id=a.id;
  perform pg_temp.usage_entry(a.customer_id,'2026-09-02',18);
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',a.id,'2026-09-01'),'22023','Conflicting billing-day');
  a := pg_temp.usage_agreement();
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',18);
  update public.customer_billing_agreements set rollover_enabled=true where id=a.id;
  perform pg_temp.usage_entry(a.customer_id,'2026-09-02',18);
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',a.id,'2026-09-01'),'22023','Conflicting allowance');
  raise notice 'PASS: exact hour conversion, fractional-minute rejection, zero allowance, per-entry money, overflow, unsupported rollover and conflicting snapshots';

  perform pg_temp.usage_reject('select * from public.get_retainer_period_usage(null,current_date)','22023');
  perform pg_temp.usage_reject('select * from public.get_retainer_period_usage(gen_random_uuid(),current_date)','P0002');
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,null)',a.id),'22023');
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,''infinity'')',a.id),'22023');
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',a.id,'2026-08-14'),'22023');
  a := pg_temp.usage_agreement(1,15,'2026-09-08','2026-09-08');
  perform pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',a.id,'2026-09-08'),'22023');
  perform pg_temp.usage_assert(has_function_privilege('authenticated','public.get_retainer_period_usage(uuid,date)','EXECUTE')
    and not has_function_privilege('anon','public.get_retainer_period_usage(uuid,date)','EXECUTE')
    and not has_function_privilege('service_role','public.get_retainer_period_usage(uuid,date)','EXECUTE'), 'Explicit authenticated-only function grant');
  perform pg_temp.usage_assert((select not prosecdef and provolatile='s' and proconfig @> array['search_path=""']
    from pg_proc where oid='public.get_retainer_period_usage(uuid,date)'::regprocedure), 'Stable invoker with empty search path');
end;
$$;
reset role;
set local role anon;
select pg_temp.usage_reject('select * from public.get_retainer_period_usage(gen_random_uuid(),current_date)','42501');
reset role;

-- Meaningful RLS test: owner sees two entries, caller sees only one. Hidden
-- agreement access fails identically to a missing ID. Policy disappears on rollback.
do $$
declare a public.customer_billing_agreements;
begin
  a := pg_temp.usage_agreement();
  perform pg_temp.usage_entry(a.customer_id,'2026-09-01',30);
  perform pg_temp.usage_entry(a.customer_id,'2026-09-02',45);
  perform set_config('nexa.usage_rls_agreement',a.id::text,true);
end;
$$;
create policy usage_test_visible_time on public.time_entries as restrictive for select to authenticated
  using (work_date='2026-09-01');
create policy usage_test_visible_agreement on public.customer_billing_agreements as restrictive for select to authenticated
  using (current_setting('nexa.usage_hide',true) is distinct from 'yes');
select pg_temp.usage_assert((select rounded_minutes_used=75 from public.get_retainer_period_usage(current_setting('nexa.usage_rls_agreement')::uuid,'2026-09-01')), 'Owner sees full fixture');
set local role authenticated;
select pg_temp.usage_assert((select rounded_minutes_used=30 and jsonb_array_length(allocations)=1
  from public.get_retainer_period_usage(current_setting('nexa.usage_rls_agreement')::uuid,'2026-09-01')), 'Invoker usage and allocation enforce time-entry RLS');
set local nexa.usage_hide='yes';
select pg_temp.usage_reject(format('select * from public.get_retainer_period_usage(%L,%L)',current_setting('nexa.usage_rls_agreement'),'2026-09-01'),'P0002');
reset role;
do $$ begin raise notice 'PASS: authenticated execution, anon denial, invalid inputs, caller time-entry RLS and hidden agreement denial'; end; $$;
rollback;
