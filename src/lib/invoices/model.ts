import type { Database } from "@/types/database";
import { isCustomerId } from "@/lib/customers/validation";
export type CreateInvoiceArgs = Database["public"]["Functions"]["create_manual_invoice"]["Args"];
export type CreateInvoiceResult = Database["public"]["Functions"]["create_manual_invoice"]["Returns"][number];
export const units = { hour: "Hour", minute: "Minute", flat: "Flat fee", each: "Each", mile: "Mile", month: "Month", custom: "Custom" } as const;
export const statuses = { draft: "Draft", sent: "Finalized", void: "Void" } as const;
export type Line = { description: string; quantity: string; unit: string; unit_rate: string };
export type Draft = { customer_id: string; issue_date: string; notes: string; terms: string; items: Line[] };
export type InvoiceState = { message?: string; uncertain?: boolean; invoiceId?: string };
export function validDecimal(value: string, whole: number, scale: number, positive = false) {
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  const [integer, fraction = ""] = value.split(".");
  return integer.replace(/^0+/, "").length <= whole && fraction.replace(/0+$/, "").length <= scale && (!positive || /[1-9]/.test(value));
}
export function invoiceInput(raw: unknown, requestId: string): { args?: CreateInvoiceArgs; message?: string } {
  if (!isCustomerId(requestId)) return { message: "The request key is invalid. Reload the form." };
  if (!raw || typeof raw !== "object") return { message: "Check the invoice details." };
  const d = raw as Partial<Draft>;
  if (typeof d.customer_id !== "string" || !isCustomerId(d.customer_id)) return { message: "Choose a customer." };
  if (typeof d.issue_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.issue_date) || d.issue_date < "0001-01-01"
    || !Number.isFinite(Date.parse(`${d.issue_date}T12:00:00Z`)) || new Date(`${d.issue_date}T12:00:00Z`).toISOString().slice(0,10) !== d.issue_date) return { message: "Enter a valid issue date." };
  if (!Array.isArray(d.items) || !d.items.length || d.items.length > 1000) return { message: "Add between 1 and 1000 line items." };
  for (const [index, line] of d.items.entries()) {
    if (!line || typeof line.description !== "string" || !line.description.trim()) return { message: `Line ${index + 1}: enter a description.` };
    if (typeof line.quantity !== "string" || !validDecimal(line.quantity,12,8,true)) return { message: `Line ${index + 1}: enter a positive quantity with up to 8 decimal places and 12 whole digits.` };
    if (typeof line.unit_rate !== "string" || !validDecimal(line.unit_rate,10,2)) return { message: `Line ${index + 1}: enter a nonnegative rate with up to 2 decimal places and 10 whole digits.` };
    if (!Object.hasOwn(units,line.unit)) return { message: `Line ${index + 1}: choose a valid unit.` };
  }
  if (typeof d.notes !== "string" || typeof d.terms !== "string") return { message: "Check the notes and terms." };
  return { args: { p_customer_id: d.customer_id, p_issue_date: d.issue_date, p_request_id: requestId,
    p_notes: d.notes || undefined, p_terms: d.terms || undefined,
    p_items: d.items.map(l => ({ description: l.description, quantity: l.quantity, unit: l.unit, unit_rate: l.unit_rate })) } };
}
// Supplemental preview only. Saved financial values always come from the DB.
export function previewTotal(items: Line[]) {
  if (items.some(l => !validDecimal(l.quantity,12,8,true) || !validDecimal(l.unit_rate,10,2))) return null;
  return items.reduce((sum,l) => sum + Math.round(Number(l.quantity)*Number(l.unit_rate)*100)/100,0);
}
