import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
export function dashboardHarness(overrides={}) {
 const cache=new Map();
 function load(name,parent='') {
  if(name in overrides)return overrides[name];
  if(name==='server-only')return {};
  if(name==='next/link')return {__esModule:true,default:({children,...props})=>require('react').createElement('a',props,children)};
  if(!name.startsWith('@/')&&!name.startsWith('.'))return require(name);
  const stem=name.startsWith('@/')?path.resolve(import.meta.dirname,'../src',name.slice(2)):path.resolve(path.dirname(parent),name);
  const file=['.ts','.tsx'].map(ext=>stem+ext).find(existsSync);if(!file)throw Error(stem);
  if(cache.has(file))return cache.get(file).exports;
  const output=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const mod={exports:{}};cache.set(file,mod);vm.runInThisContext(`(function(require,module,exports){${output}\n})`,{filename:file})(n=>load(n,file),mod,mod.exports);return mod.exports;
 }
 return load;
}
