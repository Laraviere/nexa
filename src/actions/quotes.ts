"use server";
import { revalidatePath } from "next/cache";
import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
import { previewDueDate } from "@/lib/invoices/model";
import { quoteInput, type QuoteState } from "@/lib/quotes/model";
function quoteError(code: string): QuoteState {
  if (code==="40001") return {message:"This quote changed. Refresh it before continuing."};
  if (["22023","55000","P0002","23514"].includes(code)) return {message:"Unable to save. Check the dates and lines; only unconverted drafts can be edited, and expired quotes must be revised before acceptance."};
  return {message:"We could not confirm the result. Retry the same submission safely.",uncertain:true};
}
export async function saveQuote(_previous:QuoteState,form:FormData):Promise<QuoteState> {
  const client=await customerClient();
  let raw:unknown;
  try{raw=JSON.parse(String(form.get("payload")));}catch{return {message:"Check the quote details."};}
  const input=quoteInput(raw,String(form.get("request_id")??""));
  if (!input.args) return {message:input.message};
  try {
    const {data,error}=await client.rpc("save_quote",input.args);
    if(error)return quoteError(error.code);
    if(!data)return quoteError("");
    revalidatePath("/quotes");revalidatePath(`/quotes/${data}`);return {quoteId:data};
  }catch{return quoteError("");}
}
export async function updateQuoteStatus(_previous:QuoteState,form:FormData):Promise<QuoteState> {
  const client=await customerClient();const id=String(form.get("quote_id"));
  const revision=Number(form.get("revision"));const status=String(form.get("status"));
  if(!isCustomerId(id)||!Number.isSafeInteger(revision)||revision<1||!["draft","sent","accepted","declined"].includes(status))return {message:"Check the requested status."};
  try {
    const {error}=await client.rpc("change_quote_status",{p_quote_id:id,p_revision:revision,p_status:status});
    if(error)return quoteError(error.code);
    revalidatePath("/quotes");revalidatePath(`/quotes/${id}`);return {message:"Quote status updated."};
  }catch{return quoteError("");}
}
export async function convertQuote(_previous:QuoteState,form:FormData):Promise<QuoteState> {
  const client=await customerClient();const id=String(form.get("quote_id"));
  const revision=Number(form.get("revision"));const date=String(form.get("issue_date"));
  if(!isCustomerId(id)||!Number.isSafeInteger(revision)||revision<1||!previewDueDate(date,0)||date<"0001-01-01"||form.get("confirmed")!=="yes")return {message:"Confirm conversion and enter a valid invoice date."};
  try {
    const {data,error}=await client.rpc("convert_quote_to_invoice",{p_quote_id:id,p_issue_date:date,p_revision:revision});
    if(error)return quoteError(error.code);
    if(!data)return quoteError("");
    revalidatePath("/quotes");revalidatePath(`/quotes/${id}`);revalidatePath("/invoices");return {invoiceId:data};
  }catch{return quoteError("");}
}
