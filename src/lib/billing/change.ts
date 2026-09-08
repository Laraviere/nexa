import type { Database } from "@/types/database";
import type { BillingAgreement } from "@/lib/billing/model";
import { formText, validateBilling } from "@/lib/billing/validation";

export type ChangeBillingTermsRpc = Database["public"]["Functions"]["change_customer_billing_terms"];

export function validateBillingChange(form: FormData, agreement: BillingAgreement, today: string) {
  const mode = formText(form, "end_mode");
  const normalized = new FormData();
  for (const [key, value] of form.entries()) normalized.append(key, value);
  // Omitting the RPC end argument carries forward its locked agreement's end.
  if (mode === "preserve_end") normalized.set("end_mode", "until_cancellation");
  const result = validateBilling(normalized, { allowSameDayEnd: true });
  const { errors, data } = result;
  if (!errors.effective_date && (data.effective_date < today || data.effective_date < agreement.effective_date
    || (agreement.end_date && data.effective_date >= agreement.end_date))) {
    errors.effective_date = "Choose a date on or after today and the agreement’s start, and before its scheduled end.";
  }
  if ((agreement.end_date && mode === "until_cancellation") || (!agreement.end_date && mode === "preserve_end")) {
    errors.end_mode = "Choose a duration that preserves or shortens the agreement’s scheduled end.";
  }
  if (agreement.end_date && data.end_date && data.end_date > agreement.end_date) {
    errors.end_date = "The end date cannot be later than the existing scheduled end.";
  }
  const args: ChangeBillingTermsRpc["Args"] = {
    p_predecessor_id: agreement.id,
    p_effective_date: data.effective_date,
    p_monthly_fee: data.monthly_fee,
    p_included_hours: data.included_hours,
    p_overage_hourly_rate: data.overage_hourly_rate,
    p_billing_cycle_day: data.billing_cycle_day,
    p_bill_in_advance: data.bill_in_advance,
    p_rounding_increment_minutes: data.rounding_increment_minutes,
    p_rollover_enabled: data.rollover_enabled,
    // The generated optional argument is string, not null. Omit it to use the
    // RPC default without altering or duplicating the generated types.
    ...(data.end_date ? { p_end_date: data.end_date } : {}),
  };
  return { args, errors, values: { ...result.values, end_mode: mode }, valid: Object.keys(errors).length === 0 };
}

export function changeBillingError(code?: string) {
  if (code === "55000" || code === "P0002") return "This agreement can no longer be changed. Return to the customer to review its billing history.";
  if (code === "22023" || code === "22007" || code === "22008") return "The effective date or billing terms are invalid. Check the dates and amounts, then try again.";
  if (code === "23P01") return "These terms conflict with another billing agreement. Return to the customer to review its billing history.";
  if (code === "40001" || code === "40P01") return "This agreement changed while you were working. Reload and try again.";
  if (code === "42501") return "You could not be authorized to change these terms. Sign in again and retry.";
  return "Billing terms could not be changed. Please try again.";
}
