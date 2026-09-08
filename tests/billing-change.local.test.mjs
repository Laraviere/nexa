// Explicit local functional run: node --test tests/billing-change.local.test.mjs
// Builds/serves Next with local-only Supabase settings, reads its rendered forms
// and submits through React's real Server Action encoder over HTTP.
// Uses an authenticated local test account, never service_role.
// Only generated fixtures are removed at the end; no schema or grants change.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";

const exec = promisify(execFile);
const { encodeReply } = createRequire(import.meta.url)("next/dist/compiled/react-server-dom-webpack/client.node");
const project = new URL("../", import.meta.url);
function textAttribute(tag, name) {
  return (tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "")
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function billingForm(html) {
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)]
    .map(([value]) => value).find((value) => value.includes('name="monthly_fee"'));
  assert.ok(markup, "Expected the real billing form");
  const data = new FormData();
  for (const [tag] of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = textAttribute(tag, "name");
    if (!name || (textAttribute(tag, "type") === "radio" && !tag.includes('checked=""'))) continue;
    data.append(name, textAttribute(tag, "value"));
  }
  for (const [select, attributes, contents] of markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const options = [...contents.matchAll(/<option\b[^>]*>/g)].map(([tag]) => tag);
    const selected = options.find((tag) => tag.includes('selected=""')) ?? options[0];
    assert.ok(select && selected);
    data.set(textAttribute(attributes, "name"), textAttribute(selected, "value"));
  }
  assert.ok([...data.keys()].some((key) => key.startsWith("$ACTION_")), "Expected Next server-action form metadata");
  return { data, markup };
}
function includes(html, value) { assert.ok(html.includes(value), `Rendered page missing: ${value}`); }

