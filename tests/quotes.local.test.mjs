import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import test from 'node:test';
import {createServerClient} from '@supabase/ssr';
import {inspectPdf} from './helpers/pdf.mjs';
const exec=promisify(execFile),root=new URL('../',import.meta.url);
const {encodeReply}=createRequire(import.meta.url)('next/dist/compiled/react-server-dom-webpack/client.node');
test('Quotes: authenticated routes/actions, conversion, PDFs and backdated invoice UI',{timeout:180000},async(t)=>{
 const status=JSON.parse((await exec('npx',['supabase','status','-o','json'],{cwd:root})).stdout);
 const api=new URL(status.API_URL);assert.ok(['127.0.0.1','localhost'].includes(api.hostname));
 const key=status.PUBLISHABLE_KEY??status.ANON_KEY;
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:api.href.replace(/\/$/,''),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_TELEMETRY_DISABLED:'1'};
 await exec('npm',['run','build'],{cwd:root,env,maxBuffer:1024*1024});t.diagnostic('Production build with local Supabase passed.');
 const manifest=JSON.parse(await readFile(new URL('.next/server/server-reference-manifest.json',root),'utf8'));
 const actionId=name=>Object.entries(manifest.node).find(([,v])=>v.exportedName===name)?.[0];
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const base=`http://127.0.0.1:${port}`;
 const server=spawn('node',['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});server.stdout.resume();server.stderr.resume();
 const stopped=new Promise(r=>server.once('close',r));
 const cookies=new Map();const client=createServerClient(api.href,key,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))}});
 let customer,userId,invoiceId,quoteId,originalPayee;
 async function request(route,init={},auth=true){return fetch(base+route,{...init,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Origin:base,...(auth?{Cookie:[...cookies].map(([n,v])=>`${n}=${encodeURIComponent(v)}`).join('; ')}:{}),...init.headers}});}
 async function page(route){const r=await request(route);assert.equal(r.status,200);return r.text();}
 async function action(name,route,fields,auth=true){const form=new FormData();Object.entries(fields).forEach(([k,v])=>form.set(k,String(v)));return request(route,{method:'POST',headers:{'Next-Action':actionId(name),Accept:'text/x-component'},body:await encodeReply([{},form])},auth);}
 try {
  for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const signup=await client.auth.signUp({email:`nexa-quote-${randomBytes(8).toString('hex')}@example.test`,password:randomBytes(24).toString('base64url')});assert.equal(signup.error,null);userId=signup.data.user.id;
  const settings=await client.from('payment_settings').select('checks_payable_to').eq('singleton',true).single();assert.equal(settings.error,null);originalPayee=settings.data.checks_payable_to;
  const c=await client.from('customers').insert({company_name:`Quote integration ${randomBytes(4).toString('hex')}`,default_payment_terms_days:30}).select().single();assert.equal(c.error,null);customer=c.data.id;
  const denied=await request('/quotes/new',{},false);assert.ok(denied.headers.get('location')?.includes('/login')||(await denied.text()).includes('NEXT_REDIRECT;replace;/login;'));
  const form=await page('/quotes/new');assert.match(form,/Quote date/);assert.match(form,/Expiration date/);assert.match(form,/optional/);
  const payload={customer_id:customer,issue_date:'2026-09-01',expiration_date:'',notes:'Integration notes',terms:'Integration terms',items:[{description:'Quote integration work',quantity:'1.5',unit:'hour',unit_rate:'120'}]};
  const fields={payload:JSON.stringify(payload),request_id:randomUUID()};
  const unauth=await action('saveQuote','/quotes/new',fields,false);assert.ok(unauth.headers.get('x-action-redirect')?.includes('/login'));
  const created=await action('saveQuote','/quotes/new',fields);const createdText=await created.text();
  const q=await client.from('quotes').select('*').eq('customer_id',customer).single();assert.equal(q.error,null,createdText);quoteId=q.data.id;assert.ok(createdText.includes(quoteId));
  assert.ok((await (await action('saveQuote','/quotes/new',fields)).text()).includes(quoteId));
  const route=`/quotes/${quoteId}`;
  assert.match(await page('/quotes?q='+encodeURIComponent(c.data.company_name)),new RegExp(quoteId));
  assert.match(await page(route),/Edit Quote/);assert.match(await page(route+'/edit'),/Save Changes/);
  payload.items[0].unit_rate='130';payload.quote_id=quoteId;payload.revision=1;
  assert.ok((await (await action('saveQuote',route+'/edit',{payload:JSON.stringify(payload),request_id:randomUUID()})).text()).includes(quoteId));
  assert.match(await page(route),/195\.00/);
  const changed=await action('updateQuoteStatus',route,{quote_id:quoteId,revision:2,status:'accepted'});assert.match(await changed.text(),/Quote status updated/);
  const accepted=await page(route);assert.match(accepted,/Convert to Invoice/);assert.ok(!accepted.includes('>Edit Quote<'));
  assert.equal((await client.from('invoices').select('id').eq('customer_id',customer)).data.length,0);
  const converted=await action('convertQuote',route,{quote_id:quoteId,revision:3,issue_date:'2026-09-01',confirmed:'yes'});const text=await converted.text();
  const linked=await client.from('quotes').select('*').eq('id',quoteId).single();invoiceId=linked.data.converted_invoice_id;assert.ok(invoiceId,text);
  const invoice=await client.from('invoices').select('*').eq('id',invoiceId).single();assert.equal(invoice.data.issue_date,'2026-09-01');assert.equal(invoice.data.due_date,'2026-10-01');assert.equal(invoice.data.status,'draft');
  const detail=await page(`/invoices/${invoiceId}`);assert.ok(detail.includes(`href="/quotes/${quoteId}"`));assert.match(detail,/September 1, 2026/);assert.match(detail,/October 1, 2026/);assert.match(detail,/Edit Invoice/);
  assert.ok((await page(route)).includes(`href="/invoices/${invoiceId}"`));assert.match(await page(`/invoices/${invoiceId}/edit`),/Invoice date/);
  const settingsPage=await page('/settings/payments');assert.match(settingsPage,/Checks payable to/);
  const savePayee=async value=>{const r=await action('saveChecksPayableTo','/settings/payments',{checks_payable_to:value});assert.match(await r.text(),/Check instructions saved/);};
  await savePayee('');
  const blankPdf=await request(`/invoices/${invoiceId}/pdf`);assert.equal(blankPdf.status,200);assert.doesNotMatch((await inspectPdf(Buffer.from(await blankPdf.arrayBuffer()))).text,/Checks payable to/);
  await savePayee('Example Remittance LLC');
  assert.match(await page('/settings/payments'),/value="Example Remittance LLC"/);
  assert.equal((await client.from('payment_settings').select('checks_payable_to').eq('singleton',true).single()).data.checks_payable_to,'Example Remittance LLC');
  assert.deepEqual((await client.from('invoices').select('*').eq('id',invoiceId).single()).data,invoice.data,'Updating instructions does not modify existing invoice');
  const quotePdf=await request(route+'/pdf');assert.equal(quotePdf.status,200);const quoteText=(await inspectPdf(Buffer.from(await quotePdf.arrayBuffer()))).text;assert.match(quoteText,/QUOTE/);assert.doesNotMatch(quoteText,/INVOICE|DUE DATE|Checks payable to|Example Remittance/);
  const invoicePdf=await request(`/invoices/${invoiceId}/pdf`);assert.equal(invoicePdf.status,200);const invoiceText=(await inspectPdf(Buffer.from(await invoicePdf.arrayBuffer()))).text;assert.match(invoiceText,/September 1, 2026/);assert.match(invoiceText,/Checks payable to: Example Remittance LLC/);
  const hidden=await request(route+'/pdf',{},false);assert.ok(hidden.status===401||hidden.headers.get('location')?.includes('/login'));
  t.diagnostic('Real session: save/retry, edit, accept, convert, both links, PDF access, historical invoice date and Net 30 due date passed.');
 } finally {
  if(originalPayee!==undefined){const restored=await client.rpc('update_checks_payable_to',{p_checks_payable_to:originalPayee??''});assert.equal(restored.error,null);}
  server.kill('SIGTERM');await stopped;
  // Remove only UUID-addressed fixtures created by this test. No user data reset.
  if(customer){assert.match(customer,/^[0-9a-f-]{36}$/);await exec('docker',['exec','supabase_db_nexa','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',`begin;set local session_replication_role=replica;
    delete from public.quote_write_requests where quote_id in(select id from public.quotes where customer_id='${customer}');
    delete from public.quotes where customer_id='${customer}';
    delete from public.invoice_items where invoice_id in(select id from public.invoices where customer_id='${customer}');
    delete from public.invoices where customer_id='${customer}';
    delete from public.customers where id='${customer}';commit;`]);}
  if(userId){assert.match(userId,/^[0-9a-f-]{36}$/);await exec('docker',['exec','supabase_db_nexa','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',`delete from auth.users where id='${userId}';`]);}
 }
});
