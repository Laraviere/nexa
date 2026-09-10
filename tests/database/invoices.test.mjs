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
test("invoices: fresh replay, financial integrity, caller RLS and existing regressions", { timeout: 60000 }, async (t) => {
  const database = `nexa_invoice_test_${randomBytes(6).toString("hex")}`;
  let created = false;
  try {
    await sql("postgres", `create database ${database};`); created = true;
    const authUid = await sql("postgres", "select pg_get_functiondef('auth.uid()'::regprocedure);");
    await sql(database, `create schema extensions; create schema auth;
      grant usage on schema public, auth to authenticated;
      alter database ${database} set search_path=public,extensions; ${authUid}`);
    const directory = new URL("supabase/migrations/", root);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    const target = "20260911120000_create_invoices.sql";
    const index = files.indexOf(target); assert.ok(index >= 0);
    for (const file of files.slice(0,index)) await sql(database, await readFile(new URL(file,directory), "utf8"));
    await sql(database, await readFile(new URL(target,directory), "utf8"));
    t.diagnostic(`Fresh replay of ${index + 1} migrations passed; invoice foundation applied.`);
    for (const file of ["customers_privileges.sql", "customer_billing_agreements.sql", "billing_same_day_end.sql",
      "change_customer_billing_terms.sql", "time_entries.sql", "retainer_usage.sql", "running_timers.sql", "invoices.sql"]) {
      const output = await sql(database, await readFile(new URL(`tests/database/${file}`,root), "utf8"));
      t.diagnostic(`${file}: passed`);
      if (file === "retainer_usage.sql") {
        for (const line of output.split("\n").filter((line) => line.includes("PASS:"))) t.diagnostic(line.slice(line.indexOf("PASS:")));
      }
    }
    assert.equal(await sql(database, "select (select count(*) from public.customers)+(select count(*) from public.time_entries);"), "0", "Regression fixtures rolled back");
    const customer = await sql(database, "insert into public.customers(company_name) values ('Concurrency fixture') returning id;");
    const numbers = await Promise.all(Array.from({ length: 12 }, () => sql(database,
      `set role authenticated; insert into public.invoices(customer_id) values ('${customer}') returning invoice_number;`)));
    assert.equal(new Set(numbers).size, 12, "Concurrent invoice numbers are unique");
    const entry = await sql(database, `insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate)
      values ('${customer}','2026-09-02','Concurrency source',30,120) returning id;`);
    const lines = await Promise.all([0,1].map(() => sql(database, `set role authenticated;
      with invoice as (insert into public.invoices(customer_id) values ('${customer}') returning id)
      insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes)
      select id,1,'Race','hourly_time',1,'hour',120,15 from invoice returning id;`)));
    const attempts = await Promise.allSettled(lines.map((line) => sql(database, `begin; set local role authenticated;
      insert into public.invoice_time_allocations(invoice_item_id,time_entry_id,minute_start,minute_end)
      values ('${line}','${entry}',0,15); select pg_sleep(0.15); commit;`)));
    assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1, "Only one concurrent minute claim succeeds");
    assert.match(attempts.find((r) => r.status === "rejected").reason.message, /23P01|exclusion constraint/);
    const agreement = await sql(database, `insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date)
      values ('${customer}',500,1,125,'2026-10-01') returning id;`);
    const invoices = await Promise.all([0,1].map(() => sql(database, `insert into public.invoices(customer_id) values ('${customer}') returning id;`)));
    const fees = await Promise.allSettled(invoices.map((invoice) => sql(database, `begin; set local role authenticated;
      insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billing_agreement_id,period_start,period_end)
      values ('${invoice}',1,'Concurrent fee','retainer_fee',1,'month',500,'${agreement}','2026-10-01','2026-11-01');
      select pg_sleep(0.15); commit;`)));
    assert.equal(fees.filter((r) => r.status === "fulfilled").length, 1, "Only one concurrent period fee claim succeeds");
    assert.match(fees.find((r) => r.status === "rejected").reason.message, /23P01|exclusion constraint/);
    const overages = await Promise.allSettled(invoices.map((invoice) => sql(database, `begin; set local role authenticated;
      insert into public.invoice_items(invoice_id,position,description,source_type,quantity,unit,unit_rate,billed_minutes,billing_agreement_id,period_start,period_end)
      values ('${invoice}',2,'Concurrent overage','retainer_overage',1,'hour',125,15,'${agreement}','2026-10-01','2026-11-01');
      select pg_sleep(0.15); commit;`)));
    assert.equal(overages.filter((r) => r.status === "fulfilled").length, 1, "Only one concurrent overage period claim succeeds");
    assert.match(overages.find((r) => r.status === "rejected").reason.message, /23505[\s\S]*invoice_items_retainer_overage_once_idx/);
    t.diagnostic("Concurrent overage period claims accept one winner and reject the competing invoice with the new unique index.");
    t.diagnostic("Twelve concurrent invoice creations have unique numbers; concurrent time and fee claims each accept one winner.");
    const raceInvoice = await sql(database, `insert into public.invoices(customer_id) values ('${customer}') returning id;`);
    // Hold the invoice parent lock while a complete line is still uncommitted.
    // The competing finalizer must wait and then see that line.
    const writer = sql(database, `begin; set local role authenticated;
      set local application_name = 'nexa_invoice_finalize_race';
      insert into public.invoice_items(invoice_id,position,description,quantity,unit,unit_rate)
      values ('${raceInvoice}',1,'Uncommitted line',1,'flat',25);
      select pg_sleep(1); commit;`);
    let sleeping = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await sql(database, "select exists(select from pg_stat_activity where datname=current_database() and application_name='nexa_invoice_finalize_race' and wait_event='PgSleep');") === "t") {
        sleeping = true; break;
      }
    }
    assert.ok(sleeping, "Writer holds the invoice lock before finalization");
    await sql(database, `set role authenticated; update public.invoices set status='sent' where id='${raceInvoice}';`);
    await writer;
    assert.equal(await sql(database, `select total from public.invoice_totals where invoice_id='${raceInvoice}';`), "25.00");
    t.diagnostic("Concurrent finalization waits for the draft line transaction and preserves its exact total.");
  } finally {
    if (created) await sql("postgres", `drop database ${database} with (force);`);
  }
});
