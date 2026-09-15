import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {dashboardHarness} from './dashboard-harness.mjs';
const load=dashboardHarness(),render=node=>renderToStaticMarkup(node),e=React.createElement;

test('buttons preserve native form attributes and pending states; button links stay anchors',()=>{
 const {Button,ButtonLink,ButtonAnchor}=load('@/components/ui/button');let clicked=false;
 const tree=Button({type:'submit',name:'confirmed',value:'yes',onClick:()=>clicked=true,children:'Save'});tree.props.onClick();assert.equal(clicked,true);assert.equal(tree.props.type,'submit');assert.equal(tree.props.name,'confirmed');assert.equal(tree.props.value,'yes');
 const busy=render(e(Button,{pending:true,pendingLabel:'Saving…'},'Save'));assert.match(busy,/disabled=""/);assert.match(busy,/aria-busy="true"/);assert.match(busy,/Saving…/);
 for(const variant of ['primary','secondary','quiet','destructive'])assert.match(render(e(Button,{variant,type:'button'},'Action')),new RegExp(`nexa-button--${variant}`));
 for(const Component of [ButtonLink,ButtonAnchor]){const html=render(e(Component,{href:'/invoices/123/pdf',target:'_blank',rel:'noopener noreferrer'},'View PDF'));assert.match(html,/<a /);assert.doesNotMatch(html,/<button/);assert.match(html,/target="_blank"/);}
});
test('FormField joins help and errors to the control without changing values, dates or validation',()=>{
 const {FormField,Input,Select,Textarea}=load('@/components/ui/form');
 const html=render(e(FormField,{id:'amount',label:'Amount',required:true,help:'USD',error:'Enter an amount'},e(Input,{name:'amount',defaultValue:'12.50','aria-describedby':'existing-help',inputMode:'decimal'})));
 for(const expected of ['for="amount"','id="amount"','name="amount"','value="12.50"','required=""','aria-invalid="true"','aria-describedby="existing-help amount-help amount-error"','id="amount-error"'])assert.ok(html.includes(expected),expected);
 const date=render(e(Input,{type:'date',name:'payment_date',min:'2020-01-01',max:'2026-09-15',defaultValue:'2026-09-01'}));assert.match(date,/type="date"/);assert.match(date,/max="2026-09-15"/);assert.match(date,/value="2026-09-01"/);
 assert.match(render(e(Select,{name:'method',defaultValue:'ach'},e('option',{value:'ach'},'ACH'))),/value="ach" selected/);
 assert.match(render(e(Textarea,{name:'notes',disabled:true,defaultValue:'Historical note'})),/disabled=""[^>]*>Historical note/);
});
test('status domains retain their own text and consistent semantic tones',()=>{
 const {StatusBadge}=load('@/components/ui/status-badge');
 const groups={invoiceWorkflow:{draft:'Draft',ready:'Ready',sent:'Sent',void:'Void'},invoicePayment:{unpaid:'Unpaid',partially_paid:'Partially Paid',paid:'Paid'},quote:{draft:'Draft',sent:'Sent',accepted:'Accepted',declined:'Declined',expired:'Expired'},customer:{active:'Active',archived:'Archived'},paymentRecord:{active:'Active',voided:'Voided'}};
 for(const [domain,statuses] of Object.entries(groups))for(const [status,label] of Object.entries(statuses)){const html=render(e(StatusBadge,{domain,status}));assert.match(html,/nexa-badge/);assert.ok(html.includes(`>${label}</span>`));}
 assert.match(render(e(StatusBadge,{domain:'invoicePayment',status:'partially_paid'})),/nexa-tone--warning/);
 assert.match(render(e(StatusBadge,{domain:'invoiceWorkflow',status:'void'})),/nexa-tone--danger/);
});
test('feedback and confirmations remain inline and preserve safety messages/actions',()=>{
 const {InlineNotice,EmptyState,LoadingState}=load('@/components/ui/feedback');const {ConfirmationPanel}=load('@/components/ui/confirmation-panel');
 assert.match(render(e(InlineNotice,{tone:'error'},'Existing error')),/role="alert"/);
 assert.match(render(e(InlineNotice,{tone:'warning',role:'status'},'Retry this same payment safely.')),/Retry this same payment safely/);
 const html=render(e('form',{action:'/existing'},e(ConfirmationPanel,{destructive:true,title:'Void payment?',description:'It does not issue a refund.',actions:e('button',{name:'confirmed',value:'yes'},'Confirm void')},e('input',{type:'hidden',name:'payment_id',value:'existing'}))));
 assert.equal((html.match(/<form/g)||[]).length,1);assert.doesNotMatch(html,/role="dialog"|aria-modal/);assert.match(html,/It does not issue a refund/);assert.match(html,/name="payment_id"/);assert.match(html,/name="confirmed"/);
 assert.match(render(e(EmptyState,{title:'No payments recorded.'})),/No payments recorded/);assert.match(render(e(LoadingState,null,'Loading customers…')),/role="status"/);
});
