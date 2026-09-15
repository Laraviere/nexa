import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {dashboardHarness} from './dashboard-harness.mjs';
test('all route errors keep their reset action and use accessible shared controls',()=>{
 const load=dashboardHarness();
 for(const route of ['customers','dashboard','invoices','quotes','payments','settings','time']){
  let calls=0;const tree=load(`@/app/(app)/${route}/error`).default({reset:()=>calls++});
  const visit=n=>{if(!n||typeof n!=='object')return;if(n.props?.onClick)n.props.onClick();React.Children.forEach(n.props?.children,visit);};visit(tree);
  assert.equal(calls,1,route);
  const html=renderToStaticMarkup(tree);assert.match(html,/role="alert"/);assert.match(html,/nexa-button/);assert.match(html,/Try again/);assert.match(html,/nexa-surface/);
 }
});
test('login uses canonical branding and shared controls without changing sign-in submission',async()=>{
 const slots=[' test@example.test ','password','',false];let index=0;const calls=[],navigation=[];
 const load=dashboardHarness({react:{...React,useState:()=>[slots[index++],()=>{}]},'next/image':{__esModule:true,default:({unoptimized,...props})=>{void unoptimized;return React.createElement('img',props);}},'next/navigation':{useRouter:()=>({replace:p=>navigation.push(p),refresh:()=>{}})},'@/lib/supabase/client':{createClient:()=>({auth:{signInWithPassword:async args=>{calls.push(args);return {error:null};}}})}});
 const tree=load('@/components/auth/login-form').LoginForm();let form;
 const visit=n=>{if(!n||typeof n!=='object')return;if(n.type==='form')form=n;React.Children.forEach(n.props?.children,visit);};visit(tree);
 const html=renderToStaticMarkup(tree);assert.match(html,/src="\/icon.svg"/);assert.match(html,/nexa-control/);assert.match(html,/autoComplete="current-password"/);assert.doesNotMatch(html,/shadow-2xl/);
 await form.props.onSubmit({preventDefault(){}});assert.deepEqual(calls,[{email:'test@example.test',password:'password'}]);assert.deepEqual(navigation,['/dashboard']);
});
test('existing loading states retain polite progress announcements',()=>{
 const load=dashboardHarness();for(const route of ['customers','time']){
  const html=renderToStaticMarkup(React.createElement(load(`@/app/(app)/${route}/loading`).default));assert.match(html,/role="status"/);assert.match(html,/aria-live="polite"/);
 }
});
test('dashboard payment workspace links are corrected without replacing individual invoice links',()=>{
 const source=readFileSync(new URL('../src/components/dashboard/overview.tsx',import.meta.url),'utf8');
 assert.match(source,/note:`\$\{month\} · Payments`,href:"\/payments"/);
 assert.match(source,/title="Recent payments" href="\/payments" action="View payments"/);
 assert.match(source,/href=\{`\/invoices\/\$\{p.invoice_id\}`\}/);
});
