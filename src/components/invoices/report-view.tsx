import { EmptyState } from "@/components/ui/feedback";
import { ListHeader, FilterToolbar, ListPagination } from "@/components/ui/list";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import Link from "next/link";
import type { getInvoiceReport } from "@/lib/invoices/report-server";
import { reportSorts,reportUrl } from "@/lib/invoices/report";
import { statuses } from "@/lib/invoices/model";
import { paymentStatuses } from "@/lib/payments/model";
import { formatMoney,formatBusinessDate } from "@/lib/billing/model";
const focus="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700";
const input="mt-1 block w-full min-w-0";
const date=(value:string)=>new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));
export function InvoiceReportView({data}:{data:Awaited<ReturnType<typeof getInvoiceReport>>}) {
  const {filters:{values},customers,customerMessage,report,message}=data;
  const selectedMissing=values.customer&&!customers.some(c=>c.id===values.customer);
  return <div className="nexa-list-workspace">
    <ListHeader title="Invoices" description="Invoice history, payments, and outstanding balances." action={<ButtonLink variant="primary" href="/invoices/new">New Invoice</ButtonLink>}/>
    {report&&<section aria-label="Filtered invoice summary" className="nexa-metrics">{[["Invoice count",String(report.summary.invoice_count)],["Total invoiced",formatMoney(report.summary.total_invoiced)],["Amount paid",formatMoney(report.summary.amount_paid)],["Outstanding",formatMoney(report.summary.outstanding_balance)]].map(([label,value])=><div key={label} ><h2 className="text-[13px] font-medium text-slate-500">{label}</h2><p className={`mt-0.5 break-words text-lg tabular-nums ${label==="Outstanding"?"font-bold":"font-medium"}`}>{value}</p></div>)}</section>}
    <FilterToolbar key={reportUrl(values,Number(values.page)||1)} action="/invoices" method="get" autoComplete="off" aria-label="Invoice filters">
      <div className="grid gap-2 sm:grid-cols-2 @min-[960px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.6fr)]">
        <label className="min-w-0 text-[13px] font-medium text-slate-600">Search<Input className={input} type="search" name="q" maxLength={500} defaultValue={values.q} placeholder="Search invoice # or customer"/></label>
        <label className="min-w-0 text-[13px] font-medium text-slate-600">Workflow<Select className={input} name="workflow" defaultValue={values.workflow}><option value="">All</option>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></label>
        <label className="min-w-0 text-[13px] font-medium text-slate-600">Payment status<Select className={input} name="payment" defaultValue={values.payment}><option value="">All</option>{Object.entries(paymentStatuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></label>
        <label className="min-w-0 text-[13px] font-medium text-slate-600">Customer<Select className={input} name="customer" defaultValue={values.customer}><option value="">All customers</option>{selectedMissing&&<option value={values.customer}>Selected customer unavailable</option>}{customers.map(c=><option key={c.id} value={c.id}>{`${c.company_name}${c.is_active?"":" (Archived)"}`}</option>)}</Select></label>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 @min-[960px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.6fr)]">
        <label className="min-w-0 text-[13px] font-medium text-slate-600">From<Input className={input} type="date" name="from" aria-label="Issue date From" defaultValue={values.from||""}/></label>
        <label className="min-w-0 text-[13px] font-medium text-slate-600">To<Input className={input} type="date" name="to" aria-label="Issue date To" defaultValue={values.to||""}/></label>
        <label className="min-w-0 text-[13px] font-medium text-slate-600">Sort<Select className={input} name="sort" defaultValue={values.sort}>{Object.entries(reportSorts).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></label>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 ">
          <label className="flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-slate-700"><input type="checkbox" name="overdue" value="1" defaultChecked={values.overdue==="1"} className="size-3.5 accent-cyan-700"/>Overdue only</label>
          <Button variant="secondary" className={` ${focus}`}>Apply</Button>
          <Link href="/invoices" className={`flex min-h-11 items-center whitespace-nowrap text-xs text-slate-600 hover:underline ${focus}`}>Clear filters</Link>
        </div>
      </div>
    </FilterToolbar>
    {customerMessage&&<p role="status" className="text-sm text-amber-800">{customerMessage}</p>}
    {message&&<div role="alert" className="rounded-xl border border-slate-200 bg-white p-5"><p className="font-medium">{message}</p><p className="mt-2 text-sm text-slate-600">Adjust the filters above or retry this view.</p><a href={reportUrl(values,Number(values.page)||1)} className={`mt-3 inline-block text-sm font-medium text-cyan-800 hover:underline ${focus}`}>Try again</a></div>}
    {report&&<>

      <div className="flex flex-wrap justify-between gap-x-5 gap-y-1 text-[13px] leading-4 text-slate-500">
        <details className="min-w-0"><summary className={`w-fit cursor-pointer hover:text-slate-700 ${focus}`}>About these totals</summary><p className="mt-1 max-w-xl">{values.workflow==="void"?"Historical Void amounts. Outstanding is zero; these balances are not collectible.":"Totals cover all matching invoices. Void invoices count, but their financial amounts are excluded."}</p></details>
        <p>As of {formatBusinessDate(report.summary.resolved_as_of_date)} · New York</p>
      </div>
      {!report.rows.length?<div className="nexa-empty"><EmptyState title="No invoices match these filters." action={<><ButtonLink href="/invoices">Clear filters</ButtonLink>{report.summary.total_rows>0&&<ButtonLink href={reportUrl(values)}>First page</ButtonLink>}</>}/></div>:<>
        <div className="nexa-table-frame" tabIndex={0} role="region" aria-label="Invoices table"><table aria-label="Invoice list" className="nexa-table"><caption className="sr-only">Invoices matching current filters</caption><colgroup><col className="w-[8%]"/><col className="w-[20%]"/><col className="w-[13%]"/><col className="w-[13%]"/><col className="w-[9%]"/><col className="w-[13%]"/><col className="w-[12%]"/><col className="w-[12%]"/></colgroup><thead className="border-b border-slate-200 text-slate-500"><tr>{["Invoice","Customer","Issue","Due","Workflow","Payment","Total","Balance"].map((label,i)=><th key={label} scope="col" className={`px-2 py-2 font-medium ${i>5?"text-right":""}`}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{report.rows.map(r=><tr key={r.invoice_id} className="h-12 align-middle hover:bg-slate-50"><td className="px-2 py-2"><Link className={`font-semibold text-cyan-800 hover:underline ${focus}`} href={`/invoices/${r.invoice_id}`}>#{r.invoice_number}</Link></td><td className="px-2 py-2"><Link className={`font-medium text-slate-900 hover:underline ${focus}`} href={`/invoices/${r.invoice_id}`}>{r.company_name_snapshot}</Link></td><td className="nexa-date text-slate-600">{date(r.issue_date)}</td><td className="nexa-date text-slate-600">{date(r.due_date)}{r.overdue&&<span className="mt-1 block font-medium text-amber-800">Overdue</span>}</td><td className="px-2 py-2"><StatusBadge domain="invoiceWorkflow" status={r.workflow_status}/></td><td className="px-2 py-2 text-slate-600">{<StatusBadge domain="invoicePayment" status={r.payment_status}/>}</td><td className="px-2 py-2 nexa-money">{formatMoney(r.invoice_total)}</td><td className="px-2 py-2 nexa-money font-semibold">{formatMoney(r.balance_due)}</td></tr>)}</tbody></table></div>
        <ul aria-label="Invoice cards" className="nexa-records">{report.rows.map(r=><li key={r.invoice_id}><Link href={`/invoices/${r.invoice_id}`} className={`nexa-record ${focus}`}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">Invoice #{r.invoice_number}</p><p className="mt-1 text-sm text-slate-700">{r.company_name_snapshot}</p></div>{r.overdue&&<span className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Overdue</span>}</div><p className="mt-3 text-xs text-slate-600">{<StatusBadge domain="invoiceWorkflow" status={r.workflow_status}/>} · {<StatusBadge domain="invoicePayment" status={r.payment_status}/>}</p><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Issue date</dt><dd className="mt-1">{date(r.issue_date)}</dd></div><div><dt className="text-xs text-slate-500">Due date</dt><dd className="mt-1">{date(r.due_date)}</dd></div></dl><dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm tabular-nums"><div className="flex flex-wrap justify-between gap-3"><dt className="text-slate-500">Total</dt><dd className="min-w-0 nexa-money">{formatMoney(r.invoice_total)}</dd></div><div className="flex flex-wrap justify-between gap-3"><dt className="text-slate-500">Balance</dt><dd className="min-w-0 nexa-money font-semibold">{formatMoney(r.balance_due)}</dd></div></dl></Link></li>)}</ul>
      </>}
      <ListPagination label="Invoice pages" previousHref={report.summary.page>1?reportUrl(values,report.summary.page-1):undefined} nextHref={report.summary.page<report.summary.total_pages?reportUrl(values,report.summary.page+1):undefined}>Showing {report.rows.length?(report.summary.page-1)*report.summary.page_size+1:0}–{report.rows.length?(report.summary.page-1)*report.summary.page_size+report.rows.length:0} of {report.summary.total_rows}{report.summary.total_pages>0&&` · Page ${report.summary.page} of ${report.summary.total_pages}`}</ListPagination>
    </>}
  </div>;
}
