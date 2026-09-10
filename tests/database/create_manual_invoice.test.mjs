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
test("manual invoice RPC: fresh replay, atomicity, idempotency, security and existing regressions", { timeout: 60000 }, async (t) => {
  const database = `nexa_manual_rpc_test_${randomBytes(6).toString("hex")}`;
  let created = false;
  try {
    await sql("postgres", `create database ${database};`); created = true;
    const authUid = await sql("postgres", "select pg_get_functiondef('auth.uid()'::regprocedure);");
    await sql(database, `create schema extensions; create schema auth;
      grant usage on schema public, auth to authenticated;
      alter database ${database} set search_path=public,extensions; ${authUid}`);
    const directory = new URL("supabase/migrations/", root);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    const target = "20260912120000_create_manual_invoice_rpc.sql";
    const index = files.indexOf(target); assert.ok(index >= 0);
    for (const file of files.slice(0,index)) await sql(database, await readFile(new URL(file,directory), "utf8"));
    await sql(database, await readFile(new URL(target,directory), "utf8"));
    t.diagnostic(`Fresh replay of ${index + 1} migrations passed; invoice foundation applied.`);
    for (const file of ["customers_privileges.sql", "customer_billing_agreements.sql", "billing_same_day_end.sql",
      "change_customer_billing_terms.sql", "time_entries.sql", "retainer_usage.sql", "running_timers.sql", "invoices.sql", "create_manual_invoice.sql"]) {
      const output = await sql(database, await readFile(new URL(`tests/database/${file}`,root), "utf8"));
      t.diagnostic(`${file}: passed`);
      if (file === "retainer_usage.sql") {
        for (const line of output.split("\n").filter((line) => line.includes("PASS:"))) t.diagnostic(line.slice(line.indexOf("PASS:")));
      }
    }
    assert.equal(await sql(database, "select (select count(*) from public.customers)+(select count(*) from public.time_entries);"), "0", "Regression fixtures rolled back");
    const customer = await sql(database, "insert into public.customers(company_name) values ('RPC race fixture') returning id;");
    const request = randomBytes(16).toString("hex");
    const command = `set role authenticated; select invoice_id from public.create_manual_invoice('${customer}','2026-09-01',
      '[{"description":"Concurrent","quantity":1,"unit":"flat","unit_rate":75}]','${request}');`;
    const results = await Promise.all(Array.from({length: 8}, () => sql(database, command)));
    assert.equal(new Set(results).size,1,"Concurrent duplicate requests return one invoice");
    assert.equal(await sql(database, `select count(*) from public.invoices where creation_request_id='${request}';`),"1");
    const before = await sql(database,"select last_value from public.invoices_invoice_number_seq;");
    assert.equal(await sql(database,command), results[0]);
    assert.equal(await sql(database,"select last_value from public.invoices_invoice_number_seq;"),before,"Retry consumes no sequence value");
    const conflict = command.replace('"unit_rate":75','"unit_rate":76');
    await assert.rejects(sql(database,conflict), /22023[\s\S]*different invoice data/);
    const competingKey = randomBytes(16).toString("hex");
    const competing = await Promise.allSettled([
      sql(database,command.replace(request,competingKey)),
      sql(database,conflict.replace(request,competingKey)),
    ]);
    assert.equal(competing.filter((r) => r.status === "fulfilled").length,1,"Conflicting concurrent requests have one winner");
    assert.match(competing.find((r) => r.status === "rejected").reason.message,/22023[\s\S]*different invoice data/);
    assert.equal(await sql(database,`select count(*) from public.invoices where creation_request_id='${competingKey}';`),"1");
    t.diagnostic("Eight concurrent identical request IDs return one invoice; retry consumes no sequence value; conflicting request rejected.");
  } finally {
    if (created) await sql("postgres", `drop database ${database} with (force);`);
  }
});
