-- Local-only, rollback-only. Freeze ONLY the two new functions' clock calls
-- inside this test transaction; the shipped functions have no clock override.
begin;
create function pg_temp.timer_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end;
$$;
create function pg_temp.timer_reject(statement text, expected text) returns void language plpgsql as $$
declare state text;
begin
  begin execute statement; exception when others then get stacked diagnostics state=returned_sqlstate; end;
  if state is distinct from expected then raise exception 'Expected %, got %: %',expected,state,statement; end if;
end;
$$;
create function pg_temp.timer_clock() returns timestamptz language sql volatile as $$
  select current_setting('nexa.test_timer_clock')::timestamptz;
$$;
do $$
begin
  execute replace(pg_get_functiondef('public.guard_running_timer()'::regprocedure),
    'clock_timestamp()', 'pg_temp.timer_clock()');
  execute replace(pg_get_functiondef('public.stop_time_timer(uuid,numeric)'::regprocedure),
    'clock_timestamp()', 'pg_temp.timer_clock()');
end;
$$;
create function pg_temp.timer_customer(retainer boolean default true) returns uuid language plpgsql as $$
declare customer uuid;
begin
  insert into public.customers(company_name) values ('Local timer regression') returning id into customer;
  if retainer then
    insert into public.customer_billing_agreements(customer_id,effective_date,monthly_fee,included_hours,overage_hourly_rate,billing_cycle_day)
    values(customer,'2000-01-01',500,1,120,15);
  end if;
  return customer;
end;
$$;
create function pg_temp.timer_stop(timer uuid, rate numeric default null) returns jsonb language sql volatile as $$
  select public.stop_time_timer(timer,rate)->'entries';
$$;
create function pg_temp.timer_pending(timer uuid, rate numeric default null, code text default '22023') returns void language plpgsql as $$
declare result jsonb;
begin
  result := public.stop_time_timer(timer,rate);
  perform pg_temp.timer_assert(result->>'status'='pending_finalization' and result->>'error_code'=code
    and result->'entries'='[]'::jsonb, 'Failure explicitly returns pending status, code, and no entries');
end;
$$;
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare customer uuid; hourly uuid; timer public.running_timers; entries jsonb; agreement uuid;
  first_agreement uuid; second_agreement uuid; count_before bigint; bad text;
