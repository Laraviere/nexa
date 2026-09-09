import "server-only";

import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
import { isBusinessDate } from "@/lib/billing/validation";
import { usageError, validUsageSummary, type RetainerUsageArgs, type RetainerUsageResult } from "@/lib/billing/usage";

export async function getRetainerUsage(customerId: string, args: RetainerUsageArgs): Promise<RetainerUsageResult> {
  const supabase = await customerClient();
  if (!isCustomerId(customerId) || !isCustomerId(args.p_billing_agreement_id) || !isBusinessDate(args.p_reference_date)) {
    return { status: "error", message: usageError("22023") };
  }
  try {
    const { data, error } = await supabase.rpc("get_retainer_period_usage", args);
    if (error) return { status: "error", message: usageError(error.code) };
    const summary = data?.length === 1 ? data[0] : undefined;
    if (!summary || summary.customer_id !== customerId || summary.billing_agreement_id !== args.p_billing_agreement_id
      || !validUsageSummary(summary) || args.p_reference_date < summary.period_start || args.p_reference_date >= summary.period_end) {
      return { status: "error", message: usageError() };
    }
    return { status: "ready", summary };
  } catch {
    return { status: "error", message: usageError() };
  }
}
