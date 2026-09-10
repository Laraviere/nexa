import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
export async function inspectPdf(bytes) {
 const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});const pdf=await task.promise;const pages=[];
 try {
  for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n);assert.deepEqual(page.view,[0,0,612,792],'US Letter');
   const content=await page.getTextContent();const runs=content.items.filter(i=>'str' in i&&i.str.trim());
   for(const run of runs){const [,,,,x,y]=run.transform;assert.ok(x>=40&&x+run.width<=573&&y>=20&&y<=772,`Text outside print bounds: ${run.str} (${x},${y},${run.width})`);}
   pages.push({text:runs.map(i=>i.str).join(' '),runs});
  }
  return {pages,text:pages.map(p=>p.text).join('\n')};
 } finally {await task.destroy();}
}
