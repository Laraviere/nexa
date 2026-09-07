import Link from "next/link";
import { CustomerForm } from "@/components/customers/customer-form";
import { getCustomer } from "@/lib/customers/server";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const customer = await getCustomer((await params).id);
  return <div className="max-w-3xl"><Link href={`/customers/${customer.id}`} className="text-sm font-medium text-cyan-700">← Customer details</Link><h1 className="mt-4 mb-2 text-3xl font-semibold tracking-tight">Edit customer</h1><p className="mb-6 break-words text-slate-600">{customer.company_name}</p><CustomerForm customer={customer} /></div>;
}
