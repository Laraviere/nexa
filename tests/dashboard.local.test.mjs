import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {createServerClient} from '@supabase/ssr';
import {dashboardHarness} from './dashboard-harness.mjs';
const exec=promisify(execFile),root=new URL('../',import.meta.url);
test('dashboard: authenticated local reads, authoritative KPIs, operational lists and HTTP page',{timeout:180000},async(t)=>{
 const status=JSON.parse((await exec('npx',['supabase','status','-o','json'],{cwd:root})).stdout);
 assert.ok(['localhost','127.0.0.1'].includes(new URL(status.API_URL).hostname));
 const key=status.PUBLISHABLE_KEY??status.ANON_KEY;
 const cookies=new Map();const client=createServerClient(status.API_URL,key,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value})=>cookies.set(name,value))}});
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key,NEXT_TELEMETRY_DISABLED:'1'};
 const checked=result=>{assert.equal(result.error,null);return result.data;};
 let userId,server,stopped,timerId;const customerIds=[],invoiceIds=[],paymentIds=[],agreementIds=[],entryIds=[];
 const settings=()=>client.from('payment_settings').select('*').single();
 let originalSettings;
 try{
  const auth=checked(await client.auth.signUp({email:`nexa-dashboard-${randomBytes(8).toString('hex')}@example.test`,password:randomBytes(24).toString('base64url')}));userId=auth.user.id;
  const load=dashboardHarness({'@/lib/customers/server':{customerClient:async()=>client}});
  const {readDashboard}=load('@/lib/dashboard/server');const {dashboardDates}=load('@/lib/dashboard/model');
  const now=new Date(),dates=dashboardDates(now);const yesterday=new Date(`${dates.today}T12:00Z`);yesterday.setUTCDate(yesterday.getUTCDate()-1);const previousMonth=new Date(`${dates.monthStart}T12:00Z`);previousMonth.setUTCDate(0);
  const before=await readDashboard(client,now);assert.notEqual(before.outstanding,null);assert.notEqual(before.paymentsThisMonth,null);assert.notEqual(before.billableMinutes,null);
  originalSettings=checked(await settings());checked(await client.rpc('update_payment_settings',{p_cash_enabled:true,p_check_enabled:true,p_card_enabled:true}));
  async function customer(name){const c=checked(await client.from('customers').insert({company_name:`Dashboard ${name}`}).select().single());customerIds.push(c.id);return c.id;}
  const c=await customer('billing');
  async function invoice(amount,state,due){const row=checked(await client.rpc('create_manual_invoice',{p_customer_id:c,p_issue_date:previousMonth.toISOString().slice(0,10),p_request_id:randomUUID(),p_items:[{description:'Dashboard fixture',quantity:1,unit:'flat',unit_rate:amount}]}))[0];invoiceIds.push(row.invoice_id);checked(await client.from('invoices').update({due_date:due}).eq('id',row.invoice_id));if(state!=='draft')checked(await client.from('invoices').update({status:state}).eq('id',row.invoice_id));return row.invoice_id;}
  async function payment(id,amount,date=dates.today){const row=checked(await client.rpc('record_invoice_payment',{p_invoice_id:id,p_amount:amount,p_payment_date:date,p_payment_method:'cash',p_request_id:randomUUID()}))[0];paymentIds.push(row.payment_id);return row.payment_id;}
  const ready=await invoice(200,'ready',yesterday.toISOString().slice(0,10));await payment(ready,20);await payment(ready,5,dates.monthEnd);
  const sent=await invoice(150,'sent',dates.monthEnd);await payment(sent,30,previousMonth.toISOString().slice(0,10));
  await invoice(100,'draft',dates.monthEnd);
  const voidId=await invoice(900,'ready',dates.monthEnd);checked(await client.from('invoices').update({status:'void',void_reason:'Dashboard fixture'}).eq('id',voidId));
  const paid=await invoice(50,'ready',dates.monthEnd);await payment(paid,50);
  const voidPayment=await payment(ready,10);checked(await client.rpc('void_invoice_payment',{p_payment_id:voidPayment,p_reason:'Excluded dashboard fixture'}));
  const retainers=[];
  for(const [name,minutes] of [['overage',61],['low',31],['normal',1]]){
   const id=await customer(name);retainers.push(id);
   const agreement=checked(await client.from('customer_billing_agreements').insert({id:`00000000-${randomUUID().slice(9)}`,customer_id:id,monthly_fee:100,included_hours:1,overage_hourly_rate:100,effective_date:dates.monthStart,billing_cycle_day:1,rounding_increment_minutes:15}).select().single());agreementIds.push(agreement.id);
   const entry=checked(await client.from('time_entries').insert({customer_id:id,work_date:dates.today,description:`Dashboard ${name} work`,actual_minutes:minutes,is_billable:true}).select().single());entryIds.push(entry.id);
  }
  const nonbill=checked(await client.from('time_entries').insert({customer_id:c,work_date:dates.today,description:'Dashboard internal work',actual_minutes:20,is_billable:false}).select().single());entryIds.push(nonbill.id);
  const voidTime=checked(await client.from('time_entries').insert({customer_id:c,work_date:dates.today,description:'Dashboard void time',actual_minutes:20,is_billable:true,hourly_rate:100}).select().single());entryIds.push(voidTime.id);checked(await client.from('time_entries').update({voided_at:new Date().toISOString(),void_reason:'Dashboard excluded fixture'}).eq('id',voidTime.id));
  const after=await readDashboard(client,now);
  assert.equal(Math.round((after.outstanding-before.outstanding)*100),39500,'Only positive non-Void balances; includes Draft');
  assert.equal(after.readyCount-before.readyCount,2);
  assert.equal(Math.round((after.paymentsThisMonth-before.paymentsThisMonth)*100),7000,'Excludes voided, prior-month and next-month payments');
  assert.equal(after.billableMinutes-before.billableMinutes,135,'Uses stored rounded minutes 75+45+15, excludes nonbillable/void');
  assert.ok(!after.attention.some(i=>i.id===voidId||i.id===paid));
  assert.ok(after.payments.some(p=>p.invoice_id===ready&&p.amount===5));assert.ok(!after.payments.some(p=>p.id===voidPayment));
  assert.ok(after.retainers.some(r=>r.customerId===retainers[0]&&r.usage.overage_minutes===15));
  assert.ok(after.retainers.some(r=>r.customerId===retainers[1]&&r.usage.remaining_included_minutes===15));
  assert.ok(!after.retainers.some(r=>r.customerId===retainers[2]));
  assert.ok(after.time.some(e=>e.id===nonbill.id&&e.rounded_minutes===0));assert.ok(!after.time.some(e=>e.id===voidTime.id));
  // Use existing timer RPCs only; preserve any timer the developer already has.
  if(!before.timer){
   const timer=checked(await client.from('running_timers').insert({customer_id:c,description:'Dashboard running fixture',is_billable:false}).select().single());timerId=timer.id;
   const running=await readDashboard(client);assert.equal(running.timer.id,timerId);assert.equal(running.timer.stop_requested_at,null);
   checked(await client.rpc('cancel_time_timer',{p_timer_id:timerId}));timerId=null;
   const pendingTimer=checked(await client.from('running_timers').insert({customer_id:retainers[2],description:'Dashboard pending fixture',is_billable:true}).select().single());timerId=pendingTimer.id;
   checked(await client.from('customer_billing_agreements').update({is_active:false}).eq('id',agreementIds[2]));
   const stoppedResult=checked(await client.rpc('stop_time_timer',{p_timer_id:timerId}));assert.equal(stoppedResult.status,'pending_finalization');
   const pending=await readDashboard(client);assert.equal(pending.timer.stop_requested_at,stoppedResult.stop_requested_at);
   const {renderToStaticMarkup}=await import('react-dom/server');
   const markup=renderToStaticMarkup(load('@/components/dashboard/overview').DashboardOverview({data:pending}));assert.match(markup,/Stopped — pending finalization/);assert.match(markup,/Fixed elapsed duration/);
   const later=await readDashboard(client,new Date(Date.now()+60000));assert.equal(later.timer.stop_requested_at,pending.timer.stop_requested_at);
   checked(await client.from('customer_billing_agreements').update({is_active:true}).eq('id',agreementIds[2]));
   const completed=checked(await client.rpc('stop_time_timer',{p_timer_id:timerId}));assert.equal(completed.status,'completed');entryIds.push(...completed.entries.map(e=>e.id));timerId=null;
  }
  await exec('npm',['run','build'],{cwd:root,env,maxBuffer:1024*1024});
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const base=`http://127.0.0.1:${port}`;
  server=spawn('node',['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});server.stdout.resume();server.stderr.resume();stopped=new Promise(r=>server.once('close',r));
  for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).status===200)break;}catch{}await delay(100);}
  const anonymous=await fetch(base+'/dashboard',{redirect:'manual'});assert.ok([303,307].includes(anonymous.status));assert.ok(anonymous.headers.get('location').includes('/login'));
  const response=await fetch(base+'/dashboard',{headers:{Cookie:[...cookies].map(([n,v])=>`${n}=${encodeURIComponent(v)}`).join('; ')}});assert.equal(response.status,200);const html=await response.text();
  for(const label of ['Outstanding balance','Invoices needing attention','Recent payments','Retainer usage','Recent time','Dashboard overage','Dashboard low'])assert.ok(html.includes(label),label);
  assert.ok(!html.includes('Dashboard unavailable'));assert.ok(html.includes('href="/time/new"'));
  t.diagnostic('Authenticated RLS reads and HTTP redirects/page passed; exact KPI deltas, cent sums, stored rounding, month exclusions, active payments, retainer RPC attention and timer read passed.');
 }finally{
  if(server){server.kill('SIGTERM');await stopped;}
  if(timerId){const canceled=await client.rpc('cancel_time_timer',{p_timer_id:timerId});if(canceled.error){const recovered=await client.rpc('stop_time_timer',{p_timer_id:timerId,p_hourly_rate:100});if(recovered.data?.entries)entryIds.push(...recovered.data.entries.map(e=>e.id));}}
  for(const id of paymentIds)await client.rpc('void_invoice_payment',{p_payment_id:id,p_reason:'Dashboard fixture cleanup'});
  for(const id of invoiceIds)await client.from('invoices').update({status:'void',void_reason:'Dashboard fixture cleanup'}).eq('id',id).neq('status','void');
  for(const id of entryIds)await client.from('time_entries').update({voided_at:new Date().toISOString(),void_reason:'Dashboard fixture cleanup'}).eq('id',id).is('voided_at',null);
  for(const id of agreementIds)await client.from('customer_billing_agreements').update({is_active:false}).eq('id',id);
  for(const id of customerIds)await client.from('customers').update({is_active:false}).eq('id',id);
  if(originalSettings)await client.rpc('update_payment_settings',{p_cash_enabled:originalSettings.cash_enabled,p_check_enabled:originalSettings.check_enabled,p_card_enabled:originalSettings.card_enabled});
  if(userId){assert.match(userId,/^[0-9a-f-]{36}$/);await exec('docker',['exec','supabase_db_nexa','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',`delete from auth.users where id='${userId}';`]);}
 }
});
