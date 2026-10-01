-- Current and immediately preceding overage use exact unclaimed minute ranges.
-- No historical migration, financial row, fee claim, RLS or privilege is rewritten.
drop index public.invoice_items_retainer_overage_once_idx;
-- invoice_time_allocations_no_double_billing remains the authoritative active
-- range exclusion constraint. Multiple disjoint claims per period are allowed.

create or replace function public.invoice_candidate_plan(p_customer_id uuid,p_as_of_date date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  horizon date:=p_as_of_date;
  a public.customer_billing_agreements%rowtype; u record; ref date;
  current_agreement uuid; current_ref date; previous_agreement uuid; previous_ref date; choice record;
  fees jsonb:='[]'; overages jsonb:='[]'; hourly jsonb:='[]'; planned jsonb;
  group_row record; rate numeric;
begin
  if p_customer_id is null or horizon is null or not isfinite(horizon)
    or horizon>(now() at time zone 'America/New_York')::date then
    raise exception using errcode='22023',message='Customer and a finite reference date no later than today in New York are required.';
  end if;
  perform 1 from public.customers where id=p_customer_id;
  if not found then raise exception using errcode='P0002',message='Customer unavailable.'; end if;
    -- Select at most the current period and its immediately completed predecessor.
    -- Never walk backwards looking for an unclaimed period.
    select * into a from public.customer_billing_agreements x where x.customer_id=p_customer_id
      and x.effective_date<=horizon and (x.end_date is null or x.end_date>x.effective_date)
      order by x.effective_date desc,x.id limit 1;
    if found then
      if a.end_date is null or horizon<a.end_date then
        current_agreement:=a.id; current_ref:=horizon;
        select * into strict u from public.get_retainer_period_usage(a.id,horizon);
        previous_ref:=u.period_start-1;
        -- Exact adjacency is required across versions; do not jump a service gap.
        select x.id into previous_agreement from public.customer_billing_agreements x
          where x.customer_id=p_customer_id and x.effective_date<=previous_ref
            and (x.end_date is null or previous_ref<x.end_date);
      else
        -- After cancellation, only the latest version's final completed period
        -- remains relevant. No fee catch-up and no traversal into older versions.
        previous_agreement:=a.id; previous_ref:=a.end_date-1;
      end if;
    end if;
    for choice in select * from (values
      (current_agreement,current_ref,true), (previous_agreement,previous_ref,false)
    ) as candidates(agreement_id,reference_date,is_current) where agreement_id is not null loop
        select * into strict a from public.customer_billing_agreements where id=choice.agreement_id;
        ref:=choice.reference_date;
        select * into strict u from public.get_retainer_period_usage(a.id,ref);
        if u.period_end<=ref then raise exception using errcode='22023',message='Invalid retainer period.'; end if;
        if a.is_active and ((choice.is_current and a.bill_in_advance)
          or (not choice.is_current and not a.bill_in_advance and u.period_end<=horizon)) and not exists (
          select from public.invoice_items i where i.billing_agreement_id=a.id and i.source_type='retainer_fee'
            and i.released_at is null and daterange(i.period_start,i.period_end,'[)') && daterange(u.period_start,u.period_end,'[)')
        ) then
          fees:=fees||jsonb_build_array(jsonb_build_object('source_type','retainer_fee','unit','month',
            'description','Monthly IT Support Retainer — '||to_char(u.period_start,'FMMonth FMDD, YYYY')||' – '||to_char(u.period_end-1,'FMMonth FMDD, YYYY'),
            'unit_rate',a.monthly_fee,'billing_agreement_id',a.id,'period_start',u.period_start,'period_end',u.period_end));
        end if;
        -- Chronological allowance is computed independently of invoicing. Only
        -- work through the horizon contributes; later work cannot change the
        -- included prefix of an earlier entry. Subtract exact active ranges.
        for group_row in
          with ranges as (
            select e, ord, r from jsonb_array_elements(u.allocations) with ordinality j(e,ord)
            cross join lateral unnest(
              int8multirange(int8range((e->>'included_minutes')::numeric::bigint,(e->>'rounded_minutes')::numeric::bigint,'[)'))
              - coalesce((select range_agg(int8range(x.minute_start,x.minute_end,'[)'))
                  from public.invoice_time_allocations x
                  where x.time_entry_id=(e->>'time_entry_id')::uuid and x.released_at is null),'{}'::int8multirange)
            ) r
            where (e->>'work_date')::date<=horizon and (e->>'overage_minutes')::numeric>0
          ) select (e->>'hourly_rate')::numeric as rate,sum(upper(r)-lower(r))::bigint as minutes,
              jsonb_agg(jsonb_build_object('time_entry_id',e->>'time_entry_id','minute_start',lower(r),'minute_end',upper(r))
                order by ord,lower(r)) as allocations
            from ranges group by (e->>'hourly_rate')::numeric
        loop
          overages:=overages||jsonb_build_array(jsonb_build_object('source_type','retainer_overage','unit','hour',
            'description','IT Support Overage — '||to_char(u.period_start,'FMMonth FMDD, YYYY')||' – '||to_char(u.period_end-1,'FMMonth FMDD, YYYY'),
            'unit_rate',group_row.rate,'billed_minutes',group_row.minutes,
            'expected_amount',round(group_row.minutes::numeric*group_row.rate/60,2),
            'billing_agreement_id',a.id,'period_start',u.period_start,'period_end',u.period_end,
            'allocations',group_row.allocations));
        end loop;
    end loop;

    -- Exact remaining offsets, not a subtraction that loses the positions of
    -- existing middle-of-entry claims. Group only equal captured hourly rates.
    for group_row in
      with eligible as (
        select t.*, b.available_ranges from public.time_entries t
        cross join lateral public.get_time_entry_invoiceability(t.id,horizon) b
        where t.customer_id=p_customer_id and t.billing_agreement_id is null and b.chargeable_minutes>0
      ), ranges as (
        select e.*,r from eligible e cross join lateral unnest(e.available_ranges) r
      ) select hourly_rate,sum(upper(r)-lower(r)) as minutes,
        jsonb_agg(jsonb_build_object('time_entry_id',id,'minute_start',lower(r),'minute_end',upper(r))
          order by work_date,created_at,id,lower(r)) as allocations
        from ranges group by hourly_rate order by hourly_rate
    loop
      hourly:=hourly||jsonb_build_array(jsonb_build_object('source_type','hourly_time','unit','hour',
        'description','IT Support','unit_rate',group_row.hourly_rate,'billed_minutes',group_row.minutes,'allocations',group_row.allocations));
    end loop;
    planned:=fees||overages||hourly;
  return planned;
end $$;

create or replace function public.invoice_preview_state(p_customer_id uuid,p_as_of_date date)
returns jsonb language plpgsql stable security invoker set search_path=''
set timezone='UTC' set datestyle='ISO, YMD' as $$
declare planned jsonb; candidates jsonb:='[]'; item jsonb; fingerprint jsonb; token text;
begin
  planned:=public.invoice_candidate_plan(p_customer_id,p_as_of_date);
  for item in select value from jsonb_array_elements(planned) loop
    token:=encode(sha256(convert_to(jsonb_build_object('version',1,'customer',p_customer_id,'as_of',p_as_of_date,
      'type',item->'source_type','agreement',item->'billing_agreement_id',
      'start',item->'period_start','end',item->'period_end','ranges',item->'allocations','rate',item->'unit_rate')::text,'UTF8')),'hex');
    item:=item||jsonb_build_object('candidate_id',token,
      'quantity',case when item ? 'billed_minutes' then round((item->>'billed_minutes')::numeric/60,8) else 1 end,
      'amount',case when item ? 'billed_minutes' then round((item->>'billed_minutes')::numeric*(item->>'unit_rate')::numeric/60,2) else (item->>'unit_rate')::numeric end);
    if item ? 'expected_amount' and (item->>'amount')::numeric is distinct from (item->>'expected_amount')::numeric then
      raise exception using errcode='22023',message='Overage amount does not match authoritative usage.';
    end if;
    candidates:=candidates||jsonb_build_array(item);
  end loop;
  -- Conservative customer-scoped revision: changes to customer terms, agreement
  -- versions or recorded work invalidate review, even when the total is equal.
  -- No historical period traversal; existing customer indexes scope these reads.
  select jsonb_build_object('version',1,'as_of',p_as_of_date,'plan',candidates,
    'customer',(select to_jsonb(c) from public.customers c where c.id=p_customer_id),
    'agreements',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.customer_billing_agreements a where a.customer_id=p_customer_id),
    'time',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.time_entries t where t.customer_id=p_customer_id and t.work_date<=p_as_of_date)
  ) into fingerprint;
  return jsonb_build_object('as_of_date',p_as_of_date,'revision',encode(sha256(convert_to(fingerprint::text,'UTF8')),'hex'),'candidates',candidates);
