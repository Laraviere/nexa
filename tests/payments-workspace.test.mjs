import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {dashboardHarness} from './dashboard-harness.mjs';
import {inspectPdf} from './helpers/pdf.mjs';
const id='12345678-1234-4234-8234-123456789012';
const load=dashboardHarness();
const {paymentFilters,paymentReportUrl,parsePaymentReport}=load('@/lib/payments/report');
test('receipt-date URL filters validate input and preserve pagination state',()=>{
 assert.equal(paymentFilters({}).args.p_status,'active');
 for(const params of [{page:'0'},{page:'2147483648'},{from:'2026-02-30'},{from:'2026-09-02',to:'2026-09-01'},{method:'stripe'},{status:'paid'},{customer:'bad'},{q:['a','b']}])assert.ok(paymentFilters(params).message);
 const f=paymentFilters({q:' Receipt ',method:'ach',status:'all',from:'2026-09-01',to:'2026-09-15',customer:id});assert.equal(f.message,undefined);assert.equal(f.args.p_payment_date_from,'2026-09-01');assert.equal(f.args.p_search,'Receipt');
 const url=paymentReportUrl(f.values,2);assert.match(url,/page=2/);assert.match(url,/method=ach/);assert.match(url,/status=all/);
});
test('ledger uses complete RPC totals and separates payment void from invoice void',()=>{
 const filters=paymentFilters({status:'all'});
 const result={page:1,page_size:25,total_rows:100,total_pages:4,payments_received:990,payment_count:99,average_payment:10,rows:[{payment_id:id,invoice_id:id,customer_id:id,invoice_number:1001,company_name_snapshot:'Example',invoice_status:'void',payment_date:'2026-09-01',amount:999,payment_method:'other',reference:'Check 123',payment_status:'active'}]};
 const report=parsePaymentReport(result);const html=renderToStaticMarkup(createElement(load('@/components/payments/report-view').PaymentReportView,{data:{filters,customers:[],report}}));
 assert.match(html,/\$990.00/);assert.match(html,/Invoice Void/);assert.match(html,/>Active</);assert.match(html,/Check 123/);assert.match(html,/\/customers\//);assert.match(html,/#payment-history/);assert.match(html,/page=2/);assert.match(html,/Record Payment/);assert.match(html,/Payment date From/);assert.match(html,/>ACH</);assert.match(html,/>Other</);
 assert.throws(()=>parsePaymentReport({...result,rows:[{...result.rows[0],amount:null}]}));
});
test('all five recording methods and future server errors use the existing action',async()=>{
 const paths=[],calls=[];let error=null;
 const actions=dashboardHarness({'next/cache':{revalidatePath:p=>paths.push(p)},'@/lib/customers/server':{customerClient:async()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data:[{invoice_id:id}],error};}})}})('@/actions/payments');
 const f=new FormData();Object.entries({invoice_id:id,request_id:id,amount:'10.01',payment_date:'2026-01-01'}).forEach(([k,v])=>f.set(k,v));
 for(const method of ['cash','check','card','ach','other']){f.set('payment_method',method);assert.equal((await actions.recordPayment({},f)).success,true);assert.equal(calls.at(-1)[1].p_payment_method,method);}
 for(const path of ['/payments','/invoices',`/invoices/${id}`,'/dashboard'])assert.ok(paths.includes(path));
 error={code:'22023',message:'Payment date cannot be in the future.'};assert.match((await actions.recordPayment({},f)).message,/after today in New York/);
 const settings=new FormData();settings.set('ach_enabled','on');error=null;assert.equal((await actions.savePaymentSettings({},settings)).success,true);assert.equal(calls.at(-1)[1].p_ach_enabled,true);
});
test('invoice PDFs show partial/full balances once, keep unpaid output and paginate; quotes stay payment-free',async()=>{
 const {renderInvoicePdf}=load('@/lib/invoices/pdf/document');
 const base={invoice:{invoice_number:1001,status:'ready',company_name_snapshot:'Example',issue_date:'2025-01-01',due_date:'2025-02-01',notes:'Thank you',terms:'Net 30'},items:[{id:'a',description:'Support',quantity:1,unit:'flat',unit_rate:500,amount:500}],totals:{subtotal:500,tax_amount:0,total:500},checksPayableTo:'Example Payee'};
 const unpaid=await inspectPdf(await renderInvoicePdf({...base,payment:{amount_paid:0,balance_due:500,payment_status:'unpaid'}}));assert.doesNotMatch(unpaid.text,/Amount Paid|Balance Due|Paid in full/);
 for(const [paid,balance,status] of [[200,300,'partially_paid'],[500,0,'paid']]){
  const pdf=await inspectPdf(await renderInvoicePdf({...base,payment:{amount_paid:paid,balance_due:balance,payment_status:status}}));assert.match(pdf.text,/Invoice Total/);assert.match(pdf.text,/Amount Paid/);assert.match(pdf.text,new RegExp(`Balance Due \\$${balance}.00`));assert.equal(pdf.text.includes('Paid in full'),balance===0);assert.match(pdf.text,/2025/);assert.match(pdf.text,/Checks payable to: Example Payee/);
 }
 const long=await inspectPdf(await renderInvoicePdf({...base,items:Array.from({length:90},(_,i)=>({...base.items[0],id:String(i)})),payment:{amount_paid:200,balance_due:300,payment_status:'partially_paid'}}));assert.ok(long.pages.length>1);assert.equal(long.text.match(/Balance Due/g).length,1);
 const quote={quote_number:1001,company_name_snapshot:'Example',customer_snapshot:{},status:'accepted',quote_date:'2025-01-01',expiration_date:null,items:[{description:'Support',quantity:'1',unit:'flat',unit_rate:'500',amount:'500'}],total:500,subtotal:500,payment:{amount_paid:200,balance_due:300,payment_status:'partially_paid'}};
 assert.doesNotMatch((await inspectPdf(await load('@/lib/quotes/pdf').renderQuotePdf(quote,'2026-09-15'))).text,/Amount Paid|Balance Due|Paid in full/);
});
test('PDF revision check retries a payment that commits between reads',async()=>{
 let attempt=0;const client={from(table){return {select(){return this},eq(){return this},is(){return this},order(){return this},range:async()=>({data:[],error:null}),single:async()=>({data:{checks_payable_to:null},error:null}),maybeSingle:async()=>{
 if(table==='invoices'){attempt++;return {data:{updated_at:attempt===1?'old':'new'},error:null};}
 return {data:table==='invoice_totals'?{subtotal:100,tax_amount:0,total:100}:{invoice_total:100,amount_paid:25,balance_due:75,payment_status:'partially_paid'},error:null};
 }}}};
 const result=await load('@/lib/invoices/pdf/data').loadInvoicePdf(client,id);assert.equal(attempt,4);assert.equal(result.payment.balance_due,75);
});
