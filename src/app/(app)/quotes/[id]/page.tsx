import { PageHeader, DocumentLines } from "@/components/ui/detail";
import { PageContainer } from "@/components/ui/page-container";
import { surfaceStyles, SectionHeading } from "@/components/ui/surface";
import { StatusBadge } from "@/components/ui/status-badge";
import { ButtonLink, ButtonAnchor } from "@/components/ui/button";
import Link from "next/link";
import { quoteDetail } from "@/lib/quotes/server";
import { customerClient } from "@/lib/customers/server";
import { quoteContact,quoteLines,quoteStatus } from "@/lib/quotes/model";
import { businessDate,formatBusinessDate,formatMoney } from "@/lib/billing/model";
import { QuoteActions } from "@/components/quotes/quote-actions";
export default async function QuotePage({params}:{params:Promise<{id:string}>}) {
 const q=await quoteDetail((await params).id);const today=businessDate();
 let invoiceNumber:number|undefined;
 if(q.converted_invoice_id){const client=await customerClient();const r=await client.from("invoices").select("invoice_number").eq("id",q.converted_invoice_id).single();if(r.error)throw new Error("Unable to load converted invoice.");invoiceNumber=r.data.invoice_number;}
 return <PageContainer width="document"><div className="nexa-detail-page"><Link href="/quotes" className="text-sm font-medium text-cyan-700">← Quotes</Link>
 <PageHeader title={`Quote Q-${q.quote_number}`} context={q.company_name_snapshot} status={<StatusBadge domain="quote" status={quoteStatus(q,today)}/>} actions={<><ButtonAnchor variant="secondary" href={`/quotes/${q.id}/pdf`} target="_blank" rel="noopener noreferrer">View PDF<span className="sr-only"> (opens in a new tab)</span></ButtonAnchor>{q.status==="draft"&&!q.converted_invoice_id&&<ButtonLink variant="secondary" href={`/quotes/${q.id}/edit`}>Edit Quote</ButtonLink>}</>}/>
 {q.converted_invoice_id&&<p className="mb-5 text-sm text-secondary">Converted to <Link className="font-semibold text-cyan-800 underline" href={`/invoices/${q.converted_invoice_id}`}>Invoice #{invoiceNumber}</Link>. The accepted quote is preserved.</p>}
 <article className={surfaceStyles("standard", "min-w-0")}><div className="grid gap-6 border-b border-slate-200 pb-6 sm:grid-cols-2"><section className="min-w-0 break-words"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Prepared for</h2><p className="font-semibold">{q.company_name_snapshot}</p>{quoteContact(q).map((v,i)=><p key={i} className="mt-1 text-sm text-slate-600">{v}</p>)}</section><dl className="space-y-3 text-sm sm:text-right"><div><dt className="text-slate-500">Quote date</dt><dd className="mt-1 font-medium">{formatBusinessDate(q.quote_date)}</dd></div>{q.expiration_date&&<div><dt className="text-slate-500">Valid through</dt><dd className="mt-1 font-medium">{formatBusinessDate(q.expiration_date)}</dd></div>}</dl></div>
 <DocumentLines label="Quote line items" lines={quoteLines(q.items).map((i,index)=>({id:String(index),description:i.description,quantity:<>{i.quantity} {i.unit}</>,rate:formatMoney(Number(i.unit_rate)),amount:formatMoney(Number(i.amount))}))}/>
 <dl className="nexa-financial-summary mt-5">{[["Subtotal",q.subtotal],["Total",q.total]].map(([label,value])=><div key={label} className={label==="Total"?"nexa-document-total":"text-secondary"}><dt>{label==="Total"?"Quote Total":label}</dt><dd className="font-semibold tabular-nums">{formatMoney(Number(value))}</dd></div>)}</dl>
 <div className="nexa-detail-notes">{[["Notes",q.notes],["Terms",q.terms]].map(([label,value])=>value&&<section key={label} className="min-w-0"><SectionHeading>{label}</SectionHeading><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{value}</p></section>)}</div></article>
 <QuoteActions key={q.revision} quote={q} today={today}/></div></PageContainer>;
}
