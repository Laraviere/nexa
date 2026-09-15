import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dashboardHarness } from './dashboard-harness.mjs';

function listHarness(rows,count=26) {
 const calls=[];
 const query={};
 for(const method of ['select','eq','or','ilike','order'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
 query.range=async(...args)=>{calls.push(['range',...args]);return {data:rows,count,error:null};};
 const load=dashboardHarness({'@/lib/customers/server':{customerClient:async()=>({from:table=>{calls.push(['from',table]);return query;}})}});
 return {load,calls};
}
test('customer table and mobile records preserve archived search, fields and server pagination',async()=>{
 const {load,calls}=listHarness([{id:'customer-1',company_name:'Example & Partners',primary_contact_name:'Jane',email:'jane@example.test',phone:'555-0100',default_payment_terms_days:30,is_active:false}]);
 const html=renderToStaticMarkup(await load('@/app/(app)/customers/page').default({searchParams:Promise.resolve({q:'Jane',status:'archived'})}));
 assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='is_active'&&c[2]===false));
 assert.deepEqual(calls.find(c=>c[0]==='range'),['range',0,24]);
 for(const value of ['Customer cards','scope="col"','Jane','jane@example.test','555-0100','Archived','nexa-table','nexa-records'])assert.ok(html.includes(value),value);
 assert.match(html,/status=archived&amp;page=2&amp;q=Jane/);
 assert.equal((html.match(/href="\/customers\/customer-1"/g)||[]).length,2);
 assert.match(html,/<button[^>]*disabled=""[^>]*>Previous/);
});
test('quote desktop and mobile preserve expired status, optional expiry, totals and number search',async()=>{
 const {load,calls}=listHarness([{id:'q1',quote_number:1001,company_name_snapshot:'Example',quote_date:'2020-01-01',expiration_date:'2020-01-02',status:'sent',total:123.45}]);
 const html=renderToStaticMarkup(await load('@/app/(app)/quotes/page').default({searchParams:Promise.resolve({q:'Q-1001'})}));
 assert.deepEqual(calls.find(c=>c[0]==='eq'),['eq','quote_number',1001]);
 assert.match(html,/Quote cards/);assert.match(html,/Expired/);assert.match(html,/\$123.45/);assert.match(html,/q=Q-1001&amp;page=2/);
 assert.equal((html.match(/href="\/quotes\/q1"/g)||[]).length,2);
 const empty= listHarness([],0);
 const result=renderToStaticMarkup(await empty.load('@/app/(app)/quotes/page').default({searchParams:Promise.resolve({q:'missing'})}));
 assert.match(result,/No quotes match this search/);assert.match(result,/View quotes/);
});
test('shared pagination uses supplied URLs and native disabled controls',()=>{
 const {ListPagination}=dashboardHarness()('@/components/ui/list');
 const html=renderToStaticMarkup(createElement(ListPagination,{label:'Records',previousHref:'/quotes?q=test&page=1'},'Page 2 of 2'));
 assert.match(html,/aria-label="Records"/);assert.match(html,/href="\/quotes\?q=test&amp;page=1"/);
 assert.match(html,/<button[^>]*type="button"[^>]*disabled=""[^>]*>Next/);
});
