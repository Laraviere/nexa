-- Historical lines survive edits; current composition is separate from claims.
-- Void still preserves its final composition and amounts.
alter table public.invoice_items add column superseded_at timestamptz check (superseded_at is null or isfinite(superseded_at));
alter table public.invoice_items drop constraint invoice_items_invoice_id_position_key;
create unique index invoice_items_current_position_idx on public.invoice_items(invoice_id,position) where superseded_at is null;
create table public.invoice_edit_requests (
 request_id uuid primary key, invoice_id uuid not null references public.invoices(id) on delete restrict,
 payload jsonb not null, previous_invoice jsonb not null, previous_items jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.invoice_edit_requests enable row level security;
create policy "Authenticated edit history reads" on public.invoice_edit_requests for select to authenticated using(true);
create policy "Authenticated edit history creation" on public.invoice_edit_requests for insert to authenticated with check(true);
revoke all on public.invoice_edit_requests from public,anon,authenticated;
grant select,insert on public.invoice_edit_requests to authenticated;
create function public.guard_invoice_edit_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin if tg_op<>'INSERT' then raise exception 'Invoice edit history is immutable.';end if;return new;end $$;
create trigger invoice_edit_history_guard before update or delete on public.invoice_edit_requests for each row execute function public.guard_invoice_edit_history();
create or replace function public.guard_invoice()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare c public.customers%rowtype;
begin
  if tg_op = 'DELETE' then raise exception 'Invoices cannot be deleted; void instead.'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.sent_at is not null or new.voided_at is not null then
      raise exception 'Invoices must start as drafts.';
    end if;
    select * into strict c from public.customers where id = new.customer_id for share;
    new.company_name_snapshot := c.company_name;
    new.primary_contact_name_snapshot := c.primary_contact_name;
    new.email_snapshot := c.email; new.phone_snapshot := c.phone;
    new.billing_address_line1_snapshot := c.billing_address_line1;
    new.billing_address_line2_snapshot := c.billing_address_line2;
    new.billing_city_snapshot := c.billing_city; new.billing_state_snapshot := c.billing_state;
    new.billing_postal_code_snapshot := c.billing_postal_code; new.billing_country_snapshot := c.billing_country;
    new.payment_terms_days_snapshot := c.default_payment_terms_days;
    new.due_date := coalesce(new.due_date, new.issue_date + c.default_payment_terms_days);
    return new;
  end if;
  if row(new.id,new.invoice_number,new.customer_id,new.created_at) is distinct from
    row(old.id,old.invoice_number,old.customer_id,old.created_at) then raise exception 'Invoice identity is immutable.'; end if;
  if new.sent_at is distinct from old.sent_at or new.voided_at is distinct from old.voided_at then
    raise exception 'Lifecycle timestamps are server managed.';
  end if;
  if old.status <> 'draft' and not (old.status='sent' and new.status='draft') and
    (to_jsonb(new) - array['status','void_reason','updated_at']) is distinct from
    (to_jsonb(old) - array['status','void_reason','updated_at']) then
    raise exception 'Issued invoice financial and display snapshots are immutable.';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'void' or (new.status = 'draft' and old.status <> 'sent') then raise exception 'Invalid invoice lifecycle transition.'; end if;
    if new.status = 'draft' then
      new.sent_at:=null;
    elsif new.status = 'sent' then
      if not exists (select 1 from public.invoice_items where invoice_id = new.id) then raise exception 'An invoice needs line items.'; end if;
      if exists (
        select 1 from public.invoice_items i where i.invoice_id = new.id and i.billed_minutes is not null
        and i.billed_minutes <> (select coalesce(sum(a.allocated_minutes),0) from public.invoice_time_allocations a
          where a.invoice_item_id = i.id and a.released_at is null)
      ) then raise exception 'Time line minutes must exactly match source allocations before issue.'; end if;
      new.sent_at := clock_timestamp();
    elsif new.status = 'void' then
      new.voided_at := clock_timestamp();
    end if;
  elsif new.void_reason is distinct from old.void_reason then
    raise exception 'Void reason can only be assigned while voiding.';
  end if;
  if new.issue_date is distinct from old.issue_date then new.due_date:=new.issue_date+old.payment_terms_days_snapshot; end if;
  return new;
end $$;

create or replace function public.guard_invoice_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare p public.invoices%rowtype; a public.customer_billing_agreements%rowtype;
  anchor date; expected_start date; expected_end date;
begin
  if tg_op = 'DELETE' then raise exception 'Invoice items cannot be deleted; void and replace the draft.'; end if;
  if tg_op = 'UPDATE' and row(new.id,new.invoice_id,new.created_at) is distinct from row(old.id,old.invoice_id,old.created_at) then
    raise exception 'Line identity is immutable.';
  end if;
  -- A real parent UPDATE serializes child writes against issue/void, including
  -- REPEATABLE READ (which must retry rather than finalize a stale snapshot).
  update public.invoices set updated_at = updated_at where id = new.invoice_id returning * into p;
  if not found then raise exception 'Invoice unavailable.'; end if;
  if tg_op='UPDATE' and old.superseded_at is not null then
    raise exception 'Superseded line history is immutable.';
  end if;
  if tg_op='INSERT' and new.superseded_at is not null then raise exception 'New lines must be current.'; end if;
  if tg_op='UPDATE' and new.superseded_at is not null then
    if p.status<>'draft' or (to_jsonb(new)-array['superseded_at','updated_at','amount']) is distinct from (to_jsonb(old)-array['superseded_at','updated_at','amount']) then
      raise exception 'Only an unchanged working line can be superseded.';
    end if;
    new.superseded_at:=clock_timestamp();new.released_at:=new.superseded_at;
    return new;
  end if;
  if tg_op = 'UPDATE' and p.status = 'void' and old.released_at is null
    and new.released_at = p.voided_at
    and (to_jsonb(new) - array['released_at','updated_at','amount']) = (to_jsonb(old) - array['released_at','updated_at','amount']) then
    return new;
  end if;
  if p.status <> 'draft' then raise exception 'Only draft lines can be edited.'; end if;
  if new.released_at is not null then raise exception 'Source claims are released only by invoice voiding.'; end if;
  if tg_op='UPDATE' and (to_jsonb(new)-array['position','description','updated_at','amount']) = (to_jsonb(old)-array['position','description','updated_at','amount']) then return new; end if;
  if tg_op = 'UPDATE' and exists (select 1 from public.invoice_time_allocations where invoice_item_id = old.id) then
    raise exception 'Allocated lines are immutable; void and replace the draft to correct sources.';
  end if;
  if new.billed_minutes is not null then new.quantity := round(new.billed_minutes::numeric / 60, 8); end if;
  if new.billing_agreement_id is not null then
    select * into strict a from public.customer_billing_agreements where id = new.billing_agreement_id for share;
    if a.customer_id <> p.customer_id then raise exception 'Agreement belongs to a different customer.'; end if;
    anchor := date_trunc('month',new.period_start::timestamp)::date + a.billing_cycle_day - 1;
    if anchor > new.period_start then anchor := (anchor - interval '1 month')::date; end if;
    expected_start := greatest(anchor,a.effective_date);
    expected_end := least((anchor + interval '1 month')::date,a.end_date);
    if new.period_start is distinct from expected_start or new.period_end is distinct from expected_end
      or expected_end <= expected_start then raise exception 'Source period must be one agreement-specific billing period.'; end if;
    -- Nexa policy: a clipped first/last period still receives the full fixed
    -- monthly fee, just as the usage engine grants the full included allowance.
    -- No day/percentage proration. Future explicit adjustments are separate.
    if new.source_type = 'retainer_fee' then new.unit_rate := a.monthly_fee; end if;
  end if;
  return new;
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
  if p.status <> 'draft' or i.superseded_at is not null or new.released_at is not null then raise exception 'Allocations require an unreleased draft.'; end if;
  if i.source_type not in ('hourly_time','retainer_overage') then raise exception 'This line does not accept time allocations.'; end if;
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

create or replace function public.release_void_invoice_sources()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    update public.invoice_items set released_at = new.voided_at where invoice_id = new.id and superseded_at is null;
    update public.invoice_time_allocations set released_at = new.voided_at
      where invoice_item_id in (select id from public.invoice_items where invoice_id = new.id and superseded_at is null) and released_at is null;
  end if;
  return new;
end $$;


create function public.release_superseded_invoice_item() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.superseded_at is not null and old.superseded_at is null then
   update public.invoice_time_allocations set released_at=new.superseded_at where invoice_item_id=new.id and released_at is null;
 end if;return new;
end $$;
create trigger invoice_items_release_superseded after update on public.invoice_items for each row execute function public.release_superseded_invoice_item();
create or replace view public.invoice_totals with (security_invoker=true) as
 select v.id as invoice_id,coalesce(sum(i.amount),0)::numeric as subtotal,coalesce(sum(i.tax_amount),0)::numeric as tax_amount,
 coalesce(sum(i.amount+i.tax_amount),0)::numeric as total from public.invoices v
 left join public.invoice_items i on i.invoice_id=v.id and i.superseded_at is null group by v.id;

-- Current retained sources are snapshots, not regenerated historical charges.
-- New additions still use the one shared normal planner and no catch-up.
create function public.invoice_edit_preview_state(p_invoice_id uuid,p_as_of_date date)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' set datestyle='ISO, YMD' as $$
declare v public.invoices%rowtype; base jsonb; retained jsonb; old_items jsonb; candidates jsonb;
begin
 select * into v from public.invoices where id=p_invoice_id;
 if not found or v.status='void' then raise exception using errcode='P0002',message='Editable invoice unavailable.';end if;
 base:=public.invoice_preview_state(v.customer_id,p_as_of_date);
 select coalesce(jsonb_agg(to_jsonb(i) order by i.position),'[]') into old_items from public.invoice_items i where i.invoice_id=v.id and i.superseded_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('candidate_id',encode(sha256(convert_to('keep:'||i.id::text,'UTF8')),'hex'),
   'source_type',i.source_type,'description',i.description,'quantity',i.quantity,'unit',i.unit,'unit_rate',i.unit_rate,'amount',i.amount,
   'tax_amount',i.tax_amount,'billed_minutes',i.billed_minutes,'existing_item_id',i.id,'retained',true) - case when i.billed_minutes is null then 'billed_minutes' else '__none' end order by i.position),'[]') into retained
 from public.invoice_items i where i.invoice_id=v.id and i.superseded_at is null and i.source_type<>'manual';
 candidates:=retained||(base->'candidates');
 return jsonb_build_object('as_of_date',p_as_of_date,'candidates',candidates,'revision',encode(sha256(convert_to(
   jsonb_build_object('invoice',to_jsonb(v),'items',old_items,'base',base->>'revision')::text,'UTF8')),'hex'));
