import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const customerId = "12345678-1234-4234-8234-123456789012";
const agreementId = "22345678-1234-4234-8234-123456789012";
const entryId = "32345678-1234-4234-8234-123456789012";
const args = { p_billing_agreement_id: agreementId, p_reference_date: "2026-09-09" };
const summary = (extra = {}) => ({ customer_id: customerId, billing_agreement_id: agreementId,
  period_start: "2026-09-08", period_end: "2026-09-15", included_minutes_available: 60,
  rounded_minutes_used: 30, included_minutes_used: 30, remaining_included_minutes: 30,
  overage_minutes: 0, overage_amount: 0, allocations: [], ...extra });
const agreement = { id: agreementId, customer_id: customerId, effective_date: "2020-01-01", end_date: null,
  monthly_fee: 500, included_hours: 1, overage_hourly_rate: 125, billing_cycle_day: 15, rounding_increment_minutes: 15,
  is_active: true, rollover_enabled: false, bill_in_advance: true, created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z" };
function harness() {
  const calls = []; let auth = true, error = null, data = [summary()], rows = [agreement], throws = false;
  const client = { auth: { getClaims: async () => ({ data: auth ? { claims: {} } : null }) },
    async rpc(name, value) { calls.push({ name, args: value }); if (throws) throw new Error("private network data"); return { data, error }; } };
  const overrides = { "server-only": {}, "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/billing/server": { getBillingAgreements: async () => rows },
    "@/components/customers/customer-status-action": { CustomerStatusAction: () => null },
    "next/navigation": { redirect(url) { throw Object.assign(new Error("redirect"), { url }); } },
    "next/link": { __esModule: true, default: ({ children, ...props }) => require("react").createElement("a", props, children) },
  };
  const cache = new Map();
  function load(name) {
    if (name in overrides) return overrides[name];
    if (!name.startsWith("@/")) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const base = path.resolve(import.meta.dirname, "../src", name.slice(2));
    const filename = [base + ".ts", base + ".tsx"].find(fs.existsSync);
    const output = ts.transpileModule(fs.readFileSync(filename,"utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loaded = { exports: {} }; cache.set(name,loaded);
    vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(load,loaded,loaded.exports); return loaded.exports;
  }
  function render(value) { return require("react-dom/server").renderToStaticMarkup(require("react").createElement(load("@/components/billing/retainer-usage").RetainerUsage, { result: value })); }
  // Page tests still use the real authenticated usage helper.
  client.from = () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: customerId, company_name: "Example", is_active: true, default_payment_terms_days: 30, created_at: "2020-01-01Z", updated_at: "2020-01-01Z" }, error: null }; } });
  return { load, render, calls, setData: (value) => { data = value; }, fail: (code) => { error = { code, message: "private PostgreSQL details" }; }, deny: () => { auth = false; }, noRetainer: () => { rows = []; }, networkFailure: () => { throws = true; } };
}
function ready(value) { return { status: "ready", summary: value }; }
function metric(html,label,value) { assert.match(html,new RegExp(`>${label}</dt><dd[^>]*>${value}</dd>`)); }

