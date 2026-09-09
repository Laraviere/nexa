import { formText, isBusinessDate } from "@/lib/billing/validation";
import { isCustomerId } from "@/lib/customers/validation";

export const timeFields = ["customer_id", "work_date", "description", "hours", "minutes", "is_billable", "hourly_rate"] as const;
export type TimeField = typeof timeFields[number];
export type TimeFormState = { message?: string; errors?: Partial<Record<TimeField, string>> };

export function validateTime(form: FormData) {
  const values = Object.fromEntries(timeFields.map((key) => [key, formText(form, key)])) as Record<TimeField, string>;
  const errors: NonNullable<TimeFormState["errors"]> = {};
  if (!isCustomerId(values.customer_id)) errors.customer_id = "Choose a customer.";
  if (!isBusinessDate(values.work_date)) errors.work_date = "Enter a valid work date.";
  if (!values.description) errors.description = "Enter a description of the work.";
  if (!/^\d+$/.test(values.hours) || !Number.isSafeInteger(Number(values.hours))) errors.hours = "Enter a whole number of hours, zero or more.";
  if (!/^\d+$/.test(values.minutes) || Number(values.minutes) > 59) errors.minutes = "Enter whole minutes from 0 to 59.";
  const actualMinutes = Number(values.hours) * 60 + Number(values.minutes);
  if (!Number.isSafeInteger(actualMinutes) || actualMinutes <= 0 || actualMinutes > 2147483647) errors.hours = "Enter time greater than zero and no more than 2,147,483,647 total minutes.";
  if (!["true", "false"].includes(values.is_billable)) errors.is_billable = "Choose billable or non-billable.";
  return { values, errors, actualMinutes, valid: Object.keys(errors).length === 0 };
}

export function validHourlyRate(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value)
    && value.split(".")[0].replace(/^0+/, "").length <= 10;
}

export function timeSaveError(code?: string) {
  if (code === "40001" || code === "23514") return "Billing terms may have changed. Refresh the billing context, check your entry, and try again.";
  if (code === "23503") return "The customer or billing terms are no longer available. Refresh and try again.";
  if (code === "42501") return "You do not have permission to save this entry. Sign in again and try again.";
  return "Unable to save the time entry. Please try again.";
}
