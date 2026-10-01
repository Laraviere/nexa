import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/detail";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { generationCustomers } from "@/lib/invoices/server";
import { businessDate } from "@/lib/billing/model";
import { CreateInvoiceForm } from "@/components/invoices/create-invoice-form";
export default async function NewInvoicePage() {
  const {customers,owner} = await generationCustomers(businessDate());
  return <PageContainer width="workspace"><div className="nexa-form-page"><Link href="/invoices" className="text-sm font-medium text-cyan-700">← Invoices</Link><PageHeader title="New Invoice" context="Build and review the invoice before saving." status={null} actions={null}/>{customers.length?<CreateInvoiceForm customers={customers} today={businessDate()} initialRequestId={randomUUID()} owner={owner}/>:<p>Add a <Link href="/customers/new" className="text-cyan-700 underline">customer</Link> before creating an invoice.</p>}</div></PageContainer>;
}
