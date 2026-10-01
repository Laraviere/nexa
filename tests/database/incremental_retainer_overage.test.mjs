import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import test from 'node:test';
async function sql(db,input){
 const child=spawn('docker',['exec','-i','supabase_db_nexa','psql','-U','postgres','-d',db,'-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);const done=new Promise((r,j)=>{child.on('error',j);child.on('close',r);});child.stdin.end(input);assert.equal(await done,0,output);return output.trim();
}
test('Incremental retainer overage: latest schema, exact claims, safety and concurrency',{timeout:120000},async t=>{
 const db=`nexa_incremental_${randomBytes(6).toString('hex')}`;await sql('postgres',`create database ${db};`);
 try {
  const uid=await sql('postgres',"select pg_get_functiondef('auth.uid()'::regprocedure)");
  await sql(db,`create schema extensions;create schema auth;grant usage on schema public,auth to authenticated;alter database ${db} set search_path=public,extensions;${uid}`);
  const directory=new URL('../../supabase/migrations/',import.meta.url);
  const target='20261001120000_incremental_retainer_overage.sql';
  for(const f of (await readdir(directory)).filter(f=>f.endsWith('.sql')&&f<target).sort())await sql(db,await readFile(new URL(f,directory),'utf8'));
  const migration=await readFile(new URL(target,directory),'utf8');
  const financialSnapshot="select jsonb_build_object('invoices',(select jsonb_agg(to_jsonb(i) order by id) from public.invoices i),'items',(select jsonb_agg(to_jsonb(i) order by id) from public.invoice_items i),'allocations',(select jsonb_agg(to_jsonb(i) order by id) from public.invoice_time_allocations i)) as value";
  await sql(db,`begin;do $$declare c uuid;begin insert into public.customers(company_name) values('Existing overage before upgrade') returning id into c;insert into public.customer_billing_agreements(customer_id,effective_date,monthly_fee,included_hours,overage_hourly_rate) values(c,'2025-08-01',75,1,75);insert into public.time_entries(customer_id,work_date,actual_minutes,description) values(c,'2025-08-02',285,'Existing completed source');perform public.generate_customer_invoice(c,'2025-09-02','${randomUUID()}','2025-09-02');end $$;create temp table before_upgrade as ${financialSnapshot};${migration}
    do $$begin if (select value from before_upgrade) is distinct from (${financialSnapshot}) then raise exception 'Financial history changed';end if;end $$;rollback;`);
  await sql(db,migration);
  t.diagnostic('Existing completed overage invoice, amounts and allocations unchanged by upgrade.');
  for(const file of ['incremental_retainer_overage.sql','create_manual_invoice.sql','edit_invoice.sql','quotes.sql','invoice_ready.sql','invoice_payments.sql','invoice_report.sql','payments_workspace.sql']){
   await sql(db,await readFile(new URL(file,import.meta.url),'utf8'));t.diagnostic(`${file}: passed on latest schema`);
  }
  const c=await sql(db,"insert into public.customers(company_name) values('Concurrent incremental') returning id;");
  await sql(db,`set role authenticated;insert into public.customer_billing_agreements(customer_id,effective_date,monthly_fee,included_hours,overage_hourly_rate) values('${c}','2025-09-01',75,1,75);insert into public.time_entries(customer_id,work_date,actual_minutes,description) values('${c}','2025-09-02',285,'Concurrent');`);
  const p=JSON.parse(await sql(db,`set role authenticated;select to_jsonb(p) from public.preview_customer_invoice('${c}','2025-09-02') p;`));
  const candidate=p.candidates.find(x=>x.source_type==='retainer_overage');
  const command=()=>`set role authenticated;do $$begin perform public.create_composed_invoice('${c}','2025-09-02','2025-09-02','${randomUUID()}','${p.revision}',array['${candidate.candidate_id}'],'[]');raise notice 'CLAIMED';exception when others then if sqlerrm like 'STALE_INVOICE_PREVIEW%' or sqlstate='40001' then raise notice 'REJECTED';else raise;end if;end $$;`;
  const results=await Promise.all(Array.from({length:4},()=>sql(db,command())));
  assert.equal(results.filter(s=>s.includes('CLAIMED')).length,1);assert.equal(results.filter(s=>s.includes('REJECTED')).length,3);
  assert.equal(await sql(db,"select sum(allocated_minutes) from public.invoice_time_allocations where released_at is null;"),'225');
  // Race a source reduction against claiming its later overage. Whichever
  // acquires the customer context first wins; the other must reject safely.
  const raceCustomer=await sql(db,"insert into public.customers(company_name) values('Source correction race') returning id;");
  await sql(db,`insert into public.customer_billing_agreements(customer_id,effective_date,monthly_fee,included_hours,overage_hourly_rate) values('${raceCustomer}','2025-09-01',75,1,75);`);
  const early=await sql(db,`insert into public.time_entries(customer_id,work_date,actual_minutes,description) values('${raceCustomer}','2025-09-01',60,'Earlier allowance') returning id;`);
  await sql(db,`insert into public.time_entries(customer_id,work_date,actual_minutes,description) values('${raceCustomer}','2025-09-02',225,'Later claim');`);
  const racePreview=JSON.parse(await sql(db,`select to_jsonb(p) from public.preview_customer_invoice('${raceCustomer}','2025-09-02') p;`));
  const raceCandidate=racePreview.candidates.find(x=>x.source_type==='retainer_overage');
  const raced=await Promise.all([
   sql(db,`set role authenticated;do $$begin perform public.create_composed_invoice('${raceCustomer}','2025-09-02','2025-09-02','${randomUUID()}','${racePreview.revision}',array['${raceCandidate.candidate_id}'],'[]');raise notice 'CLAIMED';exception when others then if sqlerrm like 'STALE_INVOICE_PREVIEW%' or sqlstate in ('40001','40P01') then raise notice 'REJECTED';else raise;end if;end $$;`),
   sql(db,`set role authenticated;do $$begin update public.time_entries set actual_minutes=15 where id='${early}';raise notice 'CORRECTED';exception when check_violation or serialization_failure or deadlock_detected then raise notice 'REJECTED';end $$;`)
  ]);
  assert.ok(!(raced[0].includes('CLAIMED')&&raced[1].includes('CORRECTED')),'Unsafe correction and stale claim cannot both commit');
  assert.equal(await sql(db,`select count(*) from public.invoice_time_allocations x join public.time_entries e on e.id=x.time_entry_id cross join lateral public.get_retainer_period_usage(e.billing_agreement_id,e.work_date) u cross join lateral jsonb_array_elements(u.allocations) j where e.customer_id='${raceCustomer}' and x.released_at is null and j->>'time_entry_id'=e.id::text and x.minute_start<(j->>'included_minutes')::numeric;`),'0');
  // Force deferred integrity to catch unsupported direct overage lines.
  const unbacked=await sql(db,`set role authenticated;do $$declare v uuid; a uuid;begin select id into a from public.customer_billing_agreements where customer_id='${c}';insert into public.invoices(customer_id,issue_date) values('${c}','2025-09-02') returning id into v;begin insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes,billing_agreement_id,period_start,period_end) values(v,1,'Unsupported','retainer_overage',1,'hour',75,15,a,'2025-09-01','2025-10-01');set constraints all immediate;raise exception 'Unsupported line accepted';exception when check_violation then raise notice 'UNBACKED REJECTED';end;end $$;`);
  assert.ok(unbacked.includes('UNBACKED REJECTED'));
  t.diagnostic('Concurrent source correction cannot invalidate a claim; unbacked overage lines rejected at commit.');
  t.diagnostic('Four concurrent composer requests: one claim, three rejected; exactly225 active minutes.');
 }finally{await sql('postgres',`drop database ${db} with (force);`);}
});
