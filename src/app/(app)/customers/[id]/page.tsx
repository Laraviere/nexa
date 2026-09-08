import Link from "next/link";
import { CustomerBilling } from "@/components/billing/customer-billing";
import { businessDate } from "@/lib/billing/model";
import { getBillingAgreements } from "@/lib/billing/server";
import { CustomerStatus } from "@/components/customers/customer-status";
import { CustomerStatusAction } from "@/components/customers/customer-status-action";
import { getCustomer } from "@/lib/customers/server";
import { paymentTermsLabel } from "@/lib/customers/validation";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const customer = await getCustomer((await params).id);
  const agreements = await getBillingAgreements(customer.id);
  const address = [customer.billing_address_line1, customer.billing_address_line2, [customer.billing_city, customer.billing_state, customer.billing_postal_code].filter(Boolean).join(", "), customer.billing_country].filter(Boolean).join("\n");
  const details = [
    ["Primary contact", customer.primary_contact_name], ["Email", customer.email], ["Phone", customer.phone],
    ["Default payment terms", paymentTermsLabel(customer.default_payment_terms_days)], ["Billing address", address], ["Notes", customer.notes],
    ["Created (New York time)", dateFormat.format(new Date(customer.created_at))], ["Updated (New York time)", dateFormat.format(new Date(customer.updated_at))],
  ];
  return <>
    <Link href="/customers" className="text-sm font-medium text-cyan-700">← Customers</Link>
    <div className="mt-4 mb-8 flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h1 className="mb-3 break-words text-3xl font-semibold tracking-tight">{customer.company_name}</h1><CustomerStatus active={customer.is_active} /></div><Link href={`/customers/${customer.id}/edit`} className="rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800">Edit customer</Link></div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8"><h2 className="mb-6 text-lg font-semibold">Customer details</h2><dl className="grid gap-6 sm:grid-cols-2">{details.map(([label, value]) => <div key={label} className={label === "Notes" ? "sm:col-span-2" : ""}><dt className="text-sm text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-950">{value || "Not provided"}</dd></div>)}</dl><CustomerStatusAction key={String(customer.is_active)} id={customer.id} active={customer.is_active} /></section>
    <CustomerBilling customerId={customer.id} agreements={agreements} today={businessDate()} />
  </>;
}
