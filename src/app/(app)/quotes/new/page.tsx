import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/detail";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { invoiceCustomers } from "@/lib/invoices/server";
import { businessDate } from "@/lib/billing/model";
import { QuoteForm } from "@/components/quotes/quote-form";
export default async function NewQuotePage() {
 const {customers,owner}=await invoiceCustomers();
 return <PageContainer width="document"><div className="nexa-form-page"><Link href="/quotes" className="text-sm font-medium text-cyan-700">← Quotes</Link><PageHeader title="New Quote" status={null} actions={null}/>{customers.length?<QuoteForm customers={customers} owner={owner} today={businessDate()} requestId={randomUUID()}/>:<p className="mt-5">Add a <Link href="/customers/new" className="text-cyan-700 underline">customer</Link> before creating a quote.</p>}</div></PageContainer>;
}
