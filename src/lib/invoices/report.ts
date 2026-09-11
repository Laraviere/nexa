import type { Database } from "@/types/database";
import { statuses } from "@/lib/invoices/model";
import { paymentStatuses } from "@/lib/payments/model";
import { isBusinessDate } from "@/lib/billing/validation";
import { isCustomerId } from "@/lib/customers/validation";
export type ReportArgs=Database["public"]["Functions"]["get_invoice_report"]["Args"];
export type ReportResult=Database["public"]["Functions"]["get_invoice_report"]["Returns"][number];
export type ReportParams=Record<string,string|string[]|undefined>;
export const reportSorts={newest:"Newest",oldest:"Oldest",highest_balance:"Highest balance"};
export function reportFilters(params:ReportParams) {
  const text=(key:string)=>typeof params[key]==="string"?params[key].trim():"";
  const workflow=text("workflow")||(params.workflow===undefined?text("status"):"");
  const values={q:text("q"),workflow:workflow==="all"?"":workflow,payment:text("payment")==="all"?"":text("payment"),customer:text("customer"),from:text("from"),to:text("to"),overdue:text("overdue"),sort:text("sort")||"newest",page:text("page")||"1"};
  let message:string|undefined;
  if(Object.entries(params).some(([key,value])=>[...Object.keys(values),"status"].includes(key)&&Array.isArray(value)))message="Choose one value for each filter.";
  else if(values.q.length>500)message="Search must be 500 characters or fewer.";
  else if(values.workflow&&!Object.hasOwn(statuses,values.workflow))message="Choose a valid workflow status.";
  else if(values.payment&&!Object.hasOwn(paymentStatuses,values.payment))message="Choose a valid payment status.";
  else if(values.customer&&!isCustomerId(values.customer))message="Choose a valid customer.";
  else if((values.from&&!isBusinessDate(values.from))||(values.to&&!isBusinessDate(values.to)))message="Enter valid issue dates.";
  else if(values.from&&values.to&&values.from>values.to)message="Issue date From must be on or before To.";
  else if(values.overdue&&values.overdue!=="1")message="Choose a valid Overdue only setting.";
  else if(!Object.hasOwn(reportSorts,values.sort))message="Choose a valid sort order.";
  else if(!/^\d{1,10}$/.test(values.page)||Number(values.page)<1||Number(values.page)>2147483647)message="Choose a valid page number.";
  const args:ReportArgs={p_search:values.q||undefined,p_workflow_status:values.workflow||undefined,p_payment_status:values.payment||undefined,p_customer_id:values.customer||undefined,p_issue_date_from:values.from||undefined,p_issue_date_to:values.to||undefined,p_overdue_only:values.overdue==="1",p_sort:values.sort,p_page:Number(values.page),p_page_size:25};
  return {values,args,message};
}
export function reportUrl(values:ReturnType<typeof reportFilters>["values"],page=1) {
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(values)){if(key!=="page"&&value&&!(key==="sort"&&value==="newest"))query.set(key,value);}
  if(page>1)query.set("page",String(page));
  return `/invoices${query.size?`?${query}`:""}`;
}
// Generated rows are Json. Narrow the display fields at the boundary rather
// than inventing a second RPC return interface or trusting unchecked casts.
function reportRow(value:ReportResult["rows"]) {
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid report row");
  const {invoice_id,invoice_number,customer_id,company_name_snapshot,issue_date,due_date,workflow_status,payment_status,invoice_total,amount_paid,balance_due,overdue}=value;
  if(typeof invoice_id!=="string"||!isCustomerId(invoice_id)||typeof customer_id!=="string"||!isCustomerId(customer_id)
    ||typeof invoice_number!=="number"||!Number.isSafeInteger(invoice_number)||invoice_number<1
    ||typeof company_name_snapshot!=="string"||typeof issue_date!=="string"||!isBusinessDate(issue_date)||typeof due_date!=="string"||!isBusinessDate(due_date)
    ||typeof workflow_status!=="string"||!Object.hasOwn(statuses,workflow_status)||typeof payment_status!=="string"||!Object.hasOwn(paymentStatuses,payment_status)
    ||typeof invoice_total!=="number"||!Number.isFinite(invoice_total)||typeof amount_paid!=="number"||!Number.isFinite(amount_paid)||typeof balance_due!=="number"||!Number.isFinite(balance_due)||typeof overdue!=="boolean")throw Error("Invalid report row");
  return {invoice_id,invoice_number,customer_id,company_name_snapshot,issue_date,due_date,workflow_status,payment_status,invoice_total,amount_paid,balance_due,overdue};
}
export function parseReport(result:ReportResult) {
  if(!Array.isArray(result.rows)||!isBusinessDate(result.resolved_as_of_date)
    ||![result.page,result.page_size,result.total_rows,result.total_pages,result.invoice_count].every(n=>Number.isSafeInteger(n)&&n>=0)
    ||result.page<1||result.page_size<1||result.page_size>100||result.rows.length>result.page_size
    ||![result.total_invoiced,result.amount_paid,result.outstanding_balance].every(n=>Number.isFinite(n)&&n>=0))throw Error("Invalid report");
  return {summary:result,rows:result.rows.map(reportRow)};
}
export type ParsedReport=ReturnType<typeof parseReport>;
