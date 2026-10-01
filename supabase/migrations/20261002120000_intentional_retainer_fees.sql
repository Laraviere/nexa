-- Explicit fixed-fee billing; preserve all existing claims, amounts and overage rules.

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
        if choice.is_current and u.period_start<=horizon and not exists (
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

-- Explicit historical-fee discovery only. No usage-engine traversal, allocation
-- changes or proration. Calendar construction matches guard_invoice_item.
create function public.unclaimed_historical_retainer_fees(p_customer_id uuid,p_as_of_date date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if p_as_of_date is null or not isfinite(p_as_of_date) or p_as_of_date>(now() at time zone 'America/New_York')::date then
   raise exception using errcode='22023',message='A finite billing date no later than today is required.';
 end if;
 return (with periods as (
   select a.id,a.monthly_fee,greatest(d::date,a.effective_date) as start_date,
     least((d+interval '1 month')::date,a.end_date) as end_date
   from public.customer_billing_agreements a
   cross join lateral (select date_trunc('month',a.effective_date::timestamp)::date+a.billing_cycle_day-1 as anchor) b
   cross join lateral generate_series(
     (case when b.anchor>a.effective_date then (b.anchor-interval '1 month')::date else b.anchor end)::timestamp,
     least(p_as_of_date,a.end_date)::timestamp,interval '1 month') d
   where a.customer_id=p_customer_id and a.effective_date<=p_as_of_date
 ), available as (
   select * from periods p where p.start_date<p.end_date and p.end_date<=p_as_of_date
   and not exists(select from public.invoice_items i where i.billing_agreement_id=p.id
     and i.source_type='retainer_fee' and i.released_at is null
     and daterange(i.period_start,i.period_end,'[)') && daterange(p.start_date,p.end_date,'[)'))
 ) select coalesce(jsonb_agg(jsonb_build_object('source_type','retainer_fee','unit','month',
     'description','Monthly IT Support Retainer — '||to_char(start_date,'FMMonth FMDD, YYYY')||' – '||to_char(end_date-1,'FMMonth FMDD, YYYY'),
     'unit_rate',monthly_fee,'billing_agreement_id',id,'period_start',start_date,'period_end',end_date,'historical',true)
     order by start_date desc,id),'[]'::jsonb) from available);
end $$;
revoke all on function public.unclaimed_historical_retainer_fees(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.unclaimed_historical_retainer_fees(uuid,date) to authenticated;

create or replace function public.invoice_preview_state(p_customer_id uuid,p_as_of_date date)
returns jsonb language plpgsql stable security invoker set search_path=''
set timezone='UTC' set datestyle='ISO, YMD' as $$
declare planned jsonb; candidates jsonb:='[]'; item jsonb; fingerprint jsonb; token text;
begin
  planned:=public.invoice_candidate_plan(p_customer_id,p_as_of_date) || public.unclaimed_historical_retainer_fees(p_customer_id,p_as_of_date);
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

-- The review fingerprint includes discoverable historical fees, so explicit
-- additions use the same atomic save/edit validation and concurrency locks.
-- Normal public previews hide them; the generator still uses the normal planner.
create or replace function public.preview_customer_invoice(p_customer_id uuid,p_as_of_date date default null)
returns table(as_of_date date,revision text,candidates jsonb)
language sql stable security invoker set search_path='' as $$
 with state as materialized(select public.invoice_preview_state(p_customer_id,coalesce(p_as_of_date,(now() at time zone 'America/New_York')::date)) s)
 select (s->>'as_of_date')::date,s->>'revision',coalesce((select jsonb_agg(e-array['allocations','expected_amount'] order by ord)
   from jsonb_array_elements(s->'candidates') with ordinality j(e,ord) where e->>'historical' is distinct from 'true'),'[]'::jsonb) from state;
$$;
create or replace function public.preview_invoice_edit(p_invoice_id uuid,p_as_of_date date)
returns table(as_of_date date,revision text,candidates jsonb)
language sql stable security invoker set search_path='' as $$
 with state as materialized(select public.invoice_edit_preview_state(p_invoice_id,p_as_of_date) s)
 select (s->>'as_of_date')::date,s->>'revision',coalesce((select jsonb_agg(e-array['existing_item_id','allocations','expected_amount'] order by ord)
   from jsonb_array_elements(s->'candidates') with ordinality j(e,ord) where e->>'historical' is distinct from 'true'),'[]'::jsonb) from state;
$$;

-- Opt-in read. Returns current + historical choices under one revision, all
-- signed/validated by the same state consumed by the atomic composer RPCs.
create function public.preview_invoice_with_retainer_history(p_customer_id uuid,p_as_of_date date,p_invoice_id uuid default null)
returns table(as_of_date date,revision text,candidates jsonb)
language plpgsql stable security invoker set search_path='' as $$
declare s jsonb;
begin
 if p_invoice_id is not null then
   if not exists(select from public.invoices i where i.id=p_invoice_id and i.customer_id=p_customer_id and i.status<>'void') then
     raise exception using errcode='P0002',message='Editable invoice unavailable.';
   end if;
   s:=public.invoice_edit_preview_state(p_invoice_id,p_as_of_date);
 else s:=public.invoice_preview_state(p_customer_id,p_as_of_date);end if;
 return query select (s->>'as_of_date')::date,s->>'revision',coalesce((select jsonb_agg(e-array['existing_item_id','allocations','expected_amount'] order by ord)
   from jsonb_array_elements(s->'candidates') with ordinality j(e,ord)),'[]'::jsonb);
end $$;
revoke all on function public.preview_invoice_with_retainer_history(uuid,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_invoice_with_retainer_history(uuid,date,uuid) to authenticated;
comment on function public.invoice_candidate_plan(uuid,date) is
 'Normal candidates: full current unclaimed retainer fee regardless of advance/arrears setting, exact current/prior incremental overage and eligible hourly work. No automatic historical fee catch-up or future periods.';
