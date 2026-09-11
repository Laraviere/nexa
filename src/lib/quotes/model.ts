import type { Json, Tables, Database } from "@/types/database";
import { invoiceInput, previewDueDate, type Draft } from "@/lib/invoices/model";
export type Quote = Tables<"quotes">;
export type QuoteDraft = Draft & { expiration_date: string; quote_id?: string; revision?: number };
export type QuoteLine = { description: string; quantity: string; unit: string; unit_rate: string; amount: string };
export type QuoteState = { message?: string; quoteId?: string; invoiceId?: string; uncertain?: boolean };
export const quoteStatuses = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired" } as const;
export function quoteStatus(q: Pick<Quote,"status"|"expiration_date">, today: string) {
  return ["draft","sent"].includes(q.status) && q.expiration_date && q.expiration_date < today ? "expired" : q.status;
}
export function quoteLines(items: Json): QuoteLine[] {
  if (!Array.isArray(items)) throw new Error("Unable to read quote items.");
  return items.map(item => {
    if (!item || typeof item!=="object" || Array.isArray(item) ||
      !["description","quantity","unit","unit_rate","amount"].every(k=>typeof item[k]==="string")) throw new Error("Unable to read quote items.");
    return item as QuoteLine;
  });
}
export function quoteContact(q: Quote): string[] {
  const c=q.customer_snapshot;
  if (!c || typeof c!=="object" || Array.isArray(c)) return [];
  return [c.primary_contact_name,c.email,c.phone,c.billing_address_line1,c.billing_address_line2,
    [c.billing_city,c.billing_state,c.billing_postal_code].filter(Boolean).join(", "),c.billing_country].filter((v):v is string=>typeof v==="string" && !!v);
}
export function quoteInput(raw: unknown, requestId: string): { args?: Database["public"]["Functions"]["save_quote"]["Args"]; message?: string } {
  const validated=invoiceInput(raw,requestId);
  if (!validated.args) return {message:validated.message?.replaceAll("invoice","quote").replace("issue date","quote date")};
  const d=raw as QuoteDraft;
  if (typeof d.expiration_date!=="string" || (d.expiration_date && (!previewDueDate(d.expiration_date,0) || d.expiration_date<d.issue_date))) return {message:"Expiration must be on or after the quote date, or left blank."};
  if (d.items.some(i=>i.tax_amount!==undefined)) return {message:"Quote items support quantity and rate only."};
  if (d.quote_id && (!/^[0-9a-f-]{36}$/i.test(d.quote_id) || !Number.isSafeInteger(d.revision) || d.revision!<1)) return {message:"Refresh the quote before editing."};
  const a=validated.args;
  return {args:{p_customer_id:a.p_customer_id,p_quote_date:a.p_issue_date,p_items:a.p_items,p_request_id:requestId,
    p_expiration_date:d.expiration_date||undefined,p_notes:a.p_notes,p_terms:a.p_terms,p_quote_id:d.quote_id,p_revision:d.revision}};
}
