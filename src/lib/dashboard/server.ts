import "server-only";
import { customerClient } from "@/lib/customers/server";
import { validUsageSummary } from "@/lib/billing/usage";
import { dashboardDates, prioritizeInvoices, retainerNeedsAttention, sumMoney, type AttentionInvoice } from "./model";

const PAGE=200, MAX_ROWS=2000, MAX_RETAINERS=25;
// PostgREST aggregates are disabled in the existing project. Read only the
// filtered KPI columns, with a hard cap; never present a truncated sum as truth.
async function boundedRows<T>(read:(start:number,end:number)=>PromiseLike<{data:T[]|null;error:unknown}>) {
  const rows:T[]=[];
  for(let start=0;start<=MAX_ROWS;start+=PAGE){
    const result=await read(start,Math.min(start+PAGE-1,MAX_ROWS));
    if(result.error||!result.data)throw new Error("Unable to load dashboard data.");
    rows.push(...result.data);
    if(rows.length>MAX_ROWS)return {rows:rows.slice(0,MAX_ROWS),complete:false};
    if(result.data.length<PAGE)return {rows,complete:true};
  }
  return {rows,complete:false};
}
export async function getDashboard(now=new Date()) {
  const client=await customerClient();
  return readDashboard(client,now);
}
// Separate from authentication only so local integration tests can supply an
// authenticated RLS client and a fixed business clock. Not a Server Action.
export async function readDashboard(client:Awaited<ReturnType<typeof customerClient>>,now=new Date()) {
  const dates=dashboardDates(now);
  const [balances,monthlyPayments,monthlyTime,ready,timer,recentPayments,recentTime,agreements,drafts]=await Promise.all([
    boundedRows((a,b)=>client.from("invoice_payment_summary").select("invoice_id,invoice_status,balance_due,payment_status").neq("invoice_status","void").gt("balance_due",0).order("invoice_id").range(a,b)),
    boundedRows((a,b)=>client.from("invoice_payments").select("amount").is("voided_at",null).gte("payment_date",dates.monthStart).lt("payment_date",dates.monthEnd).order("id").range(a,b)),
    boundedRows((a,b)=>client.from("time_entries").select("rounded_minutes").eq("is_billable",true).is("voided_at",null).gte("work_date",dates.monthStart).lt("work_date",dates.monthEnd).order("id").range(a,b)),
    client.from("invoices").select("id",{count:"exact",head:true}).eq("status","ready"),
    client.from("running_timers").select("id,description,started_at,stop_requested_at,customers(company_name)").maybeSingle(),
    client.from("invoice_payments").select("id,invoice_id,amount,payment_date,payment_method,invoices(invoice_number,company_name_snapshot)").is("voided_at",null).order("payment_date",{ascending:false}).order("created_at",{ascending:false}).order("id").limit(5),
    client.from("time_entries").select("id,customer_id,work_date,description,actual_minutes,rounded_minutes,is_billable,customers!time_entries_customer_fk(company_name)").is("voided_at",null).order("created_at",{ascending:false}).order("id").limit(5),
    client.from("customer_billing_agreements").select("id,customer_id,customers(company_name)").eq("is_active",true).lte("effective_date",dates.today).or(`end_date.is.null,end_date.gt.${dates.today}`).order("id").limit(MAX_RETAINERS+1),
    client.from("invoices").select("id,invoice_number,company_name_snapshot,due_date,status").eq("status","draft").order("due_date",{nullsFirst:false}).order("invoice_number",{ascending:false}).limit(6),
  ]);
  if([ready,timer,recentPayments,recentTime,agreements,drafts].some(r=>r.error))throw new Error("Unable to load dashboard data.");
  const invoiceRows:AttentionInvoice[]=[];
  const summary=new Map(balances.rows.map(b=>[b.invoice_id,b]));
  // View has no exposed relationship; batch invoice metadata, never one read per invoice.
  for(let start=0;start<balances.rows.length;start+=PAGE){
    const ids=balances.rows.slice(start,start+PAGE).map(b=>b.invoice_id).filter((id):id is string=>id!==null);
    const result=await client.from("invoices").select("id,invoice_number,company_name_snapshot,due_date,status").in("id",ids);
    if(result.error)throw new Error("Unable to load invoice attention.");
    for(const i of result.data){const s=summary.get(i.id)!;invoiceRows.push({...i,balance_due:s.balance_due!,payment_status:s.payment_status!});}
  }
  // Include zero-balance drafts as preparation work, without fabricating their payment status.
  const extraDrafts=drafts.data!.filter(i=>!summary.has(i.id));
  if(extraDrafts.length){
    const result=await client.from("invoice_payment_summary").select("invoice_id,balance_due,payment_status").in("invoice_id",extraDrafts.map(i=>i.id));
    if(result.error)throw new Error("Unable to load draft balances.");
    for(const i of extraDrafts){const s=result.data.find(s=>s.invoice_id===i.id);if(s?.balance_due!=null&&s.payment_status)invoiceRows.push({...i,balance_due:s.balance_due,payment_status:s.payment_status});}
  }
  const retainers=[];const retainerErrors:string[]=[];
  const current=agreements.data!.slice(0,MAX_RETAINERS);
  for(let start=0;start<current.length;start+=5){
    const group=await Promise.all(current.slice(start,start+5).map(async agreement=>{
      const {data,error}=await client.rpc("get_retainer_period_usage",{p_billing_agreement_id:agreement.id,p_reference_date:dates.today})
        .select("billing_agreement_id,customer_id,included_minutes_available,included_minutes_used,remaining_included_minutes,rounded_minutes_used,overage_minutes,overage_amount,period_start,period_end");
      const usage=data?.[0];
      if(error||!usage||data?.length!==1||!validUsageSummary({...usage,allocations:[]})||usage.customer_id!==agreement.customer_id||usage.billing_agreement_id!==agreement.id||dates.today<usage.period_start||dates.today>=usage.period_end){retainerErrors.push(agreement.customers?.company_name??"Customer");return null;}
      return retainerNeedsAttention({...usage,allocations:[]})?{customerId:agreement.customer_id,customer:agreement.customers?.company_name??"Customer",usage}:null;
    }));
    retainers.push(...group.filter(r=>r!==null));
  }
  retainers.sort((a,b)=>b.usage.overage_minutes-a.usage.overage_minutes||a.usage.remaining_included_minutes-b.usage.remaining_included_minutes||a.customer.localeCompare(b.customer));
  return {dates,observedAt:now.getTime(),
    outstanding:balances.complete?sumMoney(balances.rows.map(b=>b.balance_due!)):null,
    paymentsThisMonth:monthlyPayments.complete?sumMoney(monthlyPayments.rows.map(p=>p.amount)):null,
    billableMinutes:monthlyTime.complete?monthlyTime.rows.reduce((sum,t)=>sum+t.rounded_minutes,0):null,
    readyCount:ready.count!,timer:timer.data,attention:prioritizeInvoices(invoiceRows,dates.today),attentionComplete:balances.complete,
    payments:recentPayments.data!,time:recentTime.data!,retainers:retainers.slice(0,5),retainerErrors,retainersComplete:agreements.data!.length<=MAX_RETAINERS};
}
export type DashboardData=Awaited<ReturnType<typeof readDashboard>>;
