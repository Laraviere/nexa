// Local-only migration replay and preservation regression for Services removal.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
const root = new URL("../../", import.meta.url);
const exec = promisify(execFile);
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
async function tableSchema(database) {
  const { stdout } = await exec("docker", ["exec", "supabase_db_nexa", "pg_dump", "-U", "postgres", "-d", database,
    "--schema-only", "--table=public.customers", "--table=public.customer_billing_agreements",
    "--table=public.running_timers", "--table=public.time_entries", "--table=public.unbilled_time_entries"]);
  return stdout.split("\n").filter((line) => !/^\\(?:un)?restrict\b/.test(line)).sort().join("\n");
}
test("migration history: Services create/remove replay preserves unrelated schema and data", { timeout: 60000 }, async (t) => {
  const database = `nexa_history_test_${randomBytes(6).toString("hex")}`;
  let created = false;
  try {
    await sql("postgres", `create database ${database};`); created = true;
    const authUid = await sql("postgres", "select pg_get_functiondef('auth.uid()'::regprocedure);");
    await sql(database, `create schema extensions; create schema auth;
      grant usage on schema public, auth to authenticated;
      alter database ${database} set search_path=public,extensions; ${authUid}`);
    const directory = new URL("supabase/migrations/", root);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    const target = "20260910130000_remove_services.sql";
    const index = files.indexOf(target); assert.ok(index >= 0);
    for (const file of files.slice(0,index)) await sql(database, await readFile(new URL(file,directory), "utf8"));
    const customer = await sql(database, "insert into public.customers(company_name) values ('Removal sentinel') returning id;");
    await sql(database, `insert into public.services(name,default_rate,billing_unit) values ('Removal fixture',75,'hour');
      create view public.removal_dependency_fixture as select id from public.services;
      do $$ begin
        begin drop table public.services; raise exception 'Unexpected dependency removal';
        exception when dependent_objects_still_exist then null; end;
        if to_regclass('public.services') is null then raise exception 'Table lost'; end if;
      end $$;
      drop view public.removal_dependency_fixture;`);
    const before = await tableSchema(database);
    await sql(database, await readFile(new URL(target,directory), "utf8"));
    assert.equal(await tableSchema(database), before, "Existing columns, constraints, indexes, triggers, policies, view and table grants unchanged");
    assert.equal(await sql(database, "select to_regclass('public.services') is null;"), "t");
    assert.equal(await sql(database, `select company_name from public.customers where id='${customer}';`), "Removal sentinel");
    assert.equal(await sql(database, "select to_regprocedure('public.set_updated_at()') is not null;"), "t");
    await sql(database, `delete from public.customers where id='${customer}';`);
    t.diagnostic("Removal dropped only Services, preserved unrelated data/shared trigger function, and refused unexpected dependencies.");
    t.diagnostic(`Fresh replay of ${index + 1} migrations passed; existing table/view schema unchanged.`);
    for (const file of ["customers_privileges.sql", "customer_billing_agreements.sql", "billing_same_day_end.sql",
      "change_customer_billing_terms.sql", "time_entries.sql", "retainer_usage.sql", "running_timers.sql"]) {
      const output = await sql(database, await readFile(new URL(`tests/database/${file}`,root), "utf8"));
      t.diagnostic(`${file}: passed`);
      if (file === "retainer_usage.sql") {
        for (const line of output.split("\n").filter((line) => line.includes("PASS:"))) t.diagnostic(line.slice(line.indexOf("PASS:")));
      }
    }
    assert.equal(await sql(database, "select (select count(*) from public.customers)+(select count(*) from public.time_entries);"), "0", "Regression fixtures rolled back");
  } finally {
    if (created) await sql("postgres", `drop database ${database} with (force);`);
  }
});