begin
  customer := pg_temp.timer_customer(); hourly := pg_temp.timer_customer(false);
  perform set_config('nexa.test_timer_clock','2026-09-08 12:00:00Z',true);
  insert into public.running_timers(customer_id,description,is_billable,started_at,created_at,updated_at,stop_requested_at)
  values(customer,'Timed support',true,'2001-01-01Z','2100-01-01Z','2100-01-01Z','2100-01-01Z') returning * into timer;
  perform pg_temp.timer_assert(timer.started_at='2026-09-08 12:00Z' and timer.created_at=now()
    and timer.updated_at=now() and timer.hourly_rate is null and timer.stop_requested_at is null, 'Start owns clock and audits; retainer does not require fallback rate');
  perform pg_temp.timer_reject(format('insert into public.running_timers(customer_id,description,is_billable) values(%L,''Duplicate'',true)',customer),'23505');
  perform pg_temp.timer_reject(format('update public.running_timers set started_at=''2000-01-01'' where id=%L',timer.id),'55000');
  perform pg_temp.timer_reject(format('update public.running_timers set customer_id=%L where id=%L',hourly,timer.id),'55000');
  perform pg_temp.timer_reject(format('update public.running_timers set id=gen_random_uuid() where id=%L',timer.id),'55000');
  perform pg_temp.timer_reject(format('update public.running_timers set created_at=''2000-01-01'' where id=%L',timer.id),'55000');
  perform pg_temp.timer_reject(format('select * from public.stop_time_timer(%L)',timer.id),'22023');
  perform pg_temp.timer_assert(exists(select from public.running_timers where id=timer.id),'Zero elapsed stop preserves timer');
  perform set_config('nexa.test_timer_clock','2026-09-08 12:18:20Z',true);
  entries := pg_temp.timer_stop(timer.id);
  perform pg_temp.timer_assert(jsonb_array_length(entries)=1 and (entries->0->>'actual_minutes')::integer=19
    and (entries->0->>'rounded_minutes')::integer=30 and entries->0->>'description'='Timed support'
    and (entries->0->>'started_at')::timestamptz=timer.started_at
    and (entries->0->>'ended_at')::timestamptz='2026-09-08 12:18:20Z'
    and (entries->0->>'hourly_rate')::numeric=120 and (entries->0->>'included_hours_snapshot')::numeric=1,
    '18m20s produces 19 actual / 30 billable and authoritative normal snapshots');
  perform pg_temp.timer_assert(not exists(select from public.running_timers),'Successful stop removes running state');
  agreement := (entries->0->>'billing_agreement_id')::uuid;
  perform pg_temp.timer_assert((select rounded_minutes_used=30 from public.get_retainer_period_usage(agreement,'2026-09-08')),'Timer work naturally enters the existing usage engine');
  select count(*) into count_before from public.time_entries;
  perform pg_temp.timer_reject(format('select * from public.stop_time_timer(%L)',timer.id),'P0002');
  perform pg_temp.timer_assert((select count(*)=count_before from public.time_entries),'Double stop produces no duplicate');

  perform set_config('nexa.test_timer_clock','2026-09-08 13:00Z',true);
  insert into public.running_timers(customer_id,description,is_billable) values(customer,'Short work',true) returning * into timer;
  perform set_config('nexa.test_timer_clock','2026-09-08 13:00:30Z',true);
  entries := pg_temp.timer_stop(timer.id);
  perform pg_temp.timer_assert((entries->0->>'actual_minutes')::integer=1 and (entries->0->>'rounded_minutes')::integer=15,'30 seconds produces 1 actual / 15 billable');
  insert into public.running_timers(customer_id,description,is_billable) values(hourly,'Courtesy',false) returning * into timer;
  perform set_config('nexa.test_timer_clock','2026-09-08 13:18:30Z',true);
  entries := pg_temp.timer_stop(timer.id);
  perform pg_temp.timer_assert((entries->0->>'actual_minutes')::integer=18 and (entries->0->>'rounded_minutes')::integer=0
    and entries->0->'hourly_rate'='null'::jsonb,'Exact 18 minutes stays 18; non-billable work has zero rounded usage and no required rate');
  raise notice 'PASS: authoritative start, immutable identity, singleton, 18m20s/30s/exact18m, non-billable, normal usage integration and double stop';

  customer := pg_temp.timer_customer();
  perform set_config('nexa.test_timer_clock','2026-09-09 03:50Z',true); -- Sep 8 23:50 New York
  insert into public.running_timers(customer_id,description,is_billable) values(customer,'Midnight support',true) returning * into timer;
  perform set_config('nexa.test_timer_clock','2026-09-09 04:20Z',true);
  entries := pg_temp.timer_stop(timer.id);
  perform pg_temp.timer_assert(jsonb_array_length(entries)=2
    and entries->0->>'work_date'='2026-09-08' and entries->1->>'work_date'='2026-09-09'
    and (entries->0->>'actual_minutes')::integer=10 and (entries->1->>'actual_minutes')::integer=20
    and (entries->0->>'rounded_minutes')::integer=15 and (entries->1->>'rounded_minutes')::integer=30
    and entries->0->>'ended_at'=entries->1->>'started_at', 'Midnight splits exact timestamps into 10/20 actual, independently 15/30 rounded');
  perform set_config('nexa.test_timer_clock','2026-09-09 03:59:30Z',true);
  insert into public.running_timers(customer_id,description,is_billable) values(customer,'Midnight seconds',true) returning * into timer;
  perform set_config('nexa.test_timer_clock','2026-09-09 04:00:30Z',true);
  entries := pg_temp.timer_stop(timer.id);
  perform pg_temp.timer_assert(jsonb_array_length(entries)=2 and (entries->0->>'actual_minutes')::integer=1
    and (entries->1->>'actual_minutes')::integer=1, 'Each partial-minute date segment rounds actual duration up independently');
  perform set_config('nexa.test_timer_clock','2026-09-09 03:50Z',true);
  insert into public.running_timers(customer_id,description,is_billable) values(customer,'Exact midnight',true) returning * into timer;
  perform set_config('nexa.test_timer_clock','2026-09-09 04:00Z',true);
  entries := pg_temp.timer_stop(timer.id);
  perform pg_temp.timer_assert(jsonb_array_length(entries)=1 and (entries->0->>'actual_minutes')::integer=10,'Exact midnight stop creates no zero-length successor');

  customer := pg_temp.timer_customer(false);
  insert into public.customer_billing_agreements(customer_id,effective_date,end_date,monthly_fee,included_hours,overage_hourly_rate)
  values(customer,'2026-09-01','2026-09-15',500,1,125) returning id into first_agreement;
  insert into public.customer_billing_agreements(customer_id,effective_date,monthly_fee,included_hours,overage_hourly_rate,rounding_increment_minutes)
  values(customer,'2026-09-15',600,2,150,30) returning id into second_agreement;
  perform set_config('nexa.test_timer_clock','2026-09-15 03:50Z',true);
  insert into public.running_timers(customer_id,description,is_billable) values(customer,'Terms boundary',true) returning * into timer;
  perform set_config('nexa.test_timer_clock','2026-09-15 04:20Z',true);
  entries := pg_temp.timer_stop(timer.id);
  perform pg_temp.timer_assert((entries->0->>'billing_agreement_id')::uuid=first_agreement
    and (entries->1->>'billing_agreement_id')::uuid=second_agreement
    and (entries->0->>'hourly_rate')::numeric=125 and (entries->1->>'hourly_rate')::numeric=150
    and (entries->0->>'rounded_minutes')::integer=15 and (entries->1->>'rounding_increment_minutes')::integer=30
    and (entries->1->>'included_hours_snapshot')::numeric=2,'Each segment resolves its own governing agreement and captured terms');
  raise notice 'PASS: midnight, fractional-second segments, exclusive midnight and per-date agreement versions';

  -- Last segment lacks retainer and fallback. Verify the earlier successful
  -- insert also rolls back, then retry with a supplied non-retainer rate.
  customer := pg_temp.timer_customer(false);
  insert into public.customer_billing_agreements(customer_id,effective_date,end_date,monthly_fee,included_hours,overage_hourly_rate)
  values(customer,'2026-09-01','2026-09-09',500,1,125);
  perform set_config('nexa.test_timer_clock','2026-09-09 03:50Z',true);
  insert into public.running_timers(customer_id,description,is_billable) values(customer,'Retainer ends overnight',true) returning * into timer;
  perform set_config('nexa.test_timer_clock','2026-09-09 04:20Z',true);
  perform pg_temp.timer_pending(timer.id);
  perform pg_temp.timer_assert(exists(select from public.running_timers where id=timer.id)
    and not exists(select from public.time_entries where customer_id=customer),'Failed later segment rolls back ALL inserts and preserves timer');
  foreach bad in array array['-1','0.001','NaN','Infinity','10000000000'] loop
    perform pg_temp.timer_pending(timer.id,bad::numeric);
  end loop;
  perform pg_temp.timer_assert((select stop_requested_at='2026-09-09 04:20Z'::timestamptz from public.running_timers where id=timer.id), 'First failed Stop persists its authoritative timestamp');
  perform pg_temp.timer_reject(format('select public.cancel_time_timer(%L)',timer.id),'55000');
  perform pg_temp.timer_reject(format('delete from public.running_timers where id=%L',timer.id),'42501');
  perform pg_temp.timer_reject(format('update public.running_timers set stop_requested_at=null where id=%L',timer.id),'55000');
  perform pg_temp.timer_reject(format('update public.running_timers set stop_requested_at=now() where id=%L',timer.id),'55000');
  perform pg_temp.timer_reject(format('insert into public.running_timers(customer_id,description,is_billable) values(%L,''Pending blocks start'',false)',customer),'23505');
  perform set_config('nexa.test_timer_clock','2026-09-10 12:00Z',true);
  entries := pg_temp.timer_stop(timer.id,111.25);
  perform pg_temp.timer_assert(jsonb_array_length(entries)=2
    and (entries->0->>'actual_minutes')::integer=10 and (entries->1->>'actual_minutes')::integer=20
    and (entries->1->>'ended_at')::timestamptz='2026-09-09 04:20Z', 'Retry a day later preserves original midnight split and duration');
  perform pg_temp.timer_reject(format('select public.stop_time_timer(%L,111.25)',timer.id),'P0002');
  perform pg_temp.timer_assert((entries->0->>'hourly_rate')::numeric=125 and (entries->1->>'hourly_rate')::numeric=111.25
    and entries->1->'billing_agreement_id'='null'::jsonb,'Fallback affects only non-retainer segments; retainer terms remain resolver-owned');

  customer := pg_temp.timer_customer();
  perform set_config('nexa.test_timer_clock','2026-09-09 12:00Z',true);
  insert into public.running_timers(customer_id,description,is_billable) values(customer,'Disabled during timer',true) returning * into timer;
  update public.customer_billing_agreements set is_active=false where customer_id=customer;
  perform set_config('nexa.test_timer_clock','2026-09-09 12:01Z',true);
  perform pg_temp.timer_pending(timer.id);
  entries := pg_temp.timer_stop(timer.id,110);
  perform pg_temp.timer_assert(entries->0->'billing_agreement_id'='null'::jsonb,'Administrative disable is re-resolved at stop, not frozen at start');
  raise notice 'PASS: atomic rollback, missing/invalid fallback rates, safe retry, and changed enabled status';

  customer := pg_temp.timer_customer();
  -- New York fall-back date has 25 hours; spring-forward has 23.
  perform set_config('nexa.test_timer_clock','2026-11-01 04:00Z',true);
  insert into public.running_timers(customer_id,description,is_billable) values(customer,'Fall DST',false) returning * into timer;
  perform set_config('nexa.test_timer_clock','2026-11-02 05:00Z',true);
  entries := pg_temp.timer_stop(timer.id);
  perform pg_temp.timer_assert(jsonb_array_length(entries)=1 and (entries->0->>'actual_minutes')::integer=1500,'25-hour New York date is one correct segment');
  perform set_config('nexa.test_timer_clock','2026-03-08 05:00Z',true);
  insert into public.running_timers(customer_id,description,is_billable) values(customer,'Spring DST',false) returning * into timer;
  perform set_config('nexa.test_timer_clock','2026-03-09 04:00Z',true);
  entries := pg_temp.timer_stop(timer.id);
  perform pg_temp.timer_assert(jsonb_array_length(entries)=1 and (entries->0->>'actual_minutes')::integer=1380,'23-hour New York date is one correct segment');

  perform pg_temp.timer_reject(format('insert into public.running_timers(customer_id,description,is_billable) values(%L,''Hourly without rate'',true)',hourly),'22023');
  perform pg_temp.timer_reject(format('insert into public.running_timers(customer_id,description,is_billable,hourly_rate) values(%L,'' '',true,100)',hourly),'23514');
  perform pg_temp.timer_reject(format('insert into public.running_timers(customer_id,description,is_billable,hourly_rate) values(%L,''Rate'',true,-1)',hourly),'23514');
  perform pg_temp.timer_reject(format('insert into public.running_timers(customer_id,description,hourly_rate) values(%L,''No billable selection'',100)',hourly),'23502');
  perform pg_temp.timer_reject('insert into public.running_timers(customer_id,description,is_billable,hourly_rate) values(gen_random_uuid(),''Missing customer'',true,100)','23503');
  insert into public.running_timers(customer_id,description,is_billable,hourly_rate) values(hourly,'To cancel',true,100) returning * into timer;
  update public.running_timers set description='Corrected temporary description',hourly_rate=115.25,updated_at='2000-01-01Z' where id=timer.id;
  perform pg_temp.timer_assert((select updated_at=now() and hourly_rate=115.25 from public.running_timers where id=timer.id),'Temporary metadata updates use updated_at trigger');
  perform set_config('nexa.test_running_timer',timer.id::text,true);
  perform set_config('nexa.test_timer_customer',hourly::text,true);
  select count(*) into count_before from public.time_entries;
  perform public.cancel_time_timer(timer.id);
  perform pg_temp.timer_assert(not exists(select from public.running_timers) and (select count(*)=count_before from public.time_entries),'Cancel deletes temporary state only');
  perform pg_temp.timer_reject(format('select * from public.stop_time_timer(%L)',timer.id),'P0002');
  insert into public.running_timers(customer_id,description,is_billable,hourly_rate) values(hourly,'Security fixture',true,100) returning * into timer;
  perform set_config('nexa.test_running_timer',timer.id::text,true);
  perform set_config('nexa.test_timer_clock','2026-03-09 04:01Z',true);
  perform pg_temp.timer_assert(has_table_privilege('authenticated','public.running_timers','SELECT')
    and has_table_privilege('authenticated','public.running_timers','INSERT')
    and has_table_privilege('authenticated','public.running_timers','UPDATE')
    and not has_table_privilege('authenticated','public.running_timers','DELETE')
    and not has_table_privilege('authenticated','public.running_timers','TRUNCATE')
    and not has_table_privilege('authenticated','public.time_entries','DELETE'), 'Timer SELECT/INSERT/UPDATE only; no direct timer or completed-entry DELETE');
  perform pg_temp.timer_assert(has_function_privilege('authenticated','public.stop_time_timer(uuid,numeric)','EXECUTE')
    and not has_function_privilege('anon','public.stop_time_timer(uuid,numeric)','EXECUTE')
    and not has_function_privilege('authenticated','public.guard_running_timer()','EXECUTE'), 'Stop execution granted; trigger helper not an RPC');
  perform pg_temp.timer_assert(not pg_has_role('authenticated','nexa_timer_executor','MEMBER')
    and (select not rolcanlogin and not rolsuper and not rolbypassrls from pg_roles where rolname='nexa_timer_executor'), 'Authenticated cannot assume the non-login, non-bypass RPC owner role');
  raise notice 'PASS: DST, start validation, temporary updates, cancel, FK input validation and explicit privileges';
