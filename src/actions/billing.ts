"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
import { agreementStatus, businessDate } from "@/lib/billing/model";
import { billingError, formText, isBusinessDate, validateBilling, type BillingFormState } from "@/lib/billing/validation";

export async function createRetainer(customerId: string, _previous: BillingFormState, form: FormData): Promise<BillingFormState> {
  const supabase = await customerClient();
  if (!isCustomerId(customerId)) return { message: "This customer could not be found." };
  const result = validateBilling(form);
  if (!result.valid) return { values: result.values, errors: result.errors, message: "Please check the highlighted fields." };
  try {
    const { error } = await supabase.from("customer_billing_agreements")
      .insert({ ...result.data, customer_id: customerId });
    if (error) return { values: result.values, message: billingError(error.code) };
  } catch {
    return { values: result.values, message: billingError() };
  }
  revalidatePath(`/customers/${customerId}`, "layout");
  redirect(`/customers/${customerId}`);
}

export async function endRetainer(customerId: string, agreementId: string, _previous: BillingFormState, form: FormData): Promise<BillingFormState> {
  const supabase = await customerClient();
  const today = businessDate();
  const mode = formText(form, "cancellation_mode");
  const endDate = mode === "now" ? today : formText(form, "end_date");
  const values = { end_date: endDate };
  if (!isCustomerId(customerId) || !isCustomerId(agreementId)) return { values, message: "This billing agreement could not be found." };
  if (mode !== "now" && mode !== "scheduled") return { values, errors: { cancellation_mode: "Choose End now or Schedule an end date." }, message: "Choose when to end the retainer." };
  if (mode === "scheduled" && (!isBusinessDate(endDate) || endDate <= today)) return { values, errors: { end_date: "Choose a valid date after today’s New York business date." }, message: "Please check the scheduled end date." };
  if (formText(form, "confirmation") !== "yes") return { values, errors: { confirmation: "Confirm that you want to end this retainer." }, message: "Confirmation is required." };
  try {
    const { data: agreement, error: readError } = await supabase.from("customer_billing_agreements").select("*")
      .eq("customer_id", customerId).eq("id", agreementId).maybeSingle();
    if (readError) return { values, message: billingError(readError.code) };
    if (!agreement || agreementStatus(agreement, today) !== "Current") return { values, message: "This agreement is no longer current. Reload the customer to review its billing history." };
    if (endDate < agreement.effective_date || (agreement.end_date && endDate > agreement.end_date)) {
      return { values, errors: { end_date: "Choose a date on or after the agreement starts and no later than its existing end date." }, message: "Please check the end date." };
    }
    // One atomic UPDATE, guarded against a concurrent end-date change.
    // Never alter financial terms or disable the historical row.
    let query = supabase.from("customer_billing_agreements").update({ end_date: endDate })
      .eq("id", agreementId).eq("customer_id", customerId).eq("is_active", true)
      .eq("effective_date", agreement.effective_date);
    query = agreement.end_date ? query.eq("end_date", agreement.end_date) : query.is("end_date", null);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) return { values, message: billingError(error.code) };
    if (!data) return { values, message: "This agreement changed while you were working. Reload and try again." };
  } catch {
    return { values, message: billingError() };
  }
  revalidatePath(`/customers/${customerId}`, "layout");
  redirect(`/customers/${customerId}`);
}
