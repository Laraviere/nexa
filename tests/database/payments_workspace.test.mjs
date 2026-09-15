import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import test from 'node:test';
async function sql(db,input){
 const child=spawn('docker',['exec','-i','supabase_db_nexa','psql','-U','postgres','-d',db,'-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);const done=new Promise((r,j)=>{child.on('error',j);child.on('close',r);});child.stdin.end(input);assert.equal(await done,0,output);return output.trim();
}
test('Payments workspace fresh replay, upgrade preservation, report RLS/filter totals and concurrent retries',{timeout:90000},async t=>{
 const db=`nexa_workspace_${randomBytes(6).toString('hex')}`;await sql('postgres',`create database ${db};`);
 try {
  const uid=await sql('postgres',"select pg_get_functiondef('auth.uid()'::regprocedure)");
  await sql(db,`create schema extensions;create schema auth;grant usage on schema public,auth to authenticated;alter database ${db} set search_path=public,extensions;${uid}`);
  const directory=new URL('../../supabase/migrations/',import.meta.url);const files=(await readdir(directory)).filter(f=>f.endsWith('.sql')).sort();
  for(const f of files.filter(f=>!f.includes('payments_workspace')))await sql(db,await readFile(new URL(f,directory),'utf8'));
  const invoice=await sql(db,`set role authenticated;insert into public.customers(company_name) values('Historical future payment');select invoice_id from public.create_manual_invoice((select id from public.customers limit 1),'2026-09-01','[{"description":"Work","quantity":1,"unit":"flat","unit_rate":1000}]',gen_random_uuid());`);
  const key=randomUUID();await sql(db,`set role authenticated;update public.invoices set status='ready' where id='${invoice}';select public.record_invoice_payment('${invoice}',25,(now() at time zone 'America/New_York')::date+30,'cash','${key}');select public.update_payment_settings(false,true,true);`);
  const before=await sql(db,'select to_jsonb(p) from public.invoice_payments p;');
  await sql(db,await readFile(new URL('20260922120000_payments_workspace.sql',directory),'utf8'));
  assert.equal(await sql(db,'select to_jsonb(p) from public.invoice_payments p;'),before);
  assert.equal(await sql(db,'select not cash_enabled and check_enabled and card_enabled and ach_enabled and other_enabled from public.payment_settings;'),'t');
  await sql(db,`set role authenticated;select public.record_invoice_payment('${invoice}',25,(now() at time zone 'America/New_York')::date+30,'cash','${key}');select public.void_invoice_payment((select id from public.invoice_payments where request_id='${key}'),'Historical correction');`);
  await sql(db,await readFile(new URL('./payments_workspace.sql',import.meta.url),'utf8'));
  t.diagnostic('All migrations replayed; existing future row unchanged/retryable/voidable; five methods, date rules, pagination/search/filters, historical exclusions and RLS passed.');
  await sql(db,'set role authenticated;select public.update_payment_settings(true,true,true,true,true);');
  const retryKey=randomUUID();const command=`set role authenticated;select payment_id from public.record_invoice_payment('${invoice}',10,(now() at time zone 'America/New_York')::date,'ach','${retryKey}');`;
  const outcomes=await Promise.all([sql(db,command),sql(db,command)]);assert.equal(outcomes[0],outcomes[1]);assert.equal(await sql(db,`select count(*) from public.invoice_payments where request_id='${retryKey}';`),'1');
  t.diagnostic('Concurrent exact-key ACH requests produce one ledger row.');
  assert.equal(await sql(db,"begin read only;set role authenticated;select count(*) from public.get_payment_report();commit;"),'1');
  const customer=await sql(db,`select customer_id from public.invoices where id='${invoice}';`);
  const name=`payment_snapshot_${randomBytes(4).toString('hex')}`;
  const reading=sql(db,`set application_name='${name}';set role authenticated;
    with first as materialized (select to_jsonb(r) as value from public.get_payment_report(p_customer_id=>'${customer}') r),
    pause as materialized (select value,pg_sleep(1) from first),
    second as materialized (select p.value,to_jsonb(r) as later from pause p cross join lateral public.get_payment_report(p_customer_id=>(p.value->'rows'->0->>'customer_id')::uuid) r)
    select jsonb_build_array(value,later) from second;`);
  let waiting=false;for(let i=0;i<100;i++){if(await sql(db,`select exists(select from pg_stat_activity where application_name='${name}' and wait_event='PgSleep');`)==='t'){waiting=true;break;}}
  assert.ok(waiting);await sql(db,`set role authenticated;select public.record_invoice_payment('${invoice}',5,(now() at time zone 'America/New_York')::date,'other','${randomUUID()}');`);
  const snapshots=JSON.parse(await reading);assert.deepEqual(snapshots[0],snapshots[1]);assert.equal(snapshots[0].payments_received,10);
  assert.equal(Number(await sql(db,`select payments_received from public.get_payment_report(p_customer_id=>'${customer}');`)),15);
  t.diagnostic('Read-only report keeps one statement snapshot during concurrent payment; next request sees committed receipt.');
 }finally{await sql('postgres',`drop database ${db} with (force);`);}
});
