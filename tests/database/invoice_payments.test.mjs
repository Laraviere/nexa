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
test("Payments foundation: fresh replay, settings, ledger and existing regressions", { timeout: 60000 }, async (t) => {
  const database = `nexa_payments_test_${randomBytes(6).toString("hex")}`;
  let created = false;
  try {
    await sql("postgres", `create database ${database};`); created = true;
    const authUid = await sql("postgres", "select pg_get_functiondef('auth.uid()'::regprocedure);");
    await sql(database, `create schema extensions; create schema auth;
      grant usage on schema public, auth to authenticated;
      alter database ${database} set search_path=public,extensions; ${authUid}`);
    const directory = new URL("supabase/migrations/", root);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    const target = "20260917120000_create_invoice_payments.sql";
    const index = files.indexOf(target); assert.ok(index >= 0);
    for (const file of files.slice(0,index)) await sql(database, await readFile(new URL(file,directory), "utf8"));
    await sql(database, await readFile(new URL(target,directory), "utf8"));
    const initialSequence=await sql(database,"select last_value from public.invoices_invoice_number_seq;");
    const correction = await readFile(new URL("20260918120000_require_payment_eligible_invoice.sql",directory), "utf8");
    // Test the upgrade with a real Draft payment created under the old rule.
    await sql(database, `begin;
      create temp table prior_payment as select null::jsonb as ledger, null::jsonb as settings, null::text as acl;
      set local role authenticated;
      do $$declare c uuid;v uuid;begin
        insert into public.customers(company_name) values('Pre-upgrade Draft payment') returning id into c;
        select invoice_id into v from public.create_manual_invoice(c,'2026-09-10','[{"description":"Historical","quantity":1,"unit":"flat","unit_rate":100}]',gen_random_uuid());
        perform public.record_invoice_payment(v,25,'2026-09-10','cash',gen_random_uuid());
      end $$;
      reset role;
      update prior_payment set ledger=(select to_jsonb(p) from public.invoice_payments p),settings=(select to_jsonb(s) from public.payment_settings s),
        acl=(select proacl::text from pg_proc where oid='public.guard_invoice_payment()'::regprocedure);
      ${correction}
      do $$declare p public.invoice_payments%rowtype;r record;begin
        select * into p from public.invoice_payments;
        if to_jsonb(p) is distinct from (select ledger from prior_payment) then raise exception 'Upgrade changed historical ledger';end if;
        if (select to_jsonb(s) from public.payment_settings s) is distinct from (select settings from prior_payment) then raise exception 'Upgrade changed settings';end if;
        if (select proacl::text from pg_proc where oid='public.guard_invoice_payment()'::regprocedure) is distinct from (select acl from prior_payment) then raise exception 'Upgrade changed guard ACL';end if;
        set local role authenticated;
        select * into r from public.invoice_payment_summary where invoice_id=p.invoice_id;
        if r.invoice_status<>'draft' or r.amount_paid<>25 or r.balance_due<>75 or r.payment_count<>1 then raise exception 'Historical Draft summary changed';end if;
        perform public.record_invoice_payment(p.invoice_id,p.amount,p.payment_date,p.payment_method,p.request_id);
        begin
          perform public.record_invoice_payment(p.invoice_id,1,p.payment_date,'cash',gen_random_uuid());
          raise exception 'Unexpected Draft payment';
        exception when sqlstate 'P1001' then null;end;
        update public.invoices set status='ready' where id=p.invoice_id;
        perform public.record_invoice_payment(p.invoice_id,75,p.payment_date,'cash',gen_random_uuid());
        if not exists(select from public.invoice_payment_summary where invoice_id=p.invoice_id and amount_paid=100 and balance_due=0 and payment_count=2) then raise exception 'Historical remaining balance payment failed';end if;
      end $$;
      rollback;`);
    await sql(database, correction);
    t.diagnostic(`Fresh replay of ${index + 2} migrations passed, including upgrade with unchanged historical Draft payment/settings/ACL and exact-key retry.`);
    await sql(database, await readFile(new URL("tests/database/payment_eligibility.sql",root), "utf8"));
    t.diagnostic("Payment eligibility: RPC/direct INSERT, historical Draft summary/retries/corrections, Ready/Sent edits and stable rejection code passed.");
    // Rollback does not rewind sequences; restore the empty disposable database
    // baseline expected by the original first-invoice regression.
    await sql(database,`select setval('public.invoices_invoice_number_seq',${initialSequence},false);`);
    for (const file of ["customers_privileges.sql", "customer_billing_agreements.sql", "billing_same_day_end.sql",
      "change_customer_billing_terms.sql", "time_entries.sql", "retainer_usage.sql", "running_timers.sql", "invoices.sql", "create_manual_invoice.sql", "generate_customer_invoice.sql", "invoice_composer.sql", "edit_invoice.sql", "invoice_ready.sql", "invoice_payments.sql"]) {
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

    const editId=await sql(database,`select invoice_id from public.create_manual_invoice('${composedCustomer}','2025-09-01','[{"description":"Before","quantity":1,"unit":"each","unit_rate":5}]','${randomBytes(16).toString("hex")}');`);
    const editPreview=JSON.parse(await sql(database,`select row_to_json(p) from public.preview_invoice_edit('${editId}','2025-09-01') p;`));
    const editKey=randomBytes(16).toString("hex");
    const editCommand=`set role authenticated;select invoice_id from public.update_composed_invoice('${editId}','2025-09-02','2025-09-01','${editKey}','${editPreview.revision}','{}','[{"description":"After","quantity":2,"unit":"each","unit_rate":8}]');`;
    const editSame=await Promise.all(Array.from({length:4},()=>sql(database,editCommand)));assert.equal(new Set(editSame).size,1);
    assert.equal(await sql(database,`select count(*) from public.invoice_edit_requests where invoice_id='${editId}';`),'1');
    const editFresh=JSON.parse(await sql(database,`select row_to_json(p) from public.preview_invoice_edit('${editId}','2025-09-01') p;`));
    await sql(database,`create function public.test_edit_race(k uuid) returns text language plpgsql as $$begin
      perform public.update_composed_invoice('${editId}','2025-09-03','2025-09-01',k,'${editFresh.revision}','{}','[{"description":"Race","quantity":3,"unit":"each","unit_rate":8}]');return 'saved';exception when sqlstate 'P0001' then return 'stale';end $$;grant execute on function public.test_edit_race(uuid) to authenticated;`);
    const editRace=await Promise.all(Array.from({length:3},()=>sql(database,`set role authenticated;select public.test_edit_race('${randomBytes(16).toString("hex")}');`)));
    assert.equal(editRace.filter(x=>x==='saved').length,1);assert.equal(editRace.filter(x=>x==='stale').length,2);
    t.diagnostic('Concurrent edits: one same-key journal entry; one winner for distinct-key stale revisions.');
    // Real independent sessions exercise serialization at the authoritative boundary.
    const payCustomer=await sql(database,"insert into public.customers(company_name) values ('Payment races') returning id;");
    async function makeInvoice(){const id=await sql(database,`select invoice_id from public.create_manual_invoice('${payCustomer}','2026-09-10','[{"description":"Payment race","quantity":1,"unit":"flat","unit_rate":100}]','${randomBytes(16).toString("hex")}');`);await sql(database,`update public.invoices set status='ready' where id='${id}';`);return id;}
    await sql(database,`create function public.test_payment(v uuid,k uuid,method text default 'cash') returns text language plpgsql security invoker as $$declare p uuid;begin
      select payment_id into p from public.record_invoice_payment(v,100,'2026-09-10',method,k);return 'paid:'||p::text;
      exception when sqlstate '22023' then return 'rejected';when serialization_failure then return 'retry';end $$;
      grant execute on function public.test_payment(uuid,uuid,text) to authenticated;`);
    let payInvoice=await makeInvoice();const payKey=randomBytes(16).toString('hex');
    const samePayments=await Promise.all(Array.from({length:6},()=>sql(database,`set role authenticated;select public.test_payment('${payInvoice}','${payKey}');`)));
    assert.equal(new Set(samePayments).size,1);assert.ok(samePayments[0].startsWith('paid:'));
    assert.equal(await sql(database,`select amount_paid||':'||payment_count from public.invoice_payment_summary where invoice_id='${payInvoice}';`),'100:1');
    payInvoice=await makeInvoice();
    const competing=await Promise.all(Array.from({length:5},()=>sql(database,`set role authenticated;select public.test_payment('${payInvoice}','${randomBytes(16).toString('hex')}');`)));
    assert.equal(competing.filter(x=>x.startsWith('paid:')).length,1);assert.equal(competing.filter(x=>x==='rejected').length,4);
    assert.equal(await sql(database,`select amount_paid||':'||balance_due from public.invoice_payment_summary where invoice_id='${payInvoice}';`),'100:0.00');
    async function waitSleeping(name){for(let i=0;i<150;i++){if(await sql(database,`select exists(select from pg_stat_activity where application_name='${name}' and wait_event='PgSleep');`)==='t')return;await new Promise(r=>setTimeout(r,10));}assert.fail('Race session did not reach its lock barrier');}
    const suffix=randomBytes(5).toString('hex');
    payInvoice=await makeInvoice();
    const draftFirst=sql(database,`set application_name='draft_${suffix}';begin;set local role authenticated;update public.invoices set status='draft' where id='${payInvoice}';select pg_sleep(0.8);commit;`);
    await waitSleeping(`draft_${suffix}`);
    const staleStatus=assert.rejects(()=>sql(database,`set role authenticated;select public.record_invoice_payment('${payInvoice}',1,'2026-09-10','cash','${randomBytes(16).toString('hex')}');`),/P1001/);
    await draftFirst;await staleStatus;
    assert.equal(await sql(database,`select payment_count from public.invoice_payment_summary where invoice_id='${payInvoice}';`),'0');
    payInvoice=await makeInvoice();
    const statusPaymentKey=randomBytes(16).toString('hex');
    const paymentBeforeDraft=sql(database,`set application_name='before_draft_${suffix}';begin;set local role authenticated;select public.test_payment('${payInvoice}','${statusPaymentKey}');select pg_sleep(0.8);commit;`);
    await waitSleeping(`before_draft_${suffix}`);
    const moveDraft=sql(database,`set role authenticated;update public.invoices set status='draft' where id='${payInvoice}';`);
    assert.ok((await paymentBeforeDraft).startsWith('paid:'));await moveDraft;
    assert.equal(await sql(database,`select invoice_status||':'||amount_paid||':'||payment_count from public.invoice_payment_summary where invoice_id='${payInvoice}';`),'draft:100:1');
    assert.ok((await sql(database,`set role authenticated;select public.test_payment('${payInvoice}','${statusPaymentKey}');`)).startsWith('paid:'));
    t.diagnostic('Workflow/payment races: Draft-first rejects waiting insert; payment-first preserves ledger on later Draft transition and remains idempotent.');
    payInvoice=await makeInvoice();
    const disabled=sql(database,`set application_name='disable_${suffix}';begin;set local role authenticated;select public.update_payment_settings(true,true,false);select pg_sleep(0.8);commit;`);
    await waitSleeping(`disable_${suffix}`);
    const blockedPayment=sql(database,`set role authenticated;select public.test_payment('${payInvoice}','${randomBytes(16).toString('hex')}','card');`);
    await disabled;assert.equal(await blockedPayment,'rejected');
    await sql(database,'select public.update_payment_settings(true,true,true);');
    const firstPayment=sql(database,`set application_name='pay_${suffix}';begin;set local role authenticated;select public.test_payment('${payInvoice}','${randomBytes(16).toString('hex')}','card');select pg_sleep(0.8);commit;`);
    await waitSleeping(`pay_${suffix}`);
    const followingDisable=sql(database,'set role authenticated;select public.update_payment_settings(true,true,false);');
    assert.ok((await firstPayment).startsWith('paid:'));await followingDisable;
    assert.equal(await sql(database,`select amount_paid from public.invoice_payment_summary where invoice_id='${payInvoice}';`),'100');
    payInvoice=await makeInvoice();
    const stale=sql(database,`set application_name='stale_${suffix}';begin isolation level repeatable read;set local role authenticated;select count(*) from public.invoice_payments;select pg_sleep(0.8);select public.test_payment('${payInvoice}','${randomBytes(16).toString('hex')}');commit;`);
    await waitSleeping(`stale_${suffix}`);
    assert.ok((await sql(database,`set role authenticated;select public.test_payment('${payInvoice}','${randomBytes(16).toString('hex')}');`)).startsWith('paid:'));
    assert.ok((await stale).endsWith('retry'),'Stale repeatable-read balance forces retry');
    // An edit holding the parent lock wins first: the later 100 payment must
    // see its new 50 total, rather than accepting the old 100 balance.
    payInvoice=await makeInvoice();
    const editFirst=sql(database,`set application_name='edit_${suffix}';begin;set local role authenticated;update public.invoice_items set unit_rate=50 where invoice_id='${payInvoice}';select pg_sleep(0.8);commit;`);
    await waitSleeping(`edit_${suffix}`);
    const afterEdit=sql(database,`set role authenticated;select public.test_payment('${payInvoice}','${randomBytes(16).toString('hex')}');`);
    await editFirst;assert.equal(await afterEdit,'rejected');
    // Payment wins first: a later invoice reduction below it fails at COMMIT.
    payInvoice=await makeInvoice();
    const paymentFirst=sql(database,`set application_name='paid_edit_${suffix}';begin;set local role authenticated;select public.test_payment('${payInvoice}','${randomBytes(16).toString('hex')}');select pg_sleep(0.8);commit;`);
    await waitSleeping(`paid_edit_${suffix}`);
    const belowPaid=assert.rejects(()=>sql(database,`set role authenticated;update public.invoice_items set unit_rate=50 where invoice_id='${payInvoice}';`),/Invoice total cannot be less/);
    await paymentFirst;await belowPaid;
    assert.equal(await sql(database,`select invoice_total||':'||amount_paid||':'||balance_due from public.invoice_payment_summary where invoice_id='${payInvoice}';`),'100.00:100:0.00');
    t.diagnostic('Payment races: duplicate retry once, one winner for competing balances, settings disable in both orders, repeatable-read retry, invoice edit/payment serialization in both orders.');
  } finally {
    if(created) await sql("postgres",`drop database ${database} with (force);`);
  }
});
