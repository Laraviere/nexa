import { invoicePayments } from "@/lib/payments/server";
import { paymentStatuses } from "@/lib/payments/model";
import { RecordPayment } from "@/components/payments/record-payment";
import { PaymentHistory } from "@/components/payments/payment-history";
import Link from "next/link";
import { InvoiceStatus } from "@/components/invoices/invoice-status";
import { invoiceDetail } from "@/lib/invoices/server";
import { businessDate,formatBusinessDate,formatMoney } from "@/lib/billing/model";
import { statuses,units } from "@/lib/invoices/model";
export default async function InvoicePage({params}:{params:Promise<{id:string}>}) {
  const {invoice:v,items,totals} = await invoiceDetail((await params).id);
  const payments = await invoicePayments(v.id);
  const address = [v.billing_address_line1_snapshot,v.billing_address_line2_snapshot,[v.billing_city_snapshot,v.billing_state_snapshot,v.billing_postal_code_snapshot].filter(Boolean).join(", "),v.billing_country_snapshot].filter(Boolean);
  return <div className="mx-auto max-w-4xl"><Link href="/invoices" className="text-sm font-medium text-cyan-700">← Invoices</Link><header className="mb-6 mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3"><h1 className="break-words text-3xl font-semibold tracking-tight">Invoice #{v.invoice_number}</h1><span className="rounded-md bg-slate-100 ring-1 ring-slate-200 px-3 py-1 text-sm font-medium">{statuses[v.status as keyof typeof statuses]??v.status}</span></div>
      <div className="flex flex-col gap-3 sm:shrink-0 sm:flex-row">
        <a href={`/invoices/${v.id}/pdf`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-center font-semibold">View PDF<span className="sr-only"> (opens in a new tab)</span></a>
      {v.status!=="void"&&<Link href={`/invoices/${v.id}/edit`} className="shrink-0 rounded-lg border border-slate-300 bg-white px-5 py-3 text-center font-semibold">Edit Invoice</Link>}
      </div>
    </header>
    <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 sm:p-8"><div className="grid gap-6 border-b border-slate-200 pb-6 sm:grid-cols-2"><section className="min-w-0 break-words"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Bill to</h2><p className="font-semibold">{v.company_name_snapshot}</p>{[v.primary_contact_name_snapshot,v.email_snapshot,v.phone_snapshot,...address].filter(Boolean).map((value,i)=><p key={i} className="mt-1 text-sm text-slate-600">{value}</p>)}</section><dl className="space-y-3 text-sm sm:text-right"><div><dt className="text-slate-500">Issue date</dt><dd className="mt-1 font-medium">{formatBusinessDate(v.issue_date)}</dd></div><div><dt className="text-slate-500">Due date</dt><dd className="mt-1 font-medium">{formatBusinessDate(v.due_date)}</dd></div></dl></div>
      <section aria-label="Invoice line items" className="mt-5">
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_6rem_7rem_8rem] gap-4 border-b border-slate-200 pb-3 text-xs font-medium uppercase tracking-wide text-slate-500 sm:grid"><span>Description</span><span className="text-right">Qty / unit</span><span className="text-right">Rate</span><span className="text-right">Amount</span></div>
        {items.map(i=><div key={i.id} className="grid min-w-0 grid-cols-3 gap-3 border-b border-slate-100 py-5 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_8rem] sm:gap-4"><h2 className="col-span-3 min-w-0 whitespace-pre-wrap break-words font-medium sm:col-span-1">{i.description}</h2><div className="min-w-0 text-sm sm:text-right"><span className="mb-1 block text-xs text-slate-400 sm:sr-only">Quantity</span><p className="break-words">{new Intl.NumberFormat("en-US",{maximumFractionDigits:8}).format(i.quantity)} <span className="text-slate-500">{units[i.unit as keyof typeof units]??i.unit}</span></p></div><div className="min-w-0 text-right text-sm"><span className="mb-1 block text-xs text-slate-400 sm:sr-only">Rate</span><p className="break-all tabular-nums">{formatMoney(i.unit_rate)}</p></div><div className="min-w-0 text-right text-sm"><span className="mb-1 block text-xs text-slate-400 sm:sr-only">Amount</span><p className="break-all font-medium tabular-nums">{formatMoney(i.amount)}</p>{i.tax_amount!==0&&<p className="mt-1 text-xs text-slate-500">Tax {formatMoney(i.tax_amount)}</p>}</div></div>)}
      </section>
      <dl className="ml-auto max-w-sm space-y-3 border-t border-slate-200 pt-5 text-sm">{[["Subtotal",totals.subtotal],["Tax",totals.tax_amount],["Total",payments.summary.invoice_total]].map(([label,value])=><div key={label} className={`flex justify-between gap-4 ${label==="Total"?"text-xl font-semibold":"text-slate-600"}`}><dt>{label}</dt><dd className="min-w-0 break-all text-right tabular-nums">{formatMoney(value as number)}</dd></div>)}</dl>
      <section aria-label="Invoice payment" className="ml-auto mt-5 max-w-lg border-t border-slate-200 pt-5">
        <div className="ml-auto max-w-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Payment</h2><span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium">{paymentStatuses[payments.summary.payment_status as keyof typeof paymentStatuses]}</span></div>
        <dl className="mt-3 space-y-3 text-sm">{[["Amount paid",payments.summary.amount_paid],["Balance due",payments.summary.balance_due]].map(([label,value])=><div key={label} className="flex justify-between gap-4"><dt className="text-slate-600">{label}</dt><dd className="min-w-0 break-all font-medium tabular-nums">{formatMoney(value as number)}</dd></div>)}</dl></div>
        {v.status==="draft"&&<p className="mt-3 text-xs text-slate-500">Payment recording becomes available once this invoice is marked Ready.</p>}
        {v.status==="void"&&<p className="mt-3 text-xs text-slate-500">Void invoice — payment history is retained; this balance is not collectible.</p>}
        <RecordPayment key={`${payments.owner}:${v.id}`} invoiceId={v.id} owner={payments.owner} balance={payments.summary.balance_due!} today={businessDate()} settings={payments.settings} canRecord={(v.status==="ready"||v.status==="sent")&&payments.summary.balance_due!>0}/>
      </section>
      {(v.notes||v.terms)&&<div className="mt-8 grid gap-6 border-t border-slate-100 pt-6 sm:grid-cols-2">{[["Notes",v.notes],["Terms",v.terms]].map(([label,value])=>value&&<section key={label} className="min-w-0"><h2 className="text-sm font-semibold">{label}</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{value}</p></section>)}</div>}
    </article><InvoiceStatus key={v.status+v.updated_at} id={v.id} status={v.status} updatedAt={v.updated_at}/>{v.status==="sent"&&<p className="mt-3 text-sm text-slate-500">Recorded status; delivery has not been verified by Nexa.</p>}<PaymentHistory payments={payments.history}/></div>;
}
