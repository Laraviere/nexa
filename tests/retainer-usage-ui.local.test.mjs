// Local Docker Supabase + real production Next HTTP Server Actions.
// Temporary synthetic fixtures only; never alters schema/policies/grants.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
const exec = promisify(execFile);
const root = new URL("../", import.meta.url);

test("retainer usage UI: real authenticated customer pages use local authoritative RPC", { timeout: 180000 }, async (t) => {
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
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const shifted = (days) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };
  async function entry(customer_id, actual_minutes, extra = {}) {
    const result = await client.from("time_entries").insert({ customer_id, work_date: today, description: "Local usage UI fixture", actual_minutes, ...extra }).select().single();
    assert.equal(result.error,null,"Time entry fixture failed"); return result.data;
  }
  async function usage(a) {
    const result = await client.rpc("get_retainer_period_usage", { p_billing_agreement_id: a.id, p_reference_date: today });
    assert.equal(result.error,null,"Local usage RPC unavailable or failed"); assert.equal(result.data.length,1); return result.data[0];
  }
  function panel(html) { const result=html.match(/<section id="retainer-usage"[\s\S]*?<\/section>/)?.[0]; assert.ok(result,"Missing current usage panel"); return result; }
  function metric(html,label,value) { assert.match(html,new RegExp(`>${label}</dt><dd[^>]*>${value}</dd>`)); }
  try {
    for (let i=0;i<100;i++) { try { if ((await fetch(`${base}/login`)).status===200) break; } catch { /* starting */ } await delay(100); }
    const registration = await client.auth.signUp({ email: `nexa-usage-${randomBytes(8).toString("hex")}@example.test`, password: randomBytes(24).toString("base64url") });
    userId=registration.data.user?.id; assert.equal(registration.error,null,"Local sign-up failed"); assert.ok(registration.data.session);
    const retained=await customer("Local usage UI retainer");
    const a=await agreement(retained,{ effective_date: today });
    const route=`/customers/${retained}`;
    const denied=await request(route,{},false); const deniedHtml=await denied.text();
    assert.ok(denied.headers.get("location")?.includes("/login") || deniedHtml.includes('NEXT_REDIRECT;replace;/login;'));
    assert.ok(!deniedHtml.includes('id="retainer-usage"'));
    const emptyPage=await page(route);
    let html=panel(emptyPage);
    metric(html,"Included","1 hr"); metric(html,"Used","0 min"); metric(html,"Remaining","1 hr"); metric(html,"Overage","0 min");
    // React streams closed details content after its initial section markup.
    assert.ok(emptyPage.includes("No billable time recorded"));
    const first=await entry(retained,18); assert.equal(first.actual_minutes,18); assert.equal(first.rounded_minutes,30);
    html=panel(await page(route)); metric(html,"Used","30 min"); metric(html,"Remaining","30 min");
    await entry(retained,100,{is_billable:false});
    const voided=await entry(retained,100);
    const voidResult=await client.from("time_entries").update({voided_at:new Date().toISOString(),void_reason:"Local UI regression"}).eq("id",voided.id);
    assert.equal(voidResult.error,null);
    html=panel(await page(route)); metric(html,"Used","30 min"); metric(html,"Remaining","30 min");
    await entry(retained,15); await entry(retained,18);
    const authoritative=await usage(a);
    assert.equal(authoritative.rounded_minutes_used,75); assert.equal(authoritative.overage_minutes,15); assert.equal(authoritative.overage_amount,31.25);
    const allocatedPage=await page(route);
    html=panel(allocatedPage); metric(html,"Used","1 hr 15 min"); metric(html,"Remaining","0 min"); metric(html,"Overage","15 min");
    assert.ok(html.includes(new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(authoritative.overage_amount)));
    assert.ok(html.includes(`dateTime="${authoritative.period_start}"`)); assert.ok(html.includes(`dateTime="${authoritative.period_end}"`));
    const allocationRows=[...allocatedPage.matchAll(/<li\b[\s\S]*?<\/li>/g)].map(([value])=>value).filter((value)=>value.includes(">Rounded</dt>"));
    assert.equal(allocationRows.length,3); metric(allocationRows[2],"Rounded","30 min"); metric(allocationRows[2],"Included","15 min"); metric(allocationRows[2],"Overage","15 min");
    assert.ok(!html.includes("time_entry_id"));
    const hourly=await customer("Local usage no retainer");
    const hourlyHtml=await page(`/customers/${hourly}`); assert.ok(hourlyHtml.includes("No retainer")); assert.ok(!hourlyHtml.includes('id="retainer-usage"'));
    const zero=await customer("Local usage zero allowance");
    await agreement(zero,{effective_date:today,included_hours:0}); await entry(zero,18);
    html=panel(await page(`/customers/${zero}`)); metric(html,"Included","No included hours"); metric(html,"Used","30 min"); metric(html,"Overage","30 min"); assert.ok(html.includes("$62.50"));
    const rollover=await customer("Local usage unsupported rollover");
    await agreement(rollover,{effective_date:today,rollover_enabled:true});
    const rolloverHtml=await page(`/customers/${rollover}`);
    assert.ok(rolloverHtml.includes("Usage calculation is not available for rollover-enabled agreements yet."));
    assert.ok(!rolloverHtml.includes("Retainer rollover calculation is not supported")); assert.ok(rolloverHtml.includes("Monthly retainer"));
    const changed=await customer("Local usage new agreement version");
    const billingDay=Number(today.slice(-2))===15 ? 16 : 15;
    const old=await agreement(changed,{effective_date:shifted(-10),billing_cycle_day:billingDay});
    await entry(changed,60,{work_date:shifted(-1)});
    const changedResult=await client.rpc("change_customer_billing_terms",{p_predecessor_id:old.id,p_effective_date:today,p_monthly_fee:600,p_included_hours:2,p_overage_hourly_rate:150,p_billing_cycle_day:billingDay,p_bill_in_advance:true,p_rounding_increment_minutes:15,p_rollover_enabled:false});
    assert.equal(changedResult.error,null,"Same-day terms change failed");
    await entry(changed,30);
    const current=await usage(changedResult.data); assert.equal(current.period_start,today); assert.equal(current.included_minutes_available,120); assert.equal(current.remaining_included_minutes,90);
    html=panel(await page(`/customers/${changed}`)); metric(html,"Included","2 hr"); metric(html,"Used","30 min"); metric(html,"Remaining","1 hr 30 min"); assert.ok(html.includes(`dateTime="${current.period_start}"`)); assert.ok(html.includes(`dateTime="${current.period_end}"`));
    t.diagnostic("Customer pages passed: 60/30/30, 60/75/15, partial allocation, stored rounding, exclusions, empty/zero allowance, exact RPC charge and dates, fresh version, rollover message, no-retainer and authentication.");
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
