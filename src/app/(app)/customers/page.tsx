import { ListHeader, FilterToolbar, ListPagination } from "@/components/ui/list";
import { EmptyState } from "@/components/ui/feedback";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import Link from "next/link";
import { CustomerStatus } from "@/components/customers/customer-status";
import { customerClient } from "@/lib/customers/server";
import { paymentTermsLabel } from "@/lib/customers/validation";

const pageSize = 25;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const status = params.status === "archived" || params.status === "all" ? params.status : "active";
  const requestedPage = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  const supabase = await customerClient();
  let query = supabase.from("customers").select("id,company_name,primary_contact_name,email,phone,default_payment_terms_days,is_active", { count: "exact" });
  if (status !== "all") query = query.eq("is_active", status === "active");
  if (search) {
    // Quote PostgREST filter syntax and escape SQL LIKE wildcards.
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const quoted = `"${pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    query = query.or(`company_name.ilike.${quoted},primary_contact_name.ilike.${quoted}`);
  }
  const { data: customers, count, error } = await query.order("company_name").order("id").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error("Unable to load customers.");
  function pageHref(target: number) {
    const query = new URLSearchParams({ status, page: String(target) });
    if (search) query.set("q", search);
    return `/customers?${query}`;
  }
  return <div className="nexa-list-workspace">
    <ListHeader title="Customers" description="Manage contacts, billing details, and payment terms." action={<ButtonLink variant="primary" href="/customers/new">Add customer</ButtonLink>}/>
    <FilterToolbar aria-label="Customer filters" className="nexa-filter-row" action="/customers">
      <div className="flex-1"><label htmlFor="search" className="mb-2 block text-sm font-medium">Search customers</label><Input key={search} id="search" name="q" type="search" maxLength={200} defaultValue={search} placeholder="Company or primary contact" className="w-full" /></div>
      <div><label htmlFor="status" className="mb-2 block text-sm font-medium">Status</label><Select key={status} id="status" name="status" defaultValue={status} className="w-full"><option value="active">Active</option><option value="archived">Archived / inactive</option><option value="all">All customers</option></Select></div>
      <Button variant="secondary">Apply filters</Button>
      {(search || status !== "active") && <Link href="/customers" className="px-2 py-2.5 text-sm font-medium text-cyan-700">Reset</Link>}
    </FilterToolbar>
    <p className="mb-3 text-sm text-slate-500">{count ?? 0} {(count ?? 0) === 1 ? "customer" : "customers"}{status === "active" ? " · Active" : status === "archived" ? " · Archived" : " · All statuses"}</p>
    {customers?.length ? <>
      <div className="nexa-table-frame" tabIndex={0} role="region" aria-label="Customers table"><table className="nexa-table"><caption className="sr-only">Customers matching current filters</caption><colgroup><col style={{width:"28%"}}/><col style={{width:"19%"}}/><col style={{width:"26%"}}/><col style={{width:"15%"}}/><col style={{width:"12%"}}/></colgroup><thead><tr>{["Customer","Primary contact","Contact details","Payment terms","Status"].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{customers.map(customer=><tr key={customer.id}><td style={{whiteSpace:"normal"}}><Link className="nexa-list-link" href={`/customers/${customer.id}`}>{customer.company_name}</Link></td><td>{customer.primary_contact_name||"—"}</td><td className="text-secondary"><p>{customer.email||"—"}</p>{customer.phone&&<p className="mt-1 text-[13px]">{customer.phone}</p>}</td><td>{paymentTermsLabel(customer.default_payment_terms_days)}</td><td><CustomerStatus active={customer.is_active}/></td></tr>)}</tbody></table></div>
      <ul className="nexa-records" aria-label="Customer cards">{customers.map(customer=><li key={customer.id}><Link href={`/customers/${customer.id}`} className="nexa-record"><div className="nexa-record-heading"><strong>{customer.company_name}</strong><CustomerStatus active={customer.is_active}/></div><p className="mt-2 text-secondary">{customer.primary_contact_name||"No primary contact"}</p><div className="nexa-record-meta">{customer.email&&<span>{customer.email}</span>}{customer.phone&&<span>{customer.phone}</span>}</div><p className="mt-2 text-[13px] text-secondary">Payment terms: {paymentTermsLabel(customer.default_payment_terms_days)}</p></Link></li>)}</ul>
    </> : <div className="nexa-empty"><EmptyState title={search ? "No matching customers" : status === "archived" ? "No archived customers" : status === "all" ? "No customers yet" : "No active customers"} description={search || page > 1 ? "Try another search or return to the first page." : status === "archived" ? "Customers you archive will appear here." : "Add a customer to get started, or use the status filter to find archived customers."}/><Link href={search || page > 1 ? "/customers" : "/customers/new"} className="mt-5 inline-block text-sm font-semibold text-cyan-700">{search || page > 1 ? "View active customers" : "Add customer"}</Link></div>}
    <ListPagination label="Customer pages" previousHref={page>1?pageHref(page-1):undefined} nextHref={page*pageSize<(count??0)?pageHref(page+1):undefined}>{count??0} customers · Page {page}{(count??0)>0&&` of ${Math.ceil((count??0)/pageSize)}`}</ListPagination>
  </div>;
}
