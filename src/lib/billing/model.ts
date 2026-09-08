import type { Tables } from "@/types/database";

export type BillingAgreement = Tables<"customer_billing_agreements">;

export function businessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function agreementStatus(agreement: BillingAgreement, today: string) {
  if (agreement.end_date && today >= agreement.end_date) return "Ended";
  if (today < agreement.effective_date) return "Future";
  return agreement.is_active ? "Current" : "Disabled";
}

export function currentAgreement(agreements: BillingAgreement[], today: string) {
  return agreements.find((agreement) => agreementStatus(agreement, today) === "Current");
}

// Format date-only fields without moving them across timezone boundaries.
export function formatBusinessDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

// Presentation only: no monetary arithmetic is performed in JavaScript.
export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatIncludedHours(value: number) {
  if (value === 0) return "No included hours";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} ${value === 1 ? "hour" : "hours"} / month`;
}

export function formatBillingCycle(day: number) {
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  return `Monthly on the ${day}${suffix}`;
}
