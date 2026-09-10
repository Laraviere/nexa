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
  return {load,model:load("@/lib/invoices/composer"),actions:load("@/actions/invoice-composer"),calls,setResult:r=>result=r,setError:e=>error=e,setThrows:()=>throws=true};
}
const revision='a'.repeat(64),candidate='b'.repeat(64);
const payload=()=>({customer_id:id,issue_date:'2025-09-15',as_of_date:'2025-09-15',revision,selected_candidate_ids:[candidate],items:[],notes:'',terms:''});
const charge=(candidate_id=candidate,amount=500)=>({candidate_id,source_type:'retainer_fee',description:'Monthly IT Support Retainer',quantity:1,unit:'month',unit_rate:amount,amount});
test('composer validates suggested-only/custom-only/mixed inputs and calls only atomic save',async()=>{
 const h=harness(),d=payload();assert.ok(h.model.composerInput(d,id).args);
 assert.ok(h.model.composerInput({...d,selected_candidate_ids:[],items:[{description:'Custom',quantity:'1',unit:'each',unit_rate:'20'}]},id).args);
 assert.match(h.model.composerInput({...d,selected_candidate_ids:[]},id).message,/Add or select/);
 assert.ok(h.model.composerInput({...d,revision:''},id).message);
 const form=new FormData();form.set('payload',JSON.stringify(d));form.set('request_id',id);
 assert.equal((await h.actions.saveComposedInvoice({},form)).invoiceId,id);await h.actions.saveComposedInvoice({},form);
 assert.equal(h.calls[0][0],'create_composed_invoice');assert.deepEqual(h.calls[0],h.calls[1]);
 h.setError({code:'P0001',message:'STALE_INVOICE_PREVIEW: private'});let result=await h.actions.saveComposedInvoice({},form);assert.equal(result.stale,true);assert.equal(result.message,'Billing activity changed since this invoice was prepared.');
 h.setError({code:'40001',message:'private'});assert.equal((await h.actions.saveComposedInvoice({},form)).uncertain,true);
 h.setError({code:'23P01',message:'private'});assert.equal((await h.actions.saveComposedInvoice({},form)).stale,true);
 assert.equal(h.model.readCharges([charge()]).length,1);assert.equal(h.model.readCharges([{...charge(),amount:'500'}]),null);
});
test('composer suggestions replace by context, default selected, stale refresh and exact recovery',async()=>{
 const slots=[],effects=[],cleanup=[],navigation=[],previews=[],saves=[];let cursor=0;
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i][j])){slots[i]=deps;effects.push(()=>{cleanup[i]?.();cleanup[i]=fn();});}},
  useActionState(fn,initial){const i=cursor++;if(!(i in slots))slots[i]={state:initial,pending:false};return [slots[i].state,async form=>{slots[i].pending=true;try{slots[i].state=await fn(slots[i].state,form);}finally{slots[i].pending=false;}},slots[i].pending];}
 };
 let nextSave={stale:true,message:'Billing activity changed since this invoice was prepared.'};
 const pendingPreviews=[];
 const api={previewInvoice:args=>{previews.push(args);return new Promise(resolve=>pendingPreviews.push(resolve));},saveComposedInvoice:async(_state,form)=>{saves.push({key:form.get('request_id'),payload:JSON.parse(form.get('payload'))});return nextSave;}};
 const storage=new Map(),previous=globalThis.sessionStorage;
 globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 try {
  const router={replace:p=>navigation.push(p),refresh(){}};
  const h=harness({react,'next/navigation':{useRouter:()=>router},'@/actions/invoice-composer':api});
  const Component=h.load('@/components/invoices/create-invoice-form').CreateInvoiceForm;
  const props={customers:[{id,company_name:'Customer A',is_active:true,default_payment_terms_days:30,agreement:null},{id:'22345678-1234-4234-8234-123456789012',company_name:'Customer B',is_active:true,default_payment_terms_days:30,agreement:null}],today:'2025-09-15',initialRequestId:id,owner:'test'};
  const render=()=>{cursor=0;const tree=Component(props);while(effects.length)effects.shift()();return tree;};
  function all(node){if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(all)];}
  function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return [node.props?.children].flat(Infinity).map(text).join(' ');}
  let tree=render();tree=render();
  all(tree).find(n=>n.type==='select').props.onChange({target:{value:id}});tree=render();tree=render();assert.match(text(tree),/Loading charges/);
  // A context change invalidates the old response, even when it finishes last.
  all(tree).find(n=>n.type==='select').props.onChange({target:{value:props.customers[1].id}});tree=render();
  pendingPreviews[1]({preview:{as_of_date:props.today,revision,candidates:[charge()]}});await Promise.resolve();tree=render();
  assert.equal(all(tree).find(n=>n.props?.type==='checkbox').props.checked,true);
  pendingPreviews[0]({preview:{as_of_date:props.today,revision:'c'.repeat(64),candidates:[]}});await Promise.resolve();tree=render();assert.match(text(tree),/Monthly IT Support Retainer/);
  const checkbox=all(tree).find(n=>n.props?.type==='checkbox');checkbox.props.onChange({target:{checked:false}});tree=render();assert.equal(all(tree).find(n=>n.props?.type==='checkbox').props.checked,false);
  all(tree).find(n=>n.props?.type==='checkbox').props.onChange({target:{checked:true}});tree=render();
  const submit=async()=>{const f=new FormData();for(const n of all(tree).filter(n=>n.props?.type==='hidden'))f.set(n.props.name,n.props.value);await tree.props.action(f);tree=render();};
  await submit();assert.match(text(tree),/Billing activity changed/);assert.equal(all(tree).filter(n=>n.type==='button').at(-1).props.disabled,true);
  all(tree).find(n=>n.type==='button'&&text(n)==='Refresh charges').props.onClick();tree=render();
  const freshRevision='d'.repeat(64);pendingPreviews[2]({preview:{as_of_date:props.today,revision:freshRevision,candidates:[charge(candidate,600)]}});await Promise.resolve();tree=render();assert.match(text(tree),/600/);
  nextSave={uncertain:true,message:'Retry same submission'};await submit();assert.equal(storage.size,1);assert.equal(all(tree).find(n=>n.type==='fieldset').props.disabled,true);
  const saved=saves.at(-1);slots.length=0;cleanup.forEach(fn=>fn?.());cleanup.length=0;tree=render();tree=render();
  nextSave={invoiceId:id};await submit();assert.deepEqual(saves.at(-1),saved);assert.deepEqual(navigation,[`/invoices/${id}`]);assert.equal(storage.size,0);
  assert.equal(previews.length,3,'Reloaded uncertain submission never refreshes reviewed sources');
 } finally {if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous;}
});
test('edit action uses generated update contract and preserves taxes without changing customer',async()=>{
 const h=harness(),form=new FormData();const d={...payload(),invoice_id:id,descriptions:{[candidate]:'Edited description'},items:[{description:'Custom',quantity:'2',unit:'hour',unit_rate:'30',tax_amount:'2'}]};
 form.set('payload',JSON.stringify(d));form.set('request_id',id);
 assert.equal((await h.actions.updateComposedInvoice({},form)).invoiceId,id);await h.actions.updateComposedInvoice({},form);
 assert.equal(h.calls[0][0],'update_composed_invoice');assert.equal(h.calls[0][1].p_invoice_id,id);assert.equal(h.calls[0][1].p_customer_id,undefined);assert.equal(h.calls[0][1].p_custom_items[0].tax_amount,'2');assert.deepEqual(h.calls[0],h.calls[1]);
});
test('editor selects retained charges only and populates editable custom fields',async()=>{
 const slots=[],deps=[],effects=[];let cursor=0;
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useEffect(fn,d){const i=cursor++;if(!deps[i]||d.some((v,j)=>v!==deps[i][j])){deps[i]=d;effects.push(fn);}},useActionState(){cursor++;return [{},()=>{},false];}};
 const h=harness({react,'next/navigation':{useRouter:()=>({})},'@/actions/invoice-composer':{previewInvoiceEdit:async()=>({preview:{as_of_date:'2025-09-15',revision,candidates:[{...charge(),retained:true},charge('c'.repeat(64),200)]}})}});
 const Component=h.load('@/components/invoices/create-invoice-form').CreateInvoiceForm;
 const editing={invoiceId:id,draft:{customer_id:id,issue_date:'2025-09-01',as_of_date:'2025-09-15',notes:'Existing notes',terms:'Terms',items:[{description:'Original custom',quantity:'2',unit:'each',unit_rate:'5'}]}};
 function all(n){if(!n||typeof n!=='object')return [];return [n,...[n.props?.children].flat(Infinity).flatMap(all)];}
 function render(){cursor=0;const tree=Component({customers:[{id,company_name:'Snapshot',is_active:true,default_payment_terms_days:30,agreement:null}],today:'2025-09-15',initialRequestId:id,owner:'edit-test',editing});while(effects.length)effects.shift()();return tree;}
 render();render();await Promise.resolve();const tree=render();const nodes=all(tree);
 assert.deepEqual(nodes.filter(n=>n.props?.type==='checkbox').map(n=>n.props.checked),[true,false]);assert.equal(nodes.find(n=>n.type==='select').props.disabled,true);
 assert.ok(nodes.some(n=>n.type==='input'&&n.props.value==='Original custom'));assert.ok(nodes.some(n=>n.type==='button'&&n.props.children==='Save Changes'));
});
