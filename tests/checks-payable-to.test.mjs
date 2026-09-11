import assert from 'node:assert/strict';
import test from 'node:test';
import {dashboardHarness} from './dashboard-harness.mjs';
import {inspectPdf} from './helpers/pdf.mjs';
const fixture=()=>({invoice:{invoice_number:1001,status:'draft',company_name_snapshot:'Example',issue_date:'2026-09-01',due_date:'2026-10-01',notes:null,terms:null},items:[{id:'1',description:'Support',quantity:1,unit:'hour',unit_rate:120,amount:120}],totals:{subtotal:120,tax_amount:0,total:120}});
test('check payee saves trimmed text through its dedicated RPC without changing payment methods',async()=>{
 const calls=[];const load=dashboardHarness({'@/lib/customers/server':{customerClient:async()=>({rpc:async(...args)=>{calls.push(args);return {data:{checks_payable_to:args[1].p_checks_payable_to},error:null};}})},'next/cache':{revalidatePath:()=>{}}});
 const {saveChecksPayableTo}=load('@/actions/payments');const f=new FormData();f.set('checks_payable_to','  Example Payee LLC  ');
 assert.equal((await saveChecksPayableTo({},f)).success,true);assert.deepEqual(calls[0],['update_checks_payable_to',{p_checks_payable_to:'Example Payee LLC'}]);
 f.set('checks_payable_to','   ');assert.equal((await saveChecksPayableTo({},f)).success,true);assert.equal(calls[1][1].p_checks_payable_to,'');
 f.set('checks_payable_to','x'.repeat(201));assert.match((await saveChecksPayableTo({},f)).message,/200/);assert.equal(calls.length,2);
});
test('invoice PDF payee is optional and printed once after multi-page content; quotes never show it',async()=>{
 const load=dashboardHarness(),{renderInvoicePdf}=load('@/lib/invoices/pdf/document');
 for(const payee of [undefined,null,'','   ']){const pdf=await inspectPdf(await renderInvoicePdf({...fixture(),checksPayableTo:payee}));assert.doesNotMatch(pdf.text,/Checks payable to/);}
 const data=fixture();data.checksPayableTo='Example Payee LLC';data.items=Array.from({length:90},(_,i)=>({...data.items[0],id:String(i),description:`Service ${i}`}));
 const pdf=await inspectPdf(await renderInvoicePdf(data));assert.ok(pdf.pages.length>1);assert.equal(pdf.text.match(/Checks payable to:/g).length,1);assert.match(pdf.pages.at(-1).text,/Checks payable to: Example Payee LLC/);
 const quote={quote_number:1001,company_name_snapshot:'Example',customer_snapshot:{},status:'accepted',quote_date:'2026-09-01',expiration_date:null,items:[{description:'Support',quantity:'1',unit:'hour',unit_rate:'120',amount:'120'}],total:120,subtotal:120,checksPayableTo:'Example Payee LLC'};
 assert.doesNotMatch((await inspectPdf(await load('@/lib/quotes/pdf').renderQuotePdf(quote,'2026-09-11'))).text,/Checks payable to|Example Payee/);
});
test('existing invoice loads current payee on every PDF read without writing financial rows',async()=>{
 const data=fixture();let payee='First Payee';let error=null;
 const client={from(table){return {select(){return this},eq(){return this},is(){return this},order(){return this},range:async()=>({data:data.items,error:null}),maybeSingle:async()=>({data:table==='invoices'?{...data.invoice,updated_at:'fixed'}:data.totals,error:null}),single:async()=>({data:{checks_payable_to:payee},error})};}};
 const {loadInvoicePdf}=dashboardHarness()('@/lib/invoices/pdf/data');
 const first=await loadInvoicePdf(client,'existing');assert.equal(first.checksPayableTo,'First Payee');payee='Second Payee';assert.equal((await loadInvoicePdf(client,'existing')).checksPayableTo,'Second Payee');
 payee=' ';assert.equal((await loadInvoicePdf(client,'existing')).checksPayableTo,null);
 error={code:'42501'};await assert.rejects(()=>loadInvoicePdf(client,'existing'),e=>e.status===403);
});
