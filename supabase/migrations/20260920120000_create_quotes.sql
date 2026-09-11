-- Quotes are independent commercial proposals, never invoice source claims.
-- Ordered lines are stored as one normalized JSON snapshot: header, lines and
-- totals can be read atomically and accepted proposals cannot be partially edited.
create function public.normalize_quote_items(p_items jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare item jsonb; result jsonb := '[]'; q numeric; r numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode='22023', message='Quote items must be an array.';
  end if;
  if jsonb_array_length(p_items) not between 1 and 1000 then
    raise exception using errcode='22023', message='Provide 1 to 1000 quote items.';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object' or item - array['description','quantity','unit','unit_rate'] <> '{}'::jsonb
      or jsonb_typeof(item->'description') is distinct from 'string'
      or not ((item->>'description') ~ '[^[:space:]]')
      or coalesce(item->>'unit','') not in ('hour','minute','flat','each','mile','month','custom')
      or coalesce(jsonb_typeof(item->'quantity'),'null') not in ('number','string')
      or coalesce(jsonb_typeof(item->'unit_rate'),'null') not in ('number','string') then
      raise exception using errcode='22023', message='Invalid quote line.';
    end if;
    q := (item->>'quantity')::numeric; r := (item->>'unit_rate')::numeric;
    if not (q>0 and q<1000000000000 and q=trunc(q,8))
      or not (r>=0 and r<10000000000 and r=trunc(r,2)) then
      raise exception using errcode='22023', message='Invalid quote quantity or rate.';
    end if;
    -- Decimal strings preserve exact input through JS edits and conversion.
    result := result || jsonb_build_array(jsonb_build_object('description',item->>'description',
      'quantity',q::text,'unit',item->>'unit','unit_rate',r::text,'amount',round(q*r,2)::text));
  end loop;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023', message='Invalid quote numeric value.';
end $$;
create function public.quote_items_total(p_items jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select coalesce(sum((value->>'amount')::numeric),0) from jsonb_array_elements(p_items)
$$;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number integer generated always as identity (start with 1001) unique not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  company_name_snapshot text not null,
  customer_snapshot jsonb not null check(jsonb_typeof(customer_snapshot)='object'),
  quote_date date not null check(isfinite(quote_date)),
  expiration_date date check(expiration_date is null or (isfinite(expiration_date) and expiration_date>=quote_date)),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 1000),
  subtotal numeric generated always as (public.quote_items_total(items)) stored,
  total numeric generated always as (public.quote_items_total(items)) stored,
  notes text,
  terms text,
  status text not null default 'draft' check(status in ('draft','sent','accepted','declined','expired')),
  converted_invoice_id uuid unique references public.invoices(id) on delete restrict,
  conversion_request_id uuid not null unique default gen_random_uuid(),
  revision integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(converted_invoice_id is null or status='accepted')
);
create index quotes_customer_date_idx on public.quotes(customer_id,quote_date desc);
create index quotes_date_idx on public.quotes(quote_date desc,id);
create table public.quote_write_requests (
  request_id uuid primary key,
  quote_id uuid not null references public.quotes(id) on delete restrict,
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.quotes enable row level security;
alter table public.quote_write_requests enable row level security;
create policy quotes_authenticated_select on public.quotes for select to authenticated using(true);
-- Existing Nexa authorization is a shared internal authenticated workspace.
-- Quote writes are RPC-only; narrow definer entry points protect accepted
-- snapshots, numbering and conversion links from direct table modifications.
revoke all on public.quotes, public.quote_write_requests from public,anon,authenticated;
grant select on public.quotes to authenticated;
revoke all on sequence public.quotes_quote_number_seq from public,anon,authenticated;

create function public.save_quote(
 p_customer_id uuid,p_quote_date date,p_items jsonb,p_request_id uuid,
 p_expiration_date date default null,p_notes text default null,p_terms text default null,
 p_quote_id uuid default null,p_revision integer default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare normalized jsonb; payload jsonb; prior public.quote_write_requests%rowtype;
 c public.customers%rowtype; q public.quotes%rowtype; result_id uuid;
begin
 if p_request_id is null or p_quote_date is null or not isfinite(p_quote_date)
   or (p_expiration_date is not null and (not isfinite(p_expiration_date) or p_expiration_date<p_quote_date)) then
   raise exception using errcode='22023',message='Check quote dates and request ID.';
 end if;
 normalized := public.normalize_quote_items(p_items);
 payload := jsonb_build_object('customer',p_customer_id,'date',p_quote_date,'expiration',p_expiration_date,
   'items',normalized,'notes',p_notes,'terms',p_terms,'quote',p_quote_id,'revision',p_revision);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,20120000));
 select * into prior from public.quote_write_requests where request_id=p_request_id;
 if found then
   if prior.payload is distinct from payload then raise exception using errcode='22023',message='Request ID reused with different quote data.'; end if;
   return prior.quote_id;
 end if;
 if p_quote_id is null then
   select * into c from public.customers where id=p_customer_id for share;
   if not found then raise exception using errcode='P0002',message='Customer unavailable.'; end if;
   insert into public.quotes(customer_id,company_name_snapshot,customer_snapshot,quote_date,expiration_date,items,notes,terms)
   values(c.id,c.company_name,jsonb_build_object('primary_contact_name',c.primary_contact_name,'email',c.email,'phone',c.phone,
    'billing_address_line1',c.billing_address_line1,'billing_address_line2',c.billing_address_line2,
    'billing_city',c.billing_city,'billing_state',c.billing_state,'billing_postal_code',c.billing_postal_code,'billing_country',c.billing_country),
    p_quote_date,p_expiration_date,normalized,p_notes,p_terms) returning id into result_id;
 else
   select * into q from public.quotes where id=p_quote_id for update;
   if not found then raise exception using errcode='P0002',message='Quote unavailable.'; end if;
   if q.revision is distinct from p_revision then raise exception using errcode='40001',message='Quote changed. Refresh before editing.'; end if;
   if q.status<>'draft' or q.converted_invoice_id is not null or q.customer_id is distinct from p_customer_id then
     raise exception using errcode='55000',message='Only unconverted drafts can be edited; customer cannot change.';
   end if;
   update public.quotes set quote_date=p_quote_date,expiration_date=p_expiration_date,items=normalized,
     notes=p_notes,terms=p_terms,revision=revision+1,updated_at=clock_timestamp() where id=q.id;
   result_id := q.id;
 end if;
 insert into public.quote_write_requests values(p_request_id,result_id,payload,clock_timestamp());
 return result_id;
