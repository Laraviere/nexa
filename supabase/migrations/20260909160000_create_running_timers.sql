-- A non-login RPC owner inherits authenticated RLS policies without bypassing RLS.
-- Only this role can delete timer rows; authenticated cannot SET ROLE into it.
do $role$
begin
  perform pg_advisory_xact_lock(hashtextextended('nexa_timer_executor migration', 0));
  if not exists(select from pg_roles where rolname='nexa_timer_executor') then
    create role nexa_timer_executor nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if exists(select from pg_roles where rolname='nexa_timer_executor' and
    (rolcanlogin or rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication)) then
    raise exception 'Unsafe existing nexa_timer_executor role';
  end if;
end;
$role$;
grant authenticated to nexa_timer_executor;
grant nexa_timer_executor to postgres;

-- Temporary running state only. Finalized work always lives in time_entries.
create table public.running_timers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on update restrict on delete restrict,
  description text not null check (description ~ '[^[:space:]]'),
  is_billable boolean not null,
  hourly_rate numeric(12,2) check (hourly_rate is null or (hourly_rate >= 0 and hourly_rate <> 'NaN'::numeric)),
  started_at timestamptz not null,
  stop_requested_at timestamptz,
  constraint running_timers_stop_valid check (stop_requested_at is null or (isfinite(stop_requested_at) and stop_requested_at > started_at)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint running_timers_finite_timestamps check (
    isfinite(started_at) and isfinite(created_at) and isfinite(updated_at) and updated_at >= created_at
  )
);

-- Global singleton for Nexa's single-user workspace, including concurrent INSERTs.
create unique index running_timers_singleton_idx on public.running_timers ((true));

create function public.guard_running_timer()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op = 'INSERT' then
    if exists(select from public.running_timers) then
      raise exception using errcode = '23505', message = 'A timer is already running. Stop or cancel it first.';
    end if;
    -- Ignore caller-supplied clock/audit fields, including on direct table INSERT.
    new.started_at := clock_timestamp();
    new.stop_requested_at := null;
    new.created_at := now();
    new.updated_at := now();
    if new.is_billable and new.hourly_rate is null and not exists (
      select from public.customer_billing_agreements a
      where a.customer_id = new.customer_id and a.is_active
        and daterange(a.effective_date, a.end_date, '[)') @> (new.started_at at time zone 'America/New_York')::date
    ) then
      raise exception using errcode = '22023', message = 'An hourly rate is required to start billable work without an applicable retainer.';
    end if;
  elsif row(new.id, new.customer_id, new.started_at, new.created_at)
    is distinct from row(old.id, old.customer_id, old.started_at, old.created_at) then
    raise exception using errcode = '55000', message = 'Timer identity, customer and start time cannot be changed. Cancel it and start a new timer.';
  end if;
  if tg_op = 'UPDATE' and new.stop_requested_at is distinct from old.stop_requested_at then
    if current_user <> 'nexa_timer_executor' or old.stop_requested_at is not null then
      raise exception using errcode='55000', message='Only Stop may establish the immutable stop time.';
    end if;
  end if;
  -- Description/billability/fallback rate remain editable temporary state.
  -- Changes never modify existing completed entries or captured financial history.
  return new;
end;
$function$;

create trigger running_timers_guard before insert or update on public.running_timers
  for each row execute function public.guard_running_timer();
create trigger running_timers_set_updated_at before update on public.running_timers
  for each row execute function public.set_updated_at();

alter table public.running_timers enable row level security;
create policy "Authenticated users can view running timers" on public.running_timers
  for select to authenticated using (true);
create policy "Authenticated users can start timers" on public.running_timers
  for insert to authenticated with check (true);
create policy "Authenticated users can update running timers" on public.running_timers
  for update to authenticated using (true) with check (true);
create policy "Authenticated users can cancel or finalize running timers" on public.running_timers
  for delete to authenticated using (true);
revoke all on public.running_timers from public, anon, authenticated;
grant select, insert, update on public.running_timers to authenticated;
grant delete on public.running_timers to nexa_timer_executor;
revoke all on function public.guard_running_timer() from public, anon, authenticated, service_role;

