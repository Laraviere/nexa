import assert from "node:assert/strict";
import { readFileSync,existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require=createRequire(import.meta.url);
const id="12345678-1234-4234-8234-123456789012";
function harness(extra={}) {
  const calls=[]; let error=null,throws=false;
  const client={rpc:async(name,args)=>{calls.push([name,args]);if(throws)throw new Error("private network details");return {data:error?null:[{invoice_id:id}],error};},from(){throw new Error("Creation must only use RPC");}};
  const overrides={"server-only":{},"./void-payment":{VoidPayment:()=>null},"@/lib/customers/server":{customerClient:async()=>client},"next/cache":{revalidatePath:()=>{}},...extra};
  const cache=new Map();
  function load(name){
    if(name in overrides)return overrides[name];if(!name.startsWith("@/"))return require(name);
    if(cache.has(name))return cache.get(name).exports;
    const file=[".ts",".tsx"].map(ext=>path.resolve(import.meta.dirname,"../src",name.slice(2)+ext)).find(existsSync);
    const output=ts.transpileModule(readFileSync(file,"utf8"),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const mod={exports:{}};cache.set(name,mod);vm.runInThisContext(`(function(require,module,exports){${output}\n})`,{filename:file})(load,mod,mod.exports);return mod.exports;
  }
  return {load,model:load("@/lib/invoices/model"),actions:load("@/actions/invoices"),calls,setError:e=>error=e,setThrows:()=>throws=true};
}
test("payment validation and server actions use generated RPCs with stable request keys",async()=>{
 const calls=[];let error=null;let result=[{invoice_id:id,payment_id:id,payment_voided_at:null}];
 const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:error?null:result,error};},from:()=>({select(){return this},eq(){return this},single:async()=>({data:{cash_enabled:true,check_enabled:true,card_enabled:false}})})};
 const h=harness({"@/lib/customers/server":{customerClient:async()=>client}});const actions=h.load("@/actions/payments");
 const form=new FormData();Object.entries({invoice_id:id,request_id:id,amount:"200.00",payment_date:"2026-09-10",payment_method:"cash",reference:"Receipt",notes:"Note"}).forEach(([k,v])=>form.set(k,v));
 assert.equal((await actions.recordPayment({},form)).success,true);await actions.recordPayment({},form);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0][0],"record_invoice_payment");assert.equal(calls[0][1].p_amount,200);
 for(const amount of ["0","-1","NaN","Infinity","1.001","10000000000"]){form.set("amount",amount);assert.ok((await actions.recordPayment({},form)).message);}form.set("amount","200");
 form.set("payment_date","2026-02-30");assert.match((await actions.recordPayment({},form)).message,/valid payment date/);form.set("payment_date","2026-09-10");
 error={code:"22023",message:"Payment exceeds the remaining invoice balance."};assert.match((await actions.recordPayment({},form)).message,/cannot exceed/);
 error={code:"22023",message:"This payment method is not enabled."};const disabled=await actions.recordPayment({},form);assert.match(disabled.message,/no longer enabled/);assert.equal(disabled.settings.card_enabled,false);
 error={code:"P1001",message:"private database details"};const ineligible=await actions.recordPayment({},form);assert.equal(ineligible.message,"This invoice must be marked Ready before a payment can be recorded.");assert.ok(!ineligible.uncertain);
 error={code:"500",message:"private details"};const uncertain=await actions.recordPayment({},form);assert.equal(uncertain.uncertain,true);assert.ok(!uncertain.message.includes("private"));error=null;
 const settings=new FormData();assert.match((await actions.savePaymentSettings({},settings)).message,/At least one/);settings.set("cash_enabled","on");result={cash_enabled:true};assert.equal((await actions.savePaymentSettings({},settings)).success,true);assert.equal(calls.at(-1)[0],"update_payment_settings");assert.deepEqual(calls.at(-1)[1],{p_cash_enabled:true,p_check_enabled:false,p_card_enabled:false});
 const correction=new FormData();correction.set("payment_id",id);assert.match((await actions.voidPayment({},correction)).message,/reason/);correction.set("reason","Correction");correction.set("confirmed","yes");result={invoice_id:id};assert.equal((await actions.voidPayment({},correction)).success,true);assert.equal(calls.at(-1)[0],"void_invoice_payment");
});
test("payment form defaults, enabled methods, accessible switches and retained history",()=>{
 const react=require("react");let index=0;const initial=[true,true,false,{},id,null];const settings={cash_enabled:true,check_enabled:true,card_enabled:false};
 const h=harness({react:{...react,useState:value=>[index<initial.length?initial[index++]:value,()=>{}],useRef:value=>({current:value}),useEffect:()=>{},useActionState:()=>[{},()=>{},false]},"next/navigation":{useRouter:()=>({refresh(){}})}});
 const render=require("react-dom/server").renderToStaticMarkup;
 const form=h.load("@/components/payments/record-payment").RecordPayment({invoiceId:id,owner:id,balance:300,today:"2026-09-10",settings,canRecord:true});const html=render(form);
 assert.match(html,/value="300.00"/);assert.match(html,/value="2026-09-10"/);assert.match(html,/type="radio"/);assert.match(html,/Cash/);assert.match(html,/Check/);assert.ok(!html.includes('value="card"'));assert.match(html,/partial payment/);assert.match(html,/flex-wrap/);assert.match(html,/sm:grid-cols-2/);
 index=0;
 const blocked=render(h.load("@/components/payments/record-payment").RecordPayment({invoiceId:id,owner:id,balance:300,today:"2026-09-10",settings,canRecord:false}));
 assert.ok(!blocked.includes("Mark as Paid"));assert.ok(!blocked.includes("Record invoice payment"),"A stale open panel closes when the refreshed invoice becomes ineligible");
 const toggles=render(h.load("@/components/payments/settings-form").PaymentSettingsForm({settings}));assert.equal((toggles.match(/role="switch"/g)||[]).length,3);assert.match(toggles,/Historical payments remain unchanged/);
 const history=render(h.load("@/components/payments/payment-history").PaymentHistory({payments:[{id,amount:200,payment_method:"card",payment_date:"2026-09-10",reference:"Receipt",voided_at:"2026-09-10",void_reason:"Correction"}]}));assert.match(history,/Card/);assert.match(history,/Void/);assert.match(history,/Correction/);assert.ok(!history.includes("Void payment"));assert.ok(!history.includes("Delete"));
});

