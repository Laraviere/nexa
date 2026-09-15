import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/detail";
import Link from "next/link";
import { CustomerForm } from "@/components/customers/customer-form";
import { getCustomer } from "@/lib/customers/server";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const customer = await getCustomer((await params).id);
  return <PageContainer width="form"><div className="nexa-form-page"><Link href={`/customers/${customer.id}`} className="text-sm font-medium text-cyan-700">← Customer details</Link><PageHeader title="Edit customer" status={null} actions={null}/><p className="mb-6 break-words text-slate-600">{customer.company_name}</p><CustomerForm customer={customer} /></div></PageContainer>;
}