create function public.stop_time_timer(p_timer_id uuid, p_hourly_rate numeric default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $function$
declare
  timer public.running_timers%rowtype;
  completed public.time_entries%rowtype;
  stopped_at timestamptz;
  segment_start timestamptz;
  segment_end timestamptz;
  segment_date date;
  fallback_rate numeric;
  failed_constraint text;
  removed integer;
  result_entries jsonb := '[]'::jsonb;
  failure_code text;
  failure_message text;
begin
  if p_timer_id is null then
    raise exception using errcode = '22023', message = 'A timer ID is required.';
  end if;
  select t.* into timer from public.running_timers t where t.id = p_timer_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'This timer is no longer running or is unavailable.';
  end if;
  -- Capture exactly once, AFTER acquiring the lock. No timestamp argument/GUC.
  if timer.stop_requested_at is null then
    stopped_at := clock_timestamp();
    if stopped_at <= timer.started_at then
      raise exception using errcode='22023', message='The timer has no positive elapsed duration yet. Retry Stop.';
    end if;
    update public.running_timers set stop_requested_at=stopped_at where id=timer.id
      returning * into timer;
    if not found then
      raise exception using errcode='42501', message='Unable to preserve the stop request.';
    end if;
  end if;
  stopped_at := timer.stop_requested_at;
  -- This outer write survives failures in the following subtransaction. Callers
  -- must COMMIT the returned pending result, not raise/roll back their transaction.
  begin
    if stopped_at <= timer.started_at then
      raise exception using errcode = '22023', message = 'The timer has no positive elapsed duration yet. Try stopping it again.';
    end if;
    if p_hourly_rate is not null and (p_hourly_rate < 0 or p_hourly_rate > 9999999999.99
      or p_hourly_rate <> trunc(p_hourly_rate, 2)) then
      raise exception using errcode = '22023', message = 'Enter a non-negative hourly rate with at most two decimal places.';
    end if;
    fallback_rate := coalesce(p_hourly_rate, timer.hourly_rate);
    segment_start := timer.started_at;
    while segment_start < stopped_at loop
      segment_date := (segment_start at time zone 'America/New_York')::date;
      segment_end := least(stopped_at, ((segment_date + 1)::timestamp at time zone 'America/New_York'));
      begin
        -- No agreement ID or retainer snapshots are supplied. The existing resolver
        -- captures enabled, date-applicable terms at finalization for EACH segment.
        insert into public.time_entries(customer_id, work_date, description, actual_minutes,
          is_billable, hourly_rate, started_at, ended_at)
        values (timer.customer_id, segment_date, timer.description,
          ceil(extract(epoch from (segment_end - segment_start)) / 60)::integer,
          timer.is_billable, fallback_rate, segment_start, segment_end)
        returning * into completed;
      exception when check_violation then
        get stacked diagnostics failed_constraint = constraint_name;
        if failed_constraint = 'time_entries_billable_rate_required' then
          raise exception using errcode = '22023', message = 'A non-retainer segment needs an hourly rate. Provide a rate and retry stopping the timer.';
        end if;
        raise;
      end;
      result_entries := result_entries || jsonb_build_array(to_jsonb(completed));
      segment_start := segment_end;
    end loop;
    -- DELETE takes the same row lock as Cancel. A failure here also rolls back ALL
    -- inserted segments. Check RLS/trigger suppression rather than leaving a timer
    -- available to finalize twice if DELETE stops being permitted in the future.
    delete from public.running_timers t where t.id = timer.id;
    get diagnostics removed = row_count;
    if removed <> 1 then
      raise exception using errcode = '42501', message = 'Unable to close the running timer.';
    end if;
  exception when others then
    get stacked diagnostics failure_code=returned_sqlstate;
    failure_message := case when failure_code='22023' then 'Provide a valid non-retainer hourly rate and retry finalization.'
      else 'Finalization failed. The original stop time is preserved. Retry finalization; contact support if it continues.' end;
    return jsonb_build_object('status','pending_finalization','timer_id',timer.id,
      'stop_requested_at',stopped_at,'entries','[]'::jsonb,'error_code',failure_code,'message',failure_message);
  end;
  return jsonb_build_object('status','completed','timer_id',timer.id,
    'stop_requested_at',stopped_at,'entries',result_entries,'error_code',null,'message',null);
end;
$function$;

create function public.cancel_time_timer(p_timer_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
declare timer public.running_timers%rowtype; removed integer;
begin
  select * into timer from public.running_timers where id=p_timer_id for update;
  if not found then return false; end if;
  if timer.stop_requested_at is not null then
    raise exception using errcode='55000', message='This timer is stopped and awaiting finalization. Retry finalization instead of canceling.';
  end if;
  delete from public.running_timers where id=p_timer_id;
  get diagnostics removed=row_count;
  if removed<>1 then raise exception using errcode='42501', message='Unable to cancel timer.'; end if;
  return true;
end;
$function$;
-- Ownership is separate from table ownership: these definers cannot bypass RLS.
-- CREATE is needed only for transferring function ownership, then removed.
grant usage, create on schema public to nexa_timer_executor;
alter function public.stop_time_timer(uuid,numeric) owner to nexa_timer_executor;
alter function public.cancel_time_timer(uuid) owner to nexa_timer_executor;
revoke create on schema public from nexa_timer_executor;
revoke all on function public.cancel_time_timer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_time_timer(uuid) to authenticated;

revoke all on function public.stop_time_timer(uuid, numeric) from public, anon, authenticated, service_role;
grant execute on function public.stop_time_timer(uuid, numeric) to authenticated;

comment on table public.running_timers is
  'One unresolved timer. NULL stop_requested_at means running; non-NULL means stopped pending finalization. Start via guarded INSERT, Stop and Cancel via authenticated RPCs. Pending work cannot be canceled.';
comment on column public.running_timers.stop_requested_at is
  'First authoritative Stop timestamp, immutable across retries. Finalization uses this time, never the retry time. Pending results must be committed to retain it.';
comment on column public.running_timers.hourly_rate is
  'Correctable fallback for non-retainer segments only. Existing time-entry resolver owns retainer snapshots at finalization.';
comment on function public.stop_time_timer(uuid,numeric) is
  'Returns JSON status completed or pending_finalization, preserved stop_requested_at, entries, error_code and message. Finalization errors roll back only inserts/deletion; the first stop time survives when the request commits. Retry never extends elapsed time. Missing/hidden/finalized IDs raise P0002. Executes as a non-login, non-owner, non-BYPASSRLS role inheriting authenticated policies.';
