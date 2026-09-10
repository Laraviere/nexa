"use server";
import { revalidatePath } from "next/cache";
import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
import { recordPaymentInput, type PaymentState } from "@/lib/payments/model";
import type { Database } from "@/types/database";
export async function savePaymentSettings(_previous: PaymentState, form: FormData): Promise<PaymentState> {
  const client = await customerClient();
  const args: Database["public"]["Functions"]["update_payment_settings"]["Args"] = { p_cash_enabled: form.get("cash_enabled") === "on", p_check_enabled: form.get("check_enabled") === "on", p_card_enabled: form.get("card_enabled") === "on" };
  if (!args.p_cash_enabled && !args.p_check_enabled && !args.p_card_enabled) return { message: "At least one payment method must remain enabled." };
  try {
    const { data, error } = await client.rpc("update_payment_settings",args);
    if (error || !data) return { message: "Unable to save payment methods. Please try again." };
    revalidatePath("/settings/payments");revalidatePath("/invoices/[id]","page");
    return { success: true, message: "Payment methods saved." };
  } catch { return { message: "Unable to confirm the settings change. Refresh to check the saved methods." }; }
}
export async function recordPayment(_previous: PaymentState, form: FormData): Promise<PaymentState> {
  const client = await customerClient();
  const input = recordPaymentInput(form);
  if (!input.args) return { message: input.message };
  try {
    const { data, error } = await client.rpc("record_invoice_payment",input.args);
    if (error) {
      if (error.code === "P1001") return { message: "This invoice must be marked Ready before a payment can be recorded." };
      if (error.code === "22023" && error.message.includes("not enabled")) {
        const result = await client.from("payment_settings").select("*").eq("singleton",true).single();
        return { message: "That payment method is no longer enabled. Choose another method.", settings: result.data ?? undefined };
      }
      if (error.code === "22023" && error.message.includes("remaining invoice balance")) return { message: "Payment cannot exceed the remaining balance." };
      if (error.code === "22023" && error.message.includes("Void invoices")) return { message: "Void invoices cannot receive payments." };
      if (error.code === "22023" && error.message.includes("request key")) return { message: "This payment request was already used with different details. Refresh to check payment history.", uncertain: true };
      if (error.code === "P0002" || error.code === "42501") return { message: "This invoice is unavailable for payment." };
      if (error.code === "22023" || error.code === "23514") return { message: "Check the payment amount, date and details." };
      return { message: "We could not confirm the payment. Retry this same submission safely.", uncertain: true };
    }
    if (!data?.[0]) return { message: "We could not confirm the payment. Retry this same submission safely.", uncertain: true };
    revalidatePath(`/invoices/${data[0].invoice_id}`);revalidatePath("/invoices");
    return { success: true, message: data[0].payment_voided_at ? "This payment was already voided. No new payment was recorded." : "Payment recorded." };
  } catch { return { message: "Connection interrupted. Retry this same payment to confirm its result.", uncertain: true }; }
}
export async function voidPayment(_previous: PaymentState, form: FormData): Promise<PaymentState> {
  const client = await customerClient();
  const args: Database["public"]["Functions"]["void_invoice_payment"]["Args"] = { p_payment_id: String(form.get("payment_id") ?? ""), p_reason: String(form.get("reason") ?? "").trim() };
  if (!isCustomerId(args.p_payment_id) || !args.p_reason || args.p_reason.length > 2000 || form.get("confirmed") !== "yes") return { message: "Confirm voiding and enter a reason." };
  try {
    const { data, error } = await client.rpc("void_invoice_payment",args);
    if (error || !data) return { message: "Unable to void this payment. Refresh its history and try again." };
    revalidatePath(`/invoices/${data.invoice_id}`);revalidatePath("/invoices");
    return { success: true, message: "Payment voided. Its history has been preserved." };
  } catch { return { message: "Unable to confirm the correction. Retry with the same reason." }; }
}
