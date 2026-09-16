import assert from 'node:assert/strict';
import test from 'node:test';
import {performance} from 'node:perf_hooks';
import {dashboardHarness} from './dashboard-harness.mjs';
const id='12345678-1234-4234-8234-123456789012';
function harness(delay=40){
 const calls=[];let inFlight=0,max=0;
 const client={auth:{getClaims:async()=>({data:{claims:{sub:'owner'}}})},from(table){
  const q={};for(const method of ['select','eq','is','order'])q[method]=()=>q;
  const read=async()=>{calls.push(table);inFlight++;max=Math.max(max,inFlight);await new Promise(r=>setTimeout(r,delay));inFlight--;return {error:null,data:table==='invoices'?{id}:table==='invoice_totals'?{total:100,subtotal:100,tax_amount:0}:table==='invoice_payment_summary'?{invoice_total:100,amount_paid:25,balance_due:75,payment_status:'partially_paid'}:table==='payment_settings'?{checks_payable_to:'Payee'}:[]};};
  q.range=read;q.single=read;q.maybeSingle=read;return q;
 }};
 return {load:dashboardHarness({'@/lib/customers/server':{customerClient:async()=>client}}),calls,max:()=>max};
}
test('measure invoice read stages using controlled 40ms query latency',async(t)=>{
 const h=harness();const read=h.load('@/lib/invoices/server').invoiceDetail;const start=performance.now();const result=await read(id);
 t.diagnostic(`invoiceDetail: ${Math.round(performance.now()-start)}ms; ${h.calls.length} queries; peak concurrency ${h.max()}`);
 assert.equal(h.max(),2);assert.equal(result.totals.total,100);assert.deepEqual([...h.calls].sort(),['invoice_items','invoice_totals','invoices']);
});
test('measure payment read stages using controlled 40ms query latency',async(t)=>{
 const h=harness();const read=h.load('@/lib/payments/server').invoicePayments;const start=performance.now();const result=await read(id);
 t.diagnostic(`invoicePayments: ${Math.round(performance.now()-start)}ms; ${h.calls.length} queries; peak concurrency ${h.max()}`);
 assert.equal(h.max(),2);assert.equal(result.summary.balance_due,75);assert.equal(result.owner,'owner');assert.equal(result.settings.checks_payable_to,'Payee');
 assert.deepEqual([...h.calls].sort(),['invoice_payment_summary','invoice_payments','payment_settings']);
});
test('parallel reads remain behind invoice existence and payment-summary validation',async()=>{
 const calls=[];
 const client={auth:{getClaims:async()=>({data:{claims:{sub:'owner'}}})},from(table){calls.push(table);const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:null,error:null}),single:async()=>({data:null,error:null})};return q;}};
 const load=dashboardHarness({'@/lib/customers/server':{customerClient:async()=>client},'next/navigation':{notFound:()=>{throw Error('not found');}}});
 await assert.rejects(load('@/lib/invoices/server').invoiceDetail(id),/not found/);assert.deepEqual(calls,['invoices']);
 calls.length=0;await assert.rejects(load('@/lib/payments/server').invoicePayments(id),/Unable to load invoice payment summary/);assert.deepEqual(calls,['invoice_payment_summary']);
});
