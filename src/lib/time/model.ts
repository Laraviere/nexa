import type { Tables } from "@/types/database";

export type TimeEntry = Tables<"time_entries">;
export type TimeCustomer = Pick<Tables<"customers">, "id" | "company_name" | "is_active">;
export type RetainerContext = Pick<Tables<"customer_billing_agreements">,
  "included_hours" | "rounding_increment_minutes" | "overage_hourly_rate" | "billing_cycle_day">;
export type TimeContext = { agreement: RetainerContext | null };

// Presentation of stored minutes only; no rounding or allowance calculation.
export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} hr${remainder ? ` ${remainder} min` : ""}` : `${remainder} min`;
}
