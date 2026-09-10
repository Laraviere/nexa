import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {dashboardHarness} from './dashboard-harness.mjs';
const load=dashboardHarness();const model=load('@/lib/dashboard/model');
const usage={included_minutes_available:60,remaining_included_minutes:15,overage_minutes:0};
const empty={dates:model.dashboardDates(new Date('2026-09-10T12:00Z')),observedAt:Date.parse('2026-09-10T12:00Z'),outstanding:0,paymentsThisMonth:0,billableMinutes:0,readyCount:0,timer:null,attention:[],attentionComplete:true,payments:[],time:[],retainers:[],retainerErrors:[],retainersComplete:true};
test('dashboard uses New York business dates, calendar months and exact cent aggregation',()=>{
 assert.deepEqual(model.dashboardDates(new Date('2027-01-01T04:59:59Z')),{today:'2026-12-31',monthStart:'2026-12-01',monthEnd:'2027-01-01'});
 assert.equal(model.dashboardDates(new Date('2027-01-01T05:00Z')).monthStart,'2027-01-01');
 assert.equal(model.dashboardDates(new Date('2026-03-09T03:59Z')).today,'2026-03-08');
 assert.equal(model.sumMoney([0.1,0.2,12.34]),12.64);assert.equal(model.sumMoney([]),0);
});
test('invoice attention orders overdue, Ready, Sent, partial and Draft; excludes Void and settled non-Draft',()=>{
 const invoice=(id,status,balance_due,due_date=null,payment_status='unpaid')=>({id,status,balance_due,due_date,payment_status,invoice_number:1});
 const rows=[invoice('draft','draft',10),invoice('partial','draft',5,null,'partially_paid'),invoice('sent','sent',10),invoice('ready','ready',10),invoice('overdue','sent',10,'2026-09-09'),invoice('void','void',10,'2026-01-01'),invoice('paid','ready',0)];
 assert.deepEqual(model.prioritizeInvoices(rows,'2026-09-10').map(i=>i.id),['overdue','ready','sent','partial','draft']);
 assert.equal(model.invoicePriority(invoice('today','ready',1,'2026-09-10'),'2026-09-10'),1);
});
test('retainer threshold uses authoritative RPC minutes and avoids zero-allowance noise',()=>{
 assert.equal(model.retainerNeedsAttention(usage),true);
 assert.equal(model.retainerNeedsAttention({...usage,remaining_included_minutes:16}),false);
 assert.equal(model.retainerNeedsAttention({...usage,included_minutes_available:0,remaining_included_minutes:0}),false);
 assert.equal(model.retainerNeedsAttention({...usage,included_minutes_available:0,overage_minutes:15}),true);
});
test('dashboard empty states, bounded-read warnings and quick actions render without decorative filler',()=>{
 const view=load('@/components/dashboard/overview').DashboardOverview;
 const html=renderToStaticMarkup(view({data:empty}));
 for(const text of ['No outstanding invoices.','No recent payments.','No retainers need attention.','No recent time entries.','New Invoice','Add Time Entry','Start Timer','New Customer'])assert.ok(html.includes(text),text);
 for(const href of ['/invoices/new','/time/new','/time','/customers/new','/invoices?status=ready'])assert.ok(html.includes(`href="${href}"`));
 assert.ok(!html.includes('Current timer'));assert.match(html,/lg:grid-cols-4/);assert.match(html,/lg:grid-cols-2/);assert.match(html,/flex-wrap/);assert.match(html,/min-w-0/);
 const capped=renderToStaticMarkup(view({data:{...empty,outstanding:null,attentionComplete:false,retainersComplete:false}}));
 assert.match(capped,/Unavailable/);assert.match(capped,/scan limit reached/);assert.match(capped,/first 25/);assert.ok(!capped.includes('No retainers need attention'));
});
test('running and pending timers display live versus fixed elapsed time without mutation controls',()=>{
 const view=load('@/components/dashboard/overview').DashboardOverview;
 const timer={id:'timer',description:'Work',customers:{company_name:'Example'},started_at:'2026-09-10T11:00Z',stop_requested_at:null};
 const running=renderToStaticMarkup(view({data:{...empty,timer}}));assert.match(running,/Running/);assert.match(running,/01:00:00/);assert.match(running,/View Timer/);assert.ok(!running.includes('Start Timer'));
 const pending=renderToStaticMarkup(view({data:{...empty,timer:{...timer,stop_requested_at:'2026-09-10T11:12Z'}}}));
 assert.match(pending,/Stopped — pending finalization/);assert.match(pending,/00:12:00/);assert.match(pending,/Retry \/ fix in Time/);assert.ok(!pending.includes('<form'));
});

