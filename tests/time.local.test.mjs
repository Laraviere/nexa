// Local Docker Supabase + real production Next HTTP Server Actions.
// Temporary synthetic fixtures only; never alters schema/policies/grants.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
const exec = promisify(execFile);
const { encodeReply } = createRequire(import.meta.url)("next/dist/compiled/react-server-dom-webpack/client.node");
const root = new URL("../", import.meta.url);

test("manual time: authenticated real forms, database snapshots, stored rounding and recent entries", { timeout: 180000 }, async (t) => {
  const status = JSON.parse((await exec("npx", ["supabase", "status", "-o", "json"], { cwd: root })).stdout);
  const api = new URL(status.API_URL);
  assert.ok(["localhost", "127.0.0.1"].includes(api.hostname));
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  await exec("npm", ["run", "build"], { cwd: root, env: { ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: api.href.replace(/\/$/, ""), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, NEXT_TELEMETRY_DISABLED: "1" }, maxBuffer: 1024 * 1024 });
  t.diagnostic("npm run build passed with local Supabase settings.");
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn("node", ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: api.href.replace(/\/$/, ""), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.resume(); server.stderr.resume();
  const stopped = new Promise((resolve) => server.once("close", resolve));
  const cookies = new Map();
  const client = createServerClient(api.href, key, { cookies: { getAll: () => [...cookies].map(([name,value]) => ({ name,value })), setAll: (items) => items.forEach(({name,value}) => cookies.set(name,value)) } });
  const customers = []; let userId;
  async function request(route, init = {}, auth = true) {
    return fetch(`${base}${route}`, { signal: AbortSignal.timeout(15000), ...init, redirect: "manual", headers: { Origin: base,
      ...(auth ? { Cookie: [...cookies].map(([name,value]) => `${name}=${encodeURIComponent(value)}`).join("; ") } : {}), ...init.headers } });
  }
  async function page(route) { const result = await request(route); assert.equal(result.status, 200); return result.text(); }
  async function customer(name) {
    const result = await client.from("customers").insert({ company_name: name }).select().single();
    assert.equal(result.error, null, "Customer fixture failed"); customers.push(result.data.id); return result.data.id;
  }
  async function agreement(customer_id, extra) {
    const result = await client.from("customer_billing_agreements").insert({ customer_id, monthly_fee: 500, included_hours: 1, overage_hourly_rate: 125, billing_cycle_day: 15, ...extra }).select().single();
    assert.equal(result.error, null, "Agreement fixture failed"); return result.data;
  }
  async function entries(customerId) {
    const result = await client.from("time_entries").select("*").eq("customer_id", customerId).order("created_at");
    assert.equal(result.error, null, "Time fixture read failed"); return result.data;
  }
  async function context(customerId, workDate) {
    const result = await request(`/time/context?${new URLSearchParams({ customer_id: customerId, work_date: workDate })}`);
    assert.equal(result.status, 200); assert.match(result.headers.get("cache-control"), /no-store/); return result.json();
  }
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/login`)).status === 200) break; } catch { /* server starting */ }
      await delay(100);
    }
    for (const route of ["/time", "/time/new", "/time/context?customer_id=invalid&work_date=2026-09-08"]) {
      const response = await request(route, {}, false);
      const html = await response.text();
      assert.ok(response.headers.get("location")?.includes("/login") || html.includes('NEXT_REDIRECT;replace;/login;'), `Auth required: ${route}`);
      assert.ok(!html.includes('aria-label="Recent time entries"'));
    }
    const registration = await client.auth.signUp({ email: `nexa-time-${randomBytes(8).toString("hex")}@example.test`, password: randomBytes(24).toString("base64url") });
    userId = registration.data.user?.id;
    assert.equal(registration.error, null, "Test sign-up failed"); assert.ok(registration.data.session);
    const retainer = await customer("Local manual retainer work");
    const hourly = await customer("Local manual hourly work");
    const old = await agreement(retainer, { effective_date: "2026-08-15", end_date: "2026-09-08" });
    const current = await agreement(retainer, { effective_date: "2026-09-08", included_hours: 2, overage_hourly_rate: 150, rounding_increment_minutes: 30 });
    assert.equal((await context(retainer, "2026-09-07")).agreement.overage_hourly_rate, 125);
    assert.equal((await context(retainer, "2026-09-08")).agreement.overage_hourly_rate, 150);
    assert.equal((await context(hourly, "2026-09-08")).agreement, null);
    assert.equal((await context(retainer, "2026-08-14")).agreement, null);
    const html = await page("/time/new");
    assert.match(html, /href="\/time"/);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    assert.ok(html.includes(`value="${today}"`));
    const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([value]) => value).find((value) => value.includes('name="hours"'));
    assert.ok(markup);
    const decode = (value) => value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
    const hidden = new Map([...markup.matchAll(/<input\b[^>]*>/g)].map(([tag]) => [tag.match(/name="([^"]*)"/)?.[1], decode(tag.match(/value="([^"]*)"/)?.[1] ?? "")]));
    const reference = [...hidden.keys()].find((name) => name?.startsWith("$ACTION_REF_"));
    assert.ok(reference, "Expected bound form action metadata");
    const actionId = JSON.parse(hidden.get(`$ACTION_${reference.slice("$ACTION_REF_".length)}:0`)).id;
    async function submit(extra, succeeds = true, auth = true) {
      const form = new FormData();
      for (const [name,value] of Object.entries({ customer_id: retainer, work_date: "2026-09-07", description: "Manual retainer 18", hours: "0", minutes: "18", is_billable: "true", ...extra })) form.set(name,value);
      const response = await request("/time/new", { method: "POST", headers: { "Next-Action": actionId, Accept: "text/x-component" }, body: await encodeReply([{},form]) }, auth);
      assert.equal(response.status, 200);
      if (!auth) assert.ok(response.headers.get("x-action-redirect")?.startsWith("/login;"));
      else if (succeeds) assert.ok(response.headers.get("x-action-redirect")?.startsWith("/time;"));
      else assert.equal(response.headers.has("x-action-redirect"), false);
      return response.text();
    }
    await submit({ billing_agreement_id: current.id, hourly_rate: "0", rounded_minutes: "1", rounding_increment_minutes: "1", included_hours_snapshot: "999" });
    let saved = (await entries(retainer))[0];
    assert.equal(saved.actual_minutes, 18); assert.equal(saved.rounded_minutes, 30); assert.equal(saved.billing_agreement_id, old.id);
    assert.equal(saved.hourly_rate, 125); assert.equal(saved.billing_cycle_day_snapshot, 15); assert.equal(saved.included_hours_snapshot, 1); assert.equal(saved.rollover_enabled_snapshot, false); assert.equal(saved.rounding_increment_minutes, 15);
    await submit({ is_billable: "false", description: "Courtesy 18" });
    saved = (await entries(retainer)).find((row) => row.description === "Courtesy 18");
    assert.equal(saved.actual_minutes, 18); assert.equal(saved.rounded_minutes, 0);
    const missingRate = await submit({ customer_id: hourly }, false); assert.match(missingRate, /hourly rate/);
    await submit({ customer_id: hourly, hourly_rate: "110.25", description: "Hourly 18" });
    saved = (await entries(hourly))[0]; assert.equal(saved.hourly_rate, 110.25); assert.equal(saved.billing_agreement_id, null); assert.equal(saved.rounded_minutes, 30);
    await submit({ customer_id: hourly, is_billable: "false", description: "Hourly courtesy" });
    saved = (await entries(hourly)).find((row) => row.description === "Hourly courtesy"); assert.equal(saved.hourly_rate, null); assert.equal(saved.rounded_minutes, 0);
    const before = (await entries(retainer)).length;
    assert.match(await submit({ description: "   " }, false), /description of the work/);
    assert.match(await submit({ hours: "0", minutes: "0" }, false), /greater than zero/);
    await submit({}, false, false); assert.equal((await entries(retainer)).length, before);
    const list = await page("/time");
    for (const label of ["Manual retainer 18", "Courtesy 18", "Hourly 18", "18 min", "30 min", "0 min", "Retainer", "No retainer", "Non-billable", "Actual duration", "Billable duration (rounded)"]) assert.ok(list.includes(label), `List missing ${label}`);
    assert.ok(!/>Delete(?: entry)?</.test(list + markup));
    t.diagnostic("Authenticated navigation, real manual submissions, 18/30 retainer snapshots, 18/0 non-billable, hourly snapshots, backdated context, required fields, list display and unauthenticated action denial passed.");
  } finally {
    client.auth.stopAutoRefresh(); server.kill("SIGTERM");
    const forceStop = setTimeout(() => server.kill("SIGKILL"), 2000); await stopped; clearTimeout(forceStop);
    const ids = [...customers, ...(userId ? [userId] : [])]; assert.ok(ids.every((id) => /^[0-9a-f-]{36}$/.test(id)));
    const scoped = customers.map((id) => `'${id}'`).join(",");
    // Owner cleanup is restricted to this test's generated fixtures; the app has no DELETE path.
    const cleanup = spawn("docker", ["exec", "-i", "supabase_db_nexa", "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "ignore", "pipe"] });
    cleanup.stderr.resume(); const cleaned = new Promise((resolve) => cleanup.on("close", resolve));
    cleanup.stdin.end(`begin; ${customers.length ? `delete from public.time_entries where customer_id in (${scoped}); delete from public.customer_billing_agreements where customer_id in (${scoped}); delete from public.customers where id in (${scoped});` : ""} ${userId ? `delete from auth.users where id='${userId}';` : ""} commit;`);
    assert.equal(await cleaned, 0, "Scoped fixture cleanup failed");
  }
});
