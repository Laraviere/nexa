-- Durable terminal results include nothing_to_invoice, which cannot live on an
-- invoice without creating an empty financial record. Uses the same UUID lock
-- namespace and invoice creation metadata contract as create_manual_invoice.
create table public.invoice_generation_requests (
  request_id uuid primary key,
  customer_id uuid not null references public.customers(id) on update restrict on delete restrict,
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  as_of_date date not null check (isfinite(as_of_date)),
  invoice_id uuid unique references public.invoices(id) on update restrict on delete restrict,
  created_at timestamptz not null default now() check (isfinite(created_at))
);
create index invoice_generation_requests_customer_idx on public.invoice_generation_requests(customer_id);
alter table public.invoice_generation_requests enable row level security;
create policy "Authenticated generation result reads" on public.invoice_generation_requests for select to authenticated using(true);
create policy "Authenticated generation result creation" on public.invoice_generation_requests for insert to authenticated with check(true);
revoke all on public.invoice_generation_requests from public,anon,authenticated;
grant select,insert on public.invoice_generation_requests to authenticated;

create function public.guard_invoice_generation_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception using errcode='55000',message='Generation request history is immutable.'; end if;
  if new.invoice_id is not null and not exists(select from public.invoices i where i.id=new.invoice_id
    and i.customer_id=new.customer_id and i.creation_request_id=new.request_id
    and i.creation_request_payload=new.request_payload) then
    raise exception using errcode='23514',message='Generation result does not match its invoice.';
  end if;
  return new;
end $$;
create trigger invoice_generation_requests_guard before insert or update or delete on public.invoice_generation_requests
  for each row execute function public.guard_invoice_generation_request();
-- Compatibility with manual creation: an empty generation result still owns
-- its key. The manual RPC remains unchanged; this insert guard prevents reuse.
create function public.check_invoice_generation_key()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.creation_request_id is not null and exists(select from public.invoice_generation_requests r where r.request_id=new.creation_request_id) then
    raise exception using errcode='22023',message='Request ID was already used for invoice generation.';
  end if;
  return new;
end $$;
create trigger invoices_check_generation_key before insert on public.invoices for each row execute function public.check_invoice_generation_key();

-- A live, caller-RLS explanation of the unclaimed time in an entry. This is not
-- a persisted billed flag. Already-invoiced ranges win over recalculated coverage
-- when late work changes allocation order; historical invoices never change.
create function public.get_time_entry_invoiceability(p_time_entry_id uuid,p_as_of_date date)
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
  if exists(select from public.invoice_items i where i.source_type='retainer_overage' and i.released_at is null
      and i.billing_agreement_id=t.billing_agreement_id
      and daterange(i.period_start,i.period_end,'[)') && daterange(u.period_start,u.period_end,'[)')) then
    blocked_minutes:=uninvoiced_minutes-covered_minutes; billing_status:='retainer_claimed';
  elsif u.period_end>p_as_of_date then
    deferred_minutes:=uninvoiced_minutes-covered_minutes; billing_status:='retainer_open';
  else
    chargeable_minutes:=uninvoiced_minutes-covered_minutes; available_ranges:=candidate; billing_status:='retainer_completed';
  end if;
  return next;
