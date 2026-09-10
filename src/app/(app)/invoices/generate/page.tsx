import Link from "next/link";
import { randomUUID } from "node:crypto";
import { generationCustomers } from "@/lib/invoices/server";
import { businessDate } from "@/lib/billing/model";
import { GenerateInvoiceForm } from "@/components/invoices/generate-invoice-form";
export default async function GenerateInvoicePage({searchParams}:{searchParams:Promise<{customer?:string}>}) {
  const today = businessDate();
  const {customer} = await searchParams;
  const {customers,owner} = await generationCustomers(today);
  return <div className="mx-auto max-w-3xl"><Link href="/invoices/new" className="text-sm font-medium text-cyan-700">← New Invoice</Link><h1 className="mt-4 text-3xl font-semibold tracking-tight">New Invoice</h1><p className="mb-6 mt-2 text-slate-600">Use eligible billing activity to create a draft for review.</p>{customers.length?<GenerateInvoiceForm customers={customers} today={today} initialRequestId={randomUUID()} owner={owner} initialCustomer={customers.some(c=>c.id===customer)?customer:undefined}/>:<p>Add a <Link href="/customers/new" className="text-cyan-700 underline">customer</Link> before generating an invoice.</p>}</div>;
}