end $$;
create function public.preview_invoice_edit(p_invoice_id uuid,p_as_of_date date)
returns table(as_of_date date,revision text,candidates jsonb)
language sql stable security invoker set search_path='' as $$
 with state as materialized(select public.invoice_edit_preview_state(p_invoice_id,p_as_of_date) s)
 select (s->>'as_of_date')::date,s->>'revision',coalesce((select jsonb_agg(e-array['existing_item_id','allocations','expected_amount'] order by ord)
 from jsonb_array_elements(s->'candidates') with ordinality j(e,ord)),'[]') from state;
$$;

create function public.update_composed_invoice(
 p_invoice_id uuid,p_issue_date date,p_as_of_date date,p_request_id uuid,p_revision text,
 p_selected_candidate_ids text[],p_custom_items jsonb,p_descriptions jsonb default '{}',p_notes text default null,p_terms text default null
) returns table(invoice_id uuid,invoice_number integer,issue_date date,due_date date,status text,subtotal numeric,tax_total numeric,total numeric)
language plpgsql security invoker set search_path='' as $$
declare v public.invoices%rowtype; saved public.invoice_edit_requests%rowtype; snapshot jsonb; payload jsonb;
 item jsonb; allocation jsonb; normalized_items jsonb:='[]'; quantity_value numeric;rate_value numeric;tax_value numeric;
 selected text[]; retained uuid[]; old_items jsonb; rid uuid:=p_invoice_id;line_id uuid;position_value integer:=0;actual_amount numeric;
