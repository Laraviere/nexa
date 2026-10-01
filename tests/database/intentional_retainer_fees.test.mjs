import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import test from 'node:test';
async function sql(db,input){
 const child=spawn('docker',['exec','-i','supabase_db_nexa','psql','-U','postgres','-d',db,'-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);const done=new Promise((r,j)=>{child.on('error',j);child.on('close',r);});child.stdin.end(input);assert.equal(await done,0,output);return output.trim();
}
test('Intentional retainer fees: current, historical opt-in, atomic selection, release and concurrency',{timeout:120000},async t=>{
 const db=`nexa_fee_${randomBytes(6).toString('hex')}`;await sql('postgres',`create database ${db};`);
 try{
 const uid=await sql('postgres',"select pg_get_functiondef('auth.uid()'::regprocedure)");
 await sql(db,`create schema extensions;create schema auth;grant usage on schema public,auth to authenticated;alter database ${db} set search_path=public,extensions;${uid}`);
 const directory=new URL('../../supabase/migrations/',import.meta.url);
 for(const f of (await readdir(directory)).filter(f=>f.endsWith('.sql')).sort())await sql(db,await readFile(new URL(f,directory),'utf8'));
 for(const f of ['intentional_retainer_fees.sql','incremental_retainer_overage.sql','edit_invoice.sql','invoice_ready.sql','invoice_payments.sql','invoice_report.sql','payments_workspace.sql']){
  await sql(db,await readFile(new URL(f,import.meta.url),'utf8'));t.diagnostic(`${f}: passed on latest schema`);
 }
 const c=await sql(db,"insert into public.customers(company_name) values('Fee concurrency') returning id;");
 await sql(db,`insert into public.customer_billing_agreements(customer_id,effective_date,monthly_fee,included_hours,overage_hourly_rate,bill_in_advance) values('${c}','2025-06-01',500,1,75,false);`);
 const h=JSON.parse(await sql(db,`set role authenticated;select to_jsonb(p) from public.preview_invoice_with_retainer_history('${c}','2025-09-20') p;`));
 const fee=h.candidates.find(c=>c.period_start==='2025-07-01');
 const result=await Promise.all(Array.from({length:4},()=>sql(db,`set role authenticated;do $$begin perform public.create_composed_invoice('${c}','2025-09-20','2025-09-20','${randomUUID()}','${h.revision}',array['${fee.candidate_id}'],'[]');raise notice 'CLAIMED';exception when others then if sqlerrm like 'STALE_INVOICE_PREVIEW%' or sqlstate='40001' then raise notice 'REJECTED';else raise;end if;end $$;`)));
 assert.equal(result.filter(x=>x.includes('CLAIMED')).length,1);assert.equal(result.filter(x=>x.includes('REJECTED')).length,3);
 t.diagnostic('Four concurrent historical-fee selections: one claim and three rejections.');
 }finally{await sql('postgres',`drop database ${db} with (force);`);}
});