end $$;
revoke all on function public.get_time_entry_invoiceability(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.get_time_entry_invoiceability(uuid,date) to authenticated;

-- Preserve the previous columns/row eligibility for existing consumers, append
-- an explicit partition. Chargeable consumers must use chargeable_minutes > 0;
-- uninvoiced_minutes alone deliberately includes covered/deferred/blocked work.
create or replace view public.unbilled_time_entries with (security_invoker=true) as
  select t.*, b.invoiced_minutes,b.uninvoiced_minutes,b.covered_minutes,b.chargeable_minutes,
    b.deferred_minutes,b.blocked_minutes,b.billing_status
  from public.time_entries t cross join lateral public.get_time_entry_invoiceability(
    t.id,(now() at time zone 'America/New_York')::date) b
  where t.is_billable and t.voided_at is null and b.uninvoiced_minutes>0;
revoke all on public.unbilled_time_entries from public,anon,authenticated;
grant select on public.unbilled_time_entries to authenticated;

create function public.generate_customer_invoice(
  p_customer_id uuid, p_issue_date date, p_request_id uuid,
  p_as_of_date date default null, p_notes text default null, p_terms text default null
)
returns table (
  outcome text, invoice_id uuid, invoice_number integer, issue_date date, due_date date,
  status text, as_of_date date, subtotal numeric, tax_total numeric, total numeric
)
language plpgsql security invoker set search_path = '' as $$
declare
  payload jsonb; saved public.invoice_generation_requests%rowtype;
  horizon date := coalesce(p_as_of_date,(now() at time zone 'America/New_York')::date);
  a public.customer_billing_agreements%rowtype; u record; ref date; current_agreement uuid; current_ref date; previous_agreement uuid; previous_ref date; choice record;
  fees jsonb:='[]'; overages jsonb:='[]'; hourly jsonb:='[]'; planned jsonb;
  item jsonb; allocation jsonb; group_row record;
  rid uuid; line_id uuid; position_value integer:=0; rate numeric; actual_amount numeric;
begin
  if p_customer_id is null or p_request_id is null or p_issue_date is null or not isfinite(p_issue_date)
      or not isfinite(horizon) then raise exception using errcode='22023',message='Customer, request ID and finite business dates are required.'; end if;
  if horizon>(now() at time zone 'America/New_York')::date then
    raise exception using errcode='22023',message='The billing reference date cannot be later than today in New York.';
  end if;
  payload:=jsonb_build_object('operation','generate_customer_invoice','customer_id',p_customer_id,
    'issue_date',p_issue_date,'as_of_date',p_as_of_date,'notes',p_notes,'terms',p_terms);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,12120000));
  select * into saved from public.invoice_generation_requests r where r.request_id=p_request_id;
  if found then
    if saved.request_payload is distinct from payload then raise exception using errcode='22023',message='Request ID was already used with different invoice data.'; end if;
    rid:=saved.invoice_id; horizon:=saved.as_of_date;
  else
    if exists(select from public.invoices i where i.creation_request_id=p_request_id) then
      raise exception using errcode='22023',message='Request ID was already used by another invoice operation.';
    end if;
    -- Request locks are shared with manual creation. Customer-scoped generation
    -- locking serializes distinct generation keys. The customer row lock also
    -- prevents a concurrent FK insert from silently entering this source set.
    perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text,13120000));
    perform 1 from public.customers c where c.id=p_customer_id for update;
    if not found then raise exception using errcode='P0002',message='Customer unavailable.'; end if;
    perform a0.id from public.customer_billing_agreements a0 where a0.customer_id=p_customer_id order by a0.id for share;
    perform t.id from public.time_entries t where t.customer_id=p_customer_id order by t.id for update;

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
        if not choice.is_current and u.period_end<=horizon and u.overage_minutes>0 and not exists (
          select from public.invoice_items i where i.billing_agreement_id=a.id and i.source_type='retainer_overage'
            and i.released_at is null and daterange(i.period_start,i.period_end,'[)') && daterange(u.period_start,u.period_end,'[)')
        ) then
          select (e->>'hourly_rate')::numeric into rate from jsonb_array_elements(u.allocations) e where (e->>'overage_minutes')::numeric>0 limit 1;
          overages:=overages||jsonb_build_array(jsonb_build_object('source_type','retainer_overage','unit','hour',
            'description','IT Support Overage — '||to_char(u.period_start,'FMMonth FMDD, YYYY')||' – '||to_char(u.period_end-1,'FMMonth FMDD, YYYY'),
            'unit_rate',rate,'billed_minutes',u.overage_minutes,'expected_amount',u.overage_amount,
            'billing_agreement_id',a.id,'period_start',u.period_start,'period_end',u.period_end,
            'allocations',(select jsonb_agg(jsonb_build_object('time_entry_id',e->>'time_entry_id',
              'minute_start',(e->>'included_minutes')::numeric,'minute_end',(e->>'rounded_minutes')::numeric) order by ord)
              from jsonb_array_elements(u.allocations) with ordinality as j(e,ord) where (e->>'overage_minutes')::numeric>0)));
        end if;
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
    if jsonb_array_length(planned)>0 then
      insert into public.invoices(customer_id,issue_date,notes,terms,creation_request_id,creation_request_payload)
        values(p_customer_id,p_issue_date,p_notes,p_terms,p_request_id,payload) returning id into rid;
      for item in select value from jsonb_array_elements(planned) loop
        position_value:=position_value+1;
        insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes,billing_agreement_id,period_start,period_end)
          values(rid,position_value,item->>'description',item->>'source_type',1,item->>'unit',(item->>'unit_rate')::numeric,
            (item->>'billed_minutes')::numeric::bigint,(item->>'billing_agreement_id')::uuid,(item->>'period_start')::date,(item->>'period_end')::date)
          returning id,amount into line_id,actual_amount;
        if item ? 'expected_amount' and actual_amount is distinct from (item->>'expected_amount')::numeric then
          raise exception using errcode='22023',message='Overage amount does not match authoritative usage.';
        end if;
        for allocation in select value from jsonb_array_elements(coalesce(item->'allocations','[]'::jsonb)) loop
          insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end)
            values(line_id,(allocation->>'time_entry_id')::uuid,(allocation->>'minute_start')::numeric::bigint,(allocation->>'minute_end')::numeric::bigint);
        end loop;
      end loop;
    end if;
    insert into public.invoice_generation_requests(request_id,customer_id,request_payload,as_of_date,invoice_id)
      values(p_request_id,p_customer_id,payload,horizon,rid);
  end if;
  if rid is null then
    return query select 'nothing_to_invoice'::text,null::uuid,null::integer,p_issue_date,null::date,null::text,horizon,null::numeric,null::numeric,null::numeric;
  else
    return query select 'created'::text,i.id,i.invoice_number,i.issue_date,i.due_date,i.status,horizon,t.subtotal,t.tax_amount,t.total
      from public.invoices i join public.invoice_totals t on t.invoice_id=i.id where i.id=rid;
  end if;