begin
 if p_request_id is null or p_invoice_id is null or p_issue_date is null or not isfinite(p_issue_date) or p_as_of_date is null or not isfinite(p_as_of_date)
 or p_revision is null or p_selected_candidate_ids is null or array_position(p_selected_candidate_ids,null) is not null then raise exception using errcode='22023',message='Invoice, dates, revision and request are required.';end if;
 select coalesce(array_agg(distinct id order by id),'{}') into selected from unnest(p_selected_candidate_ids) id;
 if cardinality(selected)<>cardinality(p_selected_candidate_ids) then raise exception using errcode='22023',message='Duplicate selection.';end if;
 if p_descriptions is null or jsonb_typeof(p_descriptions)<>'object' or exists(select from jsonb_each(p_descriptions) e where jsonb_typeof(e.value)<>'string' or not (e.value#>>'{}' ~ '[^[:space:]]') or not e.key=any(selected)) then raise exception using errcode='22023',message='Invalid charge descriptions.';end if;
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


 if cardinality(selected)=0 and jsonb_array_length(normalized_items)=0 then raise exception using errcode='22023',message='Add or select at least one invoice item.';end if;
 payload:=jsonb_build_object('invoice',p_invoice_id,'issue_date',p_issue_date,'as_of_date',p_as_of_date,'revision',p_revision,'selected',selected,'items',normalized_items,'descriptions',p_descriptions,'notes',p_notes,'terms',p_terms);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,12120000));
 select * into saved from public.invoice_edit_requests where request_id=p_request_id;
 if found then
  if saved.payload is distinct from payload then raise exception using errcode='22023',message='Request ID was already used with different invoice data.';end if;
 else
  if exists(select from public.invoices where creation_request_id=p_request_id) or exists(select from public.invoice_generation_requests where request_id=p_request_id) then raise exception using errcode='22023',message='Request ID was already used.';end if;
  select * into v from public.invoices where id=p_invoice_id;
  if not found or v.status='void' then raise exception using errcode='P0002',message='Editable invoice unavailable.';end if;
  perform pg_advisory_xact_lock(hashtextextended(v.customer_id::text,13120000));
  perform 1 from public.customers where id=v.customer_id for update;
  perform id from public.customer_billing_agreements where customer_id=v.customer_id order by id for share;
  perform id from public.time_entries where customer_id=v.customer_id order by id for update;
  select * into v from public.invoices where id=p_invoice_id for update;
  snapshot:=public.invoice_edit_preview_state(p_invoice_id,p_as_of_date);
  if snapshot->>'revision' is distinct from p_revision then raise exception using errcode='P0001',message='STALE_INVOICE_PREVIEW: Invoice or billing data changed. Refresh before editing.';end if;
  if exists(select from unnest(selected) id where not exists(select from jsonb_array_elements(snapshot->'candidates') e where e->>'candidate_id'=id)) then raise exception using errcode='22023',message='Invalid selected charge.';end if;
  select coalesce(jsonb_agg(to_jsonb(i) order by position),'[]') into old_items from public.invoice_items i where i.invoice_id=rid and superseded_at is null;
  select coalesce(array_agg((e->>'existing_item_id')::uuid),'{}') into retained from jsonb_array_elements(snapshot->'candidates') e where e->>'candidate_id'=any(selected) and e ? 'existing_item_id';
  update public.invoices set status='draft',issue_date=p_issue_date,notes=p_notes,terms=p_terms where id=rid;
  update public.invoice_items set superseded_at=clock_timestamp() where invoice_items.invoice_id=rid and superseded_at is null and not(id=any(retained));
  -- Free current positions before reordering retained rows. Old superseded rows
  -- keep their original positions and immutable financial values.
  update public.invoice_items set position=position+1000000 where invoice_items.invoice_id=rid and superseded_at is null;
  for item in select value from jsonb_array_elements(snapshot->'candidates') where value->>'candidate_id'=any(selected) loop
   position_value:=position_value+1;
   item:=item||jsonb_build_object('description',coalesce(p_descriptions->>(item->>'candidate_id'),item->>'description'));
   if item ? 'existing_item_id' then
    update public.invoice_items set position=position_value,description=item->>'description' where id=(item->>'existing_item_id')::uuid;
   else
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

   end if;
  end loop;
  insert into public.invoice_items(invoice_id,position,description,quantity,unit,unit_rate,tax_amount,source_type)
   select rid,position_value+ordinality::integer,value->>'description',(value->>'quantity')::numeric,value->>'unit',(value->>'unit_rate')::numeric,(value->>'tax_amount')::numeric,'manual' from jsonb_array_elements(normalized_items) with ordinality;
  if exists(select from public.invoice_items i where i.invoice_id=rid and i.superseded_at is null and i.billed_minutes is not null
    and i.billed_minutes<>(select coalesce(sum(a.allocated_minutes),0) from public.invoice_time_allocations a where a.invoice_item_id=i.id and a.released_at is null)) then
    raise exception using errcode='23514',message='Time lines must exactly match their active allocations.';
  end if;
  insert into public.invoice_edit_requests(request_id,invoice_id,payload,previous_invoice,previous_items) values(p_request_id,rid,payload,to_jsonb(v),old_items);
 end if;
 return query select i.id,i.invoice_number,i.issue_date,i.due_date,i.status,t.subtotal,t.tax_amount,t.total from public.invoices i join public.invoice_totals t on t.invoice_id=i.id where i.id=rid;
