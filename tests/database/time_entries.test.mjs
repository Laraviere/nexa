// Local-only replay: node --test tests/database/time_entries.test.mjs
// Uses a disposable database in the existing Docker container, never a reset
// of the development database. Replays existing and new database regressions.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
function connection(database) {
  const child = spawn("docker", ["exec", "-i", "supabase_db_nexa", "psql", "-U", "postgres",
    "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const finished = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
  return { child, finished, output: () => output };
}

async function sql(database, input) {
  const session = connection(database);
  session.child.stdin.end(input);
  assert.equal(await session.finished, 0, session.output());
  return session.output().trim();
}

async function until(check, label) {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await delay(50);
  }
}

test("Time Tracking migration replays cleanly with all customer, billing and time regressions", { timeout: 60000 }, async (t) => {
  const database = `nexa_time_test_${randomBytes(6).toString("hex")}`;
  const sessions = [];
  let created = false;
  try {
    await sql("postgres", `create database ${database};`);
    created = true;
    const authUid = await sql("postgres", "select pg_get_functiondef('auth.uid()'::regprocedure);");
    await sql(database, `create schema extensions; create schema auth;
      grant usage on schema public, auth to authenticated;
      alter database ${database} set search_path = public, extensions;
      ${authUid}`);
    const directory = new URL("supabase/migrations/", root);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    const targetIndex = files.indexOf("20260908180000_create_time_entries.sql");
    assert.ok(targetIndex >= 0, "Time Tracking migration missing");
    for (const file of files.slice(0, targetIndex + 1)) {
      await sql(database, await readFile(new URL(file, directory), "utf8"));
    }
    t.diagnostic(`Replayed ${targetIndex + 1} migrations from scratch in a disposable local database.`);
    for (const file of ["customers_privileges.sql", "customer_billing_agreements.sql",
      "billing_same_day_end.sql", "change_customer_billing_terms.sql", "time_entries.sql"]) {
      await sql(database, await readFile(new URL(`tests/database/${file}`, root), "utf8"));
      t.diagnostic(`${file}: passed`);
    }

    const seed = JSON.parse(await sql(database, `with customer as (
      insert into public.customers(company_name) values ('Disposable time capture race') returning id
    ) insert into public.customer_billing_agreements
      (customer_id,effective_date,monthly_fee,included_hours,overage_hourly_rate,billing_cycle_day)
      select id,(clock_timestamp() at time zone 'America/New_York')::date-10,500,1,125,15 from customer
      returning json_build_object('customer',customer_id,'agreement',id);`));
    assert.match(seed.customer, /^[0-9a-f-]{36}$/);
    assert.match(seed.agreement, /^[0-9a-f-]{36}$/);
    const first = connection(database);
    sessions.push(first);
    first.child.stdin.write(`begin; set role authenticated;
      set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
      select (public.change_customer_billing_terms('${seed.agreement}',
        (clock_timestamp() at time zone 'America/New_York')::date,600,2,150,20,true,30,false)).id;
      \n\\echo TERMS_CHANGED_UNCOMMITTED\n`);
    await until(() => first.output().includes("TERMS_CHANGED_UNCOMMITTED"), "uncommitted terms change");
    const insertion = `insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate)
      values ('${seed.customer}',(clock_timestamp() at time zone 'America/New_York')::date,'Concurrent capture',18,111)`;
    const second = connection(database);
    sessions.push(second);
    second.child.stdin.end(`set application_name='nexa_time_capture_waiter'; set role authenticated; ${insertion};`);
    await until(async () => (await sql(database, `select exists(select from pg_stat_activity
      where datname=current_database() and application_name='nexa_time_capture_waiter' and wait_event_type='Lock');`)) === "t",
    "time capture waits for agreement lock");
    first.child.stdin.end("commit;\n");
    assert.equal(await first.finished, 0, first.output());
    assert.equal(await second.finished, 3, second.output());
    assert.match(second.output(), /40001: Billing terms changed while recording time/);
    assert.equal(await sql(database, "select count(*) from public.time_entries;"), "0",
      "Failed capture must not leave a time entry with the wrong billing context");
    const retried = JSON.parse(await sql(database, `set role authenticated; ${insertion}
      returning json_build_object('agreement',billing_agreement_id,'rate',hourly_rate,'rounding',rounding_increment_minutes);`));
    assert.notEqual(retried.agreement, seed.agreement);
    assert.equal(retried.rate, 150);
    assert.equal(retried.rounding, 30);
    t.diagnostic("Real concurrent terms change: time capture waits, safely requests retry, then captures the new agreement.");

    const disabling = connection(database);
    sessions.push(disabling);
    assert.match(retried.agreement, /^[0-9a-f-]{36}$/);
    disabling.child.stdin.write(`begin; set role authenticated;
      update public.customer_billing_agreements set is_active=false where id='${retried.agreement}';
      \n\\echo DISABLED_UNCOMMITTED\n`);
    await until(() => disabling.output().includes("DISABLED_UNCOMMITTED"), "uncommitted administrative disable");
    const capturing = connection(database);
    sessions.push(capturing);
    capturing.child.stdin.end(`set application_name='nexa_time_disable_waiter'; set role authenticated; ${insertion};`);
    await until(async () => (await sql(database, `select exists(select from pg_stat_activity
      where datname=current_database() and application_name='nexa_time_disable_waiter' and wait_event_type='Lock');`)) === "t",
    "time capture waits for administrative disable lock");
    disabling.child.stdin.end("commit;\n");
    assert.equal(await disabling.finished, 0, disabling.output());
    assert.equal(await capturing.finished, 3, capturing.output());
    assert.match(capturing.output(), /40001: Billing terms changed while recording time/);
    assert.equal(await sql(database, "select count(*) from public.time_entries;"), "1",
      "Concurrent disable leaves only the earlier historical entry");
    assert.equal(await sql(database, `select billing_agreement_id from public.time_entries;`), retried.agreement,
      "Existing captured agreement reference survives disabling");
    const afterDisable = JSON.parse(await sql(database, `set role authenticated; ${insertion}
      returning json_build_object('agreement',billing_agreement_id,'rate',hourly_rate,'rounding',rounding_increment_minutes);`));
    assert.equal(afterDisable.agreement, null);
    assert.equal(afterDisable.rate, 111);
    assert.equal(afterDisable.rounding, 15);
    t.diagnostic("Real concurrent disable: capture requests retry; retry uses non-retainer terms; historical reference survives.");
  } finally {
    for (const session of sessions) session.child.stdin.end();
    if (created) await sql("postgres", `drop database ${database} with (force);`);
  }
});
