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
test("invoice composer: fresh replay, preview, selected sources, atomicity and concurrency", { timeout: 60000 }, async (t) => {
  const database = `nexa_composer_test_${randomBytes(6).toString("hex")}`;
  let created = false;
  try {
    await sql("postgres", `create database ${database};`); created = true;
    const authUid = await sql("postgres", "select pg_get_functiondef('auth.uid()'::regprocedure);");
    await sql(database, `create schema extensions; create schema auth;
      grant usage on schema public, auth to authenticated;
      alter database ${database} set search_path=public,extensions; ${authUid}`);
    const directory = new URL("supabase/migrations/", root);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    const target = "20260914120000_invoice_composer.sql";
    const index = files.indexOf(target); assert.ok(index >= 0);
    for (const file of files.slice(0,index)) await sql(database, await readFile(new URL(file,directory), "utf8"));
    await sql(database, await readFile(new URL(target,directory), "utf8"));
    t.diagnostic(`Fresh replay of ${index + 1} migrations passed; invoice foundation applied.`);
    for (const file of ["customers_privileges.sql", "customer_billing_agreements.sql", "billing_same_day_end.sql",
      "change_customer_billing_terms.sql", "time_entries.sql", "retainer_usage.sql", "running_timers.sql", "invoices.sql", "create_manual_invoice.sql", "generate_customer_invoice.sql", "invoice_composer.sql"]) {
      const output = await sql(database, await readFile(new URL(`tests/database/${file}`,root), "utf8"));
      t.diagnostic(`${file}: passed`);
      if (file === "retainer_usage.sql") {
        for (const line of output.split("\n").filter((line) => line.includes("PASS:"))) t.diagnostic(line.slice(line.indexOf("PASS:")));
      }
    }
    assert.equal(await sql(database, "select (select count(*) from public.customers)+(select count(*) from public.time_entries);"), "0", "Regression fixtures rolled back");
    const customer=await sql(database,"insert into public.customers(company_name) values ('Generation concurrency') returning id;");
    await sql(database,`insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values ('${customer}','2025-08-01','Concurrent source',18,120);`);
    const key=randomBytes(16).toString("hex");
    const command=`set role authenticated; select outcome || ':' || invoice_id::text from public.generate_customer_invoice('${customer}','2025-09-01','${key}','2025-09-01');`;
    const identical=await Promise.all(Array.from({length:6},()=>sql(database,command)));
    assert.equal(new Set(identical).size,1,"Same-key concurrency returns one invoice");
    const seq=await sql(database,"select last_value from public.invoices_invoice_number_seq;");
    await sql(database,command);
    assert.equal(await sql(database,"select last_value from public.invoices_invoice_number_seq;"),seq,"Retry uses no number");
    await sql(database,`insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values ('${customer}','2025-08-02','Next source',30,120);`);
    const distinct=await Promise.all(Array.from({length:4},()=>sql(database,`set role authenticated; select outcome from public.generate_customer_invoice('${customer}','2025-09-01','${randomBytes(16).toString("hex")}','2025-09-01');`)));
    assert.equal(distinct.filter(x=>x==='created').length,1,"Distinct-key generation serializes sources");
    assert.equal(distinct.filter(x=>x==='nothing_to_invoice').length,3);
    assert.equal(await sql(database,`select sum(allocated_minutes) from public.invoice_time_allocations x join public.time_entries t on t.id=x.time_entry_id where t.customer_id='${customer}' and x.released_at is null;`),'60');
    await sql(database,`insert into public.customer_billing_agreements(customer_id,monthly_fee,included_hours,overage_hourly_rate,effective_date,end_date)
      values ('${customer}',500,1,125,'2025-08-01',null);
      insert into public.time_entries(customer_id,work_date,description,actual_minutes) values ('${customer}','2025-08-02','Retainer concurrent source',90);`);
    const retainerRace=await Promise.all(Array.from({length:3},()=>sql(database,`set role authenticated;
      select outcome from public.generate_customer_invoice('${customer}','2025-09-01','${randomBytes(16).toString("hex")}','2025-09-01');`)));
    assert.equal(retainerRace.filter(x=>x==='created').length,1,"Concurrent retainer generation has one winner");
    assert.equal(retainerRace.filter(x=>x==='nothing_to_invoice').length,2);
    assert.equal(await sql(database,`select count(*) from public.invoice_items i join public.invoices v on v.id=i.invoice_id
      where v.customer_id='${customer}' and i.source_type in ('retainer_fee','retainer_overage') and i.released_at is null;`),'2');
    t.diagnostic("Concurrent same-key and distinct-key generation: one invoice per eligible source set, exact unique claims, retry consumes no number.");

    const composedCustomer=await sql(database,"insert into public.customers(company_name) values ('Composer races') returning id;");
    await sql(database,`insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values ('${composedCustomer}','2025-08-01','Composer source',30,120);`);
    const beforePreview=await sql(database,"select last_value from public.invoices_invoice_number_seq;");
    const preview=JSON.parse(await sql(database,`begin read only;set local role authenticated;select row_to_json(p) from public.preview_customer_invoice('${composedCustomer}','2025-09-01') p;commit;`));
    assert.equal(await sql(database,"select last_value from public.invoices_invoice_number_seq;"),beforePreview,"Read-only preview does not consume a number");
    const composerKey=randomBytes(16).toString("hex");
    const composedCommand=`set role authenticated;select invoice_id from public.create_composed_invoice('${composedCustomer}','2025-09-01','2025-09-01','${composerKey}','${preview.revision}',ARRAY['${preview.candidates[0].candidate_id}'],'[]');`;
    const same=await Promise.all(Array.from({length:6},()=>sql(database,composedCommand)));
    assert.equal(new Set(same).size,1,"Concurrent composer retries return one invoice");
    const composerSeq=await sql(database,"select last_value from public.invoices_invoice_number_seq;");await sql(database,composedCommand);
    assert.equal(await sql(database,"select last_value from public.invoices_invoice_number_seq;"),composerSeq,"Composer retry consumes no number");
    await sql(database,`insert into public.time_entries(customer_id,work_date,description,actual_minutes,hourly_rate) values ('${composedCustomer}','2025-08-02','Competing source',30,120);`);
    const racePreview=JSON.parse(await sql(database,`select row_to_json(p) from public.preview_customer_invoice('${composedCustomer}','2025-09-01') p;`));
    await sql(database,`create function public.test_composer_race(k uuid) returns text language plpgsql security invoker as $$ begin
      perform public.create_composed_invoice('${composedCustomer}','2025-09-01','2025-09-01',k,'${racePreview.revision}',ARRAY['${racePreview.candidates[0].candidate_id}'],'[]');return 'created';
      exception when sqlstate 'P0001' then return 'stale';end $$;grant execute on function public.test_composer_race(uuid) to authenticated;`);
    const races=await Promise.all(Array.from({length:4},()=>sql(database,`set role authenticated;select public.test_composer_race('${randomBytes(16).toString("hex")}');`)));
    assert.equal(races.filter(x=>x==='created').length,1);assert.equal(races.filter(x=>x==='stale').length,3);
    assert.equal(await sql(database,`select sum(x.allocated_minutes) from public.invoice_time_allocations x join public.time_entries t on t.id=x.time_entry_id where t.customer_id='${composedCustomer}' and x.released_at is null;`),'60');
    t.diagnostic("Read-only preview transaction; composer same-key concurrency/retry number stability; distinct-key competing claims produce one winner and stale rejection.");
  } finally {
    if(created) await sql("postgres",`drop database ${database} with (force);`);
  }
});
