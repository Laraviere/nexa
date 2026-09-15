import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {dashboardHarness} from './dashboard-harness.mjs';
const id='12345678-1234-4234-8234-123456789012';
const invoice={id,invoice_number:1055,company_name_snapshot:'Historical customer',issue_date:'2025-01-01',due_date:'2025-02-01',updated_at:'revision',notes:'First line\nSecond line',terms:'Net 30'};
const item={id:'line1',description:'Long description\nMore detail',quantity:2,unit:'hour',unit_rate:50,amount:100,tax_amount:5};
test('detail invoice keeps status eligibility, authoritative amounts, source quote and backdated dates',async()=>{
 for(const [status,paymentStatus,paid,balance] of [['draft','unpaid',0,105],['ready','partially_paid',40,65],['sent','paid',105,0],['void','unpaid',0,105]]){
  let record;
  const load=dashboardHarness({
   '@/lib/invoices/server':{invoiceDetail:async()=>({invoice:{...invoice,status},items:[item],totals:{subtotal:100,tax_amount:5}})},
   '@/lib/payments/server':{invoicePayments:async()=>({summary:{invoice_total:105,amount_paid:paid,balance_due:balance,payment_status:paymentStatus},history:[],owner:'owner',settings:{}})},
   '@/lib/quotes/server':{sourceQuote:async()=>({id:'quote1',quote_number:1001})},
   '@/components/payments/record-payment':{RecordPayment:props=>{record=props;return null;}},
   '@/components/invoices/invoice-status':{InvoiceStatus:()=>null},
   '@/components/payments/payment-history':{PaymentHistory:()=>null},
  });
  const html=renderToStaticMarkup(await load('@/app/(app)/invoices/[id]/page').default({params:Promise.resolve({id})}));
  assert.equal(record.canRecord,(status==='ready'||status==='sent')&&balance>0);
  assert.equal(record.balance,balance);assert.equal(record.owner,'owner');
  assert.equal(html.includes('Edit Invoice'),status!=='void');
  for(const text of ['Invoice Total','Amount paid','Balance due','Historical customer','Quote Q-1001','2025','First line\nSecond line','Net 30','scope="col"','$105.00'])assert.ok(html.includes(text),text);
  assert.match(html,/nexa-document-mobile/);assert.match(html,/href="\/quotes\/quote1"/);
  assert.match(html,/nexa-balance/);if(balance===0)assert.match(html,/\$0.00/);
 }
});
test('quote detail preserves dates, conversion link and draft-only editing',async()=>{
 for(const converted of [false,true]){
  const q={id,status:converted?'accepted':'draft',revision:1,quote_number:1001,company_name_snapshot:'Quoted customer',quote_date:'2025-01-01',expiration_date:converted?'2025-02-01':null,converted_invoice_id:converted?'invoice1':null,customer_snapshot:{},items:[{description:'Service\nDetail',quantity:'2',unit:'hour',unit_rate:'50',amount:'100'}],subtotal:100,total:100,notes:'Notes\nIntact',terms:'Terms'};
  const query={select(){return this;},eq(){return this;},single:async()=>({data:{invoice_number:1055},error:null})};
  const load=dashboardHarness({'@/lib/quotes/server':{quoteDetail:async()=>q},'@/lib/customers/server':{customerClient:async()=>({from:()=>query})},'@/components/quotes/quote-actions':{QuoteActions:()=>null}});
  const html=renderToStaticMarkup(await load('@/app/(app)/quotes/[id]/page').default({params:Promise.resolve({id})}));
  assert.equal(html.includes('Edit Quote'),!converted);assert.equal(html.includes('Valid through'),converted);
  assert.equal(html.includes('Invoice #1055'),converted);assert.match(html,/Quote Total/);assert.match(html,/Service\nDetail/);assert.match(html,/\$100.00/);assert.match(html,/nexa-document-mobile/);
 }
});
test('document presentation keeps every formatted field and tax in both responsive views',()=>{
 const {DocumentLines}=dashboardHarness()('@/components/ui/detail');
 const html=renderToStaticMarkup(createElement(DocumentLines,{label:'Test lines',lines:[{id:'1',description:'A\nB',quantity:'2 hours',rate:'$10.00',amount:'$20.00',tax:'$1.00'}]}));
 for(const text of ['A\nB','2 hours','$10.00','$20.00','$1.00'])assert.equal(html.split(text).length-1,2,text);
 assert.match(html,/<th scope="col">Description/);assert.match(html,/aria-label="Test lines"/);
});
test('customer details group contact and billing while keeping archive controls and audit timestamps',async()=>{
 const customer={id,company_name:'Archived business',is_active:false,primary_contact_name:'Jane',email:'jane@example.test',phone:'555-0100',billing_address_line1:'10 Main St',default_payment_terms_days:30,notes:'Customer notes',created_at:'2025-01-01T12:00:00Z',updated_at:'2025-02-01T12:00:00Z'};
 let archive;
 const load=dashboardHarness({'@/lib/customers/server':{getCustomer:async()=>customer},'@/lib/billing/server':{getBillingAgreements:async()=>[]},'@/lib/billing/usage-server':{getRetainerUsage:async()=>{throw Error('No extra usage read');}},'@/components/customers/customer-status-action':{CustomerStatusAction:props=>{archive=props;return null;}}});
 const html=renderToStaticMarkup(await load('@/app/(app)/customers/[id]/page').default({params:Promise.resolve({id})}));
 for(const text of ['Contact information','Archived','Jane','jane@example.test','10 Main St','No retainer','Set up retainer','Default payment terms','Created (New York time)','Updated (New York time)','Customer notes'])assert.ok(html.includes(text),text);
 assert.equal(archive.id,id);assert.equal(archive.active,false);
 assert.ok(html.indexOf('billing-heading')<html.indexOf('Customer record history'));
});
test('payment history retains active and voided receipts, notes, reasons and void eligibility',()=>{
 const controls=[];
 const load=dashboardHarness({'./void-payment':{VoidPayment:({paymentId})=>{controls.push(paymentId);return null;}}});
 const html=renderToStaticMarkup(createElement(load('@/components/payments/payment-history').PaymentHistory,{payments:[{id:'active',payment_date:'2026-09-01',amount:25,payment_method:'check',reference:'Check 42',notes:'Memo\nContinued',voided_at:null},{id:'voided',payment_date:'2026-09-02',amount:50,payment_method:'ach',voided_at:'2026-09-03',void_reason:'Duplicate receipt'}]}));
 for(const text of ['Active','Voided','Check 42','Memo\nContinued','Duplicate receipt','$25.00','$50.00','ACH'])assert.ok(html.includes(text),text);
 assert.deepEqual(controls,['active']);assert.match(html,/id="payment-history"/);
});
