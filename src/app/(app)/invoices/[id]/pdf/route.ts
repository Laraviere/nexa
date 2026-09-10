import { createClient } from "@/lib/supabase/server";
import { isCustomerId } from "@/lib/customers/validation";
import { InvoicePdfError, loadInvoicePdf } from "@/lib/invoices/pdf/data";
import { renderInvoicePdf } from "@/lib/invoices/pdf/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getClaims();
    if (error || !data?.claims) return Response.json({ message: "Sign in to view this invoice PDF." }, { status: 401, headers });
    const { id } = await params;
    if (!isCustomerId(id)) throw new InvoicePdfError(404, "Invoice not found.");
    const invoice = await loadInvoicePdf(client, id);
    const pdf = await renderInvoicePdf(invoice);
    return new Response(new Uint8Array(pdf), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Nexa-Invoice-${invoice.invoice.invoice_number}.pdf"` } });
  } catch (error) {
    return Response.json({ message: error instanceof InvoicePdfError ? error.message : "Unable to generate this invoice PDF. Please try again." }, { status: error instanceof InvoicePdfError ? error.status : 500, headers });
  }
}
