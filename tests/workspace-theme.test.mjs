import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../src/app/workspace-theme.css',import.meta.url),'utf8');
const tokens=Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map(m=>[m[1],m[2]]));
function luminance(hex){const channels=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;}
function contrast(a,b){const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);}
test('graphite text and semantic status palettes meet normal-text contrast requirements',()=>{
 for(const bg of ['--workspace','--surface','--surface-raised','--surface-subtle'])for(const fg of ['--ink','--text-secondary','--text-muted','--workspace-link'])assert.ok(contrast(tokens[bg],tokens[fg])>=4.5,`${fg} on ${bg}`);
 for(const tone of ['info','warning','success','danger'])assert.ok(contrast(tokens[`--workspace-${tone}-bg`],tokens[`--workspace-${tone}-text`])>=4.5,tone);
 assert.ok(contrast(tokens['--surface'],tokens['--border-control'])>=3);
 assert.ok(contrast('#0e7490','#ffffff')>=4.5,'primary button');
});
test('theme is scoped to authenticated shell, including native controls and peer states',()=>{
 const shell=readFileSync(new URL('../src/components/app/app-shell.tsx',import.meta.url),'utf8');
 const login=readFileSync(new URL('../src/components/auth/login-form.tsx',import.meta.url),'utf8');
 assert.match(shell,/nexa-workspace nexa-graphite/);assert.doesNotMatch(login,/nexa-graphite/);
 assert.match(css,/#main-content \{ color-scheme:dark/);assert.match(css,/peer:checked/);
 assert.doesNotMatch(css,/(?:^|\n)(?:body|:root)\s*\{/);
});
