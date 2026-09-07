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
  return <>
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">Your customers</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Customers</h1><p className="mt-2 text-slate-600">Manage contacts, billing details, and payment terms.</p></div><Link href="/customers/new" className="rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800">Add customer</Link></div>
    <form className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end" action="/customers">
      <div className="flex-1"><label htmlFor="search" className="mb-2 block text-sm font-medium">Search customers</label><input key={search} id="search" name="q" type="search" maxLength={200} defaultValue={search} placeholder="Company or primary contact" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-600/20" /></div>
      <div><label htmlFor="status" className="mb-2 block text-sm font-medium">Status</label><select key={status} id="status" name="status" defaultValue={status} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"><option value="active">Active</option><option value="archived">Archived / inactive</option><option value="all">All customers</option></select></div>
      <button className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700">Apply filters</button>
      {(search || status !== "active") && <Link href="/customers" className="px-2 py-2.5 text-sm font-medium text-cyan-700">Reset</Link>}
    </form>
    <p className="mb-3 text-sm text-slate-500">{count ?? 0} {(count ?? 0) === 1 ? "customer" : "customers"}{status === "active" ? " · Active" : status === "archived" ? " · Archived" : " · All statuses"}</p>
    {customers?.length ? <ul className="space-y-3">{customers.map((customer) => <li key={customer.id}><Link href={`/customers/${customer.id}`} className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-600"><div className="flex items-start justify-between gap-4"><h2 className="min-w-0 break-words font-semibold text-slate-950">{customer.company_name}</h2><CustomerStatus active={customer.is_active} /></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">{[["Primary contact", customer.primary_contact_name], ["Email", customer.email], ["Phone", customer.phone], ["Payment terms", paymentTermsLabel(customer.default_payment_terms_days)]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-700">{value || "—"}</dd></div>)}</dl></Link></li>)}</ul> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center"><h2 className="text-lg font-semibold">{search ? "No matching customers" : status === "archived" ? "No archived customers" : status === "all" ? "No customers yet" : "No active customers"}</h2><p className="mt-2 text-sm text-slate-600">{search || page > 1 ? "Try another search or return to the first page." : status === "archived" ? "Customers you archive will appear here." : "Add a customer to get started, or use the status filter to find archived customers."}</p><Link href={search || page > 1 ? "/customers" : "/customers/new"} className="mt-5 inline-block text-sm font-semibold text-cyan-700">{search || page > 1 ? "View active customers" : "Add customer"}</Link></div>}
    {(page > 1 || (count ?? 0) > pageSize) && <nav aria-label="Customer pages" className="mt-6 flex items-center justify-between text-sm">{page > 1 ? <Link href={pageHref(page - 1)} className="font-medium text-cyan-700">← Previous</Link> : <span />}<span className="text-slate-500">Page {page}</span>{page * pageSize < (count ?? 0) ? <Link href={pageHref(page + 1)} className="font-medium text-cyan-700">Next →</Link> : <span />}</nav>}
  </>;
}
