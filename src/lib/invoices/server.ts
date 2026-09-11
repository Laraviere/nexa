import "server-only";
import type { Tables } from "@/types/database";
import { notFound } from "next/navigation";
import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
export async function invoiceDetail(id: string) {
  const client = await customerClient();
  if (!isCustomerId(id)) notFound();
  const { data: invoice,error } = await client.from("invoices").select("*").eq("id",id).maybeSingle();
  if (error) throw new Error("Unable to load invoice.");
  if (!invoice) notFound();
  const items = [];
  for (let offset=0;;offset+=100) {
    const result = await client.from("invoice_items").select("*").eq("invoice_id",id).is("superseded_at",null).order("position").range(offset,offset+99);
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
  const customers: { id:string;company_name:string;is_active:boolean;default_payment_terms_days:number }[] = [];
  for (let offset=0;;offset+=100) {
    const result = await client.from("customers").select("id,company_name,is_active,default_payment_terms_days").order("company_name").order("id").range(offset,offset+99);
    if (result.error) throw new Error("Unable to load customers.");
    customers.push(...result.data);
    if (result.data.length<100) break;
  }
  return { customers,owner: String(data!.claims.sub) };
}

export async function generationCustomers(today: string) {
  const result = await invoiceCustomers();
  const client = await customerClient();
  const agreements: Pick<Tables<"customer_billing_agreements">,"customer_id"|"monthly_fee"|"billing_cycle_day"|"included_hours"|"overage_hourly_rate">[] = [];
  for (let offset=0;;offset+=100) {
    const {data,error} = await client.from("customer_billing_agreements")
      .select("customer_id,monthly_fee,billing_cycle_day,included_hours,overage_hourly_rate")
      .eq("is_active",true).lte("effective_date",today).or(`end_date.is.null,end_date.gt.${today}`)
      .order("id").range(offset,offset+99);
    if (error) throw new Error("Unable to load billing context.");
    agreements.push(...data);
    if (data.length<100) break;
  }
  return {...result,customers:result.customers.map(c=>({...c,agreement:agreements.find(a=>a.customer_id===c.id) ?? null}))};
}
