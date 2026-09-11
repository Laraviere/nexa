// Fresh local-only invoice foundation replay and regression checks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
const root = new URL("../../", import.meta.url);
async function sql(database, input) {
  const child = spawn("docker", ["exec", "-i", "supabase_db_nexa", "psql", "-U", "postgres", "-d", database,
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const finished = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  child.stdin.end(input);
  assert.equal(await finished, 0, output);
  return output.trim();
}
test("Invoice report: fresh migration replay, exact filtered totals, RLS and prior regressions", {timeout:60000}, async(t)=>{
 const database=`nexa_report_test_${randomBytes(6).toString("hex")}`;let created=false;
 try {
  await sql("postgres",`create database ${database};`);created=true;
  const authUid=await sql("postgres","select pg_get_functiondef('auth.uid()'::regprocedure);");
  await sql(database,`create schema extensions;create schema auth;grant usage on schema public,auth to authenticated;alter database ${database} set search_path=public,extensions;${authUid}`);
  const directory=new URL("supabase/migrations/",root);
  const files=(await readdir(directory)).filter(f=>f.endsWith('.sql')).sort();
  const target="20260919120000_create_invoice_report_rpc.sql";const index=files.indexOf(target);assert.ok(index>=0);
  for(const file of files.slice(0,index+1))await sql(database,await readFile(new URL(file,directory),'utf8'));
  t.diagnostic(`Fresh replay of ${index+1} migrations passed.`);
  for(const file of ["customers_privileges.sql","customer_billing_agreements.sql","billing_same_day_end.sql","change_customer_billing_terms.sql","time_entries.sql","retainer_usage.sql","running_timers.sql","invoices.sql","create_manual_invoice.sql","generate_customer_invoice.sql","invoice_composer.sql","edit_invoice.sql","invoice_ready.sql","invoice_payments.sql","payment_eligibility.sql","invoice_report.sql"]){
   await sql(database,await readFile(new URL(`tests/database/${file}`,root),'utf8'));t.diagnostic(`${file}: passed`);
  }
  assert.equal(await sql(database,"begin read only;set local role authenticated;select total_rows||':'||rows::text from public.get_invoice_report();commit;"),'0:[]','Callable in a read-only transaction');
  // A concurrent payment commits between two report reads in one SQL statement.
  // STABLE report functions must retain that statement's original snapshot.
  const customer=await sql(database,"insert into public.customers(company_name) values('Snapshot fixture') returning id;");
  const invoice=await sql(database,`select invoice_id from public.create_manual_invoice('${customer}','2026-09-01','[{"description":"Snapshot","quantity":1,"unit":"flat","unit_rate":100}]','${randomBytes(16).toString('hex')}');`);
  await sql(database,`update public.invoices set status='ready' where id='${invoice}';`);
  const name=`report_${randomBytes(6).toString('hex')}`;
  const reading=sql(database,`set application_name='${name}';set role authenticated;
   with first as materialized (select to_jsonb(r) as value from public.get_invoice_report(p_customer_id=>'${customer}') r),
   pause as materialized (select value,pg_sleep(0.8) from first),
   second as materialized (select p.value, to_jsonb(r) as later from pause p cross join lateral public.get_invoice_report(p_customer_id=>(p.value->'rows'->0->>'customer_id')::uuid) r)
   select jsonb_build_array(value,later) from second;`);
  let sleeping=false;
  for(let attempt=0;attempt<100;attempt++){
   if(await sql(database,`select exists(select from pg_stat_activity where application_name='${name}' and wait_event='PgSleep');`)==='t'){sleeping=true;break;}
   await new Promise(r=>setTimeout(r,10));
  }
  assert.ok(sleeping,'Report reached concurrent write barrier');
  await sql(database,`set role authenticated;select payment_id from public.record_invoice_payment('${invoice}',25,'2026-09-10','cash','${randomBytes(16).toString('hex')}');`);
  const snapshots=JSON.parse(await reading);assert.deepEqual(snapshots[0],snapshots[1]);assert.equal(snapshots[0].amount_paid,0);assert.equal(snapshots[1].rows[0].balance_due,100);
  const fresh=JSON.parse(await sql(database,`set role authenticated;select to_jsonb(r) from public.get_invoice_report(p_customer_id=>'${customer}') r;`));
  assert.equal(fresh.amount_paid,25);assert.equal(fresh.rows[0].balance_due,75);
  t.diagnostic('Concurrent payment: one calling-statement snapshot, with the committed payment visible on the next report.');
 }finally{if(created)await sql('postgres',`drop database ${database} with (force);`);}
});
