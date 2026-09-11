import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {dashboardHarness} from './dashboard-harness.mjs';
const load=dashboardHarness();const model=load('@/lib/invoices/report');
const id='12345678-1234-4234-8234-123456789012';
const row={invoice_id:id,customer_id:id,invoice_number:1055,company_name_snapshot:'Historical market',issue_date:'2026-09-01',due_date:'2026-10-01',workflow_status:'ready',payment_status:'partially_paid',invoice_total:500,amount_paid:200,balance_due:300,overdue:true};
const result={resolved_as_of_date:'2026-09-10',page:1,page_size:25,total_rows:60,total_pages:3,invoice_count:60,total_invoiced:9000,amount_paid:6000,outstanding_balance:3000,rows:[row]};
test('report URL filters map to generated RPC args and canonical pagination preserves state',()=>{
 const params={q:' Market 58 ',workflow:'ready',payment:'partially_paid',customer:id,from:'2026-09-01',to:'2026-09-30',overdue:'1',sort:'highest_balance',page:'2'};
 const filters=model.reportFilters(params);assert.equal(filters.message,undefined);
 assert.deepEqual(filters.args,{p_search:'Market 58',p_workflow_status:'ready',p_payment_status:'partially_paid',p_customer_id:id,p_issue_date_from:'2026-09-01',p_issue_date_to:'2026-09-30',p_overdue_only:true,p_sort:'highest_balance',p_page:2,p_page_size:25});assert.ok(!('p_as_of_date' in filters.args));
 const url=new URL(model.reportUrl(filters.values,3),'http://local');assert.equal(url.searchParams.get('page'),'3');for(const key of ['workflow','payment','customer','from','to','overdue','sort'])assert.equal(url.searchParams.get(key),params[key]);assert.equal(url.searchParams.get('q'),'Market 58');
 assert.equal(model.reportFilters({status:'ready'}).args.p_workflow_status,'ready');assert.equal(model.reportFilters({workflow:'sent',status:'ready'}).args.p_workflow_status,'sent');
 assert.equal(model.reportFilters({q:' \t ',workflow:'all'}).args.p_search,undefined);
 const defaults=model.reportFilters({});assert.equal(defaults.values.from,'');assert.equal(defaults.values.to,'');assert.equal(defaults.args.p_issue_date_from,undefined);assert.equal(defaults.args.p_issue_date_to,undefined);
 for(const bad of [{from:'2026-02-30'},{from:'2026-10-01',to:'2026-09-01'},{workflow:'bad'},{payment:'bad'},{customer:'not-uuid'},{sort:'bad'},{page:'0'},{page:'2147483648'},{overdue:'true'},{q:['a','b']}])assert.ok(model.reportFilters(bad).message);
});
test('report JSON validation rejects malformed payloads without inventing payment/overdue state',()=>{
 const parsed=model.parseReport(result);assert.equal(parsed.rows[0].overdue,true);assert.equal(parsed.summary.total_invoiced,9000);assert.equal(parsed.rows[0].payment_status,'partially_paid');
 for(const bad of [{...result,rows:{}},{...result,rows:[{...row,balance_due:'300'}]},{...result,rows:[{...row,overdue:null}]},{...result,total_invoiced:NaN}])assert.throws(()=>model.parseReport(bad));
});
test('report renders full-set aggregates, canonical links, mobile cards and authoritative status labels',()=>{
 const view=load('@/components/invoices/report-view').InvoiceReportView;
 const data={filters:model.reportFilters({workflow:'ready',customer:id,q:'market'}),customers:[{id,company_name:'Renamed market',is_active:false}],report:model.parseReport(result)};
 const html=renderToStaticMarkup(view({data}));
 for(const text of ['$9,000.00','$6,000.00','$3,000.00','Historical market','Renamed market (Archived)','Overdue','Partially Paid','Invoice count','Total invoiced','Amount paid','Outstanding','New Invoice','Page 1 of 3'])assert.ok(html.includes(text),text);
 assert.match(html,/name="from"[^>]*value=""/);assert.match(html,/name="to"[^>]*value=""/);assert.match(html,/@min-\[680px\]:block/);assert.match(html,/About these totals/);
 assert.match(html,/method="get"/);assert.match(html,/name="workflow"/);assert.match(html,/aria-label="Invoice cards"/);assert.match(html,/table-fixed/);assert.match(html,/@min-\[680px\]:hidden/);assert.match(html,/href="\/invoices\/12345678/);assert.match(html,/page=2/);
 const empty=renderToStaticMarkup(view({data:{...data,report:model.parseReport({...result,total_rows:0,total_pages:0,invoice_count:0,rows:[]})}}));assert.match(empty,/No invoices match these filters/);assert.match(empty,/Clear filters/);
 const voidHtml=renderToStaticMarkup(view({data:{...data,filters:model.reportFilters({workflow:'void'}),report:model.parseReport({...result,outstanding_balance:0,rows:[{...row,workflow_status:'void',overdue:false}]})}}));assert.match(voidHtml,/Historical Void amounts/);assert.match(voidHtml,/\$0.00/);
 const error=renderToStaticMarkup(view({data:{...data,report:null,message:'Unable to load invoice report.'}}));assert.match(error,/Try again/);assert.match(error,/New Invoice/);assert.ok(!error.includes('Filtered invoice summary'));
});
test('authenticated report reader uses only RPC financial data and maps failures safely',async()=>{
 let error=null,calls=0,authenticated=0;
 const client={rpc:async(name,args)=>{calls++;assert.equal(name,'get_invoice_report');assert.equal(args.p_page_size,25);return {data:error?null:[result],error}},from:table=>{assert.equal(table,'customers');const q={select(){return q},order(){return q},range:async()=>({data:[{id,company_name:'Archived',is_active:false}],error:null})};return q;}};
 const server=dashboardHarness({'@/lib/customers/server':{customerClient:async()=>{authenticated++;return client}}})('@/lib/invoices/report-server');
 const valid=await server.getInvoiceReport({payment:'unpaid'});assert.equal(valid.report.summary.invoice_count,60);assert.equal(authenticated,1);
 const invalid=await server.getInvoiceReport({from:'2026-10-01',to:'2026-09-01'});assert.match(invalid.message,/From must be on or before To/);assert.equal(calls,1);
 error={code:'500',message:'secret SQL details'};const failed=await server.getInvoiceReport({});assert.equal(failed.message,'Unable to load invoice report.');assert.equal(failed.report,null);
});
