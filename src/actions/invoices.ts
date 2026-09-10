"use server";
import { revalidatePath } from "next/cache";
import { customerClient } from "@/lib/customers/server";
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

export async function changeInvoiceStatus(_previous: InvoiceState,form:FormData):Promise<InvoiceState> {
  const client=await customerClient();
  const id=String(form.get("invoice_id")??"");
  const target=String(form.get("target")??"");
  const revision=String(form.get("updated_at")??"");
  if(!/^[0-9a-f-]{36}$/i.test(id)||!revision||!['draft','ready'].includes(target)||form.get('confirmed')!=='yes') return {message:"Confirm the invoice status change."};
  try {
    const {data,error}=await client.from('invoices').update({status:target}).eq('id',id).eq('status',target==='ready'?'draft':'ready').eq('updated_at',revision).select('id').maybeSingle();
    if(error)return {message:"Unable to change status. Check the invoice items and try again."};
    if(!data)return {message:"This invoice changed. Refresh it before changing its status."};
    revalidatePath('/invoices');revalidatePath(`/invoices/${id}`);return {message:target==='ready'?'Invoice marked Ready.':'Invoice moved to Draft.'};
  }catch{return {message:"Unable to confirm the status change. Refresh to check its current status."};}
}