exception when unique_violation or exclusion_violation or deadlock_detected then
  raise exception using errcode='40001',message='Billing sources changed concurrently. Retry the same generation request.';
end $$;
revoke all on function public.generate_customer_invoice(uuid,date,uuid,date,text,text) from public,anon,authenticated,service_role;
grant execute on function public.generate_customer_invoice(uuid,date,uuid,date,text,text) to authenticated;
revoke all on function public.guard_invoice_generation_request(),public.check_invoice_generation_key() from public,anon,authenticated,service_role;
comment on table public.invoice_generation_requests is 'Immutable terminal generation outcomes, including no eligible charges. Same key replays the same result identity without recalculating sources; use a new key to evaluate new work. Existing invoice metadata stores nonempty creation intent too.';
comment on view public.unbilled_time_entries is 'Caller-RLS live billing classification: uninvoiced = covered + chargeable + deferred + blocked. Claimed minutes remain separate. Included allowance is covered, never a charged allocation. Active retainer-period claims block late extra overage pending explicit adjustment/void-rebill. Future/in-progress work is deferred; unsupported usage requires review. Chargeable historical overage remains detectable but is not necessarily selected by normal generation.';
comment on function public.generate_customer_invoice(uuid,date,uuid,date,text,text) is 'Atomic caller-RLS draft from the current retainer period, its immediately completed predecessor, and eligible unclaimed hourly minutes as of a NY business date (default today). Full current advance fee or immediately completed arrears fee; no historical catch-up. After cancellation only the latest version final completed period is considered. Disabled agreements produce no automatic fixed fee; captured completed overage remains eligible. Whole completed overage comes from usage RPC, hourly time groups captured rates and exact remaining ranges. No included charge, manual additions, editing, payments or delivery. Idempotent empty results persist; retry with same key after 40001.';
