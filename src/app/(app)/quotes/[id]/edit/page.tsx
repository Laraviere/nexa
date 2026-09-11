import Link from "next/link";
import { randomUUID } from "node:crypto";
import { quoteDetail } from "@/lib/quotes/server";
import { quoteLines } from "@/lib/quotes/model";
import { invoiceCustomers } from "@/lib/invoices/server";
import { QuoteForm } from "@/components/quotes/quote-form";
import { businessDate } from "@/lib/billing/model";
export default async function EditQuotePage({params}:{params:Promise<{id:string}>}) {
 const q=await quoteDetail((await params).id);const {customers,owner}=await invoiceCustomers();
 return <div className="mx-auto max-w-4xl"><Link href={`/quotes/${q.id}`} className="text-sm font-medium text-cyan-700">← Q-{q.quote_number}</Link><h1 className="mt-4 text-3xl font-semibold tracking-tight">Edit Quote</h1>{q.status!=="draft"||q.converted_invoice_id?<p className="mt-5">Only unconverted Draft quotes can be edited. Return to the quote to review its status.</p>:<QuoteForm customers={customers} owner={owner} today={businessDate()} requestId={randomUUID()} initial={{customer_id:q.customer_id,issue_date:q.quote_date,expiration_date:q.expiration_date??"",notes:q.notes??"",terms:q.terms??"",quote_id:q.id,revision:q.revision,items:quoteLines(q.items).map(({description,quantity,unit,unit_rate})=>({description,quantity,unit,unit_rate}))}}/>}</div>;
}