test("local Next HTTP forms use authenticated cookies and the atomic billing RPC", { timeout: 180000 }, async (t) => {
  const status = JSON.parse((await exec("npx", ["supabase", "status", "-o", "json"], { cwd: project })).stdout);
  const apiUrl = new URL(status.API_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(apiUrl.hostname), "Functional tests require local Supabase");
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  assert.ok(key, "Local publishable/anon key missing");
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: apiUrl.href.replace(/\/$/, ""),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, NEXT_TELEMETRY_DISABLED: "1" };
  await exec("npm", ["run", "build"], { cwd: project, env, maxBuffer: 1024 * 1024 });
  t.diagnostic("Production build passed using local Supabase settings.");

  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn("node", ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
  // Drain startup logs without exposing environment values or auth material.
  server.stdout.resume(); server.stderr.resume();
  const stopped = new Promise((resolve) => server.once("close", resolve));
  const cookies = new Map();
  const client = createServerClient(apiUrl.href, key, { cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => cookies.set(name, value)),
  } });
  const customers = [];
  let userId;
  let phase = "starting local server";
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = (days) => {
    const value = new Date(`${localToday}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  async function request(route, init = {}) {
    return fetch(`${base}${route}`, { signal: AbortSignal.timeout(15000), ...init, redirect: "manual", headers: {
      Cookie: [...cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; "),
      Origin: base, ...init.headers,
    } });
  }
  async function page(route) {
    phase = "loading an authenticated page";
    const response = await request(route);
    assert.equal(response.status, 200, "Authenticated route failed");
    return response.text();
  }
  async function fixture(end_date = null) {
    const created = await client.from("customers").insert({ company_name: "Local change terms functional test" }).select().single();
    assert.equal(created.error, null, "Customer fixture creation failed");
    customers.push(created.data.id);
    const agreement = await client.from("customer_billing_agreements").insert({ customer_id: created.data.id,
      effective_date: date(0), end_date, monthly_fee: 500, included_hours: 1.5, overage_hourly_rate: 125,
      billing_cycle_day: 12, bill_in_advance: false, rounding_increment_minutes: 30, rollover_enabled: true }).select().single();
    assert.equal(agreement.error, null, "Agreement fixture creation failed");
    return agreement.data;
  }
  async function history(customerId) {
    const result = await client.from("customer_billing_agreements").select().eq("customer_id", customerId);
    assert.equal(result.error, null, "History read failed");
    return result.data;
  }
  const route = (row) => `/customers/${row.customer_id}/billing/${row.id}/change`;
  async function submit(row, data, changes, expectRedirect = true) {
    phase = `submitting a form (expecting ${expectRedirect ? "redirect" : "validation error"})`;
    for (const [name, value] of Object.entries(changes)) data.set(name, value);
    const reference = [...data.keys()].find((name) => name.startsWith("$ACTION_REF_"));
    assert.ok(reference, "Missing rendered Server Action reference");
    const actionId = JSON.parse(data.get(`$ACTION_${reference.slice("$ACTION_REF_".length)}:0`)).id;
    assert.equal(typeof actionId, "string");
    const fields = new FormData();
    for (const [name, value] of data) if (!name.startsWith("$ACTION_")) fields.append(name, value);
    const response = await request(route(row), { method: "POST",
      headers: { "Next-Action": actionId, Accept: "text/x-component" },
      body: await encodeReply([row.customer_id, row.id, {}, fields]) });
    // Next 16 fetch actions keep HTTP 200 and carry redirects in this header.
    assert.equal(response.status, 200, "Unexpected server-action HTTP response");
    if (expectRedirect) {
      assert.ok(response.headers.get("x-action-redirect")?.startsWith(`/customers/${row.customer_id};`));
      await response.body?.cancel();
    } else {
      assert.equal(response.headers.has("x-action-redirect"), false);
    }
    return response;
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetch(`${base}/login`)).status === 200; } catch { /* starting */ }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, "Local Next server did not start");
    const registered = await client.auth.signUp({ email: `nexa-change-${randomBytes(8).toString("hex")}@example.test`, password: randomBytes(24).toString("base64url") });
    userId = registered.data.user?.id;
    assert.equal(registered.error, null, "Local test sign-up failed");
    assert.ok(registered.data.session, "Local auth must allow test sign-up without email confirmation");
    assert.ok(cookies.size > 0, "Expected authenticated SSR cookies");
    const rpcProbe = await client.rpc("change_customer_billing_terms", {
      p_predecessor_id: "00000000-0000-4000-8000-000000000000", p_effective_date: date(0),
      p_monthly_fee: 1, p_included_hours: 1, p_overage_hourly_rate: 1, p_billing_cycle_day: 1,
      p_bill_in_advance: true, p_rounding_increment_minutes: 15, p_rollover_enabled: false,
    });
    assert.equal(rpcProbe.error?.code, "P0002", "Local authenticated RPC must be exposed and reject a missing agreement");

    const original = await fixture();
    const detail = `/customers/${original.customer_id}`;
    const setup = billingForm(await page(`${detail}/billing/new`));
    assert.equal(setup.data.get("billing_cycle_day"), "1");
    includes(setup.markup.replace(/<details\b[\s\S]*?<\/details>/g, ""), 'name="billing_cycle_day"');
    includes(await page(detail), `${route(original)}"`);
    const initial = billingForm(await page(route(original)));
    for (const [name, expected] of Object.entries({ monthly_fee: "500", included_hours: "1.5", overage_hourly_rate: "125",
      billing_cycle_day: "12", bill_in_advance: "false", rounding_increment_minutes: "30", rollover_enabled: "true",
      effective_date: date(0), end_mode: "until_cancellation" })) assert.equal(initial.data.get(name), expected);

    const invalid = await submit(original, initial.data, { effective_date: "" }, false);
    const invalidHtml = await invalid.text();
    includes(invalidHtml, "Enter a valid effective date.");
    assert.deepEqual(await history(original.customer_id), [original]);
    for (const billing_cycle_day of ["0", "29"]) {
      const rejectedDay = await submit(original, initial.data, { effective_date: date(0), billing_cycle_day }, false);
      includes(await rejectedDay.text(), "Choose a day from 1 to 28.");
      assert.deepEqual(await history(original.customer_id), [original]);
    }
    await submit(original, initial.data, { effective_date: date(0), billing_cycle_day: "15", monthly_fee: "650.25", included_hours: "2.75", overage_hourly_rate: "150.5" });
    const after = await history(original.customer_id);
    const ended = after.find((row) => row.id === original.id);
    const current = after.find((row) => row.id !== original.id);
    assert.equal(after.length, 2);
    assert.deepEqual({ ...ended, end_date: original.end_date, updated_at: original.updated_at }, original);
    assert.equal(ended.end_date, date(0));
    assert.equal(current.effective_date, date(0));
    assert.equal(current.end_date, null);
    assert.equal(current.monthly_fee, 650.25);
    assert.equal(current.included_hours, 2.75);
    assert.equal(current.overage_hourly_rate, 150.5);
    assert.equal(ended.billing_cycle_day, 12);
    assert.equal(current.billing_cycle_day, 15);
    let html = await page(detail);
    for (const text of ["$500.00", "$650.25", "$150.50", "2.75 hours / month", "Ended", "Current", "Until cancellation"]) includes(html, text);
    includes(html, "Monthly on the 12th"); includes(html, "Monthly on the 15th");
    assert.ok(!html.includes(`${route(original)}"`));
    assert.ok(!(await page(route(original))).includes('name="monthly_fee"'));
    t.diagnostic("Real authenticated same-day form submission preserved historical pricing and displayed the new current terms.");
    t.diagnostic("Billing day defaults to 1; invalid days are rejected; the atomic change preserves historical day 12 and assigns day 15 to the new agreement.");

    const futureForm = billingForm(await page(route(current)));
    await submit(current, futureForm.data, { effective_date: date(10), monthly_fee: "800" });
    const futureRows = await history(original.customer_id);
    const future = futureRows.find((row) => row.monthly_fee === 800);
    assert.equal(future.effective_date, date(10));
    assert.equal(future.end_date, null);
    assert.equal(futureRows.find((row) => row.id === current.id).end_date, date(10));
    html = await page(detail);
    includes(html, "Future"); includes(html, "$800.00"); includes(html, `${route(future)}"`);
    includes(html, "$650.25");
    assert.ok(!html.includes(`${route(current)}"`));
    const stale = await submit(current, futureForm.data, { effective_date: date(5), monthly_fee: "900" }, false);
    const staleHtml = await stale.text();
    includes(staleHtml, "preserves or shortens");
    assert.ok(!staleHtml.includes("55000") && !staleHtml.includes("Agreement already has a later agreement"));
    assert.deepEqual(await history(original.customer_id), futureRows);
    t.diagnostic("Future terms display correctly; stale duration selection is rejected without changing history.");

    const scheduled = await fixture(date(30));
    const scheduledForm = billingForm(await page(route(scheduled)));
    assert.equal(scheduledForm.data.get("end_mode"), "preserve_end");
    assert.ok(!scheduledForm.markup.includes('value="until_cancellation"'));
    await submit(scheduled, scheduledForm.data, { effective_date: date(5), monthly_fee: "950" });
    const carried = (await history(scheduled.customer_id)).find((row) => row.id !== scheduled.id);
    assert.equal(carried.end_date, date(30));
    // A stale scheduled form still passes field validation, so the locked RPC
    // itself rejects its already-replaced agreement with a friendly message.
    const scheduledHistory = await history(scheduled.customer_id);
    const rpcConflict = await submit(scheduled, scheduledForm.data, { effective_date: date(2), monthly_fee: "999" }, false);
    const conflictReply = await rpcConflict.text();
    includes(conflictReply, "This agreement can no longer be changed.");
    assert.ok(!conflictReply.includes("55000") && !conflictReply.includes("Agreement already has a later agreement"));
    assert.deepEqual(await history(scheduled.customer_id), scheduledHistory);
    const shortenedForm = billingForm(await page(route(carried)));
    const extension = await submit(carried, shortenedForm.data,
      { effective_date: date(10), end_mode: "specific_date", end_date: date(31) }, false);
    includes(await extension.text(), "The end date cannot be later than the existing scheduled end.");
    await submit(carried, shortenedForm.data, { effective_date: date(10), end_mode: "specific_date", end_date: date(20), monthly_fee: "1000" });
    const shortened = (await history(scheduled.customer_id)).find((row) => row.monthly_fee === 1000);
    assert.equal(shortened.end_date, date(20));
    assert.equal(shortened.effective_date, date(10));
    t.diagnostic("Scheduled end carried forward; shortening succeeded, extending was rejected, and a stale RPC error was shown safely.");

    const signedOut = await fetch(`${base}${route(shortened)}`, { redirect: "manual" });
    assert.equal(signedOut.status, 307);
    assert.equal(signedOut.headers.get("location"), "/login");
    phase = "checking cross-customer route isolation";
    const crossCustomer = await request(`/customers/${original.customer_id}/billing/${shortened.id}/change`);
    // Next's streamed not-found UI can carry HTTP 200 after headers were sent.
    assert.ok([200, 404].includes(crossCustomer.status));
    const notFound = await crossCustomer.text();
    includes(notFound, "Customer not found");
    assert.ok(!notFound.includes('name="monthly_fee"'));
  } catch (error) {
    t.diagnostic(`Failure while ${phase}.`);
    throw error;
  } finally {
    client.auth.stopAutoRefresh();
    server.kill("SIGTERM");
    const forceStop = setTimeout(() => server.kill("SIGKILL"), 2000);
    await stopped;
    clearTimeout(forceStop);
    const ids = [...customers, ...(userId ? [userId] : [])];
    assert.ok(ids.every((id) => /^[0-9a-f-]{36}$/.test(id)), "Invalid cleanup fixture ID");
    const cleanup = spawn("docker", ["exec", "-i", "supabase_db_nexa", "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "ignore", "pipe"] });
    cleanup.stderr.resume();
    const cleaned = new Promise((resolve) => cleanup.on("close", resolve));
    const customerList = customers.map((id) => `'${id}'`).join(",");
    cleanup.stdin.end(`begin; ${customers.length ? `delete from public.customer_billing_agreements where customer_id in (${customerList});
      delete from public.customers where id in (${customerList});` : ""}
      ${userId ? `delete from auth.users where id = '${userId}';` : ""} commit;`);
    assert.equal(await cleaned, 0, "Local fixture cleanup failed");
  }
});
