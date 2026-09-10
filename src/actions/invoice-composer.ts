"use server";
import { revalidatePath } from "next/cache";
import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
import { previewDueDate } from "@/lib/invoices/model";
import { businessDate } from "@/lib/billing/model";
import { composerInput,composerError,readCharges,type PreviewArgs,type PreviewState,type ComposerState,type ComposerResult } from "@/lib/invoices/composer";
export async function previewInvoice(args:PreviewArgs):Promise<PreviewState> {
  const client = await customerClient();
  const date=args?.p_as_of_date??businessDate();
  if (!args || !isCustomerId(args.p_customer_id) || typeof date!=="string" || date<"0001-01-01" || !previewDueDate(date,0)) return {message:"Choose a customer and a valid as-of date."};
  try {
    const {data,error} = await client.rpc("preview_customer_invoice",{p_customer_id:args.p_customer_id,p_as_of_date:date} satisfies PreviewArgs);
    const result=data?.[0];
    if (error || !result || readCharges(result.candidates)===null || !/^[0-9a-f]{64}$/.test(result.revision)) return {message:"Unable to load charges. Check the date and billing terms, then try again."};
    return {preview:result};
  } catch {return {message:"Unable to load charges. Please try again."};}
}
export async function saveComposedInvoice(_previous:ComposerState,form:FormData):Promise<ComposerState> {
  const client = await customerClient();
  let raw:unknown;
  try {raw=JSON.parse(String(form.get("payload")));} catch {return {message:"Check the invoice details."};}
  const validated=composerInput(raw,String(form.get("request_id")??""));
  if (!validated.args) return {message:validated.message};
  try {
    const {data,error}=await client.rpc("create_composed_invoice",validated.args);
    if (error) return composerError(error.code,error.message);
    const result:ComposerResult|undefined=data?.[0];
    if (!result?.invoice_id) return {message:"We could not confirm the result. Retry this same submission safely.",uncertain:true};
    revalidatePath("/invoices");return {invoiceId:result.invoice_id};
  } catch {return {message:"Connection interrupted. Retry this same submission safely.",uncertain:true};}
}

export async function previewInvoiceEdit(args:import("@/lib/invoices/composer").EditPreviewArgs):Promise<PreviewState> {
  const client=await customerClient();
  if (!isCustomerId(args.p_invoice_id) || !previewDueDate(args.p_as_of_date,0)) return {message:"Check the invoice and date."};
  try {
    const {data,error}=await client.rpc("preview_invoice_edit",args);
    if(error||!data?.[0]||readCharges(data[0].candidates)===null)return {message:"Unable to load this invoice's charges. Please refresh."};
    return {preview:data[0]};
  } catch {return {message:"Unable to load charges. Please try again."};}
}
export async function updateComposedInvoice(_previous:ComposerState,form:FormData):Promise<ComposerState> {
  const client=await customerClient();let raw:unknown;
  try {raw=JSON.parse(String(form.get("payload")));}catch{return {message:"Check the invoice details."};}
  const validated=composerInput(raw,String(form.get("request_id")??""));
  if(!validated.args)return {message:validated.message};
  const d=raw as import("@/lib/invoices/composer").ComposerPayload;
  if(!d.invoice_id||!isCustomerId(d.invoice_id))return {message:"Invoice unavailable."};
  const a=validated.args;
  const args:import("@/lib/invoices/composer").EditArgs={p_invoice_id:d.invoice_id,p_issue_date:a.p_issue_date,p_as_of_date:a.p_as_of_date,p_request_id:a.p_request_id,p_revision:a.p_revision,p_selected_candidate_ids:a.p_selected_candidate_ids,p_custom_items:a.p_custom_items,p_descriptions:d.descriptions??{},p_notes:a.p_notes,p_terms:a.p_terms};
  try {
    const {data,error}=await client.rpc("update_composed_invoice",args);
    if(error)return composerError(error.code,error.message);
    const result:import("@/lib/invoices/composer").EditResult|undefined=data?.[0];
    if(!result)return {message:"We could not confirm the edit. Retry this same submission.",uncertain:true};
    revalidatePath("/invoices");revalidatePath(`/invoices/${result.invoice_id}`);
    return {invoiceId:result.invoice_id};
  }catch{return {message:"We could not confirm the edit. Retry this same submission.",uncertain:true};}
}
