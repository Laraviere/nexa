import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {dashboardHarness} from './dashboard-harness.mjs';

const id='12345678-1234-4234-8234-123456789012';
const base={customer_id:id,billing_agreement_id:id,period_start:'2026-09-08',period_end:'2026-10-01',included_minutes_available:60,rounded_minutes_used:285,included_minutes_used:60,remaining_included_minutes:0,overage_minutes:225,overage_amount:281.25,allocations:[{time_entry_id:id,work_date:'2026-09-30',rounded_minutes:285,included_minutes:60,overage_minutes:225}]};
function harness({summary=base,agreement={id},error=null,today='2026-09-30'}={}) {
 const calls=[];
 const query={};
 for(const method of ['select','eq','lte','or'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
 query.maybeSingle=async()=>({data:agreement,error});
 const client={from:table=>{calls.push(['from',table]);return query;},rpc:async(name,args)=>{calls.push([name,args]);return {data:[summary],error};}};
 const real=dashboardHarness()('@/lib/billing/model');
 const load=dashboardHarness({'@/lib/customers/server':{customerClient:async()=>client},'@/lib/billing/model':{...real,businessDate:()=>today}});
 return {load,calls,read:load('@/actions/invoice-retainer-context').loadInvoiceRetainerContext};
}
function html(context) {
 const load=dashboardHarness({'@/actions/invoice-retainer-context':{}});
 return renderToStaticMarkup(React.createElement(load('@/components/invoices/current-retainer-context').RetainerContextSummary,{context}));
}
test('Market 58 usage context shows authoritative minutes; only suggestions show invoiceable dollars',async()=>{
 const h=harness(),context=await h.read(id,'2026-09-30'),markup=html(context);
 assert.equal(context.status,'ready');
 for(const value of ['1 hr','4 hr 45 min','3 hr 45 min','September 8, 2026','September 30, 2026','Billing available shows eligible, unclaimed charges.'])assert.ok(markup.includes(value),value);
 assert.doesNotMatch(markup,/<input|<button|checkbox|candidate_id|Add to Invoice|period close|Available to invoice|Estimated overage|281\.25/);
 assert.deepEqual(Object.keys(context.summary).sort(),['period_start','period_end','included_minutes_available','rounded_minutes_used','remaining_included_minutes','overage_minutes','overage_amount'].sort());
 assert.ok(h.calls.some(c=>c[0]==='eq'&&c[1]==='is_active'&&c[2]===true));
});
test('below and exactly at allowance are covered, never invoice charges',()=>{
 for(const [used,remaining] of [[45,15],[60,0]]) {
  const markup=html({status:'ready',summary:{...base,rounded_minutes_used:used,remaining_included_minutes:remaining,overage_minutes:0,overage_amount:0}});
  assert.match(markup,/Covered by retainer/);assert.match(markup,/remaining/);
  assert.doesNotMatch(markup,/Estimated overage|Available to invoice|pending period close/);
  assert.ok(markup.includes(remaining?'15 min':'Included allowance exhausted'));
 }
});
test('as-of date excludes future work without recalculating; future and malformed dates rejected',async()=>{
 const h=harness();assert.deepEqual(await h.read(id,'2026-09-29'),{status:'error'});
 assert.deepEqual(await h.read(id,'2026-10-01'),{status:'error'});
 assert.deepEqual(await h.read(id,'invalid'),{status:'error'});
 const valid=harness({summary:{...base,allocations:[{...base.allocations[0],work_date:'2026-09-28'}]}});
 assert.equal((await valid.read(id,'2026-09-29')).status,'ready');
});
test('completed overage is not duplicated in current-period context; non-retainer has no context or usage call',async()=>{
 assert.deepEqual(await harness({today:'2026-10-01'}).read(id,'2026-09-30'),{status:'none'});
 const h=harness({agreement:null});assert.deepEqual(await h.read(id,'2026-09-30'),{status:'none'});
 assert.ok(!h.calls.some(c=>c[0]==='get_retainer_period_usage'));assert.equal(html({status:'none'}),'');
});
test('read errors and invalid allocations have a safe independent fallback',async()=>{
 assert.deepEqual(await harness({error:{message:'private'}}).read(id,'2026-09-30'),{status:'error'});
 assert.deepEqual(await harness({summary:{...base,allocations:null}}).read(id,'2026-09-30'),{status:'error'});
 assert.match(html({status:'error'}),/Current retainer usage is unavailable\./);
});
test('context cannot leak into atomic composer submission; actual completed/hourly candidates remain selectable',async()=>{
 const calls=[];
 const load=dashboardHarness({'next/cache':{revalidatePath(){}},'@/lib/customers/server':{customerClient:async()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data:[{invoice_id:id}],error:null};}})}});
 const model=load('@/lib/invoices/composer');
 for(const source_type of ['retainer_overage','hourly_time']) {
  const candidate={candidate_id:'b'.repeat(64),source_type,description:'Completed charge',quantity:1,unit:'hour',unit_rate:75,amount:75};
  assert.equal(model.readCharges([candidate])[0].source_type,source_type);
  const payload={customer_id:id,issue_date:'2026-09-30',as_of_date:'2026-09-30',revision:'a'.repeat(64),selected_candidate_ids:[candidate.candidate_id],items:[],notes:'',terms:'',retainerContext:{status:'ready',summary:base}};
  const form=new FormData();form.set('payload',JSON.stringify(payload));form.set('request_id',id);
  await load('@/actions/invoice-composer').saveComposedInvoice({},form);
 }
 for(const [name,args] of calls){assert.equal(name,'create_composed_invoice');assert.deepEqual(args.p_selected_candidate_ids,['b'.repeat(64)]);assert.equal(args.retainerContext,undefined);assert.doesNotMatch(JSON.stringify(args),/281\.25|overage_minutes|allocations/);}
});
test('context changes hide old totals immediately and ignore late responses; refresh and read failure stay isolated',async()=>{
 const slots=[],effects=[],cleanups=[],pending=[];let cursor=0;
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>slots[i]=v];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((v,j)=>v!==slots[i][j])){slots[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}};
 const load=dashboardHarness({react,'@/actions/invoice-retainer-context':{loadInvoiceRetainerContext:(customer,date)=>new Promise((resolve,reject)=>pending.push({customer,date,resolve,reject}))}});
 const Component=load('@/components/invoices/current-retainer-context').CurrentRetainerContext;
 const render=props=>{cursor=0;const tree=Component(props);while(effects.length)effects.shift()();return tree;};
 const props={customerId:id,asOf:'2026-09-30',refreshVersion:0};
 assert.equal(render(props),null);
 const older={...props,asOf:'2026-09-29'};assert.equal(render(older),null);
 pending[0].resolve({status:'ready',summary:base});await Promise.resolve();assert.equal(render(older),null);
 pending[1].resolve({status:'error'});await Promise.resolve();assert.equal(render(older).props.context.status,'error');
 const refreshed={...older,refreshVersion:1};assert.equal(render(refreshed),null);pending[2].reject(Error('private'));await Promise.resolve();await Promise.resolve();assert.equal(render(refreshed).props.context.status,'error');
 assert.equal(render({...refreshed,customerId:''}),null);
});
