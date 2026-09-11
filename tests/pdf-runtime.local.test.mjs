import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {promisify} from 'node:util';
import test from 'node:test';
import {createServerClient} from '@supabase/ssr';
import {inspectPdf} from './helpers/pdf.mjs';
const exec=promisify(execFile),root=new URL('../',import.meta.url);
const mode=process.env.PDF_TEST_MODE??'dev';
test(`PDF runtime (${mode}): quotes before conversion, converted/manual invoices and optional fields`,{timeout:240000},async(t)=>{
 const status=JSON.parse((await exec('npx',['supabase','status','-o','json'],{cwd:root})).stdout);
 const api=new URL(status.API_URL);assert.ok(['127.0.0.1','localhost'].includes(api.hostname));
 const key=status.PUBLISHABLE_KEY??status.ANON_KEY;
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:api.href.replace(/\/$/,''),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_TELEMETRY_DISABLED:'1'};
 if(mode==='production')await exec('npm',['run','build'],{cwd:root,env,maxBuffer:1024*1024});
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const base=`http://127.0.0.1:${port}`;
 const server=spawn('node',['node_modules/next/dist/bin/next',mode==='production'?'start':'dev','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let logs='';server.stdout.on('data',chunk=>{logs+=chunk;});server.stderr.on('data',chunk=>{logs+=chunk;});
 const stopped=new Promise(r=>server.once('close',r));
 const cookies=new Map();const client=createServerClient(api.href,key,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))}});
 let customer,userId;const failures=[];
 async function rpc(name,args){const r=await client.rpc(name,args);assert.equal(r.error,null);return r.data;}
 async function pdf(route,label,expected={}){
  const response=await fetch(base+route,{signal:AbortSignal.timeout(60000),headers:{Cookie:[...cookies].map(([n,v])=>`${n}=${encodeURIComponent(v)}`).join('; ')}});
  t.diagnostic(`${label}: HTTP ${response.status}`);
  if(response.status!==200){failures.push(`${label}: ${response.status} ${await response.text()}`);return;}
  assert.match(response.headers.get('content-type'),/application\/pdf/);
  const result=await inspectPdf(Buffer.from(await response.arrayBuffer()));
  if(expected.text)assert.match(result.text,expected.text);
  if(expected.multiple)assert.ok(result.pages.length>1,'Long document paginates');
 }
 try {
  for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const signup=await client.auth.signUp({email:`nexa-pdf-runtime-${randomBytes(8).toString('hex')}@example.test`,password:randomBytes(24).toString('base64url')});assert.equal(signup.error,null);userId=signup.data.user.id;
  const c=await client.from('customers').insert({company_name:'PDF runtime fixture',default_payment_terms_days:30}).select().single();assert.equal(c.error,null);customer=c.data.id;
  const lines=[{description:'Consulting',quantity:'1.5',unit:'hour',unit_rate:'120'},{description:'Setup',quantity:'2',unit:'each',unit_rate:'10'}];
  const q=await rpc('save_quote',{p_customer_id:customer,p_quote_date:'2026-09-01',p_items:lines,p_request_id:randomUUID()});
  const coldManual=(await rpc('create_manual_invoice',{p_customer_id:customer,p_issue_date:'2026-09-01',p_items:lines,p_request_id:randomUUID()}))[0];
  await Promise.all([pdf(`/quotes/${q}/pdf`,'Draft quote, null notes/terms/expiration/contact',{text:/QUOTE/}),pdf(`/invoices/${coldManual.invoice_id}/pdf`,'Concurrent cold manual invoice',{text:/Invoice #/})]);
  await rpc('change_quote_status',{p_quote_id:q,p_status:'sent',p_revision:1});
  await pdf(`/quotes/${q}/pdf`,'Sent quote',{text:/Sent/});
  await rpc('change_quote_status',{p_quote_id:q,p_status:'accepted',p_revision:2});
  await pdf(`/quotes/${q}/pdf`,'Accepted quote before conversion',{text:/Accepted/});
  const converted=await rpc('convert_quote_to_invoice',{p_quote_id:q,p_issue_date:'2026-09-01',p_revision:3});
  await pdf(`/invoices/${converted}/pdf`,'Converted backdated invoice',{text:/September 1, 2026/});
  const manual=(await rpc('create_manual_invoice',{p_customer_id:customer,p_issue_date:'2026-09-01',p_items:lines,p_request_id:randomUUID()}))[0];
  await pdf(`/invoices/${manual.invoice_id}/pdf`,'Manual backdated invoice, same data',{text:/September 1, 2026/});
  const longLines=Array.from({length:65},(_,i)=>({...lines[0],description:`Line ${i}: `+'Extended support description '.repeat(8)}));
  const long=await rpc('save_quote',{p_customer_id:customer,p_quote_date:'2026-09-01',p_expiration_date:'2099-12-31',p_notes:'Quote notes',p_terms:'Project terms',p_items:longLines,p_request_id:randomUUID()});
  await pdf(`/quotes/${long}/pdf`,'Long quote with expiration, notes and terms',{text:/Quote notes/,multiple:true});
  await rpc('change_quote_status',{p_quote_id:long,p_status:'accepted',p_revision:1});
  const longInvoice=await rpc('convert_quote_to_invoice',{p_quote_id:long,p_issue_date:'2026-09-01',p_revision:2});
  await pdf(`/invoices/${longInvoice}/pdf`,'Long converted invoice with notes and terms',{text:/Quote notes/,multiple:true});
  await Promise.all(Array.from({length:4},(_,i)=>pdf(i%2?`/quotes/${long}/pdf`:`/invoices/${longInvoice}/pdf`,`Concurrent long PDF ${i}`,{multiple:true})));
  const read=async id=>{const r=await client.from('invoices').select('*').eq('id',id).single();assert.equal(r.error,null);return r.data;};
  const convertedData=await read(converted),manualData=await read(manual.invoice_id);
  for(const field of ['customer_id','company_name_snapshot','issue_date','due_date','notes','terms','status','email_snapshot','billing_address_line1_snapshot'])assert.equal(convertedData[field],manualData[field],`Converted/manual ${field}`);
  t.diagnostic('Converted/manual customer snapshots, optional values, dates and status match.');
  if(failures.length){t.diagnostic(logs);assert.fail(failures.join('\n'));}
 }finally{
  server.kill('SIGTERM');await stopped;
  // Only synthetic, UUID-addressed fixtures owned by this test are removed.
  if(customer){assert.match(customer,/^[0-9a-f-]{36}$/);await exec('docker',['exec','supabase_db_nexa','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',`begin;set local session_replication_role=replica;
   delete from public.quote_write_requests where quote_id in(select id from public.quotes where customer_id='${customer}');
   delete from public.quotes where customer_id='${customer}';
   delete from public.invoice_items where invoice_id in(select id from public.invoices where customer_id='${customer}');
   delete from public.invoices where customer_id='${customer}';delete from public.customers where id='${customer}';commit;`]);}
  if(userId){assert.match(userId,/^[0-9a-f-]{36}$/);await exec('docker',['exec','supabase_db_nexa','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',`delete from auth.users where id='${userId}';`]);}
 }
});
