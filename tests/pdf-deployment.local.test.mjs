// Run after npm run build. Render using ONLY each route's traced deployment files,
// never the repository's complete node_modules (which can conceal missing assets).
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..');
const modules=['quotes/pdf','quotes/model','invoices/pdf/document','invoices/pdf/business','invoices/model','billing/model','customers/validation'];
for(const kind of ['quotes','invoices'])test(`${kind} PDF works with only production-traced dependencies`,async(t)=>{
 const directory=await mkdtemp(path.join(tmpdir(),'nexa-pdf-package-'));
 try{
  const manifest=path.join(root,`.next/server/app/(app)/${kind}/[id]/pdf/route.js.nft.json`);
  const {files}=JSON.parse(await readFile(manifest,'utf8'));
  for(const file of files){
   const source=path.resolve(path.dirname(manifest),file),relative=path.relative(root,source);
   assert.ok(!relative.startsWith('..'),'Deployment trace stays inside project');
   const target=path.join(directory,relative);await mkdir(path.dirname(target),{recursive:true});await copyFile(source,target);
  }
  for(const name of modules){
   const extension=name.endsWith('/document')||name==='quotes/pdf'?'.tsx':'.ts';
   const source=await readFile(path.join(root,'src/lib',name+extension),'utf8');
   const output=ts.transpileModule(source,{fileName:name+extension,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
   const target=path.join(directory,'src/lib',name+'.cjs');await mkdir(path.dirname(target),{recursive:true});await writeFile(target,'const React = require("react");\n'+output);
  }
  const script=`
   const fs=require('fs'),path=require('path'),vm=require('vm');
   const cache=new Map();
   function load(name,parent=__filename){
    if(!name.startsWith('@/')&&!name.startsWith('.'))return require(name);
    const file=(name.startsWith('@/')?path.join(__dirname,'src',name.slice(2)):path.resolve(path.dirname(parent),name))+'.cjs';
    if(cache.has(file))return cache.get(file).exports;
    const mod={exports:{}};cache.set(file,mod);
    vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\\n})',{filename:file})(n=>load(n,file),mod,mod.exports);return mod.exports;
   }
   (async()=>{
    const quote={quote_number:1001,company_name_snapshot:'Fixture',customer_snapshot:{email:null},quote_date:'2026-09-01',expiration_date:null,status:'draft',notes:null,terms:null,items:[{description:'Support',quantity:'1',unit:'hour',unit_rate:'120',amount:'120'}],subtotal:120,total:120};
    const invoice={invoice:{invoice_number:1001,company_name_snapshot:'Fixture',issue_date:'2026-09-01',due_date:'2026-10-01',status:'draft',notes:null,terms:null},items:[{id:'fixture',description:'Support',quantity:1,unit:'hour',unit_rate:120,amount:120}],totals:{subtotal:120,tax_amount:0,total:120}};
    const pdf=${kind==='quotes'?"await load('@/lib/quotes/pdf').renderQuotePdf(quote,'2026-09-11')":"await load('@/lib/invoices/pdf/document').renderInvoicePdf(invoice)"};
    if(pdf.subarray(0,4).toString()!=='%PDF')throw Error('Not a PDF');
    console.log('Rendered '+pdf.length+' bytes');
   })().catch(error=>{console.error(error.stack);process.exitCode=1;});
  `;
  await writeFile(path.join(directory,'render.cjs'),script);
  async function render(){
   const child=spawn(process.execPath,['render.cjs'],{cwd:directory,env:{...process.env,NODE_PATH:''},stdio:['ignore','pipe','pipe']});
   let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
   const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
   return {code,output};
  }
  const complete=await render();assert.equal(complete.code,0,complete.output);
  // Negative control recreates the original missing deployment assets. This
  // demonstrates why a full local node_modules test alone cannot catch the bug.
  await rm(path.join(directory,'node_modules/pdfkit/js/standard-fonts'),{recursive:true,force:true});
  const missing=await render();assert.notEqual(missing.code,0);
  assert.match(missing.output,/Cannot find module.*standard-fonts\/Helvetica\.cjs/);
  t.diagnostic('Removing traced fonts reproduces MODULE_NOT_FOUND for Helvetica.cjs.');
 }finally{await rm(directory,{recursive:true,force:true});}
});
