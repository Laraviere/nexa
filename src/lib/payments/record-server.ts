import "server-only";
import { customerClient } from "@/lib/customers/server";
import { invoiceCustomers } from "@/lib/invoices/server";
import { invoicePayments } from "./server";
import { isCustomerId } from "@/lib/customers/validation";
import type { ReportParams } from "./report";
export async function paymentSelection(params:ReportParams) {
  const {customers,owner}=await invoiceCustomers();
  const customer=typeof params.customer==="string"?params.customer:"";
  const invoiceId=typeof params.invoice==="string"?params.invoice:"";
  if((customer&&!isCustomerId(customer))||(invoiceId&&!isCustomerId(invoiceId))||Array.isArray(params.customer)||Array.isArray(params.invoice))throw Error("Choose a valid customer and invoice.");
  const client=await customerClient();
  const invoices:{id:string;invoice_number:number;balance_due:number}[]=[];
  if(customer)for(let offset=0;;offset+=100){
    const result=await client.from("invoices").select("id,invoice_number").eq("customer_id",customer).in("status",["ready","sent"]).order("invoice_number",{ascending:false}).order("id").range(offset,offset+99);
    if(result.error)throw Error("Unable to load eligible invoices.");
    if(result.data.length){
      const balances=await client.from("invoice_payment_summary").select("invoice_id,balance_due").in("invoice_id",result.data.map(i=>i.id));
      if(balances.error)throw Error("Unable to load invoice balances.");
      for(const invoice of result.data){const balance=balances.data.find(b=>b.invoice_id===invoice.id)?.balance_due;if(balance===undefined||balance===null)throw Error("Unable to load invoice balance.");if(balance>0)invoices.push({...invoice,balance_due:balance});}
    }
    if(result.data.length<100)break;
  }
  // Keep an explicitly selected invoice mounted even after it becomes paid.
  // The shared form can then confirm an uncertain submission using its saved key.
  let selected=null;
  if(customer&&invoiceId){
    const {data:invoice,error}=await client.from("invoices").select("id,invoice_number,status,customer_id").eq("id",invoiceId).eq("customer_id",customer).maybeSingle();
    if(error||!invoice)throw Error("The selected invoice is unavailable for this customer.");
    const payments=await invoicePayments(invoiceId);
    selected={invoice,...payments,canRecord:["ready","sent"].includes(invoice.status)&&payments.summary.balance_due!>0};
  }
  return {customers,owner,customer,invoiceId,invoices,selected};
}
