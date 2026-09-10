import type { Database } from "@/types/database";
import { isCustomerId } from "@/lib/customers/validation";
export type GenerateArgs = Database["public"]["Functions"]["generate_customer_invoice"]["Args"];
export type GenerateResult = Database["public"]["Functions"]["generate_customer_invoice"]["Returns"][number];
export type GenerationDraft = { customer_id: string; issue_date: string; as_of_date: string; notes: string; terms: string };
export type GenerationState = { message?: string; uncertain?: boolean; invoiceId?: string; empty?: boolean };
function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "0001-01-01"
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value;
}
export function generationInput(raw: unknown, requestId: string): { args?: GenerateArgs; message?: string } {
  if (!isCustomerId(requestId)) return { message: "The request key is invalid. Reload the form." };
  if (!raw || typeof raw !== "object") return { message: "Check the invoice details." };
  const d = raw as Partial<GenerationDraft>;
  if (typeof d.customer_id !== "string" || !isCustomerId(d.customer_id)) return { message: "Choose a customer." };
  if (!date(d.issue_date)) return { message: "Enter a valid issue date." };
  if (d.as_of_date !== "" && !date(d.as_of_date)) return { message: "Enter a valid as-of date." };
  if (typeof d.notes !== "string" || typeof d.terms !== "string" || d.notes.length > 10000 || d.terms.length > 10000) return { message: "Check the notes and terms." };
  return { args: { p_customer_id:d.customer_id,p_issue_date:d.issue_date,p_request_id:requestId,
    p_as_of_date:d.as_of_date || undefined,p_notes:d.notes || undefined,p_terms:d.terms || undefined } };
}
export function generationError(code: string, message: string): GenerationState {
  if (code === "40001" || code === "40P01") return { message:"Billing data changed while the invoice was being generated. Please retry this same submission.",uncertain:true };
  if (code === "P0002") return { message:"This customer or billing agreement is unavailable. Refresh and check the customer." };
  if (code === "22023" && message.includes("Request ID")) return { message:"We could not confirm this request. Retry the original submission to retrieve its result.",uncertain:true };
  if (code === "22023") return { message:"Invoice generation could not be completed. Check the dates and billing terms; the as-of date cannot be later than today in New York." };
  if (code === "0A000" || code === "23514") return { message:"Invoice generation could not be completed. Review this customer's billing terms and time entries." };
  if (code === "23505" || code === "23P01") return { message:"This billing period or time has already been invoiced. Review existing invoices before trying again." };
  return { message:"We could not confirm the result. Retry this same submission safely.",uncertain:true };
}
