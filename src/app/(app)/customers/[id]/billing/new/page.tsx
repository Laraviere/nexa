import Link from "next/link";
import { BillingForm } from "@/components/billing/billing-form";
import { businessDate } from "@/lib/billing/model";
import { getCustomer } from "@/lib/customers/server";

export default async function NewRetainerPage({ params }: { params: Promise<{ id: string }> }) {
  const customer = await getCustomer((await params).id);
  return (
    <div className="max-w-3xl">
      <Link href={`/customers/${customer.id}`} className="text-sm font-medium text-cyan-700">← Customer details</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Set up retainer</h1>
      <p className="mt-2 mb-6 break-words text-slate-600">{customer.company_name}</p>
      <BillingForm customerId={customer.id} today={businessDate()} />
    </div>
  );
}
