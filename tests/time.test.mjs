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
  const inserts = [], reads = [], invalidated = [];
  const client = { auth: { getClaims: async () => ({ data: authenticated ? { claims: {} } : null }) }, from(table) {
    let inserting = false;
    const query = {
      select() { return query; }, eq(...args) { reads.push([table, ...args]); return query; },
      lte(...args) { reads.push([table, ...args]); return query; }, or(...args) { reads.push([table, ...args]); return query; },
      insert(data) { inserts.push(data); inserting = true; return query; },
      async maybeSingle() { if (contextFailure) return { data: null, error: {} }; return { data: table === "customers" ? { id: customer } : agreement, error: null }; },
      async single() { assert.ok(inserting); return { data: failure ? null : { id: "saved" }, error: failure ? { code: failure, message: "private database details" } : null }; },
    }; return query;
  } };
  const overrides = { "server-only": {}, "@/lib/supabase/server": { createClient: async () => client },
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
  return { load, inserts, reads, invalidated, deny: () => { authenticated = false; }, retainer: () => { agreement = { included_hours: 1, rounding_increment_minutes: 15, overage_hourly_rate: 125, billing_cycle_day: 15 }; }, fail: (code) => { failure = code; }, failContext: () => { contextFailure = true; } };
}

test("manual duration uses integer minutes, valid dates and required fields", () => {
  const { validateTime, validHourlyRate } = harness().load("@/lib/time/validation");
  for (const [hours, minutes, expected] of [["0","18",18],["1","30",90],["2","0",120]]) {
    const result = validateTime(form({ hours, minutes })); assert.equal(result.valid, true); assert.equal(result.actualMinutes, expected);
  }
  for (const extra of [{ hours: "0", minutes: "0" }, { hours: "1.5" }, { minutes: "-1" }, { minutes: "60" }, { minutes: "1.2" }, { hours: "1e3" }, { hours: "999999999999" }, { hours: "" }, { description: " \n\t" }, { customer_id: "invalid" }, { work_date: "2026-02-30" }, { is_billable: "anything" }]) assert.equal(validateTime(form(extra)).valid, false, JSON.stringify(extra));
  for (const rate of ["0", "125.25", "9999999999.99"]) assert.equal(validHourlyRate(rate), true);
  for (const rate of ["", "-1", "1.234", "NaN", "Infinity", "1e2", "10000000000"]) assert.equal(validHourlyRate(rate), false);
});

test("time action whitelists inputs, leaves snapshot authority to database and scopes preview to enabled work-date terms", async () => {
  const h = harness(); h.retainer();
  await assert.rejects(h.load("@/actions/time").saveTimeEntry({}, form({ hourly_rate: "forged", billing_agreement_id: "forged", actual_minutes: "1", rounded_minutes: "1", included_hours_snapshot: "999", rounding_increment_minutes: "1", created_at: "forged" })), { url: "/time" });
  assert.deepEqual(h.invalidated, ["/time", `/customers/${customer}`]);
  assert.deepEqual(h.inserts[0], { customer_id: customer, work_date: "2026-09-08", description: "Printer work", actual_minutes: 18, is_billable: true, hourly_rate: null });
  assert.ok(h.reads.some((r) => r[1] === "is_active" && r[2] === true));
  assert.ok(h.reads.some((r) => r[1] === "effective_date" && r[2] === "2026-09-08"));
  assert.ok(h.reads.some((r) => r[1] === "end_date.is.null,end_date.gt.2026-09-08"));
});

test("non-retainer billable rates required; non-billable work does not need one", async () => {
  const h = harness(); const save = h.load("@/actions/time").saveTimeEntry;
  for (const rate of ["", "-1", "1.234"]) assert.ok((await save({}, form({ hourly_rate: rate }))).errors.hourly_rate);
  assert.equal(h.inserts.length, 0);
  await assert.rejects(save({}, form()), { url: "/time" }); assert.equal(h.inserts[0].hourly_rate, 125.25);
  await assert.rejects(save({}, form({ is_billable: "false", hourly_rate: "" })), { url: "/time" });
  assert.equal(h.inserts[1].is_billable, false); assert.equal(h.inserts[1].hourly_rate, null);
});

test("authentication guards mutations and reads; validation and context failures never insert", async () => {
  const h = harness(); const save = h.load("@/actions/time").saveTimeEntry;
  assert.ok((await save({}, form({ description: " " }))).errors.description);
  h.failContext(); assert.match((await save({}, form())).message, /Unable to confirm/); assert.equal(h.inserts.length, 0);
  h.deny();
  await assert.rejects(save({}, form()), { url: "/login" });
  await assert.rejects(h.load("@/lib/time/server").getTimeCustomers(), { url: "/login" });
  await assert.rejects(h.load("@/lib/time/server").getRecentTime(1), { url: "/login" });
  await assert.rejects(h.load("@/app/(app)/time/context/route").GET(new Request("http://localhost/time/context")), { url: "/login" });
});

test("database concurrency errors are actionable and never expose raw errors", async () => {
  const h = harness(); const save = h.load("@/actions/time").saveTimeEntry;
  for (const code of ["40001", "23514", "23503", "42501", "unexpected"]) {
    h.fail(code); const result = await save({}, form());
    assert.ok(result.message); assert.ok(!result.message.includes("private"));
    if (code === "40001") assert.match(result.message, /Refresh.*try again/);
  }
});

test("manual form, navigation and duration presentation use friendly labels without deletion", () => {
  const h = harness(); const { renderToStaticMarkup } = require("react-dom/server");
  const React = require("react");
  const markup = renderToStaticMarkup(React.createElement(h.load("@/components/time/time-entry-form").TimeEntryForm, { customers: [{ id: customer, company_name: "Test customer", is_active: true }], today: "2026-09-08" }));
  for (const label of ["Work date", "Hours", "Minutes", "Billable", "Non-billable", "Save time entry", 'value="2026-09-08"']) assert.ok(markup.includes(label), label);
  assert.ok(!/Delete|name="billing_agreement_id"|name="rounded_minutes"/.test(markup));
  const shell = renderToStaticMarkup(React.createElement(h.load("@/components/app/app-shell").AppShell));
  assert.match(shell, /href="\/time"/);
  const { formatDuration } = h.load("@/lib/time/model");
  assert.equal(formatDuration(18), "18 min"); assert.equal(formatDuration(30), "30 min"); assert.equal(formatDuration(0), "0 min"); assert.equal(formatDuration(90), "1 hr 30 min");
});
