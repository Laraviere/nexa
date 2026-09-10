-- One shared planner; existing generation and the new composer use this exact
-- eligibility path. No tables, policies, source constraints or history change.
create function public.invoice_candidate_plan(p_customer_id uuid,p_as_of_date date)
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
  return planned;
end $$;

-- A single statement snapshot covers plan and revision material. Canonical UTC
-- serialization prevents session timezone/date formatting from changing tokens.
create function public.invoice_preview_state(p_customer_id uuid,p_as_of_date date)
returns jsonb language plpgsql stable security invoker set search_path=''
set timezone='UTC' set datestyle='ISO, YMD' as $$
declare planned jsonb; candidates jsonb:='[]'; item jsonb; fingerprint jsonb; token text;
begin
  planned:=public.invoice_candidate_plan(p_customer_id,p_as_of_date);
  for item in select value from jsonb_array_elements(planned) loop
    token:=encode(sha256(convert_to(jsonb_build_object('version',1,'customer',p_customer_id,'as_of',p_as_of_date,
      'type',item->'source_type','agreement',item->'billing_agreement_id',
      'start',item->'period_start','end',item->'period_end','rate',item->'unit_rate')::text,'UTF8')),'hex');
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

create function public.preview_customer_invoice(p_customer_id uuid,p_as_of_date date default null)
returns table(as_of_date date,revision text,candidates jsonb)
language sql stable security invoker set search_path='' as $$
  with state as materialized (select public.invoice_preview_state(p_customer_id,coalesce(p_as_of_date,(now() at time zone 'America/New_York')::date)) s)
  select (s->>'as_of_date')::date,s->>'revision',
    coalesce((select jsonb_agg(e - array['allocations','expected_amount'] order by ord)
      from jsonb_array_elements(s->'candidates') with ordinality j(e,ord)),'[]'::jsonb)
  from state;
$$;