end $$;

create or replace function public.get_time_entry_invoiceability(p_time_entry_id uuid,p_as_of_date date)
returns table (
  invoiced_minutes bigint, uninvoiced_minutes bigint, covered_minutes bigint,
  chargeable_minutes bigint, deferred_minutes bigint, blocked_minutes bigint,
  billing_status text, available_ranges int8multirange
)
language plpgsql stable security invoker set search_path = '' as $$
declare t public.time_entries%rowtype; claimed int8multirange; remaining int8multirange;
  included bigint; u record; candidate int8multirange; covered int8multirange;
begin
  if p_as_of_date is null or not isfinite(p_as_of_date) then raise exception using errcode='22023',message='A finite business date is required.'; end if;
  select * into t from public.time_entries where id=p_time_entry_id;
  if not found or not t.is_billable or t.voided_at is not null then return; end if;
  select coalesce(range_agg(int8range(a.minute_start,a.minute_end,'[)')),'{}'::int8multirange) into claimed
    from public.invoice_time_allocations a where a.time_entry_id=t.id and a.released_at is null;
  remaining := int8multirange(int8range(0,t.rounded_minutes,'[)')) - claimed;
  select coalesce(sum(upper(r)-lower(r)),0)::bigint into uninvoiced_minutes from unnest(remaining) r;
  invoiced_minutes := t.rounded_minutes-uninvoiced_minutes;
  covered_minutes:=0; chargeable_minutes:=0; deferred_minutes:=0; blocked_minutes:=0; available_ranges:='{}'::int8multirange;
  if t.work_date>p_as_of_date then
    deferred_minutes:=uninvoiced_minutes; billing_status:='future_work'; return next; return;
  end if;
  if t.billing_agreement_id is null then
    chargeable_minutes:=uninvoiced_minutes; available_ranges:=remaining; billing_status:='hourly'; return next; return;
  end if;
  begin
    select * into strict u from public.get_retainer_period_usage(t.billing_agreement_id,t.work_date);
    select (e->>'included_minutes')::numeric::bigint into included from jsonb_array_elements(u.allocations) e where (e->>'time_entry_id')::uuid=t.id;
    if included is null then raise exception using errcode='22023',message='Usage allocation unavailable.'; end if;
  exception when sqlstate '22023' or sqlstate '0A000' or sqlstate 'P0002' then
    blocked_minutes:=uninvoiced_minutes; billing_status:='needs_review'; return next; return;
  end;
  covered := remaining * int8multirange(int8range(0,included,'[)'));
  candidate := remaining * int8multirange(int8range(included,t.rounded_minutes,'[)'));
  select coalesce(sum(upper(r)-lower(r)),0)::bigint into covered_minutes from unnest(covered) r;
  chargeable_minutes:=uninvoiced_minutes-covered_minutes;
  available_ranges:=candidate;
  billing_status:=case when u.period_end>p_as_of_date then 'retainer_current' else 'retainer_completed' end;
  return next;
