"use server";

import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
import { isBusinessDate } from "@/lib/billing/validation";
import { businessDate } from "@/lib/billing/model";
import { usageAllocations, validUsageSummary } from "@/lib/billing/usage";
import type { RetainerContext } from "@/lib/invoices/retainer-context";

export async function loadInvoiceRetainerContext(customerId: string, asOf: string): Promise<RetainerContext> {
  const client = await customerClient();
  const today = businessDate();
  if (!isCustomerId(customerId) || !isBusinessDate(asOf) || asOf > today) return { status: "error" };
  try {
    const { data: agreement, error } = await client.from("customer_billing_agreements")
      .select("id").eq("customer_id", customerId).eq("is_active", true)
      .lte("effective_date", asOf).or(`end_date.is.null,end_date.gt.${asOf}`).maybeSingle();
    if (error) return { status: "error" };
    if (!agreement) return { status: "none" };
    const { data, error: usageError } = await client.rpc("get_retainer_period_usage", {
      p_billing_agreement_id: agreement.id, p_reference_date: asOf,
    });
    const summary = data?.length === 1 ? data[0] : undefined;
    if (usageError || !summary || summary.customer_id !== customerId || summary.billing_agreement_id !== agreement.id
      || !validUsageSummary(summary) || asOf < summary.period_start || asOf >= summary.period_end) return { status: "error" };
    // Completed periods belong exclusively to authoritative Suggested Charges,
    // not current-period context. Historical fees have an explicit discovery read;
    // older missed overage remains outside automatic catch-up billing.
    if (summary.period_end <= today) return { status: "none" };
    const allocations = usageAllocations(summary.allocations);
    // The RPC totals the entire period, not work through its reference date.
    // Do not display future work or recompute allowance/overage in JavaScript.
    if (!allocations || allocations.some(entry => entry.work_date > asOf)) return { status: "error" };
    return { status: "ready", summary: {
      period_start: summary.period_start, period_end: summary.period_end,
      included_minutes_available: summary.included_minutes_available, rounded_minutes_used: summary.rounded_minutes_used,
      remaining_included_minutes: summary.remaining_included_minutes, overage_minutes: summary.overage_minutes,
      overage_amount: summary.overage_amount,
    } };
  } catch {
    return { status: "error" };
  }
}
