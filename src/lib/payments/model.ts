import type { Database, Tables } from "@/types/database";
import { isCustomerId } from "@/lib/customers/validation";
export type PaymentSettings = Tables<"payment_settings">;
export type Payment = Tables<"invoice_payments">;
export type PaymentSummary = Tables<"invoice_payment_summary">;
export type RecordPaymentArgs = Database["public"]["Functions"]["record_invoice_payment"]["Args"];
export type PaymentState = { message?: string; success?: boolean; uncertain?: boolean; settings?: PaymentSettings };
export const paymentMethods = { cash: "Cash", check: "Check", card: "Card" } as const;
export const paymentStatuses = { unpaid: "Unpaid", partially_paid: "Partially Paid", paid: "Paid" } as const;
export function enabledMethods(settings: PaymentSettings) {
  return (Object.keys(paymentMethods) as (keyof typeof paymentMethods)[]).filter(method => settings[`${method}_enabled`]);
}
export function recordPaymentInput(form: FormData): { args?: RecordPaymentArgs; message?: string } {
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const amount = value("amount"), date = value("payment_date"), method = value("payment_method");
  if (!isCustomerId(value("invoice_id")) || !isCustomerId(value("request_id"))) return { message: "Reload the invoice before recording a payment." };
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 9999999999.99) return { message: "Enter a positive amount with no more than two decimal places." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000") || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date) return { message: "Enter a valid payment date." };
  if (!Object.hasOwn(paymentMethods, method)) return { message: "Choose a payment method." };
  if (value("reference").length > 500 || value("notes").length > 10000) return { message: "Shorten the payment reference or notes." };
  return { args: { p_invoice_id: value("invoice_id"), p_request_id: value("request_id"), p_amount: Number(amount), p_payment_date: date, p_payment_method: method, p_reference: value("reference"), p_notes: value("notes") } };
}