end $$;
create or replace function public.guard_invoice_allocation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare i public.invoice_items%rowtype; p public.invoices%rowtype; t public.time_entries%rowtype;
  u record; included bigint;
begin
  if tg_op = 'DELETE' then raise exception 'Source allocation history cannot be deleted.'; end if;
  select * into strict i from public.invoice_items where id = new.invoice_item_id;
  update public.invoices set updated_at = updated_at where id = i.invoice_id returning * into p;
  -- Re-read after acquiring the parent lock: a line may have changed while waiting.
  select * into strict i from public.invoice_items where id = new.invoice_item_id;
  if tg_op = 'UPDATE' then
    if i.superseded_at is not null and old.released_at is null and new.released_at=i.superseded_at
      and (to_jsonb(new)-array['released_at','allocated_minutes'])=(to_jsonb(old)-array['released_at','allocated_minutes']) then return new; end if;
    if p.status = 'void' and old.released_at is null and new.released_at = p.voided_at
      and (to_jsonb(new) - array['released_at','allocated_minutes']) = (to_jsonb(old) - array['released_at','allocated_minutes']) then return new; end if;
    raise exception 'Source allocations are immutable except release by invoice voiding.';
  end if;
  if p.status = 'void' or i.superseded_at is not null or new.released_at is not null then raise exception 'Allocations require a current, non-void invoice line.'; end if;
  if i.source_type not in ('hourly_time','retainer_overage') then raise exception 'This line does not accept time allocations.'; end if;
  -- Serialize all claim creation and allowance-affecting time writes. Touching
  -- the customer also rejects stale repeatable-read writers with a retry error.
  update public.customers set updated_at=updated_at where id=p.customer_id;
  -- Touch creates a row version as well as taking the lock, protecting against
  -- concurrent source corrections and repeatable-read stale snapshots.
  update public.time_entries set updated_at = updated_at where id = new.time_entry_id returning * into t;
  if not found or t.customer_id <> p.customer_id or not t.is_billable or t.voided_at is not null
    or new.minute_end > t.rounded_minutes then raise exception 'Invalid billable time source or minute bounds.'; end if;
  if t.hourly_rate is distinct from i.unit_rate then raise exception 'Time rate must equal its captured hourly rate.'; end if;
  if i.source_type = 'hourly_time' then
    if t.billing_agreement_id is not null then raise exception 'Retainer work must use overage allocations.'; end if;
  else
    if t.billing_agreement_id is distinct from i.billing_agreement_id then raise exception 'Time agreement mismatch.'; end if;
    select * into strict u from public.get_retainer_period_usage(i.billing_agreement_id,t.work_date);
    if row(u.period_start,u.period_end) is distinct from row(i.period_start,i.period_end) then raise exception 'Time period mismatch.'; end if;
    select (e->>'included_minutes')::numeric::bigint into included from jsonb_array_elements(u.allocations) e where (e->>'time_entry_id')::uuid = t.id;
    if included is null or new.minute_start < included then raise exception 'Included minutes cannot be invoiced as overage.'; end if;
  end if;
  if new.minute_end - new.minute_start + (select coalesce(sum(allocated_minutes),0) from public.invoice_time_allocations
    where invoice_item_id = i.id and released_at is null) > i.billed_minutes then raise exception 'Allocations exceed line minutes.'; end if;
  return new;