test('bounded reads never publish partial financial totals and core read failures are explicit',async()=>{
 const balances=Array.from({length:2001},(_,n)=>({invoice_id:`invoice-${String(n).padStart(4,'0')}`,invoice_status:'ready',balance_due:1,payment_status:'unpaid'}));
 let failed=false,requests=0;
 const client={from(table){let start=0,end=199;const q={
   select(){return q},neq(){return q},gt(){return q},order(){return q},eq(){return q},is(){return q},gte(){return q},lt(){return q},lte(){return q},or(){return q},limit(){return q},maybeSingle(){return q},
   range(a,b){start=a;end=b;return q},in(){return q},
   then(resolve,reject){requests++;const data=table==='invoice_payment_summary'?balances.slice(start,end+1):table==='running_timers'?null:[];return Promise.resolve({data,error:failed&&table==='invoices'?{code:'error'}:null,count:0}).then(resolve,reject)}
  };return q;},rpc(){throw Error('No retainers should be requested')}};
 const {readDashboard}=dashboardHarness({'@/lib/customers/server':{customerClient:async()=>client}})('@/lib/dashboard/server');
 const result=await readDashboard(client,new Date('2026-09-10T12:00Z'));
 assert.equal(result.outstanding,null);assert.equal(result.attentionComplete,false);assert.equal(result.paymentsThisMonth,0);assert.ok(requests<40,'Read count is bounded');
 failed=true;await assert.rejects(()=>readDashboard(client),/Unable to load dashboard data/);
});

test('polished dashboard preserves row values, workflow meaning and concise date context',()=>{
 const view=load('@/components/dashboard/overview').DashboardOverview;
 const html=renderToStaticMarkup(view({data:{...empty,outstanding:25,readyCount:1,paymentsThisMonth:200,billableMinutes:120,
  attention:[{id:'invoice',invoice_number:1055,company_name_snapshot:'Market 58',status:'ready',payment_status:'unpaid',balance_due:25,due_date:'2026-09-09'}],
  payments:[{id:'payment',invoice_id:'invoice',amount:200,payment_date:'2026-09-10',payment_method:'cash',invoices:{invoice_number:1055,company_name_snapshot:'Market 58'}}],
  retainers:[{customerId:'customer',customer:'Market 58',usage:{rounded_minutes_used:90,included_minutes_available:60,remaining_included_minutes:0,overage_minutes:30}}],
  time:[{id:'time',customer_id:'customer',work_date:'2026-09-10',description:'Installed switch',actual_minutes:120,rounded_minutes:120,is_billable:true,customers:{company_name:'Market 58'}}]
 }}));
 for(const text of ['Open non-void invoices','Ready for payment activity','Sep 2026 · Payments','Sep 2026 · Rounded time','Invoice #1055','$25.00','$200.00','Overdue','Ready','Unpaid','Due Sep 9, 2026','Sep 10, 2026','Cash','1 hr 30 min','used of','30 min','overage','Installed switch','2 hr','actual','billable'])assert.ok(html.includes(text),text);
 assert.match(html,/focus-visible:outline/);assert.match(html,/text-right/);
});
