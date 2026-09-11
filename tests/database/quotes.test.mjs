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
test("Quotes: fresh replay, proposal invariants, conversion races and prior regressions", {timeout:120000}, async(t)=>{
 const database=`nexa_quotes_test_${randomBytes(6).toString("hex")}`;let created=false;
 try {
  await sql("postgres",`create database ${database};`);created=true;
  const authUid=await sql("postgres","select pg_get_functiondef('auth.uid()'::regprocedure);");
  await sql(database,`create schema extensions;create schema auth;grant usage on schema public,auth to authenticated;alter database ${database} set search_path=public,extensions;${authUid}`);
  const directory=new URL("supabase/migrations/",root);
  const files=(await readdir(directory)).filter(f=>f.endsWith('.sql')).sort();
  for(const file of files)await sql(database,await readFile(new URL(file,directory),'utf8'));
  t.diagnostic(`Fresh replay of ${files.length} migrations passed.`);
  for(const file of ["customers_privileges.sql","customer_billing_agreements.sql","billing_same_day_end.sql","change_customer_billing_terms.sql","time_entries.sql","retainer_usage.sql","running_timers.sql","invoices.sql","create_manual_invoice.sql","generate_customer_invoice.sql","invoice_composer.sql","edit_invoice.sql","invoice_ready.sql","invoice_payments.sql","payment_eligibility.sql","invoice_report.sql"]){
   await sql(database,await readFile(new URL(`tests/database/${file}`,root),'utf8'));t.diagnostic(`${file}: passed`);
  }
  await sql(database,await readFile(new URL('tests/database/quotes.sql',root),'utf8'));
  t.diagnostic('Quote dates, exact totals, lifecycle, conversion, payment integration, RLS and privilege checks passed.');
  const customer=await sql(database,"insert into public.customers(company_name,default_payment_terms_days) values('Quote races',30) returning id;");
  const lines=JSON.stringify([{description:'Race',quantity:'2.5',unit:'hour',unit_rate:'100'}]);
  const key=randomBytes(16).toString('hex');
  const seqBefore=await sql(database,'select last_value::text from public.invoices_invoice_number_seq;');
  const command=`set role authenticated;select public.save_quote('${customer}','2026-09-01','${lines}','${key}');`;
  const same=await Promise.all(Array.from({length:6},()=>sql(database,command)));
  assert.equal(new Set(same).size,1,'Same-key concurrent saves create one quote');
  assert.equal(await sql(database,'select last_value::text from public.invoices_invoice_number_seq;'),seqBefore,'Quotes consume no invoice numbers');
  const quote=same[0];
  await sql(database,`set role authenticated;select public.change_quote_status('${quote}','accepted',1);`);
  const quoteSeq=await sql(database,'select last_value from public.quotes_quote_number_seq;');
  const convert=`set role authenticated;select public.convert_quote_to_invoice('${quote}','2026-09-01',2);`;
  const results=await Promise.all(Array.from({length:6},()=>sql(database,convert)));
  assert.equal(new Set(results).size,1,'Concurrent conversion creates one invoice');
  assert.equal(await sql(database,`select count(*) from public.invoices where customer_id='${customer}';`),'1');
  assert.equal(Number(await sql(database,'select last_value from public.invoices_invoice_number_seq;')),Number(seqBefore)+1);
  assert.equal(await sql(database,'select last_value from public.quotes_quote_number_seq;'),quoteSeq,'Conversion consumes no quote number');
  const invoice=results[0];
  const preview=JSON.parse(await sql(database,`select row_to_json(p) from public.preview_invoice_edit('${invoice}','2026-09-01') p;`));
  await sql(database,`set role authenticated;select invoice_id from public.update_composed_invoice('${invoice}','2026-08-01','2026-09-01','${randomBytes(16).toString('hex')}','${preview.revision}','{}','[{"description":"Edited invoice","quantity":3,"unit":"each","unit_rate":50}]');`);
  assert.equal(await sql(database,`select total from public.invoice_totals where invoice_id='${invoice}';`),'150.00');
  assert.equal(await sql(database,`select total from public.quotes where id='${quote}';`),'250.00','Invoice edits never overwrite accepted quote');
  assert.equal(await sql(database,convert),invoice,'Retry after invoice edits returns existing invoice');
  t.diagnostic('Concurrent creation/conversion retries, independent sequences, backdating and normal invoice edits passed.');
 }finally{if(created)await sql('postgres',`drop database ${database} with (force);`);}
});