end $$;

-- A backdated insert adds usage ahead of later entries: previously billed ranges
-- remain overage, and newly exposed overage offsets become eligible. Conversely,
-- reducing/voiding earlier work can invalidate an active later claim. Reject the
-- entire source mutation rather than freezing allowance or rewriting invoices.
create function public.lock_retainer_claim_context()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='time_entries' and tg_op='UPDATE' then
    if row(new.actual_minutes,new.is_billable,new.voided_at) is not distinct from
       row(old.actual_minutes,old.is_billable,old.voided_at) then return new; end if;
  end if;
  if tg_op='DELETE' then
    update public.customers set updated_at=updated_at where id=old.customer_id;
    return old;
  end if;
  update public.customers set updated_at=updated_at where id=new.customer_id;
  return new;
end $$;

create function public.validate_active_retainer_claims()
returns trigger language plpgsql security invoker set search_path='' as $$
declare owner_id uuid; claim record; u record; included bigint;
begin
  if tg_table_name='time_entries' and tg_op='UPDATE' then
    if row(new.actual_minutes,new.is_billable,new.voided_at) is not distinct from
       row(old.actual_minutes,old.is_billable,old.voided_at) then return new; end if;
  end if;
  owner_id:=case when tg_op='DELETE' then old.customer_id else new.customer_id end;
  for claim in
    select x.minute_start,x.minute_end,t.id,t.billing_agreement_id,t.work_date,t.hourly_rate,t.rounded_minutes,
      t.is_billable,t.voided_at,i.unit_rate
    from public.invoice_time_allocations x
    join public.time_entries t on t.id=x.time_entry_id
    join public.invoice_items i on i.id=x.invoice_item_id
    where t.customer_id=owner_id and x.released_at is null and i.source_type='retainer_overage'
  loop
    select * into strict u from public.get_retainer_period_usage(claim.billing_agreement_id,claim.work_date);
    select (e->>'included_minutes')::numeric::bigint into included from jsonb_array_elements(u.allocations) e
      where (e->>'time_entry_id')::uuid=claim.id;
    if included is null or claim.minute_start<included or claim.minute_end>claim.rounded_minutes
       or not claim.is_billable or claim.voided_at is not null or claim.hourly_rate<>claim.unit_rate then
      raise exception using errcode='23514',message='This change would invalidate invoiced retainer overage. Release the affected invoice claims before correcting earlier work or terms.';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create trigger time_entries_00_lock_claim_context before insert or update or delete on public.time_entries
