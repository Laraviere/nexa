import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { invoiceDetail,generationCustomers } from "@/lib/invoices/server";
import { businessDate } from "@/lib/billing/model";
import { CreateInvoiceForm } from "@/components/invoices/create-invoice-form";
export default async function EditInvoicePage({params}:{params:Promise<{id:string}>}) {
 const {invoice,items}=await invoiceDetail((await params).id);
 if(invoice.status==="void")notFound();
 const today=businessDate();const {customers,owner}=await generationCustomers(today);
 const editing={invoiceId:invoice.id,draft:{customer_id:invoice.customer_id,issue_date:invoice.issue_date,as_of_date:today,notes:invoice.notes??"",terms:invoice.terms??"",items:items.filter(i=>i.source_type==="manual").map(i=>({description:i.description,quantity:String(i.quantity),unit:i.unit,unit_rate:String(i.unit_rate),tax_amount:String(i.tax_amount)}))}};
 const options=customers.map(c=>c.id===invoice.customer_id?{...c,company_name:invoice.company_name_snapshot,default_payment_terms_days:invoice.payment_terms_days_snapshot}:c);
 return <div className="mx-auto max-w-5xl"><Link href={`/invoices/${invoice.id}`} className="text-sm font-medium text-cyan-700">← Invoice #{invoice.invoice_number}</Link><h1 className="mt-4 text-3xl font-semibold">Edit Invoice</h1><p className="mb-6 mt-2 text-slate-500">Invoice #{invoice.invoice_number} · Changes save together.</p><CreateInvoiceForm customers={options} today={today} initialRequestId={randomUUID()} owner={owner} editing={editing}/></div>;
}
