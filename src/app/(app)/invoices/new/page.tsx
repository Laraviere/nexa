import Link from "next/link";
import { randomUUID } from "node:crypto";
import { generationCustomers } from "@/lib/invoices/server";
import { businessDate } from "@/lib/billing/model";
import { CreateInvoiceForm } from "@/components/invoices/create-invoice-form";
export default async function NewInvoicePage() {
  const {customers,owner} = await generationCustomers(businessDate());
  return <div className="mx-auto max-w-5xl"><Link href="/invoices" className="text-sm font-medium text-cyan-700">← Invoices</Link><h1 className="mt-4 text-3xl font-semibold tracking-tight">New Invoice</h1><p className="mb-7 mt-2 text-slate-600">Prepare your invoice. You can edit it after saving.</p>{customers.length?<CreateInvoiceForm customers={customers} today={businessDate()} initialRequestId={randomUUID()} owner={owner}/>:<p>Add a <Link href="/customers/new" className="text-cyan-700 underline">customer</Link> before creating an invoice.</p>}</div>;
}
