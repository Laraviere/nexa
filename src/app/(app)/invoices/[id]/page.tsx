import { PageHeader, DocumentLines } from "@/components/ui/detail";
import { PageContainer } from "@/components/ui/page-container";
import { surfaceStyles, SectionHeading } from "@/components/ui/surface";
import { StatusBadge } from "@/components/ui/status-badge";
import { ButtonLink, ButtonAnchor } from "@/components/ui/button";
import { sourceQuote } from "@/lib/quotes/server";
import { invoicePayments } from "@/lib/payments/server";
import { RecordPayment } from "@/components/payments/record-payment";
import { PaymentHistory } from "@/components/payments/payment-history";
import Link from "next/link";
import { InvoiceStatus } from "@/components/invoices/invoice-status";
import { invoiceDetail } from "@/lib/invoices/server";
import { businessDate,formatBusinessDate,formatMoney } from "@/lib/billing/model";
import { units } from "@/lib/invoices/model";
export default async function InvoicePage({params}:{params:Promise<{id:string}>}) {
  const {invoice:v,items,totals} = await invoiceDetail((await params).id);
  const payments = await invoicePayments(v.id);
  const quote = await sourceQuote(v.id);
  const address = [v.billing_address_line1_snapshot,v.billing_address_line2_snapshot,[v.billing_city_snapshot,v.billing_state_snapshot,v.billing_postal_code_snapshot].filter(Boolean).join(", "),v.billing_country_snapshot].filter(Boolean);
  return <PageContainer width="document"><div className="nexa-detail-page"><Link href="/invoices" className="text-sm font-medium text-cyan-700">← Invoices</Link><PageHeader title={`Invoice #${v.invoice_number}`} context={v.company_name_snapshot} status={<><span className="inline-flex items-center gap-2"><span className="sr-only">Workflow: </span><StatusBadge domain="invoiceWorkflow" status={v.status}/></span><span className="inline-flex items-center gap-2"><span className="sr-only">Payment: </span><StatusBadge domain="invoicePayment" status={payments.summary.payment_status!}/></span></>} actions={<><ButtonAnchor variant="secondary" href={`/invoices/${v.id}/pdf`} target="_blank" rel="noopener noreferrer">View PDF<span className="sr-only"> (opens in a new tab)</span></ButtonAnchor>{v.status!=="void"&&<ButtonLink variant="secondary" href={`/invoices/${v.id}/edit`}>Edit Invoice</ButtonLink>}</>}/>
    {quote&&<p className="mb-5 text-sm text-slate-600">Created from <Link href={`/quotes/${quote.id}`} className="font-semibold text-cyan-700 underline">Quote Q-{quote.quote_number}</Link>.</p>}
    <article className={surfaceStyles("standard", "min-w-0")}><div className="grid gap-6 border-b border-slate-200 pb-6 sm:grid-cols-2"><section className="min-w-0 break-words"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Bill to</h2><p className="font-semibold">{v.company_name_snapshot}</p>{[v.primary_contact_name_snapshot,v.email_snapshot,v.phone_snapshot,...address].filter(Boolean).map((value,i)=><p key={i} className="mt-1 text-sm text-slate-600">{value}</p>)}</section><dl className="space-y-3 text-sm sm:text-right"><div><dt className="text-slate-500">Issue date</dt><dd className="mt-1 font-medium">{formatBusinessDate(v.issue_date)}</dd></div><div><dt className="text-slate-500">Due date</dt><dd className="mt-1 font-medium">{formatBusinessDate(v.due_date)}</dd></div></dl></div>
      <DocumentLines label="Invoice line items" lines={items.map(i=>({id:i.id,description:i.description,quantity:<>{new Intl.NumberFormat("en-US",{maximumFractionDigits:8}).format(i.quantity)} <span className="text-secondary">{units[i.unit as keyof typeof units]??i.unit}</span></>,rate:formatMoney(i.unit_rate),amount:formatMoney(i.amount),tax:i.tax_amount!==0?formatMoney(i.tax_amount):undefined}))}/>
      <dl className="nexa-financial-summary mt-5">{[["Subtotal",totals.subtotal],["Tax",totals.tax_amount],["Total",payments.summary.invoice_total]].map(([label,value])=><div key={label} className={label==="Total"?"nexa-document-total":"text-secondary"}><dt>{label==="Total"?"Invoice Total":label}</dt><dd className="min-w-0">{formatMoney(value as number)}</dd></div>)}</dl>
      <section aria-label="Invoice payment" className="ml-auto mt-5 max-w-lg border-t border-slate-200 pt-5">
        <div className="ml-auto max-w-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Payment</h2><StatusBadge domain="invoicePayment" status={payments.summary.payment_status!}/></div>
        <dl className="nexa-financial-summary mt-3">{[["Amount paid",payments.summary.amount_paid],["Balance due",payments.summary.balance_due]].map(([label,value])=><div key={label} className={label==="Balance due"?"nexa-balance":"text-secondary"}><dt>{label}</dt><dd className="min-w-0 font-semibold">{formatMoney(value as number)}</dd></div>)}</dl></div>
        {v.status==="draft"&&<p className="mt-3 text-xs text-slate-500">Payment recording becomes available once this invoice is marked Ready.</p>}
        {v.status==="void"&&<p className="mt-3 text-xs text-slate-500">Void invoice — payment history is retained; this balance is not collectible.</p>}
        <RecordPayment key={`${payments.owner}:${v.id}`} invoiceId={v.id} owner={payments.owner} balance={payments.summary.balance_due!} today={businessDate()} settings={payments.settings} canRecord={(v.status==="ready"||v.status==="sent")&&payments.summary.balance_due!>0}/>
      </section>
      {(v.notes||v.terms)&&<div className="nexa-detail-notes">{[["Notes",v.notes],["Terms",v.terms]].map(([label,value])=>value&&<section key={label} className="min-w-0"><SectionHeading>{label}</SectionHeading><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{value}</p></section>)}</div>}
    </article><InvoiceStatus key={v.status+v.updated_at} id={v.id} status={v.status} updatedAt={v.updated_at}/>{v.status==="sent"&&<p className="mt-3 text-sm text-slate-500">Recorded status; delivery has not been verified by Nexa.</p>}<PaymentHistory payments={payments.history}/></div></PageContainer>;
}