test("usage summary shows 60/30/30 and RPC-supplied period dates with exclusive end", () => {
  const h = harness(); const html = h.render(ready(summary()));
  metric(html,"Included","1 hr"); metric(html,"Used","30 min"); metric(html,"Remaining","30 min"); metric(html,"Overage","0 min");
  assert.match(html,/September 8, 2026/); assert.match(html,/September 15, 2026/); assert.match(html,/End date is exclusive/);
  assert.match(html, /<progress[^>]*value="30"[^>]*max="60"/);
});
test("overage charge is formatted directly from RPC; split allocation preserves both minute parts", () => {
  const h = harness(); const html = h.render(ready(summary({ rounded_minutes_used: 75, included_minutes_used: 60, remaining_included_minutes: 0, overage_minutes: 15,
    overage_amount: 987.65, allocations: [{ time_entry_id: entryId, work_date: "2026-09-09", rounded_minutes: 30, included_minutes: 15, overage_minutes: 15, hourly_rate: 125 }] })));
  metric(html,"Used","1 hr 15 min"); metric(html,"Remaining","0 min"); metric(html,"Overage","15 min");
  assert.match(html,/\$987\.65/); assert.ok(!html.includes("$31.25"));
  metric(html,"Rounded","30 min"); metric(html,"Included","15 min");
  assert.match(html,/<details/); assert.ok(!html.includes("time_entry_id"));
});
test("empty usage and zero allowance display clearly without dividing by zero", () => {
  const h = harness(); const empty = h.render(ready(summary({ rounded_minutes_used: 0, included_minutes_used: 0, remaining_included_minutes: 60 })));
  metric(empty,"Used","0 min"); metric(empty,"Remaining","1 hr"); assert.match(empty,/No billable time recorded/);
  const zero = h.render(ready(summary({ included_minutes_available: 0, included_minutes_used: 0, remaining_included_minutes: 0, overage_minutes: 30, overage_amount: 62.5 })));
  metric(zero,"Included","No included hours"); metric(zero,"Overage","30 min"); assert.match(zero,/\$62\.50/); assert.ok(!zero.includes("<progress"));
  assert.match(zero,/No included hours — 30 min overage/);
  const zeroEmpty = h.render(ready(summary({ included_minutes_available: 0, rounded_minutes_used: 0, included_minutes_used: 0, remaining_included_minutes: 0 })));
  assert.match(zeroEmpty, /id="included-usage-status"[^>]*>No included hours</);
  assert.ok(!/<progress|NaN|Infinity|%/.test(zeroEmpty));
});
test("progress distinguishes remaining allowance from exhausted allowance without overage", () => {
  const h = harness(); const within = h.render(ready(summary()));
  assert.match(within,/Within included allowance — 30 min remaining/);
  assert.match(within,/<progress[^>]*aria-describedby="included-usage-status"[^>]*accent-cyan-700[^>]*value="30"[^>]*max="60"/);
  const exhausted = h.render(ready(summary({ rounded_minutes_used: 60, included_minutes_used: 60, remaining_included_minutes: 0 })));
  assert.match(exhausted,/Included allowance exhausted — no overage/);
  assert.match(exhausted,/<progress[^>]*accent-slate-500[^>]*value="60"[^>]*max="60"/);
  assert.ok(!exhausted.includes("accent-cyan-700"));
  metric(exhausted,"Overage","0 min");
});
test("overage progress uses an amber warning and accessible explicit status while preserving RPC values", () => {
  const html = harness().render(ready(summary({ rounded_minutes_used: 150, included_minutes_used: 60, remaining_included_minutes: 0, overage_minutes: 90, overage_amount: 187.5 })));
  assert.match(html,/id="included-usage-status" role="status"[^>]*>Included allowance exhausted — 1 hr 30 min overage</);
  assert.match(html,/border-amber-200 bg-amber-50/);
  assert.match(html,/<progress[^>]*aria-describedby="included-usage-status"[^>]*accent-amber-600[^>]*value="60"[^>]*max="60"/);
  assert.ok(!html.includes("accent-cyan-700"));
  metric(html,"Included","1 hr"); metric(html,"Used","2 hr 30 min"); metric(html,"Remaining","0 min"); metric(html,"Overage","1 hr 30 min");
  assert.match(html,/\$187\.50/);
});
test("usage read authenticates, forwards generated RPC args, and safely maps errors", async () => {
  const h = harness(); const read = h.load("@/lib/billing/usage-server").getRetainerUsage;
  assert.equal((await read(customerId,args)).status,"ready"); assert.deepEqual(h.calls[0], { name: "get_retainer_period_usage", args });
  for (const code of ["0A000","22023","P0002","42501","unexpected"]) {
    h.fail(code); const result = await read(customerId,args); assert.equal(result.status,"error"); assert.ok(!result.message.includes("private"));
    if (code === "0A000") assert.equal(result.message,"Usage calculation is not available for rollover-enabled agreements yet.");
  }
  h.networkFailure(); assert.equal((await read(customerId,args)).status,"error");
  h.deny(); await assert.rejects(read(customerId,args), { url: "/login" });
});
test("invalid summaries, wrong scopes and missing/extra rows do not render misleading totals", async () => {
  const h = harness(); const read = h.load("@/lib/billing/usage-server").getRetainerUsage;
  for (const data of [[], [summary(),summary()], [summary({ customer_id: agreementId })], [summary({ billing_agreement_id: customerId })], [summary({ rounded_minutes_used: NaN })], [summary({ period_end: "2026-09-09" })]]) {
    h.setData(data); assert.equal((await read(customerId,args)).status,"error");
  }
});
test("malformed allocations degrade detail safely without exposing JSON or changing summary", () => {
  const h = harness(); const parse = h.load("@/lib/billing/usage").usageAllocations;
  assert.equal(parse({ private: "data" }),null); assert.equal(parse([{ time_entry_id: entryId, work_date: "invalid" }]),null);
  const html = h.render(ready(summary({ allocations: { private: "data" } })));
  assert.match(html,/Entry allocation detail is unavailable/); metric(html,"Used","30 min"); assert.ok(!html.includes('"private"'));
});
test("customer page requests only current retainer using one server New York business date", async () => {
  const h = harness(); h.setData([summary({ period_start: "2000-01-01", period_end: "2199-01-01" })]);
  const page = h.load("@/app/(app)/customers/[id]/page").default;
  const today = h.load("@/lib/billing/model").businessDate();
  const tree = await page({ params: Promise.resolve({ id: customerId }) });
  const html = require("react-dom/server").renderToStaticMarkup(tree);
  assert.deepEqual(h.calls[0].args, { p_billing_agreement_id: agreementId, p_reference_date: today }); assert.match(html,/Current billing period/);
  h.noRetainer(); h.calls.length=0;
  const noRetainer = require("react-dom/server").renderToStaticMarkup(await page({ params: Promise.resolve({ id: customerId }) }));
  assert.equal(h.calls.length,0); assert.match(noRetainer,/No retainer/); assert.ok(!noRetainer.includes("Current billing period"));
});
