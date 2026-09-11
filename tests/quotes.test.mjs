import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {dashboardHarness} from './dashboard-harness.mjs';
import {inspectPdf} from './helpers/pdf.mjs';
const id='12345678-1234-4234-8234-123456789012';
const draft=()=>({customer_id:id,issue_date:'2026-09-01',expiration_date:'',notes:'Proposal notes',terms:'Project scope',items:[{description:'Consulting',quantity:'1.5',unit:'hour',unit_rate:'120'}]});
const fixture=()=>({id,quote_number:1001,customer_id:id,company_name_snapshot:'Example Customer',customer_snapshot:{email:'customer@example.com',billing_address_line1:'100 Main Street'},quote_date:'2026-09-01',expiration_date:null,items:[{description:'Consulting',quantity:'1.5',unit:'hour',unit_rate:'120',amount:'180.00'}],subtotal:180,total:180,notes:'Proposal notes',terms:'Project scope',status:'draft',converted_invoice_id:null,revision:1});
test('quote validation preserves dates/decimals and optional expiration',()=>{
 const m=dashboardHarness()('@/lib/quotes/model');
 const good=m.quoteInput(draft(),id);assert.equal(good.args.p_quote_date,'2026-09-01');assert.equal(good.args.p_expiration_date,undefined);assert.equal(good.args.p_items[0].quantity,'1.5');
 for(const expiration of ['2026-08-31','2026-02-30','infinity'])assert.ok(m.quoteInput({...draft(),expiration_date:expiration},id).message);
 assert.ok(m.quoteInput({...draft(),expiration_date:'2026-09-01'},id).args);
 for(const value of ['0','-1','NaN','Infinity','0.000000001']){const d=draft();d.items[0].quantity=value;assert.ok(m.quoteInput(d,id).message);}
 assert.ok(m.quoteInput({...draft(),items:[]},id).message);
 const d=draft();d.items[0].tax_amount='1';assert.ok(m.quoteInput(d,id).message);
});
test('expiration is inclusive and never replaces an accepted or declined decision',()=>{
 const {quoteStatus}=dashboardHarness()('@/lib/quotes/model');
 for(const status of ['draft','sent']){
  assert.equal(quoteStatus({status,expiration_date:'2026-09-10'},'2026-09-10'),status);
  assert.equal(quoteStatus({status,expiration_date:'2026-09-10'},'2026-09-11'),'expired');
  assert.equal(quoteStatus({status,expiration_date:null},'2026-09-11'),status);
 }
 for(const status of ['accepted','declined'])assert.equal(quoteStatus({status,expiration_date:'2020-01-01'},'2026-09-11'),status);
});
test('quote writes use atomic RPCs and exact invoice business dates',async()=>{
 const calls=[];let error=null;
 const load=dashboardHarness({'@/lib/customers/server':{customerClient:async()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:id,error};}})},'next/cache':{revalidatePath:()=>{}}});
 const actions=load('@/actions/quotes');const form=new FormData();form.set('payload',JSON.stringify(draft()));form.set('request_id',id);
 assert.equal((await actions.saveQuote({},form)).quoteId,id);await actions.saveQuote({},form);assert.deepEqual(calls[0],calls[1]);
 const convert=new FormData();convert.set('quote_id',id);convert.set('revision','2');convert.set('issue_date','2026-09-01');
 assert.ok((await actions.convertQuote({},convert)).message);assert.equal(calls.length,2);
 convert.set('confirmed','yes');assert.equal((await actions.convertQuote({},convert)).invoiceId,id);
 assert.equal(calls[2].name,'convert_quote_to_invoice');assert.equal(calls[2].args.p_issue_date,'2026-09-01');
 error={code:'40001',message:'Private SQL'};assert.match((await actions.convertQuote({},convert)).message,/Refresh/);
 error={code:'UNKNOWN',message:'Private SQL'};const failed=await actions.saveQuote({},form);assert.equal(failed.uncertain,true);assert.ok(!failed.message.includes('Private'));
});
test('quote PDF contains proposal dates/number, full lines/notes, no invoice or payment language',async()=>{
 const {renderQuotePdf}=dashboardHarness()('@/lib/quotes/pdf');
 const q=fixture();let pdf=await inspectPdf(await renderQuotePdf(q,'2026-09-10'));
 for(const text of ['QUOTE','Q-1001','Example Customer','Consulting','180.00','Proposal notes','Project scope','September 1, 2026'])assert.ok(pdf.text.includes(text),text);
 assert.doesNotMatch(pdf.text,/INVOICE|DUE DATE|Payment|Balance|VALID THROUGH/);
 q.expiration_date='2026-10-01';q.items=Array.from({length:60},(_,i)=>({...q.items[0],description:`Service ${i} `+'Long description '.repeat(8)}));
 pdf=await inspectPdf(await renderQuotePdf(q,'2026-09-10'));assert.ok(pdf.pages.length>1);assert.match(pdf.text,/VALID THROUGH/);assert.match(pdf.text,/October 1, 2026/);assert.match(pdf.text,/Service 59/);
});
test('quote PDF route enforces session and private responses',async()=>{
 let authenticated=false;let data=fixture();
 const load=dashboardHarness({'@/lib/supabase/server':{createClient:async()=>({auth:{getClaims:async()=>({data:authenticated?{claims:{sub:id}}:null})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data,error:null})})})},'@/lib/quotes/pdf':{renderQuotePdf:async()=>Buffer.from('%PDF-test')}});
 const {GET}=load('@/app/(app)/quotes/[id]/pdf/route');
 let response=await GET(new Request('http://localhost'),{params:Promise.resolve({id})});assert.equal(response.status,401);
 authenticated=true;response=await GET(new Request('http://localhost'),{params:Promise.resolve({id})});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/Q-1001.pdf/);assert.match(response.headers.get('cache-control'),/no-store/);
 data=null;assert.equal((await GET(new Request('http://localhost'),{params:Promise.resolve({id})})).status,404);
});
test('backdated invoice input and due dates stay calendar dates across DST',()=>{
 const m=dashboardHarness()('@/lib/invoices/model');
 assert.equal(m.invoiceInput(draft(),id).args.p_issue_date,'2026-09-01');
 assert.equal(m.previewDueDate('2026-09-01',30),'2026-10-01');
 assert.equal(m.previewDueDate('2026-03-01',30),'2026-03-31');
 assert.equal(m.previewDueDate('2026-11-01',30),'2026-12-01');
 const source=readFileSync(new URL('../src/components/invoices/create-invoice-form.tsx',import.meta.url),'utf8');
 assert.match(source,/Invoice date<input required type="date"/);
 assert.match(source,/issue_date:today/);
});
