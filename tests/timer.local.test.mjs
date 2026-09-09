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

test("timer UI: authenticated Start/Stop/Cancel, committed pending state and safe retry", { timeout: 180000 }, async (t) => {
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
  function actionId(html, field) {
    const markup=[...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([v])=>v).find(v=>v.includes(field));
    assert.ok(markup, `Missing form: ${field}`);
    const decode=v=>v.replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&amp;/g,"&");
    const hidden=new Map([...markup.matchAll(/<input\b[^>]*>/g)].map(([tag])=>[tag.match(/name="([^"]*)"/)?.[1],decode(tag.match(/value="([^"]*)"/)?.[1]??"")]));
    const ref=[...hidden.keys()].find(k=>k?.startsWith("$ACTION_REF_")); assert.ok(ref);
    return JSON.parse(hidden.get(`$ACTION_${ref.slice("$ACTION_REF_".length)}:0`)).id;
  }
  async function submit(id, fields, success=true, auth=true) {
    const form=new FormData(); for (const [k,v] of Object.entries(fields)) form.set(k,v);
    const result=await request("/time",{method:"POST",headers:{"Next-Action":id,Accept:"text/x-component"},body:await encodeReply([{},form])},auth);
    assert.equal(result.status,200);
    if (!auth) assert.ok(result.headers.get("x-action-redirect")?.startsWith("/login;"));
    else if(success) assert.ok(result.headers.get("x-action-redirect")?.startsWith("/time;"));
    else assert.equal(result.headers.has("x-action-redirect"),false);
    return result.text();
  }
  async function currentTimer() {
    const result=await client.from("running_timers").select("*").maybeSingle(); assert.equal(result.error,null); return result.data;
  }
  try {
    for(let i=0;i<100;i++){try{if((await fetch(`${base}/login`)).status===200)break;}catch{} await delay(100);}
    const denied=await request("/time",{},false);const deniedHtml=await denied.text();assert.ok(denied.headers.get("location")?.includes("/login")||deniedHtml.includes("NEXT_REDIRECT;replace;/login;"));assert.ok(!deniedHtml.includes('id="timer-heading"'));
    const registration=await client.auth.signUp({email:`nexa-timer-${randomBytes(8).toString("hex")}@example.test`,password:randomBytes(24).toString("base64url")});
    userId=registration.data.user?.id;assert.equal(registration.error,null);assert.ok(registration.data.session);
    assert.equal(await currentTimer(),null,"Do not run this test with an unresolved local timer");
    const hourly=await customer("Local timer hourly"), retained=await customer("Local timer retainer");
    const a=await agreement(retained,{effective_date:"2000-01-01"});
    const start=actionId(await page("/time"),'name="customer_id"');
    const fields={customer_id:hourly,description:"Timer hourly fixture",is_billable:"true",hourly_rate:"100"};
    assert.match(await submit(start,{...fields,hourly_rate:""},false),/hourly rate/);
    await submit(start,{...fields,started_at:"2000-01-01",stop_requested_at:"2100-01-01"},false,false);
    assert.equal(await currentTimer(),null);
    await submit(start,{...fields,started_at:"2000-01-01",stop_requested_at:"2100-01-01"});
    let timer=await currentTimer();assert.ok(Date.parse(timer.started_at)>Date.now()-60000);assert.equal(timer.stop_requested_at,null);
    let html=await page("/time");assert.match(html,/Timer running/);assert.match(html,/Elapsed duration, live/);assert.match(await page("/time"),/Timer hourly fixture/);
    assert.match(await submit(start,fields,false),/already active/);
    let stop=actionId(html,'name="timer_id"'),cancel=actionId(html,'name="confirm"');
    await submit(stop,{timer_id:timer.id},false,false);assert.ok(await currentTimer());
    await submit(stop,{timer_id:timer.id});assert.equal(await currentTimer(),null);
    let saved=await entries(hourly);assert.equal(saved.length,1);assert.equal(saved[0].actual_minutes,Math.ceil((Date.parse(saved[0].ended_at)-Date.parse(saved[0].started_at))/60000));assert.match(await page("/time"),/Timer hourly fixture/);
    await submit(start,{...fields,is_billable:"false",hourly_rate:"",description:"Timer courtesy"});timer=await currentTimer();stop=actionId(await page("/time"),'name="timer_id"');await submit(stop,{timer_id:timer.id});saved=await entries(hourly);assert.equal(saved.find(e=>e.description==="Timer courtesy").rounded_minutes,0);
    await submit(start,{...fields,description:"Cancel fixture"});timer=await currentTimer();cancel=actionId(await page("/time"),'name="confirm"');
    assert.match(await submit(cancel,{timer_id:timer.id},false),/Confirm cancellation/);assert.ok(await currentTimer());
    await submit(cancel,{timer_id:timer.id,confirm:"yes"});assert.equal(await currentTimer(),null);assert.equal((await entries(hourly)).length,2);
    await submit(start,{customer_id:retained,description:"Pending fixture",is_billable:"true"});timer=await currentTimer();html=await page("/time");stop=actionId(html,'name="timer_id"');cancel=actionId(html,'name="confirm"');
    const disabled=await client.from("customer_billing_agreements").update({is_active:false}).eq("id",a.id);assert.equal(disabled.error,null);
    assert.match(await submit(stop,{timer_id:timer.id},false),/stop time was saved/);
    const pending=await currentTimer();assert.ok(pending.stop_requested_at);assert.equal((await entries(retained)).length,0);
    html=await page("/time");assert.match(html,/Stopped — pending finalization/);assert.match(html,/Elapsed duration, fixed/);assert.ok(!html.includes("Elapsed duration, live"));assert.ok(!html.includes("Cancel timer"));assert.match(await page("/time"),/Retry finalization/);
    assert.match(await submit(cancel,{timer_id:timer.id,confirm:"yes"},false),/awaiting finalization/);
    assert.match(await submit(start,fields,false),/already active/);
    await delay(1100);
    stop=actionId(html,'name="timer_id"');await submit(stop,{timer_id:timer.id,hourly_rate:"110.25"});assert.equal(await currentTimer(),null);
    saved=await entries(retained);assert.equal(saved.length,1);assert.equal(saved[0].ended_at,pending.stop_requested_at);assert.equal(saved[0].actual_minutes,Math.ceil((Date.parse(pending.stop_requested_at)-Date.parse(timer.started_at))/60000));
    assert.match(await submit(stop,{timer_id:timer.id,hourly_rate:"110.25"},false),/no longer running/);assert.equal((await entries(retained)).length,1);
    // Render authoritative completed timestamp fixtures. Exact timer splitting and
    // 18m20s conversion are exercised through Stop by the database regressions.
    const fixtures=await client.from("time_entries").insert([
      {customer_id:hourly,description:"Timer 18m20s fixture",work_date:"2026-09-08",actual_minutes:19,is_billable:true,hourly_rate:100,started_at:"2026-09-08T12:00:00Z",ended_at:"2026-09-08T12:18:20Z"},
      {customer_id:hourly,description:"Timer midnight first",work_date:"2026-09-08",actual_minutes:10,is_billable:true,hourly_rate:100,started_at:"2026-09-09T03:50:00Z",ended_at:"2026-09-09T04:00:00Z"},
      {customer_id:hourly,description:"Timer midnight second",work_date:"2026-09-09",actual_minutes:20,is_billable:true,hourly_rate:100,started_at:"2026-09-09T04:00:00Z",ended_at:"2026-09-09T04:20:00Z"}
    ]);assert.equal(fixtures.error,null);
    html=await page("/time");for(const value of ["Timer midnight first","Timer midnight second","Timer 18m20s fixture","19 min","30 min"])assert.ok(html.includes(value));
    const directDelete=await client.from("running_timers").delete().eq("id",timer.id);assert.equal(directDelete.error.code,"42501");
    t.diagnostic("Authenticated real Server Actions passed: Start, persisted active state, duplicate rejection, authoritative Stop, non-billable, confirmed Cancel, committed pending state, fixed duration, refresh, blocked Cancel/Start, original-time retry, and no duplicates. Completed duration and midnight fixtures render normally.");
  } finally {
    client.auth.stopAutoRefresh(); server.kill("SIGTERM");
    const forceStop = setTimeout(() => server.kill("SIGKILL"), 2000); await stopped; clearTimeout(forceStop);
    const ids = [...customers, ...(userId ? [userId] : [])]; assert.ok(ids.every((id) => /^[0-9a-f-]{36}$/.test(id)));
    const scoped = customers.map((id) => `'${id}'`).join(",");
    // Owner cleanup is restricted to this test's generated fixtures; the app has no DELETE path.
    const cleanup = spawn("docker", ["exec", "-i", "supabase_db_nexa", "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "ignore", "pipe"] });
    cleanup.stderr.resume(); const cleaned = new Promise((resolve) => cleanup.on("close", resolve));
    cleanup.stdin.end(`begin; ${customers.length ? `delete from public.running_timers where customer_id in (${scoped}); delete from public.time_entries where customer_id in (${scoped}); delete from public.customer_billing_agreements where customer_id in (${scoped}); delete from public.customers where id in (${scoped});` : ""} ${userId ? `delete from auth.users where id='${userId}';` : ""} commit;`);
    assert.equal(await cleaned, 0, "Scoped fixture cleanup failed");
  }
});
