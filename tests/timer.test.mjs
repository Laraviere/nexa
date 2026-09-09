import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const customer = "12345678-1234-4234-8234-123456789012";
function form(extra = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ customer_id: customer, work_date: "2026-09-08", description: "Printer work", hours: "0", minutes: "18", is_billable: "true", hourly_rate: "125.25", ...extra })) result.set(key, value);
  return result;
}
function harness() {
  let authenticated = true, agreement = null, failure, contextFailure = false;
  let timer = { id: customer, customer_id: customer }, rpcResult = true;
  const calls = [], effects = [];
  const inserts = [], reads = [], invalidated = [];
  const client = { async rpc(name, args) { calls.push([name,args]); return {data: rpcResult,error: failure ? {code:failure,message:"private database details"}:null}; }, auth: { getClaims: async () => ({ data: authenticated ? { claims: {} } : null }) }, from(table) {
    let inserting = false;
    const query = {
      select() { return query; }, eq(...args) { reads.push([table, ...args]); return query; },
      lte(...args) { reads.push([table, ...args]); return query; }, or(...args) { reads.push([table, ...args]); return query; },
      insert(data) { inserts.push(data); inserting = true; return query; },
      then(resolve) { return Promise.resolve({data:null,error:failure ? {code:failure}:null}).then(resolve); },
      async maybeSingle() { if (contextFailure) return { data: null, error: {} }; return { data: table === "running_timers" ? timer : table === "customers" ? { id: customer } : agreement, error: null }; },
      async single() { assert.ok(inserting); return { data: failure ? null : { id: "saved" }, error: failure ? { code: failure, message: "private database details" } : null }; },
    }; return query;
  } };
  const overrides = { react: { ...require("react"), useEffect: callback => { effects.push(callback); } }, "server-only": {}, "@/lib/supabase/server": { createClient: async () => client },
    "next/navigation": { redirect(url) { throw Object.assign(new Error("redirect"), { url }); } },
    "next/cache": { revalidatePath(value) { invalidated.push(value); } },
    "next/link": { __esModule: true, default: ({ children, ...props }) => require("react").createElement("a", props, children) },
    "@/components/auth/sign-out-button": { SignOutButton: () => null },
  };
  const cache = new Map();
  function load(name) {
    if (name in overrides) return overrides[name];
    if (!name.startsWith("@/")) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const base = path.resolve(import.meta.dirname, "../src", name.slice(2));
    const filename = [base + ".ts", base + ".tsx"].find(fs.existsSync);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loaded = { exports: {} }; cache.set(name, loaded);
    vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(load, loaded, loaded.exports);
    return loaded.exports;
  }
  return { load, inserts, reads, invalidated, calls, effects, result: value => { rpcResult=value; }, timer: value => { timer=value; }, deny: () => { authenticated = false; }, retainer: () => { agreement = { included_hours: 1, rounding_increment_minutes: 15, overage_hourly_rate: 125, billing_cycle_day: 15 }; }, fail: (code) => { failure = code; }, failContext: () => { contextFailure = true; } };
}

