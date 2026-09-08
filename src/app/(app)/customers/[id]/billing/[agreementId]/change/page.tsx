import Link from "next/link";
import { BillingForm } from "@/components/billing/billing-form";
import { businessDate, canChangeBillingTerms, formatBusinessDate, formatMoney } from "@/lib/billing/model";
import { getBillingAgreement, getBillingAgreements } from "@/lib/billing/server";
import { getCustomer } from "@/lib/customers/server";

export default async function ChangeBillingTermsPage({ params }: { params: Promise<{ id: string; agreementId: string }> }) {
  const { id, agreementId } = await params;
  const customer = await getCustomer(id);
  const [agreement, agreements] = await Promise.all([getBillingAgreement(id, agreementId), getBillingAgreements(id)]);
  const today = businessDate();
  return (
    <div className="max-w-3xl">
      <Link href={`/customers/${id}`} className="text-sm font-medium text-cyan-700">← Customer details</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Change billing terms</h1>
      <p className="mt-2 break-words text-slate-600">{customer.company_name}</p>
      <p className="mt-2 mb-6 text-sm text-slate-500">Existing terms: {formatMoney(agreement.monthly_fee)} / month · Effective {formatBusinessDate(agreement.effective_date)}</p>
      {canChangeBillingTerms(agreement, agreements, today)
        ? <BillingForm customerId={id} today={today} agreement={agreement} />
        : <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">This agreement can no longer be changed. Return to the customer to review its billing history and any future terms.</p>}
    </div>
  );
}
