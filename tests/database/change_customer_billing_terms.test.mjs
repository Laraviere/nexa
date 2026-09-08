// Local Docker only. Replays migrations in a disposable database, then uses two
// real PostgreSQL sessions to prove row-lock contention (not a mocked race).
// node --test tests/database/change_customer_billing_terms.test.mjs
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const exec = promisify(execFile);
const container = "supabase_db_nexa";
const root = new URL("../../", import.meta.url);
const identity = `set role authenticated;
  set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';`;

function session(database) {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres",
    "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"],
  { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
  return { child, done, output: () => output };
}

async function sql(database, input) {
  const connection = session(database);
  connection.child.stdin.end(input);
  const result = await connection.done;
  assert.equal(result.code, 0, result.output);
  return result.output.trim();
}

async function until(check, description) {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `Timed out: ${description}`);
    await delay(50);
  }
}

async function tableSchema(database) {
  const { stdout } = await exec("docker", ["exec", container, "pg_dump", "-U", "postgres",
    "-d", database, "--schema-only", "--table=public.customers",
    "--table=public.customer_billing_agreements"]);
  // pg_dump emits a fresh psql safety token on each invocation.
  return stdout.split("\n").filter((line) => !/^\\(?:un)?restrict\b/.test(line)).join("\n");
}

test("atomic billing terms: fresh migration replay, regressions, unchanged tables and real race", { timeout: 60000 }, async () => {
  const database = `nexa_rpc_test_${randomBytes(6).toString("hex")}`;
  const connections = [];
  let created = false;
  try {
    await sql("postgres", `create database ${database};`);
    created = true;
    // Reuse the real local Supabase auth helper without copying any auth data.
    const authUid = await sql("postgres", "select pg_get_functiondef('auth.uid()'::regprocedure);");
    await sql(database, `create schema extensions; create schema auth;
      grant usage on schema public, auth to authenticated;
      alter database ${database} set search_path = public, extensions;
      ${authUid}`);

    const migrationDirectory = new URL("supabase/migrations/", root);
    const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
    const target = "20260908120000_change_customer_billing_terms.sql";
    const targetIndex = files.indexOf(target);
    assert.ok(targetIndex >= 0, "RPC migration is missing");
    for (const file of files.slice(0, targetIndex)) {
      await sql(database, await readFile(new URL(file, migrationDirectory), "utf8"));
    }
    const before = await tableSchema(database);
    await sql(database, await readFile(new URL(target, migrationDirectory), "utf8"));
    assert.equal(await tableSchema(database), before,
      "RPC migration changed existing columns, constraints, indexes, policies, triggers or table grants");

    for (const file of ["customers_privileges.sql", "customer_billing_agreements.sql",
      "billing_same_day_end.sql", "change_customer_billing_terms.sql"]) {
      await sql(database, await readFile(new URL(`tests/database/${file}`, root), "utf8"));
    }

    const predecessor = await sql(database, `with customer as (
      insert into public.customers(company_name) values ('Disposable RPC race fixture') returning id
    ) insert into public.customer_billing_agreements
      (customer_id, effective_date, monthly_fee, included_hours, overage_hourly_rate)
      select id, (clock_timestamp() at time zone 'America/New_York')::date - 30, 500, 1, 125
      from customer returning id;`);
    assert.match(predecessor, /^[0-9a-f-]{36}$/);
    const call = (days, fee) => `select (public.change_customer_billing_terms(
      '${predecessor}', (clock_timestamp() at time zone 'America/New_York')::date + ${days},
      ${fee}, 2, 150, 1, true, 15, false)).id;`;

    const first = session(database);
    connections.push(first);
    first.child.stdin.write(`begin; ${identity} ${call(10, 650)}\n\\echo FIRST_FINISHED_RPC\n`);
    await until(() => first.output().includes("FIRST_FINISHED_RPC"), "first RPC completing while retaining its transaction lock");

    const second = session(database);
    connections.push(second);
    second.child.stdin.end(`set application_name = 'nexa_rpc_second'; ${identity} ${call(5, 700)}`);
    await until(async () => (await sql(database, `select exists (
      select from pg_stat_activity where datname = current_database()
        and application_name = 'nexa_rpc_second' and wait_event_type = 'Lock'
    );`)) === "t", "second RPC blocking on the first RPC's row lock");

    first.child.stdin.end("commit;\n");
    const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
    assert.equal(firstResult.code, 0, firstResult.output);
    assert.equal(secondResult.code, 3, secondResult.output);
    assert.match(secondResult.output, /55000: Agreement already has a later agreement/);
    const result = JSON.parse(await sql(database, `select json_build_object(
      'count', count(*),
      'old_terms_intact', bool_or(id = '${predecessor}' and monthly_fee = 500
        and included_hours = 1 and overage_hourly_rate = 125
        and end_date = (clock_timestamp() at time zone 'America/New_York')::date + 10),
      'successor_correct', bool_or(id <> '${predecessor}' and monthly_fee = 650
        and end_date is null
        and effective_date = (clock_timestamp() at time zone 'America/New_York')::date + 10)
      ) from public.customer_billing_agreements;`));
    assert.deepEqual(result, { count: 2, old_terms_intact: true, successor_correct: true });
  } finally {
    for (const connection of connections) connection.child.stdin.end();
    if (created) {
      // Drop only this randomly named disposable database, including sessions
      // left behind by a failed assertion. Never reset the development database.
      await sql("postgres", `drop database ${database} with (force);`);
    }
  }
});
