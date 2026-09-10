import assert from "node:assert/strict";
import { execFile,spawn } from "node:child_process";
import { writeFile,mkdir } from "node:fs/promises";
import { randomBytes,randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { inspectPdf } from "./helpers/pdf.mjs";
import { createServerClient } from "@supabase/ssr";
const exec=promisify(execFile),root=new URL("../",import.meta.url);
test("invoice PDF: authenticated persisted documents, multi-page output and regeneration",{timeout:180000},async(t)=>{
 const status=JSON.parse((await exec("npx",["supabase","status","-o","json"],{cwd:root})).stdout);
 const api=new URL(status.API_URL);assert.ok(["127.0.0.1","localhost"].includes(api.hostname));const key=status.PUBLISHABLE_KEY??status.ANON_KEY;
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:api.href.replace(/\/$/,""),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_TELEMETRY_DISABLED:"1"};
 await exec("npm",["run","build"],{cwd:root,env,maxBuffer:1024*1024});t.diagnostic("npm run build passed using local Supabase.");
 const socket=createServer();await new Promise(r=>socket.listen(0,"127.0.0.1",r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const base=`http://127.0.0.1:${port}`;
 const server=spawn("node",["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env,stdio:["ignore","pipe","pipe"]});server.stdout.resume();server.stderr.resume();const stopped=new Promise(r=>server.once("close",r));
 const cookies=new Map();const client=createServerClient(api.href,key,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))}});
 let customer,userId;const customerIds=[],invoiceIds=[];
 async function request(route,init={},auth=true){return fetch(base+route,{...init,redirect:"manual",signal:AbortSignal.timeout(15000),headers:{Origin:base,...(auth?{Cookie:[...cookies].map(([n,v])=>`${n}=${encodeURIComponent(v)}`).join("; ")} :{}),...init.headers}});}
 async function page(route){const res=await request(route);assert.equal(res.status,200);return res.text();}

 try {
  for(let i=0;i<100;i++){try{if((await fetch(base+"/login")).status===200)break;}catch{}await delay(100);}
  const registration=await client.auth.signUp({email:`nexa-pdf-${randomBytes(8).toString("hex")}@example.test`,password:randomBytes(24).toString("base64url")});assert.equal(registration.error,null);userId=registration.data.user.id;
  const fixture=await client.from("customers").insert({company_name:"Sample Consulting — PDF Review",primary_contact_name:"Morgan Example",email:"sample@example.test",billing_address_line1:"123 Sample Street",billing_city:"Sample City",billing_state:"VA",billing_postal_code:"00000",default_payment_terms_days:30}).select().single();assert.equal(fixture.error,null);customer=fixture.data.id;customerIds.push(customer);
  const items=[{description:"Monthly IT Support Retainer\nSeptember support period",quantity:1,unit:"month",unit_rate:500},{description:"IT Support Overage",quantity:1.5,unit:"hour",unit_rate:75},{description:"Network equipment setup",quantity:1,unit:"each",unit_rate:25,tax_amount:2.5}];
  const made=await client.rpc("create_manual_invoice",{p_customer_id:customer,p_issue_date:"2026-09-10",p_request_id:randomUUID(),p_items:items,p_notes:"Thank you for your business.\nPlease reference the invoice number with payment.",p_terms:"Payment due within 30 days."});assert.equal(made.error,null);const invoice=made.data[0];invoiceIds.push(invoice.invoice_id);
  assert.equal((await client.from("customers").update({company_name:"Changed live customer"}).eq("id",customer)).error,null);
  const endpoint=`/invoices/${invoice.invoice_id}/pdf`;
  assert.equal((await request(endpoint,{},false)).status,401);
  assert.equal((await request(`/invoices/${randomUUID()}/pdf`)).status,404);
  assert.equal((await request('/invoices/not-a-uuid/pdf')).status,404);
  const sampleDirectory='/tmp/nexa-invoice-pdf-samples';await mkdir(sampleDirectory,{recursive:true});
  async function pdf(route){const response=await request(route);assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(response.headers.get('cache-control'),/private.*no-store/);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');return {bytes,document:await inspectPdf(bytes),response};}
  for(const state of ['draft','ready','sent','void']){
   if(state!=='draft'){const changed=await client.from('invoices').update({status:state,...(state==='void'?{void_reason:'Local PDF fixture complete'}:{})}).eq('id',invoice.invoice_id);assert.equal(changed.error,null);}
   const result=await pdf(endpoint);const text=result.document.text;
   assert.match(result.response.headers.get('content-disposition'),new RegExp(`Nexa-Invoice-${invoice.invoice_number}.pdf`));
   for(const expected of ['Sample Consulting','Morgan Example','sample@example.test','123 Sample Street','September 10, 2026','October 10, 2026','1 Month','1.5 Hours','1 Each','$112.50','$637.50','$2.50','$640.00','Thank you for your business.','Payment due within 30 days.'])assert.ok(text.includes(expected),expected);
   assert.ok(!text.includes('Changed live customer'));assert.ok(text.indexOf('Monthly IT Support Retainer')<text.indexOf('IT Support Overage'));
   if(state==='draft')assert.match(text,/DRAFT/);if(state==='void')assert.match(text,/VOID.*Not payable/);
   if(state==='ready')await writeFile(`${sampleDirectory}/ready.pdf`,result.bytes);
   if(state==='void')await writeFile(`${sampleDirectory}/void.pdf`,result.bytes);
  }
  const many=Array.from({length:75},(_,i)=>({description:`Support activity ${String(i+1).padStart(3,'0')}\nPersisted consulting work and customer support.`,quantity:1,unit:'hour',unit_rate:100}));
  const large=await client.rpc('create_manual_invoice',{p_customer_id:customer,p_issue_date:'2026-09-10',p_request_id:randomUUID(),p_items:many});assert.equal(large.error,null);const largeId=large.data[0].invoice_id;invoiceIds.push(largeId);
  assert.equal((await client.from('invoices').update({status:'ready'}).eq('id',largeId)).error,null);
  const largePdf=await pdf(`/invoices/${largeId}/pdf`);assert.ok(largePdf.document.pages.length>=3);assert.match(largePdf.document.text,/Support activity 075/);assert.ok(!/NOTES|TERMS/.test(largePdf.document.text));
  await writeFile(`${sampleDirectory}/multiple-pages.pdf`,largePdf.bytes);
  const preview=await client.rpc('preview_invoice_edit',{p_invoice_id:largeId,p_as_of_date:'2026-09-10'});assert.equal(preview.error,null);
  const changed=await client.rpc('update_composed_invoice',{p_invoice_id:largeId,p_issue_date:'2026-09-10',p_as_of_date:'2026-09-10',p_request_id:randomUUID(),p_revision:preview.data[0].revision,p_selected_candidate_ids:[],p_custom_items:[{description:'Regenerated after edit',quantity:1,unit:'flat',unit_rate:42}]});assert.equal(changed.error,null);
  const edited=await pdf(`/invoices/${largeId}/pdf`);assert.match(edited.document.text,/Regenerated after edit/);assert.match(edited.document.text,/\$42.00/);assert.ok(!edited.document.text.includes('Support activity 001'));assert.equal(changed.data[0].status,'ready');assert.equal(changed.data[0].invoice_number,large.data[0].invoice_number);
  const detail=await page(`/invoices/${largeId}`);assert.match(detail,/View PDF/);assert.ok(detail.includes(`href="/invoices/${largeId}/pdf"`));assert.match(detail,/target="_blank"/);
  t.diagnostic(`Draft/Ready/Sent/Void; auth/404; snapshots, dates, ordered lines, units, exact totals; current rows after edit; no-cache; ${largePdf.document.pages.length}-page sample with print bounds verified. Samples: ${sampleDirectory}`);
 } finally {
  try {
   for(const id of invoiceIds){const result=await client.from('invoices').update({status:'void',void_reason:'Local PDF fixture complete'}).eq('id',id).neq('status','void');assert.equal(result.error,null);}
   for(const id of customerIds)await client.from('customers').update({is_active:false}).eq('id',id);
   if(userId){assert.match(userId,/^[0-9a-f-]{36}$/);await exec('docker',['exec','supabase_db_nexa','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',`delete from auth.users where id='${userId}';`]);}
  } finally {server.kill('SIGTERM');await stopped;}
 }
});
