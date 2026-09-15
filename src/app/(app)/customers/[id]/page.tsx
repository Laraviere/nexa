import { PageHeader } from "@/components/ui/detail";
import { Surface, SectionHeading } from "@/components/ui/surface";
import { InlineNotice } from "@/components/ui/feedback";
import { ButtonLink } from "@/components/ui/button";
import Link from "next/link";
import { CustomerBilling } from "@/components/billing/customer-billing";
import { businessDate, currentAgreement } from "@/lib/billing/model";
import { getRetainerUsage } from "@/lib/billing/usage-server";
import { getBillingAgreements } from "@/lib/billing/server";
import { CustomerStatus } from "@/components/customers/customer-status";
import { CustomerStatusAction } from "@/components/customers/customer-status-action";
import { getCustomer } from "@/lib/customers/server";
import { paymentTermsLabel } from "@/lib/customers/validation";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const customer = await getCustomer((await params).id);
  const agreements = await getBillingAgreements(customer.id);
  const today = businessDate();
  const current = currentAgreement(agreements, today);
  const usage = current ? await getRetainerUsage(customer.id, { p_billing_agreement_id: current.id, p_reference_date: today }) : undefined;
  const address = [customer.billing_address_line1, customer.billing_address_line2, [customer.billing_city, customer.billing_state, customer.billing_postal_code].filter(Boolean).join(", "), customer.billing_country].filter(Boolean).join("\n");
  const details = [
    ["Primary contact", customer.primary_contact_name], ["Email", customer.email], ["Phone", customer.phone],
    ["Default payment terms", paymentTermsLabel(customer.default_payment_terms_days)], ["Billing address", address], ["Notes", customer.notes],
    ["Created (New York time)", dateFormat.format(new Date(customer.created_at))], ["Updated (New York time)", dateFormat.format(new Date(customer.updated_at))],
  ];
  return <div className="nexa-detail-page">
    <Link href="/customers" className="text-sm font-medium text-cyan-700">← Customers</Link>
    <PageHeader title={customer.company_name} context={customer.primary_contact_name} status={<CustomerStatus active={customer.is_active}/>} actions={<ButtonLink variant="primary" href={`/customers/${customer.id}/edit`}>Edit customer</ButtonLink>}/>
    {!customer.is_active&&<InlineNotice tone="info" className="mb-5">This customer is archived. Contact information and billing history remain available.</InlineNotice>}
    <Surface aria-labelledby="contact-heading"><SectionHeading id="contact-heading">Contact information</SectionHeading><dl className="nexa-detail-facts mt-4">{[...details.slice(0,3),details[4]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||"Not provided"}</dd></div>)}</dl>

    </Surface>
    <CustomerBilling paymentTerms={paymentTermsLabel(customer.default_payment_terms_days)} customerId={customer.id} agreements={agreements} today={today} usage={usage}/>
    <section className="mt-6"><SectionHeading>Notes</SectionHeading><p className="mt-2 whitespace-pre-wrap text-sm text-secondary">{customer.notes||"Not provided"}</p></section>
    <section className="nexa-detail-metadata" aria-label="Customer record history"><dl className="nexa-detail-facts">{details.slice(6).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    <CustomerStatusAction key={String(customer.is_active)} id={customer.id} active={customer.is_active}/>
  </div>;
}