test("uncertain payment retries preserve the exact payload and block simultaneous submission",async()=>{
 const payload={invoice_id:id,request_id:id,amount:"200.00",payment_date:"2026-09-10",payment_method:"cash",reference:"Original receipt",notes:"Original note"};
 const values=[true,true,false,{uncertain:true},id,payload];let stateIndex=0,refIndex=0,release;const calls=[],stored=new Map();let refreshed=0;
 const oldStorage=globalThis.sessionStorage;globalThis.sessionStorage={setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
 try {
  const react=require("react");const h=harness({react:{...react,useState:()=>[values[stateIndex++],()=>{}],useRef:()=>({current:refIndex++===0?payload:false}),useEffect:()=>{}},"next/navigation":{useRouter:()=>({refresh(){refreshed++;}})},"@/actions/payments":{recordPayment:async(_state,form)=>{calls.push(Object.fromEntries(form));if(calls.length===1)return new Promise(r=>{release=r;});return {success:true,message:"Payment recorded."};}}});
  const component=h.load("@/components/payments/record-payment").RecordPayment({invoiceId:id,owner:id,balance:300,today:"2026-09-11",settings:{cash_enabled:true,check_enabled:true,card_enabled:true},canRecord:true});
  function findForm(node){if(!node||typeof node!=="object")return; if(node.type==="form")return node;for(const child of [node.props?.children].flat(Infinity)){const found=findForm(child);if(found)return found;}}
  const form=findForm(component);const event={preventDefault(){}};
  const first=form.props.onSubmit(event);await form.props.onSubmit(event);assert.equal(calls.length,1);release({uncertain:true,message:"Retry"});await first;assert.equal(stored.size,1);
  await form.props.onSubmit(event);assert.equal(calls.length,2);assert.deepEqual(calls[0],payload);assert.deepEqual(calls[1],payload);assert.equal(stored.size,0);assert.equal(refreshed,1);
 }finally{if(oldStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=oldStorage;}
});
