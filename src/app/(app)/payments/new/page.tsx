import { PageHeader } from "@/components/ui/detail";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeading, surfaceStyles } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import Link from "next/link";
import { paymentSelection } from "@/lib/payments/record-server";
import type { ReportParams } from "@/lib/payments/report";
import { RecordPayment } from "@/components/payments/record-payment";
import { businessDate,formatMoney } from "@/lib/billing/model";
const input="mt-2 block w-full min-w-0";
export default async function NewPaymentPage({searchParams}:{searchParams:Promise<ReportParams>}) {
  const data=await paymentSelection(await searchParams);
  const {selected}=data;
  return <PageContainer width="form"><div className="nexa-form-page space-y-6"><div><Link href="/payments" className="text-sm font-medium text-cyan-800 hover:underline">← Payments</Link><PageHeader title="Record Payment" context="Choose a customer and an invoice with a balance due." status={null} actions={null}/></div>
    <section className={surfaceStyles("standard", "space-y-5")}>
      <form action="/payments/new" method="get"><SectionHeading className="mb-3">1. Select customer</SectionHeading><label className="block text-sm font-medium">Customer<Select key={data.customer} className={input} name="customer" defaultValue={data.customer} required><option value="">Choose a customer</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.company_name}{c.is_active?"":" (Archived)"}</option>)}</Select></label><Button variant="secondary" className="mt-3">Choose customer</Button></form>
      {data.customer&&<form action="/payments/new" method="get" className="border-t border-slate-100 pt-5"><SectionHeading className="mb-3">2. Select eligible invoice</SectionHeading><input type="hidden" name="customer" value={data.customer}/><label className="block text-sm font-medium">Invoice<Select key={`${data.customer}:${data.invoiceId}`} className={input} name="invoice" defaultValue={data.invoices.some(i=>i.id===data.invoiceId)?data.invoiceId:""} required><option value="">Choose an invoice</option>{data.invoices.map(i=><option key={i.id} value={i.id}>#{i.invoice_number} — {formatMoney(i.balance_due)} due</option>)}</Select></label><p className="mt-2 text-xs text-slate-500">Only Ready or Sent invoices with a positive balance are available.</p>{data.invoices.length?<Button variant="secondary" className="mt-3">Choose invoice</Button>:<p className="mt-3 text-sm">This customer has no eligible invoices.</p>}</form>}
    </section>
    {selected&&<section className={surfaceStyles()}><SectionHeading className="mb-3">3. Review invoice</SectionHeading><h3 className="font-semibold"><Link href={`/invoices/${selected.invoice.id}`} className="text-cyan-800 hover:underline">Invoice #{selected.invoice.invoice_number}</Link></h3><dl className="nexa-payment-review">{[["Invoice total",selected.summary.invoice_total],["Amount paid",selected.summary.amount_paid],["Balance due",selected.summary.balance_due]].map(([label,value])=><div key={String(label)} className={label==="Balance due"?"nexa-payment-balance":""}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{formatMoney(Number(value))}</dd></div>)}</dl>{!selected.canRecord&&<p className="mt-4 text-sm text-slate-600">This invoice cannot receive a new payment. Any pending submission can still be confirmed safely.</p>}<SectionHeading className="mt-6 border-t border-structural pt-4">4. Enter and record payment</SectionHeading><RecordPayment key={selected.invoice.id} invoiceId={selected.invoice.id} owner={data.owner} balance={selected.summary.balance_due!} today={businessDate()} settings={selected.settings} canRecord={selected.canRecord}/></section>}
  </div></PageContainer>;
}
