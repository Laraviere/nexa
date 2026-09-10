import "server-only";
import { customerClient } from "@/lib/customers/server";
import { paymentStatuses, type Payment } from "./model";
export async function paymentSettings() {
  const client = await customerClient();
  const { data, error } = await client.from("payment_settings").select("*").eq("singleton",true).single();
  if (error || !data) throw new Error("Unable to load payment settings.");
  return data;
}
export async function invoicePayments(id: string) {
  const client = await customerClient();
  const { data: claims } = await client.auth.getClaims();
  const { data: summary, error } = await client.from("invoice_payment_summary").select("*").eq("invoice_id",id).single();
  if (error || !summary || summary.invoice_total === null || summary.amount_paid === null || summary.balance_due === null || !summary.payment_status || !Object.hasOwn(paymentStatuses,summary.payment_status)) throw new Error("Unable to load invoice payment summary.");
  const history: Payment[] = [];
  for (let offset=0;;offset+=100) {
    const result = await client.from("invoice_payments").select("*").eq("invoice_id",id).order("payment_date",{ascending:false}).order("created_at",{ascending:false}).order("id").range(offset,offset+99);
    if (result.error) throw new Error("Unable to load payment history.");
    history.push(...result.data);
    if (result.data.length < 100) break;
  }
  return { summary, history, owner: String(claims!.claims.sub), settings: await paymentSettings() };
}
