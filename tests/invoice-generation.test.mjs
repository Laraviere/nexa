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
  const calls=[]; let error=null,throws=false,result={outcome:"created",invoice_id:id};
  const client={rpc:async(name,args)=>{calls.push([name,args]);if(throws)throw new Error("private network details");return {data:error?null:[result],error};},from(){throw new Error("Creation must only use RPC");}};
  const overrides={"@/lib/customers/server":{customerClient:async()=>client},"next/cache":{revalidatePath:()=>{}},...extra};
  const cache=new Map();
  function load(name){
    if(name in overrides)return overrides[name];if(!name.startsWith("@/"))return require(name);
    if(cache.has(name))return cache.get(name).exports;
    const file=[".ts",".tsx"].map(ext=>path.resolve(import.meta.dirname,"../src",name.slice(2)+ext)).find(existsSync);
    const output=ts.transpileModule(readFileSync(file,"utf8"),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const mod={exports:{}};cache.set(name,mod);vm.runInThisContext(`(function(require,module,exports){${output}\n})`,{filename:file})(load,mod,mod.exports);return mod.exports;
  }
  return {load,model:load("@/lib/invoices/generation"),actions:load("@/actions/generate-invoice"),calls,setResult:r=>result=r,setError:e=>error=e,setThrows:()=>throws=true};
}
const generation=()=>({customer_id:id,issue_date:"2025-09-15",as_of_date:"2025-09-15",notes:"",terms:""});
test("generation validates required fields and real dates with generated optional args",()=>{
 const h=harness();assert.ok(h.model.generationInput(generation(),id).args);
 for(const [field,value] of [["customer_id",""],["issue_date",""],["issue_date","2025-02-30"],["as_of_date","2025-02-29"]])assert.ok(h.model.generationInput({...generation(),[field]:value},id).message);
 assert.equal(h.model.generationInput({...generation(),as_of_date:""},id).args.p_as_of_date,undefined);
});
test("generation calls only atomic RPC, preserves retry payload and handles normal empty outcome",async()=>{
 const h=harness(),form=new FormData();form.set("payload",JSON.stringify(generation()));form.set("request_id",id);
 assert.equal((await h.actions.generateInvoice({},form)).invoiceId,id);await h.actions.generateInvoice({},form);
 assert.equal(h.calls[0][0],"generate_customer_invoice");assert.deepEqual(h.calls[0],h.calls[1]);
 h.setResult({outcome:"nothing_to_invoice",invoice_id:null});const empty=await h.actions.generateInvoice({},form);assert.equal(empty.empty,true);assert.equal(empty.invoiceId,undefined);assert.match(empty.message,/nothing eligible/);
 for(const code of ["40001","40P01","XX000"]){h.setError({code,message:"private SQL"});const r=await h.actions.generateInvoice({},form);assert.equal(r.uncertain,true);assert.ok(!r.message.includes("private"));}
 for(const code of ["P0002","22023","0A000","23514","23505","23P01"]){h.setError({code,message:"private SQL"});const r=await h.actions.generateInvoice({},form);assert.ok(r.message);assert.ok(!r.message.includes("private"));}
 h.setError({code:"22023",message:"Request ID conflict"});assert.equal((await h.actions.generateInvoice({},form)).uncertain,true);
 h.setThrows();assert.equal((await h.actions.generateInvoice({},form)).uncertain,true);
});
test("form recovery, double-submit guard, empty result editing, context and draft navigation",async()=>{
 const slots=[],effects=[],navigation=[];let cursor=0;
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i][j])){slots[i]=deps;effects.push(fn);}},
  useActionState(fn,initial){const i=cursor++;if(!(i in slots))slots[i]={state:initial,pending:false};return [slots[i].state,async form=>{slots[i].pending=true;try{slots[i].state=await fn(slots[i].state,form);}finally{slots[i].pending=false;}},slots[i].pending];}
 };
 const storage=new Map(),previous=globalThis.sessionStorage;
 globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 try {
  const router={replace:path=>navigation.push(path),refresh:()=>{}};
  const h=harness({react,"next/navigation":{useRouter:()=>router}});
  const Component=h.load("@/components/invoices/generate-invoice-form").GenerateInvoiceForm;
  const props={customers:[{id,company_name:"Example",is_active:true,agreement:{monthly_fee:500,billing_cycle_day:15,included_hours:1,overage_hourly_rate:120}}],today:"2025-09-15",initialRequestId:id,owner:"test"};
  const render=()=>{cursor=0;const tree=Component(props);while(effects.length)effects.shift()();return tree;};
  function all(node){if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(all)];}
  function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return [node.props?.children].flat(Infinity).map(text).join(' ');}
  let tree=render();tree=render();
  all(tree).find(n=>n.type==='select').props.onChange({target:{value:id}});tree=render();
  assert.match(text(tree),/Monthly retainer/);assert.match(text(tree),/Monthly on the 15th/);
  const inputs=all(tree).filter(n=>n.type==='input'&&n.props.type==='date');assert.deepEqual(inputs.map(n=>n.props.value),[props.today,props.today]);
  let prevented=0;tree.props.onSubmit({preventDefault:()=>prevented++});tree.props.onSubmit({preventDefault:()=>prevented++});assert.equal(prevented,1);
  const submit=async()=>{const f=new FormData();for(const n of all(tree).filter(n=>n.type==='input'&&n.props.type==='hidden'))f.set(n.props.name,n.props.value);await tree.props.action(f);tree=render();};
  h.setError({code:"40001",message:"private"});await submit();assert.equal(storage.size,1);assert.equal(all(tree).find(n=>n.type==='fieldset').props.disabled,true);assert.match(text(tree),/Retry same submission/);
  const saved=JSON.parse([...storage.values()][0]);assert.equal(saved.requestId,id);
  // Reload restores exactly the request payload and freezes edits until resolved.
  slots.length=0;tree=render();tree=render();assert.equal(all(tree).find(n=>n.type==='fieldset').props.disabled,true);
  h.setError(null);h.setResult({outcome:"nothing_to_invoice",invoice_id:null});await submit();
  assert.equal(storage.size,0);assert.equal(all(tree).find(n=>n.type==='fieldset').props.disabled,false);assert.match(text(tree),/nothing eligible/);assert.equal(navigation.length,0);
  assert.deepEqual(h.calls[0],h.calls[1]);assert.notEqual(all(tree).find(n=>n.props?.name==='request_id').props.value,id);
  h.setResult({outcome:"created",invoice_id:id});await submit();assert.deepEqual(navigation,[`/invoices/${id}`]);
  assert.equal(all(tree).find(n=>n.type==='button').props.disabled,true);
 } finally { if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous; }
});