for each row execute function public.lock_retainer_claim_context();
create trigger time_entries_validate_active_claims after insert or update or delete on public.time_entries
for each row execute function public.validate_active_retainer_claims();
-- Agreement corrections must not make a live claimed source invalid either.
create trigger billing_agreements_00_lock_claim_context before update or delete on public.customer_billing_agreements
for each row execute function public.lock_retainer_claim_context();
create trigger billing_agreements_validate_active_claims after update or delete on public.customer_billing_agreements
for each row execute function public.validate_active_retainer_claims();
revoke all on function public.lock_retainer_claim_context(),public.validate_active_retainer_claims() from public,anon,authenticated,service_role;

comment on view public.unbilled_time_entries is
  'Caller-RLS classification: uninvoiced = covered + chargeable + deferred + blocked. Current and completed exact unclaimed overage is chargeable immediately. Future work is deferred; unsupported usage is blocked. Normal invoice planning still selects only the current period and its adjacent predecessor, not historical catch-up.';
comment on function public.generate_customer_invoice(uuid,date,uuid,date,text,text) is
  'Atomic idempotent caller-RLS generation using the same invoice_candidate_plan as preview and composer. Exact unclaimed current/prior overage, unchanged fixed fees and hourly time; no historical catch-up. Existing customer/source locks and allocation exclusion prevent duplicate claims.';

-- The removed period-wide index must not permit unsupported overage lines with
-- no source claims. Deferred checks allow the atomic RPC to insert line then
-- ranges, but require complete coverage before committing any active line.
create function public.check_overage_line_coverage()
returns trigger language plpgsql security invoker set search_path='' as $$
declare line_id uuid; line public.invoice_items%rowtype; minutes bigint;
begin
  if tg_table_name='invoice_items' then line_id:=new.id; else line_id:=new.invoice_item_id; end if;
  select * into line from public.invoice_items where id=line_id;
  if line.source_type='retainer_overage' and line.released_at is null and line.superseded_at is null then
    select coalesce(sum(allocated_minutes),0)::bigint into minutes from public.invoice_time_allocations
      where invoice_item_id=line.id and released_at is null;
    if minutes<>line.billed_minutes then
      raise exception using errcode='23514',message='Active overage lines must be fully backed by exact source allocations.';
    end if;
  end if;
  return null;
end $$;
create constraint trigger invoice_items_overage_coverage after insert or update on public.invoice_items
  deferrable initially deferred for each row execute function public.check_overage_line_coverage();
create constraint trigger invoice_allocations_overage_coverage after insert or update on public.invoice_time_allocations
  deferrable initially deferred for each row execute function public.check_overage_line_coverage();
revoke all on function public.check_overage_line_coverage() from public,anon,authenticated,service_role;