test("timer Start authenticates, validates rates and whitelists server-only start inputs", async () => {
  const h=harness(), start=h.load("@/actions/timer").startTimer;
  assert.match((await start({},form({hourly_rate:""}))).message,/hourly rate/);
  assert.equal(h.inserts.length,0);
  await assert.rejects(start({},form({started_at:"2000-01-01",stop_requested_at:"2100-01-01",billing_agreement_id:"forged"})),{url:"/time"});
  assert.ok(Date.parse(h.inserts[0].started_at)>Date.parse("2026-01-01"));
  assert.deepEqual(Object.keys(h.inserts[0]).sort(),["customer_id","description","hourly_rate","is_billable","started_at"]);
  assert.equal(h.inserts[0].hourly_rate,125.25);
  h.retainer(); await assert.rejects(start({},form({hourly_rate:""})),{url:"/time"}); assert.equal(h.inserts[1].hourly_rate,null);
  h.fail("23505"); assert.match((await start({},form())).message,/already active/);
  h.deny(); await assert.rejects(start({},form()),{url:"/login"});
});
test("Stop accepts committed pending result; Retry uses identical timer ID with no timestamp or inserts", async () => {
  const h=harness(), stop=h.load("@/actions/timer").stopTimer;
  const result={status:"pending_finalization",timer_id:customer,stop_requested_at:"2026-09-09T12:00:00Z",entries:[],error_code:"22023",message:"private error"};
  h.result(result);
  const pending=await stop({},form({timer_id:customer,hourly_rate:"",stop_requested_at:"forged"}));
  assert.equal(pending.pendingFinalization,true); assert.match(pending.message,/stop time was saved/); assert.ok(!pending.message.includes("private"));
  assert.deepEqual(h.calls[0],["stop_time_timer",{p_timer_id:customer}]);
  h.result({...result,status:"completed",entries:[{actual_minutes:19,rounded_minutes:30}]});
  await assert.rejects(stop({},form({timer_id:customer,hourly_rate:"100"})),{url:"/time"});
  assert.deepEqual(h.calls[1],["stop_time_timer",{p_timer_id:customer,p_hourly_rate:100}]);
  assert.equal(h.inserts.length,0); assert.ok(h.invalidated.includes(`/customers/${customer}`));
  h.result({status:"completed"}); assert.match((await stop({},form({timer_id:customer}))).message,/Unable to confirm/);
  h.deny(); await assert.rejects(stop({},form({timer_id:customer})),{url:"/login"});
});
test("Cancel requires confirmation and uses only the generated RPC, with friendly race errors", async () => {
  const h=harness(), cancel=h.load("@/actions/timer").cancelTimer;
  assert.match((await cancel({},form({timer_id:customer}))).message,/Confirm/); assert.equal(h.calls.length,0);
  await assert.rejects(cancel({},form({timer_id:customer,confirm:"yes"})),{url:"/time"});
  assert.deepEqual(h.calls[0],["cancel_time_timer",{p_timer_id:customer}]);
  h.fail("55000"); assert.match((await cancel({},form({timer_id:customer,confirm:"yes"}))).message,/awaiting finalization/);
  h.deny(); await assert.rejects(cancel({},form({timer_id:customer,confirm:"yes"})),{url:"/login"});
  await assert.rejects(h.load("@/lib/timer/server").getTimer(),{url:"/login"});
});
test("elapsed display uses stored end time, supports long sessions and clamps browser skew", () => {
  const {elapsedTimer,stopStatus}=harness().load("@/lib/timer/model");
  const start="2026-09-09T12:00:00Z",end="2026-09-09T12:18:20Z";
  assert.equal(elapsedTimer(start,null,Date.parse(end)),"00:18:20");
  assert.equal(elapsedTimer(start,end,Date.parse("2026-09-11")),"00:18:20");
  assert.equal(elapsedTimer(start,null,Date.parse("2026-09-08")),"00:00:00");
  assert.equal(elapsedTimer(start,null,Date.parse("2026-09-11T13:00:00Z")),"49:00:00");
  assert.equal(stopStatus({status:"completed",timer_id:"wrong",stop_requested_at:end,entries:[{}]},customer),null);
});
test("timer panel shows fixed pending state, Retry and no Cancel; active state has live duration", () => {
  const h=harness(),{TimerPanel}=h.load("@/components/timer/timer-panel");
  const react=require("react"), {renderToStaticMarkup}=require("react-dom/server");
  const timer={id:customer,customer_id:customer,description:"Support",is_billable:true,hourly_rate:null,started_at:"2026-09-09T12:00:00Z",stop_requested_at:"2026-09-09T12:18:20Z",customers:{company_name:"Fixture"}};
  const render=t=>renderToStaticMarkup(react.createElement(TimerPanel,{timer:t,customers:[],today:"2026-09-09",serverNow:Date.parse("2026-09-10")}));
  const pending=render(timer); assert.match(pending,/Stopped — pending finalization/); assert.match(pending,/00:18:20/); assert.match(pending,/Retry finalization/); assert.ok(!pending.includes("Cancel timer")); assert.ok(!pending.includes("Elapsed duration, live"));
  assert.equal(h.effects[0](),undefined,"Pending timer must not start a ticking interval");
  const active=render({...timer,stop_requested_at:null}); assert.match(active,/Elapsed duration, live/); assert.match(active,/Cancel timer/); assert.match(active,/Stop timer/);
  const originalInterval=globalThis.setInterval, originalClear=globalThis.clearInterval;
  let started=false, cleared=false;
  try {
    globalThis.setInterval=(_callback,ms)=>{ assert.equal(ms,1000);started=true;return 42; };
    globalThis.clearInterval=id=>{ assert.equal(id,42);cleared=true; };
    const cleanup=h.effects[1]();assert.ok(started);cleanup();assert.ok(cleared);
  } finally {globalThis.setInterval=originalInterval;globalThis.clearInterval=originalClear;}

});

test("Start presentation uses a visible workflow and accessible native billing segments", () => {
  const h=harness(), {TimerPanel}=h.load("@/components/timer/timer-panel");
  const html=require("react-dom/server").renderToStaticMarkup(require("react").createElement(TimerPanel,{timer:null,customers:[{id:customer,company_name:"Example",is_active:true}],today:"2026-09-09",serverNow:0}));
  assert.match(html,/Track work as you perform it/);
  assert.match(html,/<legend[^>]*>Billing<\/legend>/);
  const radios=[...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map(([tag])=>tag);
  assert.equal(radios.length,2);
  assert.ok(!html.includes("<svg"), "Timer presentation contains no decorative SVG");
  assert.ok(radios.every(tag => tag.includes('class="peer sr-only"')), "Native radios use only standard accessible hiding");
  const startButton = [...html.matchAll(/<button\b[^>]*>/g)].map(([tag])=>tag).at(-1);
  assert.ok(startButton.includes("w-40") && startButton.includes("max-sm:w-full"), "Start is bounded on desktop and full-width only on mobile");
  assert.match(html,/w-60 max-w-full rounded-lg border/, "Billing choices share one bounded container");
  assert.ok(radios.every(tag=>tag.includes('name="is_billable"')));
  assert.ok(radios.find(tag=>tag.includes('value="true"')).includes('checked=""'));
  assert.ok(!radios.find(tag=>tag.includes('value="false"')).includes('checked=""'));
  assert.ok(!html.includes("<details"),"Start form is visible without opening a disclosure");
  assert.match(html,/Ready to start/);
  assert.match(html,/for="timer-customer"/);assert.match(html,/for="timer-description"/);
});
