"use server";
import { revalidatePath } from "next/cache";
import { customerClient } from "@/lib/customers/server";
import { generationInput,generationError,type GenerationState,type GenerateResult } from "@/lib/invoices/generation";
export async function generateInvoice(_previous: GenerationState, form: FormData): Promise<GenerationState> {
  const client = await customerClient();
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("payload"))); } catch { return {message:"Check the invoice details."}; }
  const validated = generationInput(raw,String(form.get("request_id") ?? ""));
  if (!validated.args) return {message:validated.message};
  try {
    const {data,error} = await client.rpc("generate_customer_invoice",validated.args);
    if (error) return generationError(error.code,error.message);
    const result: GenerateResult | undefined = data?.[0];
    if (result?.outcome === "nothing_to_invoice") return {empty:true,message:"There is nothing eligible to invoice for this customer through the selected date."};
    if (result?.outcome !== "created" || !result.invoice_id) return {message:"We could not confirm the result. Retry this same submission safely.",uncertain:true};
    revalidatePath("/invoices");
    return {invoiceId:result.invoice_id};
  } catch { return {message:"Connection interrupted. Retry this same submission safely.",uncertain:true}; }
}
