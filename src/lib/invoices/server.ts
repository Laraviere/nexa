import "server-only";
import { notFound } from "next/navigation";
import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
export async function invoiceList(status: string, page: number) {
  const client = await customerClient();
  let query = client.from("invoices").select("id,invoice_number,company_name_snapshot,issue_date,due_date,status").order("invoice_number",{ ascending: false });
  if (status !== "all") query = query.eq("status",status);
  const { data,error } = await query.range((page-1)*25,page*25);
  if (error) throw new Error("Unable to load invoices.");
  const rows = data.slice(0,25);
  const totals = rows.length ? await client.from("invoice_totals").select("invoice_id,total").in("invoice_id",rows.map(r=>r.id)) : { data: [],error: null };
  if (totals.error || rows.some(r=> !totals.data?.some(t=>t.invoice_id===r.id && t.total !== null))) throw new Error("Unable to load invoice totals.");
  return { rows: rows.map(r=>({...r,total: totals.data!.find(t=>t.invoice_id===r.id)!.total!})), hasNext: data.length>25 };
}
export async function invoiceDetail(id: string) {
  const client = await customerClient();
  if (!isCustomerId(id)) notFound();
  const { data: invoice,error } = await client.from("invoices").select("*").eq("id",id).maybeSingle();
  if (error) throw new Error("Unable to load invoice.");
  if (!invoice) notFound();
  const items = [];
  for (let offset=0;;offset+=100) {
    const result = await client.from("invoice_items").select("*").eq("invoice_id",id).order("position").range(offset,offset+99);
    if (result.error) throw new Error("Unable to load invoice lines.");
    items.push(...result.data);
    if (result.data.length<100) break;
  }
  const { data: totals,error: totalsError } = await client.from("invoice_totals").select("*").eq("invoice_id",id).single();
  if (totalsError || totals.total===null || totals.subtotal===null || totals.tax_amount===null) throw new Error("Unable to load invoice totals.");
  return { invoice,items,totals };
}
export async function invoiceCustomers() {
  const client = await customerClient();
  const { data } = await client.auth.getClaims();
  const customers: { id:string;company_name:string;is_active:boolean }[] = [];
  for (let offset=0;;offset+=100) {
    const result = await client.from("customers").select("id,company_name,is_active").order("company_name").order("id").range(offset,offset+99);
    if (result.error) throw new Error("Unable to load customers.");
    customers.push(...result.data);
    if (result.data.length<100) break;
  }
  return { customers,owner: String(data!.claims.sub) };
}