create or replace function public.generate_customer_invoice(
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

    planned:=public.invoice_candidate_plan(p_customer_id,horizon);
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

create function public.create_composed_invoice(
  p_customer_id uuid,p_issue_date date,p_as_of_date date,p_request_id uuid,
  p_revision text,p_selected_candidate_ids text[],p_custom_items jsonb,
  p_notes text default null,p_terms text default null
)
returns table(invoice_id uuid,invoice_number integer,issue_date date,due_date date,
  status text,company_name_snapshot text,as_of_date date,subtotal numeric,tax_total numeric,total numeric)
language plpgsql security invoker set search_path='' as $$
declare
  item jsonb; normalized_items jsonb:='[]'; payload jsonb; original_payload jsonb;
  quantity_value numeric; rate_value numeric; tax_value numeric;
  selected text[]; snapshot jsonb; rid uuid; line_id uuid; position_value integer:=0;
  allocation jsonb; actual_amount numeric;
begin
  if p_customer_id is null or p_request_id is null or p_issue_date is null or not isfinite(p_issue_date)
    or p_as_of_date is null or not isfinite(p_as_of_date) or p_revision is null or p_revision !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='Customer, finite dates, request ID and preview revision are required.';
  end if;
  if p_selected_candidate_ids is null or array_position(p_selected_candidate_ids,null) is not null
    or cardinality(p_selected_candidate_ids)>1000 then
    raise exception using errcode='22023',message='Invalid candidate selection.';
  end if;
  select coalesce(array_agg(distinct x order by x),'{}'::text[]) into selected from unnest(p_selected_candidate_ids) x;
  if cardinality(selected)<>cardinality(p_selected_candidate_ids) then
    raise exception using errcode='22023',message='Duplicate candidate selection.';
  end if;
  if p_custom_items is null or jsonb_typeof(p_custom_items) <> 'array' then
    raise exception using errcode = '22023', message = 'Line items must be an array.';
  end if;
  if jsonb_array_length(p_custom_items) > 1000 then
    raise exception using errcode = '22023', message = 'Provide at most 1000 custom line items.';
  end if;
  -- Reject protected/unknown properties, rather than silently ignoring them.
  -- Array order determines positions. Decimal strings or JSON numbers are
  -- accepted and normalized to equal numeric intent for retry comparisons.
  for item in select value from jsonb_array_elements(p_custom_items) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception using errcode = '22023', message = 'Invalid manual line item.';
    end if;
    if item - array['description','quantity','unit','unit_rate','tax_amount'] <> '{}'::jsonb
      or jsonb_typeof(item->'description') is distinct from 'string'
      or not ((item->>'description') ~ '[^[:space:]]')
      or jsonb_typeof(item->'unit') is distinct from 'string'
      or (item->>'unit') not in ('hour','minute','flat','each','mile','month','custom') then
      raise exception using errcode = '22023', message = 'Invalid manual line description, unit or fields.';
    end if;
    if coalesce(jsonb_typeof(item->'quantity'),'null') not in ('number','string')
      or coalesce(jsonb_typeof(item->'unit_rate'),'null') not in ('number','string')
      or (item ? 'tax_amount' and coalesce(jsonb_typeof(item->'tax_amount'),'null') not in ('number','string')) then
      raise exception using errcode = '22023', message = 'Invalid manual line numeric values.';
    end if;
    begin
      quantity_value := (item->>'quantity')::numeric;
      rate_value := (item->>'unit_rate')::numeric;
      tax_value := coalesce(item->>'tax_amount','0')::numeric;
      -- Check BEFORE fixed-precision column casts can round invalid precision.
      if not (quantity_value > 0 and quantity_value < 1000000000000
          and quantity_value = trunc(quantity_value,8))
        or not (rate_value >= 0 and rate_value < 10000000000 and rate_value = trunc(rate_value,2))
        or not (tax_value >= 0 and tax_value < 10000000000000000000000 and tax_value = trunc(tax_value,2)) then
        raise exception using errcode = '22023', message = 'Invalid manual line numeric range or precision.';
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Invalid manual line numeric values.';
    end;
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object(
      'description', item->>'description', 'quantity', quantity_value,
      'unit',item->>'unit', 'unit_rate',rate_value, 'tax_amount',tax_value));
  end loop;

  if cardinality(selected)=0 and jsonb_array_length(normalized_items)=0 then
    raise exception using errcode='22023',message='Select a charge or add a custom item before saving.';
  end if;
  payload:=jsonb_build_object('operation','create_composed_invoice','customer_id',p_customer_id,
    'issue_date',p_issue_date,'as_of_date',p_as_of_date,'revision',p_revision,
    'selected',to_jsonb(selected),'items',normalized_items,'notes',p_notes,'terms',p_terms);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,12120000));
  select i.id,i.creation_request_payload into rid,original_payload from public.invoices i where i.creation_request_id=p_request_id;
  if found then
    if original_payload is distinct from payload then
      raise exception using errcode='22023',message='Request ID was already used with different invoice data.';
    end if;
  else
    if exists(select from public.invoice_generation_requests where request_id=p_request_id) then
      raise exception using errcode='22023',message='Request ID was already used for invoice generation.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text,13120000));
    perform 1 from public.customers c where c.id=p_customer_id for update;
    if not found then raise exception using errcode='P0002',message='Customer unavailable.'; end if;
    perform a.id from public.customer_billing_agreements a where a.customer_id=p_customer_id order by a.id for share;
    perform t.id from public.time_entries t where t.customer_id=p_customer_id order by t.id for update;
    snapshot:=public.invoice_preview_state(p_customer_id,p_as_of_date);
    if snapshot->>'revision' is distinct from p_revision then
      raise exception using errcode='P0001',message='STALE_INVOICE_PREVIEW: Billing data changed. Refresh the preview and review the charges again.';
    end if;
    if exists(select from unnest(selected) id where not exists(
      select from jsonb_array_elements(snapshot->'candidates') e where e->>'candidate_id'=id)) then
      raise exception using errcode='22023',message='Selected charge does not belong to this preview.';
    end if;
    insert into public.invoices(customer_id,issue_date,notes,terms,creation_request_id,creation_request_payload)
      values(p_customer_id,p_issue_date,p_notes,p_terms,p_request_id,payload) returning id into rid;
    -- Canonical planner order, then custom items in caller order. Browser never
    -- supplies financial/source fields for generated items.
    for item in select value from jsonb_array_elements(snapshot->'candidates') where value->>'candidate_id'=any(selected) loop
      position_value:=position_value+1;
      insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes,billing_agreement_id,period_start,period_end)
        values(rid,position_value,item->>'description',item->>'source_type',1,item->>'unit',(item->>'unit_rate')::numeric,
          (item->>'billed_minutes')::numeric::bigint,(item->>'billing_agreement_id')::uuid,(item->>'period_start')::date,(item->>'period_end')::date)
        returning id,amount into line_id,actual_amount;
      if actual_amount is distinct from (item->>'amount')::numeric then
        raise exception using errcode='P0001',message='STALE_INVOICE_PREVIEW: Charge amount changed.';
      end if;
      for allocation in select value from jsonb_array_elements(coalesce(item->'allocations','[]')) loop
        insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end)
          values(line_id,(allocation->>'time_entry_id')::uuid,(allocation->>'minute_start')::numeric::bigint,(allocation->>'minute_end')::numeric::bigint);
      end loop;
    end loop;
    insert into public.invoice_items(invoice_id,position,description,quantity,unit,unit_rate,tax_amount,source_type)
      select rid,position_value+ordinality::integer,value->>'description',(value->>'quantity')::numeric,
        value->>'unit',(value->>'unit_rate')::numeric,(value->>'tax_amount')::numeric,'manual'
      from jsonb_array_elements(normalized_items) with ordinality;
  end if;
  return query select i.id,i.invoice_number,i.issue_date,i.due_date,i.status,i.company_name_snapshot,
    p_as_of_date,t.subtotal,t.tax_amount,t.total from public.invoices i join public.invoice_totals t on t.invoice_id=i.id where i.id=rid;
exception when unique_violation or exclusion_violation or deadlock_detected then
  raise exception using errcode='40001',message='Billing sources changed concurrently. Retry the same request; refresh the preview if stale.';
end $$;

revoke all on function public.invoice_candidate_plan(uuid,date),public.invoice_preview_state(uuid,date),
  public.preview_customer_invoice(uuid,date),public.create_composed_invoice(uuid,date,date,uuid,text,text[],jsonb,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.invoice_candidate_plan(uuid,date),public.invoice_preview_state(uuid,date),
  public.preview_customer_invoice(uuid,date),public.create_composed_invoice(uuid,date,date,uuid,text,text[],jsonb,text,text)
  to authenticated;
comment on function public.preview_customer_invoice(uuid,date) is 'Read-only caller-RLS preview using the shared generator planner. One row including empty candidates, resolved NY date and conservative SHA-256 source revision. Does not reserve. Allocation ranges omitted from the public preview.';
comment on function public.create_composed_invoice(uuid,date,date,uuid,text,text[],jsonb,text,text) is 'Atomic selected billing candidates plus ordered custom lines. Recomputes preview under source locks, rejects stale review, reuses invoice creation request metadata. Fixed planner order then custom order. No empty drafts, no automatic approval or delivery.';