end;
$$;
reset role;
select pg_temp.timer_reject(format('delete from public.customers where id=%L',current_setting('nexa.test_timer_customer')),'23503');
-- Future restrictive DELETE policies must not leave completed work PLUS a timer.
create policy timer_test_no_delete on public.running_timers as restrictive for delete to authenticated using(false);
set local role authenticated;
select pg_temp.timer_pending(current_setting('nexa.test_running_timer')::uuid,null,'42501');
select pg_temp.timer_assert(exists(select from public.running_timers)
  and not exists(select from public.time_entries where customer_id=current_setting('nexa.test_timer_customer')::uuid and description='Security fixture'), 'DELETE RLS failure rolls back finalization');
reset role;
drop policy timer_test_no_delete on public.running_timers;
create policy timer_test_no_entry on public.time_entries as restrictive for insert to authenticated with check(false);
set local role authenticated;
select pg_temp.timer_pending(current_setting('nexa.test_running_timer')::uuid,null,'42501');
select pg_temp.timer_assert(not exists(select from public.time_entries where description='Security fixture'), 'Definer role respects authenticated time-entry INSERT RLS');
reset role;
drop policy timer_test_no_entry on public.time_entries;
create policy timer_test_hidden on public.running_timers as restrictive for select to authenticated using(false);
set local role authenticated;
select pg_temp.timer_assert(not exists(select from public.running_timers),'Running-state SELECT respects caller RLS');
select pg_temp.timer_reject(format('select * from public.stop_time_timer(%L)',current_setting('nexa.test_running_timer')),'P0002');
reset role;
set local role anon;
select pg_temp.timer_reject('select * from public.running_timers','42501');
select pg_temp.timer_reject('insert into public.running_timers(customer_id,description,is_billable) values(gen_random_uuid(),''Anon'',false)','42501');
select pg_temp.timer_reject('update public.running_timers set description=''Anon''','42501');
select pg_temp.timer_reject('delete from public.running_timers','42501');
select pg_temp.timer_reject('select * from public.stop_time_timer(gen_random_uuid())','42501');
select pg_temp.timer_reject('select public.cancel_time_timer(gen_random_uuid())','42501');
reset role;
do $$ begin raise notice 'PASS: restrictive customer FK, caller SELECT/DELETE RLS, rollback and actual anonymous denial'; end; $$;
rollback;
