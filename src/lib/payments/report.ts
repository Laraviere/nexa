import type { Database } from "@/types/database";
import { paymentMethods } from "./model";
import { isBusinessDate } from "@/lib/billing/validation";
import { isCustomerId } from "@/lib/customers/validation";
import { statuses } from "@/lib/invoices/model";
export type ReportParams = Record<string,string|string[]|undefined>;
type Result = Database["public"]["Functions"]["get_payment_report"]["Returns"][number];
export function paymentFilters(params: ReportParams) {
  const text=(key:string)=>typeof params[key]==="string"?params[key].trim():"";
  const values={q:text("q"),customer:text("customer"),method:text("method"),status:text("status")||"active",from:text("from"),to:text("to"),page:text("page")||"1"};
  let message:string|undefined;
  if(Object.keys(values).some(key=>Array.isArray(params[key])))message="Choose one value for each filter.";
  else if(values.q.length>500)message="Search must be 500 characters or fewer.";
  else if(values.customer&&!isCustomerId(values.customer))message="Choose a valid customer.";
  else if(values.method&&!Object.hasOwn(paymentMethods,values.method))message="Choose a valid payment method.";
  else if(!["active","voided","all"].includes(values.status))message="Choose a valid payment status.";
  else if((values.from&&!isBusinessDate(values.from))||(values.to&&!isBusinessDate(values.to)))message="Enter valid payment dates.";
  else if(values.from&&values.to&&values.from>values.to)message="Payment date From must be on or before To.";
  else if(!/^\d{1,10}$/.test(values.page)||Number(values.page)<1||Number(values.page)>2147483647)message="Choose a valid page.";
  const args:Database["public"]["Functions"]["get_payment_report"]["Args"]={p_search:values.q||undefined,p_customer_id:values.customer||undefined,p_method:values.method||undefined,p_status:values.status,p_payment_date_from:values.from||undefined,p_payment_date_to:values.to||undefined,p_page:Number(values.page),p_page_size:25};
  return {values,args,message};
}
export function paymentReportUrl(values:ReturnType<typeof paymentFilters>["values"],page=1) {
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(values))if(key!=="page"&&value&&!(key==="status"&&value==="active"))query.set(key,value);
  if(page>1)query.set("page",String(page));
  return `/payments${query.size?`?${query}`:""}`;
}
function row(value:Result["rows"]) {
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid payment row");
  const {payment_id,invoice_id,invoice_number,customer_id,company_name_snapshot,invoice_status,payment_date,amount,payment_method,reference,payment_status}=value;
  if(typeof payment_id!=="string"||!isCustomerId(payment_id)||typeof invoice_id!=="string"||!isCustomerId(invoice_id)||typeof customer_id!=="string"||!isCustomerId(customer_id)
    ||typeof invoice_number!=="number"||!Number.isSafeInteger(invoice_number)||invoice_number<1||typeof company_name_snapshot!=="string"
    ||typeof invoice_status!=="string"||!Object.hasOwn(statuses,invoice_status)||typeof payment_date!=="string"||!isBusinessDate(payment_date)
    ||typeof amount!=="number"||!Number.isFinite(amount)||amount<=0||typeof payment_method!=="string"||!Object.hasOwn(paymentMethods,payment_method)
    ||(reference!==null&&typeof reference!=="string")||(payment_status!=="active"&&payment_status!=="voided"))throw Error("Invalid payment row");
  return {payment_id,invoice_id,invoice_number,customer_id,company_name_snapshot,invoice_status,payment_date,amount,payment_method,reference,payment_status};
}
export function parsePaymentReport(result:Result) {
  if(!Array.isArray(result.rows)||![result.page,result.page_size,result.total_rows,result.total_pages,result.payment_count].every(n=>Number.isSafeInteger(n)&&n>=0)
    ||result.page<1||result.page_size<1||result.page_size>100||result.rows.length>result.page_size
    ||![result.payments_received,result.average_payment].every(n=>Number.isFinite(n)&&n>=0))throw Error("Invalid payment report");
  return {summary:result,rows:result.rows.map(row)};
}
