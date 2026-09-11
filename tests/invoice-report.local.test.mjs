import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {createServerClient} from '@supabase/ssr';
import {dashboardHarness} from './dashboard-harness.mjs';
const exec=promisify(execFile),root=new URL('../',import.meta.url);
test('invoice reporting UI: authenticated filters, full aggregates, sorting, history and pagination',{timeout:180000},async(t)=>{
 const status=JSON.parse((await exec('npx',['supabase','status','-o','json'],{cwd:root})).stdout);assert.ok(['localhost','127.0.0.1'].includes(new URL(status.API_URL).hostname));
 const key=status.PUBLISHABLE_KEY??status.ANON_KEY;
 const cookies=new Map();const client=createServerClient(status.API_URL,key,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))}});
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_TELEMETRY_DISABLED:'1'};
 const checked=r=>{assert.equal(r.error,null);return r.data;};
 let userId,customer,server,stopped;const invoices=[],payments=[];
 try{
  const auth=checked(await client.auth.signUp({email:`nexa-report-ui-${randomBytes(8).toString('hex')}@example.test`,password:randomBytes(24).toString('base64url')}));userId=auth.user.id;
  const originalName=`Report history ${randomBytes(5).toString('hex')}`;
  customer=checked(await client.from('customers').insert({company_name:originalName}).select().single()).id;
  const settings=checked(await client.from('payment_settings').select('*').single());const method=['cash','check','card'].find(m=>settings[`${m}_enabled`]);
  for(let i=0;i<27;i++){
   const invoice=checked(await client.rpc('create_manual_invoice',{p_customer_id:customer,p_issue_date:`2026-01-${String(i+1).padStart(2,'0')}`,p_items:[{description:'History fixture',quantity:1,unit:'flat',unit_rate:100+i}],p_request_id:randomUUID()}))[0];invoices.push(invoice);
   if(i>=1&&i<=4){
    checked(await client.from('invoices').update({status:i===2?'sent':'ready'}).eq('id',invoice.invoice_id));
    if(i!==2){const paid=checked(await client.rpc('record_invoice_payment',{p_invoice_id:invoice.invoice_id,p_amount:i===4?104:10,p_payment_date:'2026-02-01',p_payment_method:method,p_request_id:randomUUID()}))[0];payments.push(paid.payment_id);}
    if(i===3)checked(await client.from('invoices').update({status:'void',void_reason:'Reporting historical fixture'}).eq('id',invoice.invoice_id));
   }
  }
  checked(await client.from('customers').update({company_name:'Renamed reporting customer',is_active:false}).eq('id',customer));
  await exec('npm',['run','build'],{cwd:root,env,maxBuffer:1024*1024});
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const base=`http://127.0.0.1:${port}`;
  server=spawn('node',['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});server.stdout.resume();server.stderr.resume();stopped=new Promise(r=>server.once('close',r));
  for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).status===200)break;}catch{}await delay(100);}
  const denied=await fetch(base+'/invoices',{redirect:'manual'});assert.ok([303,307].includes(denied.status));assert.ok(denied.headers.get('location').includes('/login'));
  const model=dashboardHarness()('@/lib/invoices/report');
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  async function page(params){const response=await fetch(`${base}/invoices?${new URLSearchParams(params)}`,{headers:{Cookie:[...cookies].map(([n,v])=>`${n}=${encodeURIComponent(v)}`).join('; ')},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);return response.text();}
  async function verify(params={}){
   const filters={customer,...params};const html=await page(filters);
   assert.ok(!html.includes('Unable to load invoice report.'));
   const expected=checked(await client.rpc('get_invoice_report',model.reportFilters(filters).args))[0];
   const summary=html.match(/<section aria-label="Filtered invoice summary"[\s\S]*?<\/section>/)?.[0];assert.ok(summary);
   for(const number of [expected.total_invoiced,expected.amount_paid,expected.outstanding_balance])assert.ok(summary.includes(money(number)),`Summary ${number}`);
   assert.ok(summary.includes(`>${expected.invoice_count}</p>`));
   if(expected.rows.length){const body=html.match(/<tbody[\s\S]*?<\/tbody>/)[0];const ids=[...body.matchAll(/href="\/invoices\/([0-9a-f-]+)"/g)].map(m=>m[1]);assert.deepEqual(ids.filter((_,i)=>i%2===0),expected.rows.map(r=>r.invoice_id));const rowMarkup=body.match(/<tr\b[\s\S]*?<\/tr>/g);rowMarkup.forEach((markup,i)=>assert.equal(markup.includes('Overdue'),expected.rows[i].overdue));}
   else assert.ok(html.includes('No invoices match these filters.'));
   return {html,expected};
  }
  const all=await verify();assert.equal(all.expected.total_rows,27);assert.equal(all.expected.rows.length,25);assert.equal(all.expected.total_pages,2);assert.ok(all.html.includes('Renamed reporting customer (Archived)'));assert.ok(all.html.includes(originalName));assert.ok(all.html.includes('New Invoice'));assert.match(all.html,/name="from"[^>]*value=""/);assert.match(all.html,/name="to"[^>]*value=""/);assert.ok(all.html.includes('@min-[680px]:block'));assert.ok(all.html.includes('aria-label="Invoice cards"'));assert.ok(all.html.includes('@min-[680px]:hidden'));
  await verify({q:String(invoices[1].invoice_number)});await verify({q:originalName});
  for(const workflow of ['draft','ready','sent','void'])await verify({workflow});
  for(const payment of ['unpaid','partially_paid','paid'])await verify({payment});
  await verify({from:'2026-01-03',to:'2026-01-12'});await verify({overdue:'1'});
  for(const sort of ['newest','oldest','highest_balance'])await verify({sort});
  const combined={q:originalName,from:'2026-01-01',to:'2026-01-27',sort:'oldest'};
  const first=await verify(combined);const second=await verify({...combined,page:'2'});assert.equal(second.expected.rows.length,2);assert.equal(first.expected.total_invoiced,second.expected.total_invoiced);
  const next=model.reportUrl(model.reportFilters({customer,...combined}).values,2).replaceAll('&','&amp;');assert.ok(first.html.includes(`href="${next}"`));
  const voidOnly=await verify({workflow:'void'});assert.equal(voidOnly.expected.outstanding_balance,0);assert.match(voidOnly.html,/Historical Void amounts/);
  const invalid=await page({customer,from:'2026-02-01',to:'2026-01-01'});assert.match(invalid,/Issue date From must be on or before To/);assert.ok(!invalid.includes('Filtered invoice summary'));assert.match(invalid,/New Invoice/);
  await verify({q:'no-match-unique-report'});await verify({status:'ready'});
  const detail=await fetch(`${base}/invoices/${invoices[0].invoice_id}`,{headers:{Cookie:[...cookies].map(([n,v])=>`${n}=${encodeURIComponent(v)}`).join('; ')}});assert.equal(detail.status,200);assert.match(await detail.text(),/Edit Invoice/);
  t.diagnostic('All filter/sort cases, RPC full-set totals across 27 invoices, Void semantics, archived snapshot labels, canonical pagination, auth, empty/validation states and invoice links passed.');
 }finally{
  if(server){server.kill('SIGTERM');await stopped;}
  for(const id of payments)await client.rpc('void_invoice_payment',{p_payment_id:id,p_reason:'Reporting UI fixture cleanup'});
  for(const v of invoices)await client.from('invoices').update({status:'void',void_reason:'Reporting UI fixture cleanup'}).eq('id',v.invoice_id).neq('status','void');
  if(customer)await client.from('customers').update({is_active:false}).eq('id',customer);
  if(userId){assert.match(userId,/^[0-9a-f-]{36}$/);await exec('docker',['exec','supabase_db_nexa','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',`delete from auth.users where id='${userId}';`]);}
 }
});
