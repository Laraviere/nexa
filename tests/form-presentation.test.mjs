import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {dashboardHarness} from './dashboard-harness.mjs';
const hooks={...React,useState:v=>[v,()=>{}],useActionState:()=>[{},()=>{},false],useRef:v=>({current:v}),useEffect:()=>{}};
const load=dashboardHarness({react:hooks,'next/navigation':{useRouter:()=>({})},'@/actions/customers':{saveCustomer:()=>{}},'@/actions/quotes':{saveQuote:()=>{}},'@/actions/payments':{savePaymentSettings:()=>{},saveChecksPayableTo:()=>{}}});
test('customer form separates contact, address and billing while retaining names and defaults',()=>{
 const html=renderToStaticMarkup(React.createElement(load('@/components/customers/customer-form').CustomerForm,{}));
 for(const text of ['Customer','Primary contact','Billing address','Billing','Other information','nexa-form-actions','name="company_name"','name="billing_country"','name="default_payment_terms_days"','value="30"'])assert.ok(html.includes(text),text);
 assert.ok(html.indexOf('>Cancel<')<html.indexOf('>Create customer<'));
});
test('quote editor preserves line fields and initial values within grouped sections',()=>{
 const html=renderToStaticMarkup(React.createElement(load('@/components/quotes/quote-form').QuoteForm,{customers:[],today:'2026-09-15',requestId:'request',owner:'owner'}));
 for(const text of ['Quote details','Line items','Notes &amp; terms','nexa-edit-line','Quantity','Unit','Rate','Line total','Add line item','name="request_id"','name="payload"','value="2026-09-15"','nexa-form-actions'])assert.ok(html.includes(text),text);
 assert.match(html,/<fieldset disabled=""/);
});
test('payment settings retain native method switches and payee contract with separate help',()=>{
 const settings={cash_enabled:true,check_enabled:true,card_enabled:false,ach_enabled:false,other_enabled:false,checks_payable_to:'Example Payee'};
 const methods=renderToStaticMarkup(React.createElement(load('@/components/payments/settings-form').PaymentSettingsForm,{settings}));
 assert.equal((methods.match(/role="switch"/g)||[]).length,5);assert.equal((methods.match(/checked=""/g)||[]).length,2);
 assert.match(methods,/At least one method must remain enabled/);assert.match(methods,/Enabled/);assert.match(methods,/Disabled/);
 const checks=renderToStaticMarkup(React.createElement(load('@/components/payments/settings-form').CheckInstructionsForm,{settings}));
 assert.match(checks,/name="checks_payable_to"/);assert.match(checks,/value="Example Payee"/);assert.match(checks,/aria-describedby="check-payee-help"/);assert.match(checks,/Leave blank to hide/);
});
test('central payment steps keep selected invoice balance and recovery eligibility untouched',async()=>{
 let props;
 const selection={customer:'c1',invoiceId:'i1',owner:'owner',customers:[{id:'c1',company_name:'Example',is_active:true}],invoices:[{id:'i1',invoice_number:1001,balance_due:40}],selected:{invoice:{id:'i1',invoice_number:1001},summary:{invoice_total:100,amount_paid:60,balance_due:40},canRecord:false,settings:{}}};
 const page=dashboardHarness({'@/lib/payments/record-server':{paymentSelection:async()=>selection},'@/components/payments/record-payment':{RecordPayment:p=>{props=p;return null;}}})('@/app/(app)/payments/new/page').default;
 const html=renderToStaticMarkup(await page({searchParams:Promise.resolve({customer:'c1',invoice:'i1'})}));
 for(const text of ['1. Select customer','2. Select eligible invoice','3. Review invoice','4. Enter and record payment','$100.00','$60.00','$40.00','Any pending submission can still be confirmed safely.'])assert.ok(html.includes(text),text);
 assert.equal(props.canRecord,false);assert.equal(props.balance,40);assert.equal(props.invoiceId,'i1');assert.equal(props.owner,'owner');
 assert.equal((html.match(/action="\/payments\/new"/g)||[]).length,2);
});
