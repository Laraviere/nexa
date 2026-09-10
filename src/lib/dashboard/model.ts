import { businessDate } from "@/lib/billing/model";
import type { RetainerUsage } from "@/lib/billing/usage";
export function dashboardDates(now = new Date()) {
  const today = businessDate(now);
  const [year, month] = today.split("-").map(Number);
  return { today, monthStart: `${today.slice(0,7)}-01`, monthEnd: `${month === 12 ? year+1 : year}-${String(month === 12 ? 1 : month+1).padStart(2,"0")}-01` };
}
// Sum authoritative cent values, without recalculating any invoice/payment rules.
export function sumMoney(values: number[]) {
  const cents = values.reduce((sum,value) => {
    const next = Math.round(value*100);
    if (!Number.isFinite(value) || !Number.isSafeInteger(next)) throw new Error("Invalid dashboard amount");
    return sum + BigInt(next);
  },BigInt(0));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Dashboard amount exceeds display range");
  return Number(cents)/100;
}
export type AttentionInvoice = { id:string; invoice_number:number; company_name_snapshot:string; due_date:string|null; status:string; balance_due:number; payment_status:string };
export function invoicePriority(invoice: AttentionInvoice,today:string) {
  if (invoice.balance_due > 0 && invoice.due_date && invoice.due_date < today) return 0;
  if (invoice.status === "ready" && invoice.balance_due > 0) return 1;
  if (invoice.status === "sent" && invoice.balance_due > 0) return 2;
  if (invoice.payment_status === "partially_paid" && invoice.balance_due > 0) return 3;
  return 4;
}
export function prioritizeInvoices(invoices:AttentionInvoice[],today:string) {
  return invoices.filter(i=>i.status!=="void"&&(i.balance_due>0||i.status==="draft"))
    .sort((a,b)=>invoicePriority(a,today)-invoicePriority(b,today)||(a.due_date??"9999").localeCompare(b.due_date??"9999")||b.invoice_number-a.invoice_number).slice(0,6);
}
export function retainerNeedsAttention(usage:RetainerUsage) {
  return usage.overage_minutes>0 || (usage.included_minutes_available>0 && usage.remaining_included_minutes<=usage.included_minutes_available/4);
}
