// Local-only fresh replay and contract/security regression for the usage RPC.
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
    "--table=public.time_entries", "--table=public.unbilled_time_entries"]);
  return stdout.split("\n").filter((line) => !/^\\(?:un)?restrict\b/.test(line)).sort().join("\n");
}
test("running timers: fresh replay, unchanged existing schema, all regressions and concurrency", { timeout: 120000 }, async (t) => {
  const database = `nexa_timer_test_${randomBytes(6).toString("hex")}`;
  let created = false;
  try {
    await sql("postgres", `create database ${database};`); created = true;
    const authUid = await sql("postgres", "select pg_get_functiondef('auth.uid()'::regprocedure);");
    await sql(database, `create schema extensions; create schema auth;
      grant usage on schema public, auth to authenticated;
      alter database ${database} set search_path=public,extensions; ${authUid}`);
    const directory = new URL("supabase/migrations/", root);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    const target = "20260909160000_create_running_timers.sql";
    const index = files.indexOf(target); assert.ok(index >= 0);
    for (const file of files.slice(0,index)) await sql(database, await readFile(new URL(file,directory), "utf8"));
    const before = await tableSchema(database);
    await sql(database, await readFile(new URL(target,directory), "utf8"));
    assert.equal(await tableSchema(database), before, "Existing columns, constraints, indexes, triggers, policies, view and table grants unchanged");
    t.diagnostic(`Fresh replay of ${index + 1} migrations passed; existing table/view schema unchanged.`);
    for (const file of ["customers_privileges.sql", "customer_billing_agreements.sql", "billing_same_day_end.sql",
      "change_customer_billing_terms.sql", "time_entries.sql", "retainer_usage.sql", "running_timers.sql"]) {
      const output = await sql(database, await readFile(new URL(`tests/database/${file}`,root), "utf8"));
      t.diagnostic(`${file}: passed`);
      if (file === "running_timers.sql") {
        for (const line of output.split("\n").filter((line) => line.includes("PASS:"))) t.diagnostic(line.slice(line.indexOf("PASS:")));
      }
    }
    assert.equal(await sql(database, "select (select count(*) from public.customers)+(select count(*) from public.time_entries);"), "0", "Regression fixtures rolled back");
    assert.equal(await sql(database, "select position('pg_temp.timer_clock' in pg_get_functiondef('public.stop_time_timer(uuid,numeric)'::regprocedure));"), "0", "Test clock replacement rolled back");
    await races(database, t);
  } finally {
    if (created) await sql("postgres", `drop database ${database} with (force);`);
  }
});

function session(database, name) {
  const child = spawn("docker", ["exec", "-i", "supabase_db_nexa", "psql", "-U", "postgres", "-d", database,
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]);
  const state = { child, output: "", finished: null };
  child.stdout.on("data", chunk => { state.output += chunk; });
  child.stderr.on("data", chunk => { state.output += chunk; });
  state.finished = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  child.stdin.write(`set application_name='${name}'; set statement_timeout='15s'; set role authenticated;\n`);
  return state;
}
async function until(check, label) {
  const deadline = Date.now()+10000;
  while (!(await check())) {
    assert.ok(Date.now()<deadline, label);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
}
async function races(database, t) {
  const customer = await sql(database, "insert into public.customers(company_name) values ('Timer race fixture') returning id;");
  const start = `insert into public.running_timers(customer_id,description,is_billable,hourly_rate,started_at) values('${customer}','Race',true,100,'2000-01-01') returning id;`;
  async function race(first, second, expectedCode, expectedText) {
    const name = `timer_wait_${randomBytes(4).toString("hex")}`;
    const a = session(database, `${name}_first`), b = session(database, name);
    try {
      a.child.stdin.write(`begin; ${first}\n\\echo READY\n`);
      await until(() => a.output.includes("READY"), a.output || "First transaction ready");
      b.child.stdin.end(`${second}\n`);
      await until(async () => await sql(database, `select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock';`)==="1", "Second transaction must actually block on a database lock");
      a.child.stdin.end("commit;\n");
      assert.equal(await a.finished, 0, a.output);
      assert.equal(await b.finished, expectedCode, b.output);
      if (expectedText) assert.ok(b.output.includes(expectedText), b.output);
    } finally {
      if (a.child.exitCode===null) a.child.stdin.end("rollback;\n");
      if (b.child.exitCode===null) b.child.kill();
      await Promise.allSettled([a.finished,b.finished]);
    }
  }
  await race(start, start, 3, "23505");
  assert.equal(await sql(database, "select count(*) from public.running_timers;"), "1");
  assert.equal(await sql(database, "select started_at > now()-interval '1 minute' from public.running_timers;"), "t", "Real server clock replaces forged start");
  let id = await sql(database, "select id from public.running_timers;");
  const stop = timer => `select count(*) from public.stop_time_timer('${timer}');`;
  await race(stop(id),stop(id),3,"P0002");
  assert.equal(await sql(database, "select count(*) from public.time_entries;"), "1");
  id = await sql(database, `set role authenticated; ${start}`);
  await race(stop(id),`select public.cancel_time_timer('${id}');`,0);
  assert.equal(await sql(database, "select count(*) from public.time_entries;"), "2");
  id = await sql(database, `set role authenticated; ${start}`);
  await race(`select public.cancel_time_timer('${id}');`,stop(id),3,"P0002");
  assert.equal(await sql(database, "select count(*) from public.time_entries;"), "2");
  assert.equal(await sql(database, "select count(*) from public.running_timers;"), "0");
  // A failed first Stop commits pending state; Cancel must wait and then reject.
  id = await sql(database, `set role authenticated; ${start} update public.running_timers set hourly_rate=null;`);
  await race(stop(id),`select public.cancel_time_timer('${id}');`,3,"55000");
  const preserved = await sql(database, "select stop_requested_at from public.running_timers;");
  assert.ok(preserved);
  assert.equal(await sql(database, `set role authenticated; select public.stop_time_timer('${id}')->>'status';`), "pending_finalization");
  assert.equal(await sql(database, "select stop_requested_at from public.running_timers;"), preserved);
  await sql(database, "set role authenticated; update public.running_timers set hourly_rate=100;");
  await race(stop(id),stop(id),3,"P0002");
  assert.equal(await sql(database, "select count(*) from public.time_entries;"), "3");
  assert.equal(await sql(database, "select ended_at from public.time_entries order by created_at desc limit 1;"), preserved);
  assert.equal(await sql(database, "select count(*) from public.running_timers;"), "0");
  t.diagnostic("Pending-state races passed: failed Stop versus Cancel, preserved timestamp on repeated failure, and concurrent successful retries finalize exactly once.");
  t.diagnostic("Real two-session races passed: simultaneous starts, double Stop, Stop winning Cancel, Cancel winning Stop; authoritative production clock verified.");
}
