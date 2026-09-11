import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";

export type InvoicePdfData = {
  checksPayableTo?: string | null;
  invoice: Tables<"invoices">;
  items: Tables<"invoice_items">[];
  totals: { subtotal: number; tax_amount: number; total: number };
};
export class InvoicePdfError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function check(error: { code?: string } | null) {
  if (error) throw new InvoicePdfError(error.code === "42501" ? 403 : 500, "Unable to load this invoice PDF.");
}

// Every read uses the caller's session and RLS. Invoice/child writes touch the
// parent revision, so reject mixed reads if an atomic edit commits while loading.
export async function loadInvoicePdf(client: SupabaseClient<Database>, id: string): Promise<InvoicePdfData> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const header = await client.from("invoices").select("*").eq("id", id).maybeSingle();
    check(header.error);
    if (!header.data) throw new InvoicePdfError(404, "Invoice not found.");
    const items: Tables<"invoice_items">[] = [];
    for (let offset = 0; ; offset += 100) {
      const result = await client.from("invoice_items").select("*").eq("invoice_id", id)
        .is("superseded_at", null).order("position").order("id").range(offset, offset + 99);
      check(result.error);
      items.push(...result.data!);
      if (result.data!.length < 100) break;
    }
    const summary = await client.from("invoice_totals").select("subtotal,tax_amount,total").eq("invoice_id", id).maybeSingle();
    check(summary.error);
    const revision = await client.from("invoices").select("updated_at").eq("id", id).maybeSingle();
    check(revision.error);
    if (!revision.data) throw new InvoicePdfError(404, "Invoice not found.");
    if (revision.data.updated_at !== header.data.updated_at) continue;
    const totals = summary.data;
    if (!totals || totals.subtotal === null || totals.tax_amount === null || totals.total === null) {
      throw new InvoicePdfError(500, "Unable to load invoice totals.");
    }
    // Current remittance instructions apply to old and new invoices alike.
    // Use this request's authenticated client; never cache a payee in invoice data.
    const settings = await client.from("payment_settings").select("checks_payable_to").eq("singleton",true).single();
    check(settings.error);
    if (!settings.data) throw new InvoicePdfError(500, "Unable to load invoice check instructions.");
    return { checksPayableTo: settings.data.checks_payable_to?.trim() || null, invoice: header.data, items, totals: { subtotal: totals.subtotal, tax_amount: totals.tax_amount, total: totals.total } };
  }
  throw new InvoicePdfError(409, "Invoice changed while preparing the PDF. Please try again.");
}
