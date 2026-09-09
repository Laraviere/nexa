import type { Database, Json } from "@/types/database";
import { isBusinessDate } from "@/lib/billing/validation";
import { isCustomerId } from "@/lib/customers/validation";

export type RetainerUsageArgs = Database["public"]["Functions"]["get_retainer_period_usage"]["Args"];
export type RetainerUsage = Database["public"]["Functions"]["get_retainer_period_usage"]["Returns"][number];
export type RetainerUsageResult = { status: "ready"; summary: RetainerUsage }
  | { status: "error"; message: string };

export function usageError(code?: string) {
  if (code === "0A000") return "Usage calculation is not available for rollover-enabled agreements yet.";
  if (code === "22023") return "Usage cannot be calculated for these billing terms. Check the agreement dates, allowance, and captured terms for consistency.";
  if (code === "P0002") return "This billing agreement is no longer available. Refresh the customer page to see the latest terms.";
  if (code === "42501") return "You do not have permission to view retainer usage. Sign in again and try again.";
  return "Unable to load retainer usage. Please try again in a moment.";
}

// Generated JSON has no field-level contract. Narrow only the presentation
// fields at runtime; never infer allocations or prices from time entries.
export function usageAllocations(value: Json) {
  if (!Array.isArray(value)) return null;
  const rows = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { time_entry_id, work_date, rounded_minutes, included_minutes, overage_minutes } = entry;
    if (typeof time_entry_id !== "string" || !isCustomerId(time_entry_id)
      || typeof work_date !== "string" || !isBusinessDate(work_date)
      || typeof rounded_minutes !== "number" || !Number.isSafeInteger(rounded_minutes) || rounded_minutes < 0
      || typeof included_minutes !== "number" || !Number.isSafeInteger(included_minutes) || included_minutes < 0
      || typeof overage_minutes !== "number" || !Number.isSafeInteger(overage_minutes) || overage_minutes < 0) return null;
    rows.push({ time_entry_id, work_date, rounded_minutes, included_minutes, overage_minutes });
  }
  return rows;
}

export function validUsageSummary(value: RetainerUsage) {
  return isBusinessDate(value.period_start) && isBusinessDate(value.period_end)
    && value.period_start < value.period_end
    && [value.included_minutes_available, value.rounded_minutes_used, value.included_minutes_used,
      value.remaining_included_minutes, value.overage_minutes].every((minutes) => Number.isSafeInteger(minutes) && minutes >= 0)
    && Number.isFinite(value.overage_amount) && value.overage_amount >= 0;
}