exception when unique_violation or exclusion_violation or deadlock_detected then raise exception using errcode='40001',message='Invoice sources changed concurrently. Retry the same request.';
end $$;
revoke all on function public.invoice_edit_preview_state(uuid,date),public.preview_invoice_edit(uuid,date),public.update_composed_invoice(uuid,date,date,uuid,text,text[],jsonb,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.invoice_edit_preview_state(uuid,date),public.preview_invoice_edit(uuid,date),public.update_composed_invoice(uuid,date,date,uuid,text,text[],jsonb,jsonb,text,text) to authenticated;
revoke all on function public.guard_invoice_edit_history(),public.release_superseded_invoice_item() from public,anon,authenticated,service_role;

-- Preserve request UUID uniqueness across creation and edit workflows.
create function public.check_invoice_edit_key() returns trigger language plpgsql security invoker set search_path='' as $$
begin if new.creation_request_id is not null and exists(select from public.invoice_edit_requests where request_id=new.creation_request_id) then raise exception using errcode='22023',message='Request ID was already used for invoice editing.';end if;return new;end $$;
create trigger invoices_check_edit_key before insert on public.invoices for each row execute function public.check_invoice_edit_key();
revoke all on function public.check_invoice_edit_key() from public,anon,authenticated,service_role;
comment on column public.invoice_items.superseded_at is 'Retired by an edit, with financial values/history preserved. Only current rows contribute to totals; void preserves its last current composition.';
comment on table public.invoice_edit_requests is 'Immutable edit request intent and before-images. Legacy sent represents pre-delivery review, not delivery proof. Editing reopens it to draft and preserves its prior header here.';

create or replace function public.guard_invoice_generation_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select from public.invoice_edit_requests where request_id=new.request_id) then raise exception using errcode='22023',message='Request ID was already used for invoice editing.';end if;
  if tg_op <> 'INSERT' then raise exception using errcode='55000',message='Generation request history is immutable.'; end if;
  if new.invoice_id is not null and not exists(select from public.invoices i where i.id=new.invoice_id
    and i.customer_id=new.customer_id and i.creation_request_id=new.request_id
    and i.creation_request_payload=new.request_payload) then
    raise exception using errcode='23514',message='Generation result does not match its invoice.';
  end if;
  return new;
end $$;
