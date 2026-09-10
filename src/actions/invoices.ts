"use server";
import { revalidatePath } from "next/cache";
import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
import { invoiceInput, type InvoiceState, type CreateInvoiceResult } from "@/lib/invoices/model";
export async function createInvoice(_previous: InvoiceState, form: FormData): Promise<InvoiceState> {
  const supabase = await customerClient();
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("payload"))); } catch { return { message: "Check the invoice details." }; }
  const validated = invoiceInput(raw,String(form.get("request_id") ?? ""));
  if (!validated.args) return { message: validated.message };
  try {
    const { data,error } = await supabase.rpc("create_manual_invoice",validated.args);
    if (error) {
      if (error.code === "P0002") return { message: "This customer is unavailable. Choose another customer." };
      if (error.code === "22023" && !error.message.includes("Request ID")) return { message: "The invoice could not be saved. Check the date, quantities and rates." };
      return { message: "We could not confirm the result. Retry this same submission to check or complete it safely.", uncertain: true };
    }
    const saved: CreateInvoiceResult | undefined = data?.[0];
    if (!saved) return { message: "We could not confirm the result. Retry this same submission.", uncertain: true };
    revalidatePath("/invoices");
    return { invoiceId: saved.invoice_id };
  } catch { return { message: "Connection interrupted. Retry this same submission safely.", uncertain: true }; }
}
export async function finalizeInvoice(_previous: InvoiceState, form: FormData): Promise<InvoiceState> {
  const supabase = await customerClient();
  const id = String(form.get("invoice_id") ?? "");
  if (!isCustomerId(id) || form.get("confirmed") !== "yes") return { message: "Confirm that the invoice should be finalized." };
  try {
    const { data,error } = await supabase.from("invoices").update({ status: "sent" }).eq("id",id).eq("status","draft").select("id").maybeSingle();
    if (error) return { message: "Unable to finalize this invoice. Refresh and check its lines before trying again." };
    if (!data) return { message: "This invoice is no longer a draft. Refresh to see its current status." };
    revalidatePath(`/invoices/${id}`); revalidatePath("/invoices");
    return { message: "Invoice finalized." };
  } catch { return { message: "Unable to confirm finalization. Refresh to check the invoice status." }; }
}
