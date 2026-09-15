import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {dashboardHarness} from './dashboard-harness.mjs';
const loadFor=pathname=>dashboardHarness({'next/navigation':{usePathname:()=>pathname},'@/components/auth/sign-out-button':{SignOutButton:()=>createElement('button',null,'Sign Out')}});

test('navigation selects the parent section on list, detail, new and edit paths without prefix collisions',()=>{
 const {activeSection,navigation}=loadFor('/invoices')('@/components/app/navigation');
 for(const item of navigation){
  for(const suffix of ['','/new','/some-id','/some-id/edit']){
   const selected=navigation.filter(n=>activeSection(item.href+suffix,n.href));assert.deepEqual(selected,[item]);
  }
  assert.equal(activeSection(`${item.href}-other`,item.href),false);
 }
});
test('shell preserves each workspace, one main landmark, skip link, real brand and active navigation',()=>{
 for(const path of ['/dashboard','/customers/one/edit','/quotes/new','/invoices/one','/payments/new','/settings/payments']){
  const load=loadFor(path);const html=renderToStaticMarkup(createElement(load('@/components/app/app-shell').AppShell,null,createElement('h1',null,'Page content')));
  assert.equal((html.match(/<main\b/g)||[]).length,1);assert.match(html,/href="#main-content"/);assert.match(html,/id="main-content" tabindex="-1"/);assert.match(html,/src="\/icon.svg"/);
  assert.match(html,/<details/);assert.match(html,/<summary/);assert.match(html,/Mobile navigation/);assert.match(html,/Page content/);
  assert.equal((html.match(/aria-current="page"/g)||[]).length,2,'One active item in each mutually exclusive desktop/mobile navigation');
  assert.doesNotMatch(html,/Internal workspace|backdrop-blur|overflow-x-auto/);
  for(const route of ['dashboard','customers','time','quotes','invoices','payments','settings'])assert.match(html,new RegExp(`href="/${route}"`));
 }
});
test('mobile disclosure Escape closes it and returns focus; selecting a section closes it',()=>{
 let focused=false;const details={open:true,querySelector:()=>({focus(){focused=true;}})};
 const react=loadFor('/')('react');
 const load=dashboardHarness({'react':{...react,useRef:()=>({current:details})},'next/navigation':{usePathname:()=>'/payments'},'@/components/auth/sign-out-button':{SignOutButton:()=>null}});
 const tree=load('@/components/app/navigation').AppNavigation();
 const find=(node,predicate)=>{if(!node||typeof node!=='object')return;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const result=find(child,predicate);if(result)return result;}};
 const disclosure=find(tree,n=>n.type==='details');let prevented=false;
 disclosure.props.onKeyDown({key:'Escape',preventDefault(){prevented=true;}});assert.equal(details.open,false);assert.equal(focused,true);assert.equal(prevented,true);
 details.open=true;find(disclosure,n=>n.props?.href==='/customers').props.onClick();assert.equal(details.open,false);
 assert.equal(disclosure.key,'/payments','Route change remounts a closed native disclosure');
});
