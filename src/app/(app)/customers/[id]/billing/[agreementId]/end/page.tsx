import Link from "next/link";
import { EndRetainerForm } from "@/components/billing/end-retainer-form";
import { agreementStatus, businessDate, formatBusinessDate, formatMoney } from "@/lib/billing/model";
import { getBillingAgreement } from "@/lib/billing/server";
import { getCustomer } from "@/lib/customers/server";

export default async function EndRetainerPage({ params }: { params: Promise<{ id: string; agreementId: string }> }) {
  const { id, agreementId } = await params;
  const customer = await getCustomer(id);
  const agreement = await getBillingAgreement(id, agreementId);
  const today = businessDate();
  return (
    <div className="max-w-2xl">
      <Link href={`/customers/${id}`} className="text-sm font-medium text-cyan-700">← Customer details</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">End retainer</h1>
      <p className="mt-2 mb-6 break-words text-slate-600">{customer.company_name}</p>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <p className="font-medium">{formatMoney(agreement.monthly_fee)} / month · Effective {formatBusinessDate(agreement.effective_date)}</p>
        {agreementStatus(agreement, today) === "Current" ? <EndRetainerForm customerId={id} agreementId={agreementId} today={today} existingEnd={agreement.end_date} /> : <p className="mt-4 text-sm text-slate-600">This agreement is not current. Return to the customer to review its billing history.</p>}
      </div>
    </div>
  );
}
