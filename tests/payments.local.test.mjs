import assert from "node:assert/strict";
import { execFile,spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomBytes,randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import {inspectPdf} from "./helpers/pdf.mjs";
const exec=promisify(execFile),root=new URL("../",import.meta.url);
const {encodeReply}=createRequire(import.meta.url)("next/dist/compiled/react-server-dom-webpack/client.node");
test("Payments UI: settings, invoice summaries, authenticated record and void actions",{timeout:180000},async(t)=>{
 const status=JSON.parse((await exec("npx",["supabase","status","-o","json"],{cwd:root})).stdout);
 const api=new URL(status.API_URL);assert.ok(["127.0.0.1","localhost"].includes(api.hostname));const key=status.PUBLISHABLE_KEY??status.ANON_KEY;
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:api.href.replace(/\/$/,""),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_TELEMETRY_DISABLED:"1"};
 await exec("npm",["run","build"],{cwd:root,env,maxBuffer:1024*1024});t.diagnostic("npm run build passed using local Supabase.");
 const manifest=JSON.parse(await readFile(new URL(".next/server/server-reference-manifest.json",root),"utf8"));
 const actionId=name=>Object.entries(manifest.node).find(([,v])=>v.exportedName===name)?.[0];
 assert.ok(actionId("recordPayment"));
 const socket=createServer();await new Promise(r=>socket.listen(0,"127.0.0.1",r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const base=`http://127.0.0.1:${port}`;
 const server=spawn("node",["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env,stdio:["ignore","pipe","pipe"]});server.stdout.resume();server.stderr.resume();const stopped=new Promise(r=>server.once("close",r));
 const cookies=new Map();const client=createServerClient(api.href,key,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))}});
 let customer,userId;const customerIds=[],invoiceIds=[];
 async function request(route,init={},auth=true){return fetch(base+route,{...init,redirect:"manual",signal:AbortSignal.timeout(15000),headers:{Origin:base,...(auth?{Cookie:[...cookies].map(([n,v])=>`${n}=${encodeURIComponent(v)}`).join("; ")} :{}),...init.headers}});}
 async function page(route){const res=await request(route);assert.equal(res.status,200);return res.text();}
 async function action(name,route,form,auth=true){return request(route,{method:"POST",headers:{"Next-Action":actionId(name),Accept:"text/x-component"},body:await encodeReply([{},form])},auth);}
 let originalSettings;
 try {
  for(let i=0;i<100;i++){try{if((await fetch(base+"/login")).status===200)break;}catch{}await delay(100);}
  const registration=await client.auth.signUp({email:`nexa-payment-ui-${randomBytes(8).toString("hex")}@example.test`,password:randomBytes(24).toString("base64url")});assert.equal(registration.error,null);userId=registration.data.user.id;
  originalSettings=(await client.from('payment_settings').select('*').single()).data;
  const fixture=await client.from('customers').insert({company_name:'Payment UI fixture'}).select().single();assert.equal(fixture.error,null);customer=fixture.data.id;customerIds.push(customer);
  async function settings(cash,check,card,auth=true){const form=new FormData();for(const [method,on] of Object.entries({cash,check,card}))if(on)form.set(`${method}_enabled`,'on');const response=await action('savePaymentSettings','/settings/payments',form,auth);return {response,text:await response.text()};}
  assert.ok((await settings(true,true,true,false)).response.headers.get('x-action-redirect')?.includes('/login'));
  const settingsPage=await page('/settings/payments');assert.match(settingsPage,/Payment methods/);assert.match(settingsPage,/role="switch"/);
  for(const flags of [[false,true,true],[true,false,true],[true,true,false]]){assert.match((await settings(...flags)).text,/Payment methods saved/);const row=(await client.from('payment_settings').select('*').single()).data;assert.deepEqual([row.cash_enabled,row.check_enabled,row.card_enabled],flags);}
  assert.match((await settings(false,false,false)).text,/At least one payment method must remain enabled/);
  await settings(true,true,true);
  const made=await client.rpc('create_manual_invoice',{p_customer_id:customer,p_issue_date:'2026-09-10',p_request_id:randomUUID(),p_items:[{description:'Invoice payment work',quantity:1,unit:'flat',unit_rate:500}]});assert.equal(made.error,null);const id=made.data[0].invoice_id;invoiceIds.push(id);const route=`/invoices/${id}`;
  const initial=await page(route);assert.match(initial,/Unpaid/);assert.ok(!initial.includes('>Record Payment<'));assert.match(initial,/Payment recording becomes available once this invoice is marked Ready/);assert.match(initial,/Mark Ready/);assert.match(initial,/No payments recorded/);
  async function record(amount,method='cash',key=randomUUID(),auth=true){const form=new FormData();for(const [k,v] of Object.entries({invoice_id:id,request_id:key,amount:String(amount),payment_date:'2026-09-10',payment_method:method,reference:'UI receipt',notes:'Recorded from invoice'}))form.set(k,v);const response=await action('recordPayment',`/payments/new?customer=${customer}&invoice=${id}`,form,auth);return {response,text:await response.text(),key};}
  assert.ok((await record(200,'cash',randomUUID(),false)).response.headers.get('x-action-redirect')?.includes('/login'));
  assert.match((await record(200)).text,/must be marked Ready before a payment can be recorded/);
  assert.equal((await client.from('invoice_payments').select('id').eq('invoice_id',id)).data.length,0);
  assert.equal((await client.from('invoices').update({status:'ready'}).eq('id',id)).error,null);
  assert.match(await page(route),/>Record Payment</);
  const unauthLedger=await request('/payments',{},false);assert.ok(unauthLedger.headers.get('location')?.includes('/login')||(await unauthLedger.text()).includes('NEXT_REDIRECT;replace;/login;'));
  assert.match(await page('/payments'),/Payments Received/);
  assert.match(await page(`/payments/new?customer=${customer}`),new RegExp(id));
  const selection=`/payments/new?customer=${customer}&invoice=${id}`;
  const selected=await page(selection);assert.match(selected,/Invoice total/);assert.match(selected,/Amount paid/);assert.match(selected,/Balance due/);assert.match(selected,/500.00/);
  const future=new FormData();Object.entries({invoice_id:id,request_id:randomUUID(),amount:'1',payment_date:'9999-12-31',payment_method:'cash'}).forEach(([k,v])=>future.set(k,v));assert.match(await (await action('recordPayment',selection,future)).text(),/after today in New York/);
  const unpaidPdf=await request(route+'/pdf');assert.equal(unpaidPdf.status,200);assert.doesNotMatch((await inspectPdf(await unpaidPdf.arrayBuffer())).text,/Amount Paid|Balance Due/);
  const first=await record(200,'card');assert.match(first.text,/Payment recorded/);assert.match((await record(200,'card',first.key)).text,/Payment recorded/);
  assert.equal((await client.from('invoice_payments').select('id').eq('invoice_id',id)).data.length,1);
  assert.equal((await client.from('invoices').update({status:'draft'}).eq('id',id)).error,null);
  const historicalDraft=await page(route);assert.ok(!historicalDraft.includes('>Record Payment<'));assert.match(historicalDraft,/marked Ready/);assert.match(historicalDraft,/Partially Paid/);assert.match(historicalDraft,/\$200\.00/);assert.match(historicalDraft,/\$300\.00/);assert.match(historicalDraft,/UI receipt/);
  assert.match((await record(1)).text,/must be marked Ready/);
  assert.match((await record(200,'card',first.key)).text,/Payment recorded/);
  assert.equal((await client.from('invoice_payments').select('id').eq('invoice_id',id)).data.length,1);
  assert.equal((await client.from('invoices').update({status:'ready'}).eq('id',id)).error,null);
  await settings(true,true,false);
  const partialPdf=await request(route+'/pdf');assert.equal(partialPdf.status,200);assert.match((await inspectPdf(await partialPdf.arrayBuffer())).text,/Amount Paid \$200.00 Balance Due \$300.00/);
  const ledger=await page(`/payments?customer=${customer}&q=UI+receipt&method=card`);assert.match(ledger,/UI receipt/);assert.match(ledger,/200.00/);assert.match(ledger,/#payment-history/);
  const partial=await page(route);assert.match(partial,/Partially Paid/);assert.match(partial,/\$200\.00/);assert.match(partial,/\$300\.00/);assert.match(partial,/Card/);assert.match(partial,/UI receipt/);
  assert.match((await record(10,'card')).text,/no longer enabled/);
  assert.match((await record(301)).text,/cannot exceed the remaining balance/);
  await client.from('invoices').update({status:'ready'}).eq('id',id);
  assert.match((await record(100,'check')).text,/Payment recorded/);
  await client.from('invoices').update({status:'sent'}).eq('id',id);
  const sent=await page(route);assert.match(sent,/>Record Payment</);assert.match(sent,/Edit Invoice/);
  assert.match((await record(200)).text,/Payment recorded/);
  const paidPdf=await request(route+'/pdf');assert.equal(paidPdf.status,200);assert.match((await inspectPdf(await paidPdf.arrayBuffer())).text,/Balance Due \$0.00 Paid in full/);
  const paidSelection=await page(selection);assert.match(paidSelection,/no eligible invoices/);assert.match(paidSelection,/pending submission can still be confirmed/);
  const paid=await page(route);assert.match(paid,/>Paid</);assert.ok(!paid.includes('>Record Payment<'));assert.match(paid,/>Sent</);
  const summary=(await client.from('invoice_payment_summary').select('*').eq('invoice_id',id).single()).data;assert.equal(summary.amount_paid,500);assert.equal(summary.balance_due,0);
  const payment=(await client.from('invoice_payments').select('*').eq('request_id',first.key).single()).data;
  async function voidIt(reason,confirmed='yes',auth=true){const form=new FormData();form.set('payment_id',payment.id);form.set('reason',reason);form.set('confirmed',confirmed);const response=await action('voidPayment',route,form,auth);return {response,text:await response.text()};}
  assert.match((await voidIt('')).text,/enter a reason/);assert.match((await voidIt('Correction','no')).text,/Confirm/);
  assert.ok((await voidIt('Correction','yes',false)).response.headers.get('x-action-redirect')?.includes('/login'));
  assert.match((await voidIt('Correction')).text,/Payment voided/);assert.match((await voidIt('Correction')).text,/Payment voided/);
  const corrected=await page(route);assert.match(corrected,/Void reason:.*Correction/);assert.match(corrected,/Partially Paid/);assert.match(corrected,/Record Payment/);assert.equal((await client.from('invoice_payments').select('id').eq('invoice_id',id)).data.length,3);
  assert.equal((await client.from('invoice_payment_summary').select('balance_due').eq('invoice_id',id).single()).data.balance_due,200);
  await client.from('invoices').update({status:'void',void_reason:'Payment UI complete'}).eq('id',id);
  const voidPage=await page(route);assert.ok(!voidPage.includes('>Record Payment<'));assert.match(voidPage,/Payment History/);assert.match(voidPage,/not collectible/);assert.match((await record(1)).text,/Void invoices cannot receive payments/);assert.ok(!voidPage.includes('Delete payment'));
  const historical=await page(`/payments?customer=${customer}&status=all`);assert.match(historical,/Invoice Void/);assert.match(historical,/>Voided</);assert.match(historical,/>Active</);
  const extraSettings=new FormData();extraSettings.set('ach_enabled','on');extraSettings.set('other_enabled','on');assert.match(await (await action('savePaymentSettings','/settings/payments',extraSettings)).text(),/Payment methods saved/);
  assert.equal((await client.from('payment_settings').select('ach_enabled,other_enabled').single()).data.ach_enabled,true);
  const quote=await client.rpc('save_quote',{p_customer_id:customer,p_quote_date:'2026-09-01',p_items:[{description:'Converted work',quantity:'1',unit:'flat',unit_rate:'100'}],p_request_id:randomUUID()});assert.equal(quote.error,null);
  assert.equal((await client.rpc('change_quote_status',{p_quote_id:quote.data,p_status:'accepted',p_revision:1})).error,null);
  const converted=await client.rpc('convert_quote_to_invoice',{p_quote_id:quote.data,p_issue_date:'2026-09-01',p_revision:2});assert.equal(converted.error,null);invoiceIds.push(converted.data);
  assert.equal((await client.from('invoices').update({status:'ready'}).eq('id',converted.data)).error,null);
  for(const method of ['ach','other']){const form=new FormData();Object.entries({invoice_id:converted.data,request_id:randomUUID(),amount:'50',payment_date:'2026-09-10',payment_method:method}).forEach(([k,v])=>form.set(k,v));assert.match(await (await action('recordPayment',`/payments/new?customer=${customer}&invoice=${converted.data}`,form)).text(),/Payment recorded/);}
  const convertedPdf=await request(`/invoices/${converted.data}/pdf`);assert.equal(convertedPdf.status,200);assert.match((await inspectPdf(await convertedPdf.arrayBuffer())).text,/Paid in full/);
  const quotePdf=await request(`/quotes/${quote.data}/pdf`);assert.equal(quotePdf.status,200);assert.doesNotMatch((await inspectPdf(await quotePdf.arrayBuffer())).text,/Amount Paid|Balance Due/);
  t.diagnostic('Central customer/invoice selection, authenticated ledger and action, partial/full/no-payment PDFs, ACH/Other settings and converted invoice payment/PDF, quote payment exclusion passed.');
  t.diagnostic('Cash/Check/Card settings, disabled-method race/history, Draft rejection/history and Ready/Sent partial/full payments, summary values, overpayment, idempotency, authentication, corrections and Void history passed.');
 } finally {
  try {
   if(originalSettings)await client.rpc('update_payment_settings',{p_cash_enabled:originalSettings.cash_enabled,p_check_enabled:originalSettings.check_enabled,p_card_enabled:originalSettings.card_enabled,p_ach_enabled:originalSettings.ach_enabled,p_other_enabled:originalSettings.other_enabled});
   for(const id of invoiceIds)await client.from('invoices').update({status:'void',void_reason:'Payment UI fixture complete'}).eq('id',id).neq('status','void');
   for(const id of customerIds)await client.from('customers').update({is_active:false}).eq('id',id);
   if(userId){assert.match(userId,/^[0-9a-f-]{36}$/);await exec('docker',['exec','supabase_db_nexa','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',`delete from auth.users where id='${userId}';`]);}
  }finally{server.kill('SIGTERM');await stopped;}
 }
});
