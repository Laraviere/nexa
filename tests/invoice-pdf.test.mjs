import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as renderer from '@react-pdf/renderer';
import {inspectPdf} from './helpers/pdf.mjs';
const require=createRequire(import.meta.url);
function harness(overrides={}){
 const cache=new Map();
 function load(name,parent=path.resolve('src')){
  if(name in overrides)return overrides[name];if(name==='@react-pdf/renderer')return renderer;
  if(!name.startsWith('@/')&&!name.startsWith('.'))return require(name);
  const base=name.startsWith('@/')?path.resolve('src',name.slice(2)):path.resolve(parent,name);
  const file=['.ts','.tsx'].map(ext=>base+ext).find(existsSync);if(cache.has(file))return cache.get(file).exports;
  const output=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const mod={exports:{}};cache.set(file,mod);vm.runInThisContext(`(function(require,module,exports){${output}\n})`,{filename:file})(name=>load(name,path.dirname(file)),mod,mod.exports);return mod.exports;
 }return load;
}
const fixture=()=>({invoice:{invoice_number:1055,status:'ready',company_name_snapshot:'Snapshot Consulting',primary_contact_name_snapshot:'Jane Example',email_snapshot:'test@example.test',phone_snapshot:'555 test',billing_address_line1_snapshot:'123 Test Street',billing_city_snapshot:'Test City',billing_state_snapshot:'VA',billing_postal_code_snapshot:'00000',issue_date:'2026-09-10',due_date:'2026-10-10',notes:'Notes first line\nNotes second line',terms:'Payment terms example'},items:[{id:'one',description:'Persisted description',quantity:1.5,unit:'hour',unit_rate:75,amount:111.11}],totals:{subtotal:111.11,tax_amount:2.22,total:113.33}});
test('PDF uses persisted text and amounts with friendly dates, units, totals and status treatment',async()=>{
 const {renderInvoicePdf,formatInvoiceQuantity}=harness()('@/lib/invoices/pdf/document');
 for(const [q,u,label] of [[1,'hour','1 Hour'],[1.5,'hour','1.5 Hours'],[30,'minute','30 Minutes'],[1,'each','1 Each'],[15,'mile','15 Miles'],[1,'month','1 Month'],[1,'flat','Flat fee'],[2,'flat','2 × Flat fee']])assert.equal(formatInvoiceQuantity(q,u),label);
 for(const status of ['draft','ready','sent','void']){
  const data=fixture();data.invoice.status=status;if(status==='sent'){data.invoice.notes=null;data.invoice.terms=null;}
  const pdf=await inspectPdf(await renderInvoicePdf(data));assert.equal(pdf.pages.length,1);
  for(const value of ['Snapshot Consulting','September 10, 2026','October 10, 2026','Persisted description','1.5 Hours','$75.00','$111.11','$2.22','$113.33'])assert.ok(pdf.text.includes(value),value);
  assert.ok(!pdf.text.includes('$112.50'),'Does not multiply quantity by rate');
  if(status==='void')assert.match(pdf.text,/VOID.*Not payable/);
  if(status==='draft')assert.match(pdf.text,/DRAFT.*For review/);
  if(status==='sent')assert.ok(!/NOTES|TERMS/.test(pdf.text));else assert.match(pdf.text,/Notes first line.*Notes second line/);
 }
});
test('multi-page PDFs preserve every line, repeated columns and long notes within print bounds',async()=>{
 const {renderInvoicePdf}=harness()('@/lib/invoices/pdf/document');const data=fixture();
 data.items=Array.from({length:80},(_,i)=>({...data.items[0],id:String(i),description:`Ordered service ${String(i).padStart(3,'0')} — persisted detail`}));
 data.items.push({...data.items[0],id:'long',description:Array.from({length:130},(_,i)=>`Long description paragraph ${i}.`).join('\n')});
 data.invoice.notes=Array.from({length:80},(_,i)=>`Note paragraph ${i} with customer instructions.`).join('\n');
 const pdf=await inspectPdf(await renderInvoicePdf(data));assert.ok(pdf.pages.length>3);
 let previous=-1;for(let i=0;i<80;i++){const position=pdf.text.indexOf(`Ordered service ${String(i).padStart(3,'0')}`);assert.ok(position>previous);previous=position;}
 assert.match(pdf.text,/Long description paragraph 129/);assert.match(pdf.text,/Note paragraph 79/);
 for(const [index,p] of pdf.pages.entries()){assert.match(p.text,/DESCRIPTION.*QTY \/ UNIT.*RATE.*AMOUNT/);assert.ok(p.text.includes(`${index+1} / ${pdf.pages.length}`));}
});
test('PDF endpoint has private responses, authentication, hidden invoices and safe generation errors',async()=>{
 const id='12345678-1234-4234-8234-123456789012';let authenticated=false;let fail=false;
 const load=harness({'@/lib/supabase/server':{createClient:async()=>({auth:{getClaims:async()=>({data:authenticated?{claims:{sub:id}}:null,error:null})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null})})})},'@/lib/invoices/pdf/document':{renderInvoicePdf:async()=>{throw Error('Private error')}}});
 const {GET}=load('@/app/(app)/invoices/[id]/pdf/route');
 let response=await GET(new Request('http://localhost'),{params:Promise.resolve({id})});assert.equal(response.status,401);assert.match(response.headers.get('cache-control'),/no-store/);
 authenticated=true;response=await GET(new Request('http://localhost'),{params:Promise.resolve({id})});assert.equal(response.status,404);
 const endpoint=harness({'@/lib/supabase/server':{createClient:async()=>{if(fail)throw Error('secret');return {auth:{getClaims:async()=>({data:{claims:{sub:id}}})}}}},'@/lib/invoices/pdf/data':{InvoicePdfError:class extends Error{},loadInvoicePdf:async()=>fixture()},'@/lib/invoices/pdf/document':{renderInvoicePdf:async()=>Buffer.from('%PDF-test')}})('@/app/(app)/invoices/[id]/pdf/route');
 response=await endpoint.GET(new Request('http://localhost'),{params:Promise.resolve({id})});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/Nexa-Invoice-1055.pdf/);
 fail=true;response=await endpoint.GET(new Request('http://localhost'),{params:Promise.resolve({id})});assert.equal(response.status,500);assert.ok(!(await response.text()).includes('secret'));
});
test('PDF data reader respects permission errors and rejects inconsistent read revisions',async()=>{
 const {loadInvoicePdf}=harness()('@/lib/invoices/pdf/data');
 const query={select(){return this},eq(){return this},is(){return this},order(){return this},range:async()=>({data:[],error:null}),maybeSingle:async()=>({data:null,error:{code:'42501'}})};
 await assert.rejects(()=>loadInvoicePdf({from:()=>query},'id'),e=>e.status===403);
 let reads=0;query.maybeSingle=async()=>({data:{...fixture().invoice,updated_at:String(reads++)},error:null});
 await assert.rejects(()=>loadInvoicePdf({from:()=>query},'id'),e=>e.status===409);
});
