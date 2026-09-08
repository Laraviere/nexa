import Link from "next/link";
import { agreementStatus, currentAgreement, formatBillingCycle, formatBusinessDate, formatIncludedHours, formatMoney, type BillingAgreement } from "@/lib/billing/model";

export function CustomerBilling({ customerId, agreements, today }: { customerId: string; agreements: BillingAgreement[]; today: string }) {
  const current = currentAgreement(agreements, today);
  const terms = current ? [
    ["Monthly fee", formatMoney(current.monthly_fee)],
    ["Included support", formatIncludedHours(current.included_hours)],
    ["Overage rate", `${formatMoney(current.overage_hourly_rate)} / hour`],
    ["Billing cycle", formatBillingCycle(current.billing_cycle_day)],
    ["Billing timing", current.bill_in_advance ? "Beginning of period" : "End of period"],
    ["Time rounding", `Each time entry rounds up to ${current.rounding_increment_minutes} ${current.rounding_increment_minutes === 1 ? "minute" : "minutes"}`],
    ["Unused hours", current.rollover_enabled ? "Roll over" : "Do not roll over"],
    ["Effective", formatBusinessDate(current.effective_date)],
    ["End date (exclusive)", current.end_date ? formatBusinessDate(current.end_date) : "Until cancellation"],
  ] : [];
  return (
    <section aria-labelledby="billing-heading" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <h2 id="billing-heading" className="text-lg font-semibold">Billing</h2>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Billing model</p>
          <p className="mt-1 text-xl font-semibold">{current ? "Monthly retainer" : "No retainer"}</p>
          {!current && <p className="mt-2 text-sm text-slate-600">No monthly billing agreement is currently active for this customer.</p>}
        </div>
        <Link href={current ? `/customers/${customerId}/billing/${current.id}/end` : `/customers/${customerId}/billing/new`}
          className={current ? "rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium hover:bg-slate-50" : "rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800"}>
          {current ? "End retainer" : "Set up retainer"}
        </Link>
      </div>
      {current && <>
        <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {terms.map(([label, value]) => <div key={label}><dt className="text-sm text-slate-500">{label}</dt><dd className="mt-1 text-sm leading-6">{value}</dd></div>)}
        </dl>
        <p className="mt-5 text-sm text-slate-500">Included support is allocated each month. Rounding applies to each individual entry before usage is totaled.</p>
      </>}
      <div className="mt-8 border-t border-slate-100 pt-6">
        <h3 className="font-semibold">Agreement history</h3>
        <p className="mt-1 text-xs text-slate-500">Status as of {formatBusinessDate(today)} · New York time. End dates are exclusive.</p>
        {agreements.length === 0 ? <p className="mt-4 text-sm text-slate-600">No billing agreements yet. This customer can remain without a retainer.</p> : (
          <ul className="mt-4 space-y-3">
            {agreements.map((agreement) => {
              const status = agreementStatus(agreement, today);
              return <li key={agreement.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{formatBusinessDate(agreement.effective_date)} → {agreement.end_date ? formatBusinessDate(agreement.end_date) : "Until cancellation"}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status === "Current" ? "bg-emerald-50 text-emerald-700" : status === "Future" ? "bg-cyan-50 text-cyan-800" : "bg-slate-100 text-slate-600"}`}>
                    {status}{!agreement.is_active && status !== "Disabled" ? " · Disabled" : ""}
                  </span>
                </div>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-xs text-slate-500">Monthly fee</dt><dd className="mt-1">{formatMoney(agreement.monthly_fee)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Included support</dt><dd className="mt-1">{formatIncludedHours(agreement.included_hours)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Overage rate</dt><dd className="mt-1">{formatMoney(agreement.overage_hourly_rate)} / hour</dd></div>
                </dl>
              </li>;
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
