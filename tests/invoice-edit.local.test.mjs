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
test("invoice editor: existing composition, legacy state, atomic edits and history",{timeout:180000},async(t)=>{
 const status=JSON.parse((await exec("npx",["supabase","status","-o","json"],{cwd:root})).stdout);
 const api=new URL(status.API_URL);assert.ok(["127.0.0.1","localhost"].includes(api.hostname));const key=status.PUBLISHABLE_KEY??status.ANON_KEY;
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:api.href.replace(/\/$/,""),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_TELEMETRY_DISABLED:"1"};
 await exec("npm",["run","build"],{cwd:root,env,maxBuffer:1024*1024});t.diagnostic("npm run build passed using local Supabase.");
 const manifest=JSON.parse(await readFile(new URL(".next/server/server-reference-manifest.json",root),"utf8"));
 const actionId=name=>Object.entries(manifest.node).find(([,v])=>v.exportedName===name)?.[0];
 assert.ok(actionId("updateComposedInvoice"));
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
  const registration=await client.auth.signUp({email:`nexa-edit-${randomBytes(8).toString("hex")}@example.test`,password:randomBytes(24).toString("base64url")});assert.equal(registration.error,null);userId=registration.data.user.id;
  const fixture=await client.from("customers").insert({company_name:"Editor original snapshot",default_payment_terms_days:30}).select().single();assert.equal(fixture.error,null);customer=fixture.data.id;customerIds.push(customer);
  const made=await client.rpc("create_manual_invoice",{p_customer_id:customer,p_issue_date:"2025-09-01",p_request_id:randomUUID(),p_items:[{description:"Old line",quantity:1,unit:"each",unit_rate:10,tax_amount:2}]});assert.equal(made.error,null);const invoice=made.data[0];invoiceIds.push(invoice.invoice_id);
  const invoiceId=invoice.invoice_id;const route=`/invoices/${invoiceId}/edit`;
  const denied=await request(route,{},false);assert.ok(denied.headers.get("location")?.includes("/login")||(await denied.text()).includes("NEXT_REDIRECT;replace;/login;"));
  async function transition(target,revision,auth=true){const form=new FormData();form.set("invoice_id",invoiceId);form.set("target",target);form.set("updated_at",revision);form.set("confirmed","yes");const response=await action("changeInvoiceStatus",`/invoices/${invoiceId}`,form,auth);return {response,text:await response.text()};}
  const draftPage=await page(`/invoices/${invoiceId}`);assert.match(draftPage,/Mark Ready/);assert.ok(!/Approved|Finalized|Mark Sent|Send Invoice/.test(draftPage));
  const initial=(await client.from("invoices").select("updated_at").eq("id",invoiceId).single()).data.updated_at;
  const deniedStatus=await transition("ready",initial,false);assert.ok(deniedStatus.response.headers.get("x-action-redirect")?.includes("/login"));
  assert.match((await transition("ready",initial)).text,/Invoice marked Ready/);
  const readyPage=await page(`/invoices/${invoiceId}`);assert.match(readyPage,/>Ready</);assert.match(readyPage,/Move to Draft/);assert.match(readyPage,/Edit Invoice/);
  assert.match(await page(route),/Save Changes/);
  const list=await page("/invoices?status=ready");assert.match(list,/status=ready/);assert.ok(list.includes(`href="/invoices/${invoiceId}"`));assert.ok(!/Approved|Finalized/.test(list));
  assert.match((await transition("draft",initial)).text,/This invoice changed/);
  const readyRevision=(await client.from("invoices").select("updated_at").eq("id",invoiceId).single()).data.updated_at;
  assert.match((await transition("sent",readyRevision)).text,/Confirm the invoice status change/);
  assert.match((await transition("draft",readyRevision)).text,/Invoice moved to Draft/);
  await client.from("invoices").update({status:"sent"}).eq("id",invoiceId);
  await client.from("customers").update({company_name:"Changed customer",default_payment_terms_days:5}).eq("id",customer);
  const detail=await page(`/invoices/${invoiceId}`);assert.match(detail,/Edit Invoice/);assert.match(detail,/>Sent</);assert.match(detail,/delivery has not been verified/);assert.ok(!/Approve Invoice|Finaliz/.test(detail));
  const editor=await page(route);assert.match(editor,/Old line/);assert.match(editor,/Save Changes/);assert.match(editor,/Cancel/);assert.match(editor,/Customer and captured payment terms remain fixed/);assert.match(editor,/Editor original snapshot/);
  const preview=await client.rpc("preview_invoice_edit",{p_invoice_id:invoiceId,p_as_of_date:"2025-09-01"});assert.equal(preview.error,null);
  const payload={invoice_id:invoiceId,customer_id:customer,issue_date:"2025-09-05",as_of_date:"2025-09-01",revision:preview.data[0].revision,selected_candidate_ids:[],descriptions:{},notes:"Edited notes",terms:"Edited terms",items:[{description:"Updated custom",quantity:"2",unit:"hour",unit_rate:"30",tax_amount:"2"},{description:"New custom",quantity:"1",unit:"flat",unit_rate:"5"}]};
  async function edit(body,key=randomUUID(),auth=true){const form=new FormData();form.set("payload",JSON.stringify(body));form.set("request_id",key);const response=await action("updateComposedInvoice",route,form,auth);return {response,text:await response.text(),key};}
  const unauth=await edit(payload,randomUUID(),false);assert.ok(unauth.response.headers.get("x-action-redirect")?.includes("/login"));
  const saved=await edit(payload);assert.ok(saved.text.includes(invoiceId));const retry=await edit(payload,saved.key);assert.ok(retry.text.includes(invoiceId));
  const read=await client.from("invoices").select("*").eq("id",invoiceId).single();assert.equal(read.data.invoice_number,invoice.invoice_number);assert.equal(read.data.status,"sent");assert.equal(read.data.due_date,"2025-10-05");assert.equal(read.data.company_name_snapshot,"Editor original snapshot");
  const total=(await client.from("invoice_totals").select("total").eq("invoice_id",invoiceId).single()).data.total;assert.equal(total,67);
  const after=await page(`/invoices/${invoiceId}`);assert.match(after,/Updated custom/);assert.match(after,/New custom/);assert.match(after,/Edited notes/);assert.match(after,/\$67\.00/);assert.ok(!after.includes("Old line"));assert.match(after,/Edit Invoice/);
  const stale=await edit(payload);assert.match(stale.text,/Billing activity changed/);
  const history=await client.from("invoice_items").select("id,superseded_at").eq("invoice_id",invoiceId);assert.equal(history.data.filter(i=>i.superseded_at).length,1);
  const journal=await client.from("invoice_edit_requests").select("request_id").eq("invoice_id",invoiceId);assert.equal(journal.data.length,1);
  assert.equal((await client.from("invoices").update({status:"ready"}).eq("id",invoiceId)).error,null);
  const readyPreview=await client.rpc("preview_invoice_edit",{p_invoice_id:invoiceId,p_as_of_date:"2025-09-01"});assert.equal(readyPreview.error,null);
  const readySaved=await edit({...payload,revision:readyPreview.data[0].revision,notes:"Ready edit"});assert.ok(readySaved.text.includes(invoiceId));
  const readyRead=(await client.from("invoices").select("status,invoice_number").eq("id",invoiceId).single()).data;assert.equal(readyRead.status,"ready");assert.equal(readyRead.invoice_number,invoice.invoice_number);
  assert.equal((await client.from("invoices").update({status:"void",void_reason:"Lifecycle test"}).eq("id",invoiceId)).error,null);
  const voidPage=await page(`/invoices/${invoiceId}`);assert.match(voidPage,/>Void</);assert.ok(!/Edit Invoice|Mark Ready|Move to Draft/.test(voidPage));
  const voidEditor=await request(route);assert.ok(voidEditor.status===404||(await voidEditor.text()).includes("NEXT_HTTP_ERROR_FALLBACK;404"));
  t.diagnostic("Draft ↔ Ready server actions, authentication, stale revision, no manual Sent action, Ready filter, editable Ready/Sent and read-only Void passed.");
  t.diagnostic("Authenticated populated editor; truthful Sent label; customer fixed; custom quantity/rate/unit/description replacement; tax preserved; dates/totals/number; retry/stale/history; no approval UI passed.");
 } finally {
  // Invoice history is intentionally nondeletable. Keep only archived/void
  // synthetic fixtures locally; never disable triggers or change schema to clean up.
  for(const id of invoiceIds){const r=await client.from("invoices").update({status:"void",void_reason:"Local UI regression fixture complete"}).eq("id",id).neq("status","void");assert.equal(r.error,null);}
  for(const id of customerIds) await client.from("customers").update({is_active:false}).eq("id",id);
  if(userId){assert.match(userId,/^[0-9a-f-]{36}$/);await exec("docker",["exec","supabase_db_nexa","psql","-U","postgres","-d","postgres","-X","-v","ON_ERROR_STOP=1","-c",`delete from auth.users where id='${userId}';`]);}
  server.kill("SIGTERM");await stopped;
 }
});
