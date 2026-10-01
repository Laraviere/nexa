import type { RetainerUsage } from "@/lib/billing/usage";

export type RetainerContext = { status: "none" } | { status: "error" } | {
  status: "ready";
  summary: Pick<RetainerUsage, "period_start" | "period_end" | "included_minutes_available" | "rounded_minutes_used" | "remaining_included_minutes" | "overage_minutes" | "overage_amount">;
};

// Presentation only: database periods have an exclusive end.
export function inclusivePeriodEnd(end: string) {
  const date = new Date(`${end}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
