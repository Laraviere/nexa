-- Reporting only: no changes to invoice/payment calculations or lifecycle.
create function public.get_invoice_report(
  p_search text default null,
  p_workflow_status text default null,
  p_payment_status text default null,
  p_customer_id uuid default null,
  p_issue_date_from date default null,
  p_issue_date_to date default null,
  p_overdue_only boolean default false,
  p_sort text default 'newest',
  p_page integer default 1,
  p_page_size integer default 25,
  p_as_of_date date default null
) returns table (
  resolved_as_of_date date,
  page integer,
  page_size integer,
  total_rows bigint,
  total_pages bigint,
  invoice_count bigint,
  total_invoiced numeric,
  amount_paid numeric,
  outstanding_balance numeric,
  rows jsonb
)
language plpgsql stable security invoker set search_path='' as $$
declare
  as_of_date date := coalesce(p_as_of_date,(now() at time zone 'America/New_York')::date);
  search_text text := nullif(regexp_replace(p_search,'^[[:space:]]+|[[:space:]]+$','','g'),'');
begin
  if p_workflow_status is not null and p_workflow_status not in ('draft','ready','sent','void') then
    raise exception using errcode='22023',message='Choose a supported invoice workflow status.';
  end if;
  if p_payment_status is not null and p_payment_status not in ('unpaid','partially_paid','paid') then
    raise exception using errcode='22023',message='Choose a supported payment status.';
  end if;
  if p_sort is null or p_sort not in ('newest','oldest','highest_balance') then
    raise exception using errcode='22023',message='Choose newest, oldest or highest_balance sorting.';
  end if;
  if p_page is null or p_page<1 or p_page_size is null or p_page_size<1 or p_page_size>100 then
    raise exception using errcode='22023',message='Page must be positive and page size must be between 1 and 100.';
  end if;
  if p_overdue_only is null then
    raise exception using errcode='22023',message='Overdue-only must be true or false.';
  end if;
  if not isfinite(as_of_date) or (p_issue_date_from is not null and not isfinite(p_issue_date_from))
    or (p_issue_date_to is not null and not isfinite(p_issue_date_to)) then
    raise exception using errcode='22023',message='Reporting dates must be finite dates.';
  end if;
  if p_issue_date_from>p_issue_date_to then
    raise exception using errcode='22023',message='Issue date From must be on or before To.';
  end if;
  if length(search_text)>500 then
    raise exception using errcode='22023',message='Search must be 500 characters or fewer.';
  end if;

  -- One statement and one materialized filtered set feed both totals and page.
  -- STABLE preserves the calling statement snapshot; no application-side sums.
  return query
  with filtered as materialized (
    select i.id as invoice_id,i.invoice_number,i.customer_id,i.company_name_snapshot,
      i.issue_date,i.due_date,i.status as workflow_status,s.payment_status,
      s.invoice_total,s.amount_paid,s.balance_due,
      (i.status<>'void' and s.balance_due>0 and i.due_date<as_of_date) as overdue
    from public.invoices i
    join public.invoice_payment_summary s on s.invoice_id=i.id
    where (search_text is null or i.invoice_number::text=search_text
        or strpos(lower(i.company_name_snapshot),lower(search_text))>0)
      and (p_workflow_status is null or i.status=p_workflow_status)
      and (p_payment_status is null or s.payment_status=p_payment_status)
      and (p_customer_id is null or i.customer_id=p_customer_id)
      and (p_issue_date_from is null or i.issue_date>=p_issue_date_from)
      and (p_issue_date_to is null or i.issue_date<=p_issue_date_to)
      and (not p_overdue_only or (i.status<>'void' and s.balance_due>0 and i.due_date<as_of_date))
  ), totals as (
    select count(*) as count_all,
      coalesce(sum(f.invoice_total) filter(where p_workflow_status='void' or f.workflow_status<>'void'),0::numeric) as invoiced,
      coalesce(sum(f.amount_paid) filter(where p_workflow_status='void' or f.workflow_status<>'void'),0::numeric) as paid,
      coalesce(sum(greatest(f.balance_due,0::numeric)) filter(where f.workflow_status<>'void'),0::numeric) as outstanding
    from filtered f
  ), paged as (
    select f.*,row_number() over(order by
      case when p_sort='highest_balance' then f.balance_due end desc,
      case when p_sort='oldest' then f.issue_date end asc,
      case when p_sort='oldest' then f.invoice_number end asc,
      case when p_sort<>'oldest' then f.issue_date end desc,
      case when p_sort<>'oldest' then f.invoice_number end desc
    ) as ordinal
    from filtered f
    order by ordinal
    limit p_page_size offset ((p_page::bigint-1)*p_page_size)
  )
  select as_of_date,p_page,p_page_size,t.count_all,(t.count_all+p_page_size-1)/p_page_size,
    t.count_all,t.invoiced,t.paid,t.outstanding,
    coalesce((select jsonb_agg(to_jsonb(p)-'ordinal' order by p.ordinal) from paged p),'[]'::jsonb)
  from totals t;
end $$;

revoke all on function public.get_invoice_report(text,text,text,uuid,date,date,boolean,text,integer,integer,date) from public,anon,authenticated,service_role;
grant execute on function public.get_invoice_report(text,text,text,uuid,date,date,boolean,text,integer,integer,date) to authenticated;
comment on function public.get_invoice_report(text,text,text,uuid,date,date,boolean,text,integer,integer,date) is
  'Read-only caller-RLS invoice report. Exact numeric totals and 1..100 page rows share one filtered statement snapshot. Count includes matching Void invoices; money excludes Void unless workflow filter is explicitly void, which returns historical invoiced/active-payment amounts and zero outstanding. Literal case-insensitive snapshot substring or exact invoice-number search. New York date default; no stored overdue state.';
