import assert from "node:assert/strict";
import { readFileSync,existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require=createRequire(import.meta.url);
const id="12345678-1234-4234-8234-123456789012";
const draft=()=>({customer_id:id,issue_date:"2026-09-01",notes:"",terms:"",items:[{description:"Support",quantity:"1.5",unit:"hour",unit_rate:"120"}]});
function harness(extra={}) {
  const calls=[]; let error=null,throws=false;
  const client={rpc:async(name,args)=>{calls.push([name,args]);if(throws)throw new Error("private network details");return {data:error?null:[{invoice_id:id}],error};},from(){throw new Error("Creation must only use RPC");}};
  const overrides={"@/lib/customers/server":{customerClient:async()=>client},"next/cache":{revalidatePath:()=>{}},...extra};
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
test("invoice validation preserves exact decimals, array order and only manual editable values",()=>{
 const {model}=harness();const d=draft();d.items.push({description:"Second",quantity:"0.00000001",unit:"each",unit_rate:"9999999999.99",amount:100,source_type:"retainer_fee"});
 const r=model.invoiceInput(d,id);assert.ok(r.args);assert.equal(r.args.p_request_id,id);assert.equal(r.args.p_items[1].quantity,"0.00000001");assert.equal(r.args.p_items[1].source_type,undefined);assert.equal(r.args.p_items[1].amount,undefined);
 for(const [field,values] of Object.entries({quantity:["0","-1","NaN","Infinity","0.000000001","1000000000000"],unit_rate:["-1","NaN","Infinity","1.001","10000000000"],unit:["invalid"],description:["  "]}))for(const value of values){const copy=draft();copy.items[0][field]=value;assert.ok(model.invoiceInput(copy,id).message,`${field}: ${value}`);}
 assert.ok(model.invoiceInput({...draft(),items:[]},id).message);assert.ok(model.invoiceInput({...draft(),customer_id:""},id).message);
 for(const date of ["2026-02-30","2026-13-01","0000-01-01",""])assert.ok(model.invoiceInput({...draft(),issue_date:date},id).message);
 assert.equal(model.previewTotal(draft().items),180);
});
test("creation uses generated RPC contract only and reuses supplied key on retries",async()=>{
 const h=harness();const form=new FormData();form.set("payload",JSON.stringify(draft()));form.set("request_id",id);
 assert.equal((await h.actions.createInvoice({},form)).invoiceId,id);await h.actions.createInvoice({},form);
 assert.equal(h.calls.length,2);assert.equal(h.calls[0][0],"create_manual_invoice");assert.deepEqual(h.calls[0][1],h.calls[1][1]);
 h.setError({code:"40001",message:"secret SQL"});let r=await h.actions.createInvoice({},form);assert.equal(r.uncertain,true);assert.ok(!r.message.includes("secret"));
 h.setError({code:"22023",message:"invalid quantity"});r=await h.actions.createInvoice({},form);assert.ok(!r.uncertain);
 h.setError({code:"22023",message:"Request ID was already used with different invoice data."});assert.equal((await h.actions.createInvoice({},form)).uncertain,true);
 h.setThrows();assert.equal((await h.actions.createInvoice({},form)).uncertain,true);
});

test("invoice status and due-date previews use workflow labels and date-only terms",()=>{
 const {model}=harness();assert.equal(model.statuses.sent,"Sent");assert.equal(model.statuses.ready,"Ready");assert.equal(model.statuses.draft,"Draft");assert.equal(model.previewDueDate("2026-09-01",30),"2026-10-01");assert.equal(model.previewDueDate("2024-02-28",1),"2024-02-29");assert.equal(model.previewDueDate("2026-09-01",0),"2026-09-01");assert.equal(model.previewDueDate("2026-02-30",30),null);
});
test("composer has billing context, dated suggestions and responsive custom rows",()=>{
 const react=require("react"),draftValue={...draft(),items:[{description:"Support",quantity:"1.5",unit:"hour",unit_rate:"120"}]};let first=true;
 const h=harness({react:{...react,useState:initial=>[first?(first=false,draftValue):initial,()=>{}],useRef:initial=>({current:initial}),useEffect:()=>{},useActionState:()=>[{},()=>{},false]},"next/navigation":{useRouter:()=>({})}});
 const Component=h.load("@/components/invoices/create-invoice-form").CreateInvoiceForm;
 const tree=Component({customers:[{id,company_name:"Example",is_active:true,default_payment_terms_days:30,agreement:null}],today:"2026-09-01",initialRequestId:id,owner:"test"});
 const html=require("react-dom/server").renderToStaticMarkup(tree);assert.match(html,/Bill to/);assert.match(html,/No retainer/);assert.match(html,/October 1, 2026/);assert.match(html,/Suggested charges/);assert.match(html,/As-of date/);assert.match(html,/Add custom item/);assert.match(html,/Save Draft/);assert.match(html,/\$180\.00/);assert.match(html,/lg:grid-cols/);assert.match(html,/min-w-0/);
});

test("invoice workflow controls and confirmations match the status without delivery actions",()=>{
 for(const open of [false,true])for(const status of ["draft","ready","sent","void"]){
  const react=require("react");const h=harness({react:{...react,useState:()=>[open,()=>{}],useActionState:()=>[{},()=>{},false]},"next/navigation":{useRouter:()=>({refresh(){}})}});
  const Component=h.load("@/components/invoices/invoice-status").InvoiceStatus;
  const html=require("react-dom/server").renderToStaticMarkup(Component({id,status,updatedAt:"2026-09-10T12:00:00Z"}));
  if(status==="sent"||status==="void")assert.equal(html,"");
  else {assert.match(html,status==="draft"?/Mark Ready/:/Move to Draft/);if(open){assert.match(html,/Cancel/);assert.match(html,/remains editable/);if(status==="draft")assert.match(html,/ready for sending/);}}
  assert.ok(!/Approved|Finalized|Send Invoice|Mark Sent/.test(html));
 }
});
test("workflow action updates only status with expected status/revision and limits UI transitions",async()=>{
 const calls=[];let result={data:{id},error:null};const query={update(value){calls.push(value);return this;},eq(key,value){calls.push([key,value]);return this;},select(){return this;},async maybeSingle(){return result;}};
 const h=harness({"@/lib/customers/server":{customerClient:async()=>({from:name=>{assert.equal(name,"invoices");return query;}})}});
 const form=new FormData();form.set("invoice_id",id);form.set("updated_at","2026-09-10T12:00:00Z");form.set("confirmed","yes");form.set("target","ready");
 assert.match((await h.actions.changeInvoiceStatus({},form)).message,/marked Ready/);assert.deepEqual(calls[0],{status:"ready"});assert.deepEqual(calls.slice(1),[["id",id],["status","draft"],["updated_at","2026-09-10T12:00:00Z"]]);
 form.set("target","draft");assert.match((await h.actions.changeInvoiceStatus({},form)).message,/moved to Draft/);
 result={data:null,error:null};assert.match((await h.actions.changeInvoiceStatus({},form)).message,/changed/);
 result={data:null,error:{message:"private SQL"}};assert.ok(!(await h.actions.changeInvoiceStatus({},form)).message.includes("private"));
 for(const target of ["sent","void","approved"]){form.set("target",target);assert.match((await h.actions.changeInvoiceStatus({},form)).message,/Confirm/);}
});
