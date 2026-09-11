import Link from "next/link";
import { randomUUID } from "node:crypto";
import { invoiceCustomers } from "@/lib/invoices/server";
import { businessDate } from "@/lib/billing/model";
import { QuoteForm } from "@/components/quotes/quote-form";
export default async function NewQuotePage() {
 const {customers,owner}=await invoiceCustomers();
 return <div className="mx-auto max-w-4xl"><Link href="/quotes" className="text-sm font-medium text-cyan-700">← Quotes</Link><h1 className="mt-4 text-3xl font-semibold tracking-tight">New Quote</h1>{customers.length?<QuoteForm customers={customers} owner={owner} today={businessDate()} requestId={randomUUID()}/>:<p className="mt-5">Add a <Link href="/customers/new" className="text-cyan-700 underline">customer</Link> before creating a quote.</p>}</div>;
}
