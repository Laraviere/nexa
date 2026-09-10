-- Persist original creation intent separately from later editable draft fields.
alter table public.invoices
  add column creation_request_id uuid,
  add column creation_request_payload jsonb,
  add constraint invoices_creation_request_unique unique (creation_request_id),
  add constraint invoices_creation_request_paired check (
    (creation_request_id is null and creation_request_payload is null)
    or (creation_request_id is not null and creation_request_payload is not null
      and jsonb_typeof(creation_request_payload) = 'object')
  );

create function public.protect_invoice_creation_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.creation_request_id,new.creation_request_payload) is distinct from
     row(old.creation_request_id,old.creation_request_payload) then
    raise exception using errcode = '55000', message = 'Invoice creation request metadata is immutable.';
  end if;
  return new;
end $$;
create trigger invoices_protect_creation_request before update on public.invoices
  for each row execute function public.protect_invoice_creation_request();
revoke all on function public.protect_invoice_creation_request() from public, anon, authenticated, service_role;

create function public.create_manual_invoice(
  p_customer_id uuid,
  p_issue_date date,
  p_items jsonb,
  p_request_id uuid,
  p_notes text default null,
  p_terms text default null
)
returns table (
  invoice_id uuid,
  invoice_number integer,
  issue_date date,
  due_date date,
  status text,
  company_name_snapshot text,
  subtotal numeric,
  tax_total numeric,
  total numeric
)
language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb; normalized_items jsonb := '[]'::jsonb; payload jsonb;
  quantity_value numeric; rate_value numeric; tax_value numeric;
  result_id uuid; original_payload jsonb;
begin
  if p_request_id is null or p_customer_id is null or p_issue_date is null or not isfinite(p_issue_date) then
    raise exception using errcode = '22023', message = 'Customer, finite issue date and request ID are required.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'Line items must be an array.';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 1000 then
    raise exception using errcode = '22023', message = 'Provide between 1 and 1000 manual line items.';
  end if;
  -- Reject protected/unknown properties, rather than silently ignoring them.
  -- Array order determines positions. Decimal strings or JSON numbers are
  -- accepted and normalized to equal numeric intent for retry comparisons.
  for item in select value from jsonb_array_elements(p_items) loop
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
  payload := jsonb_build_object('customer_id',p_customer_id,'issue_date',p_issue_date,
    'notes',p_notes,'terms',p_terms,'items',normalized_items);

  -- Serialize duplicate RPC requests without consuming another invoice number.
  -- Hash collisions only serialize unrelated keys; unique UUID storage remains
  -- authoritative. Higher-isolation stale snapshots may need a 40001 retry.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 12120000));
  select i.id,i.creation_request_payload into result_id,original_payload
    from public.invoices i where i.creation_request_id = p_request_id;
  if found then
    if original_payload is distinct from payload then
      raise exception using errcode = '22023', message = 'Request ID was already used with different invoice data.';
    end if;
  else
    perform 1 from public.customers c where c.id = p_customer_id for share;
    if not found then
      raise exception using errcode = 'P0002', message = 'Customer unavailable.';
    end if;
    -- Number, snapshots, terms and due date are filled by existing DB behavior.
    insert into public.invoices(customer_id,issue_date,notes,terms,creation_request_id,creation_request_payload)
      values(p_customer_id,p_issue_date,p_notes,p_terms,p_request_id,payload)
      returning id into result_id;
    insert into public.invoice_items(invoice_id,position,description,quantity,unit,unit_rate,tax_amount,source_type)
      select result_id,ordinality::integer, value->>'description', (value->>'quantity')::numeric,
        value->>'unit',(value->>'unit_rate')::numeric,(value->>'tax_amount')::numeric,'manual'
      from jsonb_array_elements(normalized_items) with ordinality;
  end if;
  return query select i.id,i.invoice_number,i.issue_date,i.due_date,i.status,i.company_name_snapshot,
    t.subtotal,t.tax_amount,t.total from public.invoices i
    join public.invoice_totals t on t.invoice_id=i.id where i.id=result_id;
exception
  when unique_violation then
    raise exception using errcode = '40001', message = 'Invoice request could not be completed. Retry the same request.';
  when check_violation or not_null_violation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Invoice creation failed validation. Check the date and manual line values.';
end $$;

revoke all on function public.create_manual_invoice(uuid,date,jsonb,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.create_manual_invoice(uuid,date,jsonb,uuid,text,text) to authenticated;
comment on column public.invoices.creation_request_id is 'Optional durable manual-creation idempotency UUID. Unique and immutable after insert; null for invoices created by other workflows.';
comment on column public.invoices.creation_request_payload is 'Immutable original normalized creation intent, including ordered lines and notes/terms. Compare retries against this, not mutable draft fields. No customer snapshots or computed totals are supplied by the caller.';
comment on function public.create_manual_invoice(uuid,date,jsonb,uuid,text,text) is 'Caller-RLS atomic manual draft creation. One to 1000 ordered manual items, no protected/source fields. Exact precision validation before insertion; table guards remain authoritative. Same request and normalized intent returns current persisted invoice/totals; changed intent is rejected. All writes roll back on failure; sequence gaps are allowed. Retries do not restore old draft content or undo finalization/voiding. No time/retainer allocation, editing or delivery.';
