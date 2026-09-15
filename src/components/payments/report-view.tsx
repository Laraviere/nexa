import { EmptyState } from "@/components/ui/feedback";
import { ListHeader, FilterToolbar, ListPagination } from "@/components/ui/list";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import Link from "next/link";
import type { getPaymentReport } from "@/lib/payments/report-server";
import { paymentReportUrl } from "@/lib/payments/report";
import { paymentMethods } from "@/lib/payments/model";
import { formatMoney,formatBusinessDate } from "@/lib/billing/model";
const input="mt-1 block w-full min-w-0";
const link="font-medium text-cyan-800 hover:underline focus-visible:outline-cyan-700";
export function PaymentReportView({data}:{data:Awaited<ReturnType<typeof getPaymentReport>>}) {
  const {filters:{values},customers,customerMessage,report,message}=data;
  return <div className="nexa-list-workspace">
    <ListHeader title="Payments" description="Recorded receipts and payment history." action={<ButtonLink variant="primary" href="/payments/new">Record Payment</ButtonLink>}/>
    {report&&<section aria-label="Filtered payment summary" className="nexa-metrics">{[["Payments Received",formatMoney(report.summary.payments_received)],["Payment Count",String(report.summary.payment_count)],["Average Payment",formatMoney(report.summary.average_payment)]].map(([label,value])=><div key={label} ><h2 className="text-xs font-medium text-slate-500">{label}</h2><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>)}</section>}
    <FilterToolbar key={paymentReportUrl(values,Number(values.page)||1)} action="/payments" method="get" aria-label="Payment filters">
      <div className="grid gap-3 sm:grid-cols-2 @min-[960px]:grid-cols-4">
        <label className="min-w-0 text-xs font-medium">Search<Input className={input} name="q" type="search" maxLength={500} defaultValue={values.q} placeholder="Invoice #, customer or reference"/></label>
        <label className="min-w-0 text-xs font-medium">Customer<Select className={input} name="customer" defaultValue={values.customer}><option value="">All customers</option>{values.customer&&!customers.some(c=>c.id===values.customer)&&<option value={values.customer}>Selected customer unavailable</option>}{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}{c.is_active?"":" (Archived)"}</option>)}</Select></label>
        <label className="min-w-0 text-xs font-medium">Method<Select className={input} name="method" defaultValue={values.method}><option value="">All methods</option>{Object.entries(paymentMethods).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></label>
        <label className="min-w-0 text-xs font-medium">Payment status<Select className={input} name="status" defaultValue={values.status}><option value="active">Active</option><option value="voided">Voided</option><option value="all">All payments</option></Select></label>
      </div>
      <div className="mt-3 grid items-end gap-3 sm:grid-cols-2 @min-[960px]:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-medium">Payment date From<Input className={input} name="from" type="date" defaultValue={values.from}/></label><label className="text-xs font-medium">Payment date To<Input className={input} name="to" type="date" defaultValue={values.to}/></label><div className="flex min-h-11 flex-wrap items-center gap-4"><Button variant="secondary">Apply</Button><Link className={`${link} text-xs`} href="/payments">Clear filters</Link></div></div>
    </FilterToolbar>
    {customerMessage&&<p role="status" className="text-sm text-amber-800">{customerMessage}</p>}
    {message&&<div role="alert" className="rounded-lg border border-slate-200 bg-white p-5"><p>{message}</p><a className={`${link} mt-3 inline-block text-sm`} href={paymentReportUrl(values,Number(values.page)||1)}>Try again</a></div>}
    {report&&<>

      <div className="text-[13px] text-slate-600"><p>{!values.from&&!values.to?"All payment dates":`Payment dates: ${values.from?formatBusinessDate(values.from):"All earlier dates"} – ${values.to?formatBusinessDate(values.to):"All later dates"}`}</p><details className="mt-1"><summary className="cursor-pointer">About these totals</summary><p className="mt-1 max-w-2xl">Totals include all matching active receipts, excluding voided payments and payments on Void invoices. These are receipts, not invoice totals or outstanding balances.</p></details></div>
      <p className="text-xs text-slate-500">For a correction, open an invoice’s payment history to void and replace the payment.</p>
      {!report.rows.length?<div className="nexa-empty"><EmptyState title="No payments match this view." action={<><ButtonLink href="/payments">Clear filters</ButtonLink>{report.summary.total_rows>0&&<ButtonLink href={paymentReportUrl(values)}>First page</ButtonLink>}</>}/></div>:<>
        <div className="nexa-table-frame" tabIndex={0} role="region" aria-label="Payments table"><table className="nexa-table" aria-label="Payment ledger"><caption className="sr-only">Payments matching current filters</caption><colgroup><col style={{width:"15%"}}/><col style={{width:"23%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:"20%"}}/><col style={{width:"12%"}}/><col style={{width:"14%"}}/></colgroup><thead className="border-b border-slate-200 text-slate-500"><tr>{["Payment date","Customer","Invoice","Method","Reference","Status","Amount"].map(label=><th className={`px-3 py-3 font-medium ${label==="Amount"?"text-right":""}`} scope="col" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{report.rows.map(r=><tr key={r.payment_id} className="hover:bg-slate-50"><td className="px-3 py-3">{formatBusinessDate(r.payment_date)}</td><td className="px-3 py-3"><Link className={link} href={`/customers/${r.customer_id}`}>{r.company_name_snapshot}</Link></td><td className="px-3 py-3"><Link className={link} href={`/invoices/${r.invoice_id}#payment-history`}>#{r.invoice_number}</Link></td><td className="px-3 py-3">{paymentMethods[r.payment_method as keyof typeof paymentMethods]}</td><td className="px-3 py-3">{r.reference||"—"}</td><td className="px-3 py-3"><StatusBadge domain="paymentRecord" status={r.payment_status}/>{r.invoice_status==="void"&&<span className="mt-1 block font-medium text-rose-800">Invoice Void</span>}</td><td className="px-3 py-3 nexa-money">{formatMoney(r.amount)}</td></tr>)}</tbody></table></div>
        <ul aria-label="Payment cards" className="nexa-records">{report.rows.map(r=><li key={r.payment_id} className="nexa-record"><div className="flex flex-wrap justify-between gap-3"><Link className={link} href={`/customers/${r.customer_id}`}>{r.company_name_snapshot}</Link><span className="nexa-money font-semibold">{formatMoney(r.amount)}</span></div><Link className={`${link} mt-2 inline-block`} href={`/invoices/${r.invoice_id}#payment-history`}>Invoice #{r.invoice_number} · Payment history</Link><p className="mt-2 text-xs text-slate-600">{formatBusinessDate(r.payment_date)} · {paymentMethods[r.payment_method as keyof typeof paymentMethods]} · {<StatusBadge domain="paymentRecord" status={r.payment_status}/>}</p>{r.reference&&<p className="mt-2 text-xs">Reference: {r.reference}</p>}{r.invoice_status==="void"&&<p className="mt-2 text-xs font-medium text-rose-800">Invoice Void</p>}</li>)}</ul>
      </>}
      <ListPagination label="Payment pages" previousHref={report.summary.page>1?paymentReportUrl(values,report.summary.page-1):undefined} nextHref={report.summary.page<report.summary.total_pages?paymentReportUrl(values,report.summary.page+1):undefined}>{report.summary.total_rows} ledger records{report.summary.total_pages>0&&` · Page ${report.summary.page} of ${report.summary.total_pages}`}</ListPagination>
    </>}
  </div>;
}
