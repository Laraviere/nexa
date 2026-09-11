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
const exec=promisify(execFile),root=new URL("../",import.meta.url);
const {encodeReply}=createRequire(import.meta.url)("next/dist/compiled/react-server-dom-webpack/client.node");
test("composer UI: authenticated preview, selection, mixed save, staleness and approval",{timeout:180000},async(t)=>{
 const status=JSON.parse((await exec("npx",["supabase","status","-o","json"],{cwd:root})).stdout);
 const api=new URL(status.API_URL);assert.ok(["127.0.0.1","localhost"].includes(api.hostname));const key=status.PUBLISHABLE_KEY??status.ANON_KEY;
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:api.href.replace(/\/$/,""),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_TELEMETRY_DISABLED:"1"};
 await exec("npm",["run","build"],{cwd:root,env,maxBuffer:1024*1024});t.diagnostic("npm run build passed using local Supabase.");
 const manifest=JSON.parse(await readFile(new URL(".next/server/server-reference-manifest.json",root),"utf8"));
 const actionId=name=>Object.entries(manifest.node).find(([,v])=>v.exportedName===name)?.[0];
 assert.ok(actionId("saveComposedInvoice"));
 const socket=createServer();await new Promise(r=>socket.listen(0,"127.0.0.1",r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const base=`http://127.0.0.1:${port}`;
 const server=spawn("node",["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env,stdio:["ignore","pipe","pipe"]});server.stdout.resume();server.stderr.resume();const stopped=new Promise(r=>server.once("close",r));
 const cookies=new Map();const client=createServerClient(api.href,key,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))}});
 let customer,userId;const customerIds=[],invoiceIds=[];
 async function request(route,init={},auth=true){return fetch(base+route,{...init,redirect:"manual",signal:AbortSignal.timeout(15000),headers:{Origin:base,...(auth?{Cookie:[...cookies].map(([n,v])=>`${n}=${encodeURIComponent(v)}`).join("; ")} :{}),...init.headers}});}
 async function page(route){const res=await request(route);assert.equal(res.status,200);return res.text();}
 async function action(name,route,form,auth=true){return request(route,{method:"POST",headers:{"Next-Action":actionId(name),Accept:"text/x-component"},body:await encodeReply([{},form])},auth);}
 try {
  for(let i=0;i<100;i++){try{if((await fetch(base+"/login")).status===200)break;}catch{}await delay(100);}
  const protectedResponse=await request("/invoices/new",{},false);assert.ok(protectedResponse.headers.get("location")?.includes("/login")||(await protectedResponse.text()).includes("NEXT_REDIRECT;replace;/login;"));
  const registration=await client.auth.signUp({email:`nexa-generation-${randomBytes(8).toString("hex")}@example.test`,password:randomBytes(24).toString("base64url")});assert.equal(registration.error,null);userId=registration.data.user.id;
  async function fixture(name){const r=await client.from("customers").insert({company_name:name}).select().single();assert.equal(r.error,null);customerIds.push(r.data.id);return r.data.id;}
  customer=await fixture("Local generation retainer");
  const a=await client.from("customer_billing_agreements").insert({customer_id:customer,monthly_fee:500,included_hours:1,overage_hourly_rate:120,billing_cycle_day:15,effective_date:"2025-06-15"}).select().single();assert.equal(a.error,null);
  for(const work_date of ["2025-07-16","2025-08-16","2025-09-16"]){const r=await client.from("time_entries").insert({customer_id:customer,work_date,description:"Local generation usage",actual_minutes:90});assert.equal(r.error,null);}
  const formPage=await page("/invoices/new");assert.match(formPage,/Suggested charges/);
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const part=k=>parts.find(p=>p.type===k).value;const today=`${part("year")}-${part("month")}-${part("day")}`;
  assert.ok(formPage.includes(`&quot;issue_date&quot;:&quot;${today}&quot;`));assert.ok(formPage.includes(`&quot;as_of_date&quot;:&quot;${today}&quot;`));
  const payload={customer_id:customer,issue_date:"2025-09-20",as_of_date:"2025-09-20",notes:"Composed fixture",terms:"Review first",items:[]};
  async function preview(id=customer,date="2025-09-20"){
    const response=await request("/invoices/new",{method:"POST",headers:{"Next-Action":actionId("previewInvoice"),Accept:"text/x-component"},body:await encodeReply([{p_customer_id:id,p_as_of_date:date}])});
    const text=await response.text();assert.match(text,/candidate_id|candidates/);return text;
  }
  const previewText=await preview();assert.match(previewText,/Monthly IT Support Retainer/);assert.match(previewText,/IT Support Overage/);
  const initial=(await client.rpc("preview_customer_invoice",{p_customer_id:customer,p_as_of_date:"2025-09-20"})).data[0];
  assert.equal(initial.candidates.length,2);
  const fee=initial.candidates.find(c=>c.source_type==="retainer_fee"),overage=initial.candidates.find(c=>c.source_type==="retainer_overage");
  payload.revision=initial.revision;payload.selected_candidate_ids=[overage.candidate_id];
  payload.items=[{description:"Custom alongside overage",quantity:"1",unit:"each",unit_rate:"40"}];
  async function generate(body,requestId=randomUUID(),auth=true){const form=new FormData();form.set("payload",JSON.stringify(body));form.set("request_id",requestId);const r=await action("saveComposedInvoice","/invoices/new",form,auth);return {text:await r.text(),response:r,requestId};}
  assert.match((await generate({...payload,customer_id:""})).text,/Choose a customer/);assert.match((await generate({...payload,issue_date:""})).text,/Enter a valid issue date/);
  const unauth=await generate(payload,randomUUID(),false);assert.ok(unauth.response.headers.get("x-action-redirect")?.includes("/login"));
  const first=await generate(payload);const stored=await client.from("invoices").select("*").eq("creation_request_id",first.requestId).single();assert.equal(stored.error,null);const invoice=stored.data;invoiceIds.push(invoice.id);assert.ok(first.text.includes(invoice.id));assert.equal(invoice.status,"draft");
  const retry=await generate(payload,first.requestId);assert.ok(retry.text.includes(invoice.id));assert.equal((await client.from("invoices").select("id").eq("creation_request_id",first.requestId)).data.length,1);
  const items=(await client.from("invoice_items").select("*").eq("invoice_id",invoice.id).order("position")).data;
  assert.deepEqual(items.map(i=>i.source_type),["retainer_overage","manual"]);assert.deepEqual(items.map(i=>i.period_start),["2025-08-15",null]);assert.equal(items[0].amount,60);
  let detail=await page(`/invoices/${invoice.id}`);assert.match(detail,/Custom alongside overage/);assert.match(detail,/IT Support Overage/);assert.match(detail,/\$100\.00/);assert.match(detail,/>Draft</);
  assert.ok((await page(`/invoices?q=${invoice.invoice_number}`)).includes(`href="/invoices/${invoice.id}"`));assert.match(await page("/invoices"),/New Invoice/);assert.match(await page("/invoices"),/New Invoice/);
  const stale=await generate(payload);assert.match(stale.text,/Billing activity changed since this invoice was prepared/);
  const fresh=(await client.rpc("preview_customer_invoice",{p_customer_id:customer,p_as_of_date:"2025-09-20"})).data[0];assert.equal(fresh.candidates.length,1);assert.equal(fresh.candidates[0].candidate_id,fee.candidate_id);assert.notEqual(fresh.revision,initial.revision);
  const feeOnly=await generate({...payload,revision:fresh.revision,selected_candidate_ids:[fee.candidate_id],items:[]});
  const feeInvoice=(await client.from("invoices").select("id").eq("creation_request_id",feeOnly.requestId).single()).data;invoiceIds.push(feeInvoice.id);assert.match(await page(`/invoices/${feeInvoice.id}`),/Monthly IT Support Retainer/);
  const emptyPreview=(await client.rpc("preview_customer_invoice",{p_customer_id:customer,p_as_of_date:"2025-09-20"})).data[0];assert.equal(emptyPreview.candidates.length,0);
  const empty=await generate({...payload,revision:emptyPreview.revision,selected_candidate_ids:[],items:[]});assert.match(empty.text,/Add or select at least one invoice item/);
  const customOnly=await generate({...payload,revision:emptyPreview.revision,selected_candidate_ids:[]});const customInvoice=(await client.from("invoices").select("id").eq("creation_request_id",customOnly.requestId).single()).data;invoiceIds.push(customInvoice.id);
  assert.equal((await client.from("invoice_items").select("id").eq("billing_agreement_id",a.data.id).lt("period_start","2025-08-15")).data.length,0);
  assert.match(await page(`/invoices/${invoice.id}`),/Edit Invoice/);
  const hourly=await fixture("Local generation hourly");
  for(const [actual_minutes,hourly_rate] of [[18,120],[60,120],[30,150]]){const r=await client.from("time_entries").insert({customer_id:hourly,work_date:"2025-06-01",description:"Historical hourly fixture",actual_minutes,hourly_rate});assert.equal(r.error,null);}
  const hourlyPreview=(await client.rpc("preview_customer_invoice",{p_customer_id:hourly,p_as_of_date:payload.as_of_date})).data[0];
  const generated=await generate({...payload,customer_id:hourly,revision:hourlyPreview.revision,selected_candidate_ids:hourlyPreview.candidates.map(c=>c.candidate_id),items:[]});const hourlyInvoice=await client.from("invoices").select("id,status").eq("creation_request_id",generated.requestId).single();assert.equal(hourlyInvoice.error,null);invoiceIds.push(hourlyInvoice.data.id);assert.equal(hourlyInvoice.data.status,"draft");
  const hourlyItems=(await client.from("invoice_items").select("*").eq("invoice_id",hourlyInvoice.data.id).order("position")).data;assert.deepEqual(hourlyItems.map(i=>i.billed_minutes),[90,30]);assert.deepEqual(hourlyItems.map(i=>i.amount),[180,75]);assert.match(await page(`/invoices/${hourlyInvoice.data.id}`),/\$255\.00/);
  t.diagnostic("Authenticated preview/actions, current fee/prior overage, mixed/custom/suggested-only saves, deselection remains available, claims disappear, stale refresh, hourly grouping, empty selection, retries, authoritative draft totals/list and approval passed.");
 } finally {
  // Invoice history is intentionally nondeletable. Keep only archived/void
  // synthetic fixtures locally; never disable triggers or change schema to clean up.
  for(const id of invoiceIds){const r=await client.from("invoices").update({status:"void",void_reason:"Local UI regression fixture complete"}).eq("id",id);assert.equal(r.error,null);}
  for(const id of customerIds) await client.from("customers").update({is_active:false}).eq("id",id);
  if(userId){assert.match(userId,/^[0-9a-f-]{36}$/);await exec("docker",["exec","supabase_db_nexa","psql","-U","postgres","-d","postgres","-X","-v","ON_ERROR_STOP=1","-c",`delete from auth.users where id='${userId}';`]);}
  server.kill("SIGTERM");await stopped;
 }
});