end $$;

create function public.change_quote_status(p_quote_id uuid,p_status text,p_revision integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare q public.quotes%rowtype; today date := (now() at time zone 'America/New_York')::date;
begin
 select * into q from public.quotes where id=p_quote_id for update;
 if not found then raise exception using errcode='P0002',message='Quote unavailable.'; end if;
 if q.revision is distinct from p_revision then raise exception using errcode='40001',message='Quote changed. Refresh before changing status.'; end if;
 if q.converted_invoice_id is not null then raise exception using errcode='55000',message='Converted quotes are historical and cannot change.'; end if;
 if p_status is null or p_status not in ('draft','sent','accepted','declined') then raise exception using errcode='22023',message='Invalid quote status.'; end if;
 -- Accepted/declined quotes retain their decision; reopen as Draft to revise.
 if q.status in ('accepted','declined','expired') and p_status<>'draft' then
   raise exception using errcode='55000',message='Move the quote to Draft before changing its decision.';
 end if;
 if p_status in ('sent','accepted') and q.expiration_date<today then
   raise exception using errcode='22023',message='Quote has expired. Move to Draft and revise its expiration date.';
 end if;
 update public.quotes set status=p_status,revision=revision+1,updated_at=clock_timestamp() where id=q.id;
 return q.id;
end $$;

create function public.convert_quote_to_invoice(p_quote_id uuid,p_issue_date date,p_revision integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare q public.quotes%rowtype; result_id uuid; lines jsonb;
begin
 select * into q from public.quotes where id=p_quote_id for update;
 if not found then raise exception using errcode='P0002',message='Quote unavailable.'; end if;
 -- Retry (including simultaneous clicks) returns the original invoice, forever.
 if q.converted_invoice_id is not null then return q.converted_invoice_id; end if;
 if q.revision is distinct from p_revision then raise exception using errcode='40001',message='Quote changed. Refresh before conversion.'; end if;
 if q.status<>'accepted' then raise exception using errcode='55000',message='Only accepted quotes can be converted.'; end if;
 select jsonb_agg(value-'amount' order by ordinality) into lines from jsonb_array_elements(q.items) with ordinality;
 select invoice_id into result_id from public.create_manual_invoice(q.customer_id,p_issue_date,lines,q.conversion_request_id,q.notes,q.terms);
 -- Existing invoice trigger supplies its own customer/payment-term snapshots,
 -- due date and next normal invoice number. All amounts use the same rounding.
 update public.quotes set converted_invoice_id=result_id,revision=revision+1,updated_at=clock_timestamp() where id=q.id;
 return result_id;
end $$;

revoke all on function public.normalize_quote_items(jsonb), public.quote_items_total(jsonb),
 public.save_quote(uuid,date,jsonb,uuid,date,text,text,uuid,integer),
 public.change_quote_status(uuid,text,integer), public.convert_quote_to_invoice(uuid,date,integer)
 from public,anon,authenticated;
grant execute on function public.save_quote(uuid,date,jsonb,uuid,date,text,text,uuid,integer),
 public.change_quote_status(uuid,text,integer), public.convert_quote_to_invoice(uuid,date,integer) to authenticated;
comment on table public.quotes is 'Internal proposals. Display number is Q- plus independent identity. Ordered normalized line snapshots, exact numeric totals, optional inclusive expiration date. Accepted decisions survive expiration. Converted quotes are retained unchanged; writes only through authenticated RPCs.';
