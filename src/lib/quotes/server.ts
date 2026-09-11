import "server-only";
import { notFound } from "next/navigation";
import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
export async function quoteDetail(id: string) {
  const client=await customerClient();
  if (!isCustomerId(id)) notFound();
  const {data,error}=await client.from("quotes").select("*").eq("id",id).maybeSingle();
  if (error) throw new Error("Unable to load quote.");
  if (!data) notFound();
  return data;
}
export async function sourceQuote(invoiceId: string) {
  const client=await customerClient();
  const {data,error}=await client.from("quotes").select("id,quote_number").eq("converted_invoice_id",invoiceId).maybeSingle();
  if (error) throw new Error("Unable to load source quote.");
  return data;
}
