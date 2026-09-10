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
test("manual invoices: authenticated HTTP actions, atomic retries, snapshots, totals, filters and finalization",{timeout:180000},async(t)=>{
 const status=JSON.parse((await exec("npx",["supabase","status","-o","json"],{cwd:root})).stdout);
 const api=new URL(status.API_URL);assert.ok(["127.0.0.1","localhost"].includes(api.hostname));const key=status.PUBLISHABLE_KEY??status.ANON_KEY;
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:api.href.replace(/\/$/,""),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_TELEMETRY_DISABLED:"1"};
 await exec("npm",["run","build"],{cwd:root,env,maxBuffer:1024*1024});t.diagnostic("npm run build passed using local Supabase.");
 const manifest=JSON.parse(await readFile(new URL(".next/server/server-reference-manifest.json",root),"utf8"));
 const actionId=name=>Object.entries(manifest.node).find(([,v])=>v.exportedName===name)?.[0];
 assert.ok(actionId("createInvoice"));assert.ok(actionId("finalizeInvoice"));
 const socket=createServer();await new Promise(r=>socket.listen(0,"127.0.0.1",r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const base=`http://127.0.0.1:${port}`;
 const server=spawn("node",["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env,stdio:["ignore","pipe","pipe"]});server.stdout.resume();server.stderr.resume();const stopped=new Promise(r=>server.once("close",r));
 const cookies=new Map();const client=createServerClient(api.href,key,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))}});
 let customer,userId;const invoiceIds=[];
 async function request(route,init={},auth=true){return fetch(base+route,{...init,redirect:"manual",signal:AbortSignal.timeout(15000),headers:{Origin:base,...(auth?{Cookie:[...cookies].map(([n,v])=>`${n}=${encodeURIComponent(v)}`).join("; ")} :{}),...init.headers}});}
 async function page(route){const res=await request(route);assert.equal(res.status,200);return res.text();}
 async function action(name,route,form,auth=true){return request(route,{method:"POST",headers:{"Next-Action":actionId(name),Accept:"text/x-component"},body:await encodeReply([{},form])},auth);}
 try {
  for(let i=0;i<100;i++){try{if((await fetch(base+"/login")).status===200)break;}catch{}await delay(100);}
  for(const route of ["/invoices","/invoices/new","/invoices/12345678-1234-4234-8234-123456789012"]){const r=await request(route,{},false);assert.ok(r.headers.get("location")?.includes("/login")||(await r.text()).includes("NEXT_REDIRECT;replace;/login;"));}
  const registration=await client.auth.signUp({email:`nexa-invoice-${randomBytes(8).toString("hex")}@example.test`,password:randomBytes(24).toString("base64url")});assert.equal(registration.error,null);userId=registration.data.user.id;
  const fixture=await client.from("customers").insert({company_name:"Local invoice UI regression",primary_contact_name:"Casey Example",email:"invoice@example.test",billing_city:"Boston",default_payment_terms_days:30}).select().single();assert.equal(fixture.error,null);customer=fixture.data.id;
  const formPage=await page("/invoices/new");assert.match(formPage,/Create draft invoice/);assert.ok(!formPage.includes('name="invoice_number"'));assert.match(formPage,/Preview only/);
  const payload={customer_id:customer,issue_date:"2026-09-01",notes:"Fixture notes",terms:"Fixture terms",items:[{description:"Consulting first",quantity:"1.5",unit:"hour",unit_rate:"120"},{description:"Travel second",quantity:"15",unit:"mile",unit_rate:"0.70"}]};
  async function create(body,requestId=randomUUID(),auth=true){const form=new FormData();form.set("payload",JSON.stringify(body));form.set("request_id",requestId);const r=await action("createInvoice","/invoices/new",form,auth);return {text:await r.text(),response:r,requestId};}
  assert.match((await create({...payload,customer_id:""})).text,/Choose a customer/);
  assert.match((await create({...payload,items:[]})).text,/Add between/);
  const unauth=await create(payload,randomUUID(),false);assert.ok(unauth.response.headers.get("x-action-redirect")?.includes("/login"));
  const first=await create(payload);const read=await client.from("invoices").select("*").eq("creation_request_id",first.requestId).single();assert.equal(read.error,null);const invoice=read.data;invoiceIds.push(invoice.id);assert.ok(first.text.includes(invoice.id));assert.ok(invoice.invoice_number>=1001);assert.equal(invoice.due_date,"2026-10-01");
  assert.equal(invoice.company_name_snapshot,"Local invoice UI regression");
  const retry=await create(payload,first.requestId);assert.ok(retry.text.includes(invoice.id));assert.equal((await client.from("invoices").select("id").eq("creation_request_id",first.requestId)).data.length,1);
  const rows=await client.from("invoice_items").select("*").eq("invoice_id",invoice.id).order("position");assert.deepEqual(rows.data.map(i=>i.description),["Consulting first","Travel second"]);assert.ok(rows.data.every(i=>i.source_type==="manual"));
  const totals=(await client.from("invoice_totals").select("*").eq("invoice_id",invoice.id).single()).data;assert.equal(totals.total,190.50);
  await client.from("customers").update({company_name:"Changed current customer",billing_city:"Miami"}).eq("id",customer);
  let detail=await page(`/invoices/${invoice.id}`);assert.match(detail,/Casey Example/);assert.match(detail,/Boston/);assert.ok(!detail.includes("Changed current customer"));assert.match(detail,/\$190\.50/);assert.match(detail,/October 1, 2026/);assert.match(detail,/>Draft</);assert.ok(!detail.includes('/edit'));
  assert.ok((await page("/invoices?status=draft")).includes(`href="/invoices/${invoice.id}"`));
  const confirm=new FormData();confirm.set("invoice_id",invoice.id);assert.match(await (await action("finalizeInvoice",`/invoices/${invoice.id}`,confirm)).text(),/Confirm that/);
  confirm.set("confirmed","yes");await action("finalizeInvoice",`/invoices/${invoice.id}`,confirm);
  detail=await page(`/invoices/${invoice.id}`);assert.match(detail,/>Finalized</);assert.ok(!detail.includes("Confirm finalization"));assert.ok(!detail.includes('>Sent<'));assert.ok(!detail.includes("Delete"));assert.ok(!detail.includes("Amount paid"));
  assert.ok(!(await page("/invoices?status=draft")).includes(`href="/invoices/${invoice.id}"`));assert.ok((await page("/invoices?status=sent")).includes(`href="/invoices/${invoice.id}"`));
  assert.ok((await client.from("invoice_items").update({unit_rate:1}).eq("invoice_id",invoice.id)).error);
  const second=await create({...payload,items:[payload.items[0]]});const one=await client.from("invoices").select("id").eq("creation_request_id",second.requestId).single();assert.equal(one.error,null);invoiceIds.push(one.data.id);
  // Tax is supported in detail; no tax creation workflow is exposed.
  await client.from("invoice_items").update({tax_amount:2.5}).eq("invoice_id",one.data.id);
  assert.match(await page(`/invoices/${one.data.id}`),/\$182\.50/);
  t.diagnostic("Authenticated list/create/detail/finalize, one/multiple lines, snapshots, DB dates/totals/tax display, request-key retry and finalized immutability passed.");
 } finally {
  // Invoice history is intentionally nondeletable. Keep only archived/void
  // synthetic fixtures locally; never disable triggers or change schema to clean up.
  for(const id of invoiceIds){const r=await client.from("invoices").update({status:"void",void_reason:"Local UI regression fixture complete"}).eq("id",id);assert.equal(r.error,null);}
  if(customer)await client.from("customers").update({is_active:false}).eq("id",customer);
  if(userId){assert.match(userId,/^[0-9a-f-]{36}$/);await exec("docker",["exec","supabase_db_nexa","psql","-U","postgres","-d","postgres","-X","-v","ON_ERROR_STOP=1","-c",`delete from auth.users where id='${userId}';`]);}
  server.kill("SIGTERM");await stopped;
 }
});
