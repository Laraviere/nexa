import Link from "next/link";
import { invoiceList } from "@/lib/invoices/server";
import { statuses } from "@/lib/invoices/model";
import { formatBusinessDate,formatMoney } from "@/lib/billing/model";
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{status?:string;page?:string}> }) {
  const params = await searchParams;
  const status = params.status && Object.hasOwn(statuses,params.status) ? params.status : "all";
  const page = /^\d{1,6}$/.test(params.page??"") ? Math.max(1,Number(params.page)) : 1;
  const { rows,hasNext } = await invoiceList(status,page);
  return <><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight">Invoices</h1><p className="mt-2 text-slate-600">Invoices and their saved billing details.</p></div><Link className="rounded-lg bg-cyan-400 px-5 py-2.5 font-semibold" href="/invoices/new">New Invoice</Link></div>
    <nav aria-label="Invoice status" className="my-6 flex flex-wrap gap-2">{Object.entries({all:"All",...statuses}).map(([key,label])=><Link key={key} aria-current={status===key?"page":undefined} href={`/invoices?status=${key}`} className={`rounded-lg px-4 py-2 text-sm font-medium ${status===key?"bg-slate-900 text-white":"bg-white text-slate-600 ring-1 ring-slate-200"}`}>{label}</Link>)}</nav>
    <div aria-label="Invoice list" className="overflow-hidden rounded-xl border border-slate-200 bg-white">{!rows.length?<p className="p-6 text-slate-600">No invoices in this view.</p>:rows.map(r=><Link key={r.id} href={`/invoices/${r.id}`} className="grid gap-3 border-b border-slate-100 p-5 last:border-0 hover:bg-slate-50 sm:grid-cols-[1fr_1fr_auto]"><div className="min-w-0"><p className="font-semibold">Invoice #{r.invoice_number}</p><p className="break-words text-sm text-slate-600">{r.company_name_snapshot}</p></div><div className="text-sm text-slate-600"><p>Issued {formatBusinessDate(r.issue_date)}</p><p>Due {formatBusinessDate(r.due_date)}</p></div><div><span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium">{statuses[r.status as keyof typeof statuses]??r.status}</span><p className="mt-2 font-semibold tabular-nums">{formatMoney(r.total)}</p></div></Link>)}</div>
    <nav aria-label="Invoice pages" className="mt-5 flex justify-between text-sm font-medium text-cyan-700">{page>1?<Link href={`/invoices?status=${status}&page=${page-1}`}>Previous</Link>:<span/>}{hasNext&&<Link href={`/invoices?status=${status}&page=${page+1}`}>Next</Link>}</nav></>;
}
