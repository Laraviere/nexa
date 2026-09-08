import type { TablesInsert } from "@/types/database";

export const billingFields = [
  "monthly_fee", "included_hours", "overage_hourly_rate", "effective_date", "end_date", "end_mode",
  "billing_cycle_day", "bill_in_advance", "rounding_increment_minutes", "rollover_enabled",
] as const;
export type BillingField = typeof billingFields[number];
export type BillingFormState = {
  message?: string;
  errors?: Partial<Record<BillingField | "confirmation" | "cancellation_mode", string>>;
  values?: Partial<Record<BillingField, string>>;
};

export function formText(form: FormData, field: string) {
  const value = form.get(field);
  return typeof value === "string" ? value.trim() : "";
}

export function isBusinessDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === "0000") return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateBilling(form: FormData, { allowSameDayEnd = false } = {}) {
  const values = Object.fromEntries(billingFields.map((field) => [field, formText(form, field)])) as Record<BillingField, string>;
  const errors: NonNullable<BillingFormState["errors"]> = {};
  for (const field of ["monthly_fee", "included_hours", "overage_hourly_rate"] as const) {
    // Validate decimal text against the DB precision before converting for transport.
    // No financial calculations or rounding; reject extra decimal places explicitly.
    const digits = field === "included_hours" ? 8 : 10;
    if (!/^\d+(\.\d{1,2})?$/.test(values[field]) || values[field].split(".")[0].replace(/^0+/, "").length > digits) {
      errors[field] = `Enter a non-negative amount with at most ${digits} whole-number digits and 2 decimal places.`;
    }
  }
  for (const [field, max] of [["billing_cycle_day", 28], ["rounding_increment_minutes", 2147483647]] as const) {
    if (!/^\d+$/.test(values[field]) || Number(values[field]) < 1 || Number(values[field]) > max) {
      errors[field] = field === "billing_cycle_day" ? "Choose a day from 1 to 28." : "Enter a whole number of minutes from 1 to 2,147,483,647.";
    }
  }
  if (!isBusinessDate(values.effective_date)) errors.effective_date = "Enter a valid effective date.";
  if (values.end_mode === "until_cancellation") {
    // Ignore any stale date submitted after switching back to cancellation.
    values.end_date = "";
  } else if (values.end_mode === "specific_date") {
    if (!isBusinessDate(values.end_date) || values.end_date < values.effective_date
      || (!allowSameDayEnd && values.end_date === values.effective_date)) {
      errors.end_date = allowSameDayEnd ? "Enter a valid end date on or after the effective date." : "Enter a valid end date after the effective date.";
    }
  } else {
    errors.end_mode = "Choose until cancellation or an end date.";
  }
  for (const field of ["bill_in_advance", "rollover_enabled"] as const) {
    if (!["true", "false"].includes(values[field])) errors[field] = "Choose a billing option.";
  }
  const data = {
    monthly_fee: Number(values.monthly_fee), included_hours: Number(values.included_hours),
    overage_hourly_rate: Number(values.overage_hourly_rate), effective_date: values.effective_date,
    end_date: values.end_date || null, billing_cycle_day: Number(values.billing_cycle_day),
    bill_in_advance: values.bill_in_advance === "true", rounding_increment_minutes: Number(values.rounding_increment_minutes),
    rollover_enabled: values.rollover_enabled === "true", is_active: true,
  } satisfies Omit<TablesInsert<"customer_billing_agreements">, "customer_id">;
  return { values, errors, data, valid: Object.keys(errors).length === 0 };
}

export function billingError(code?: string) {
  if (code === "23P01") return "This billing agreement overlaps an existing agreement for this customer.";
  if (code === "23503") return "This customer is no longer available. Return to Customers and try again.";
  return "Unable to save the billing agreement. Please try again.";
}
