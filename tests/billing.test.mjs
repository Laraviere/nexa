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
function fixture(overrides = {}) {
  return { id: agreementId, customer_id: customerId, monthly_fee: 500, included_hours: 1.5, overage_hourly_rate: 125,
    billing_cycle_day: 1, bill_in_advance: true, rounding_increment_minutes: 15, rollover_enabled: false,
    effective_date: "2020-01-01", end_date: null, is_active: true, created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z", ...overrides };
}
function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ monthly_fee: "500.00", included_hours: "1.5", overage_hourly_rate: "125.00", billing_cycle_day: "1", bill_in_advance: "true", rounding_increment_minutes: "15", rollover_enabled: "false", effective_date: "2027-01-01", end_mode: "until_cancellation", ...overrides })) data.set(key, value);
  return data;
}
// Tests execute real modules; only the database/framework boundary is simulated.
function harness() {
  let authenticated = true, failure, conflict = false;
  const rows = [];
  const calls = [];
  const revalidated = [];
  const client = {
    auth: { getClaims: async () => ({ data: authenticated ? { claims: { sub: "test" } } : null }) },
    from(table) {
      assert.equal(table, "customer_billing_agreements");
      let operation = "select", payload, range;
      const filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        is(key, value) { filters.push([key, value]); return query; },
        order() { return query; },
        range(from, to) { range = [from, to]; return query; },
        insert(value) { payload = value; operation = "insert"; return query; },
        update(value) { payload = value; operation = "update"; return query; },
        maybeSingle() { return Promise.resolve(execute(true)); },
        then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
      };
      function execute(single) {
        calls.push({ operation, payload, filters });
        if (failure) return { data: null, error: { code: failure, message: "Private technical details" } };
        let selected = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
        if (operation === "insert") rows.push(fixture(payload));
        if (operation === "update") {
          if (conflict) selected = [];
          selected.forEach((row) => Object.assign(row, payload));
        }
        if (range) selected = selected.slice(range[0], range[1] + 1);
        return { data: single ? selected[0] ?? null : selected, error: null };
      }
      return query;
    },
  };
  const overrides = {
    "server-only": {},
    "@/lib/supabase/server": { createClient: async () => client },
    "next/navigation": { redirect: (url) => { throw Object.assign(new Error("redirect"), { url }); }, notFound: () => { throw new Error("notFound"); } },
    "next/cache": { revalidatePath: (...args) => revalidated.push(args) },
    "next/link": { __esModule: true, default: ({ children, ...props }) => require("react").createElement("a", props, children) },
  };
  const cache = new Map();
  function load(name) {
    if (name in overrides) return overrides[name];
    if (!name.startsWith("@/")) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const base = path.resolve(import.meta.dirname, "../src", name.slice(2));
    const filename = [base + ".ts", base + ".tsx"].find(fs.existsSync);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loaded = { exports: {} };
    cache.set(name, loaded);
    vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(load, loaded, loaded.exports);
    return loaded.exports;
  }
  return { load, rows, calls, revalidated, denyAuth: () => { authenticated = false; }, fail: (code) => { failure = code; }, conflict: () => { conflict = true; } };
}

test("New York business dates and exclusive boundaries select only current enabled terms", () => {
  const { businessDate, currentAgreement, agreementStatus } = harness().load("@/lib/billing/model");
  assert.equal(businessDate(new Date("2027-04-01T03:59:59Z")), "2027-03-31");
  assert.equal(businessDate(new Date("2027-04-01T04:00:00Z")), "2027-04-01");
  assert.equal(businessDate(new Date("2027-01-01T04:59:59Z")), "2026-12-31");
  assert.equal(businessDate(new Date("2027-01-01T05:00:00Z")), "2027-01-01");
  const old = fixture({ end_date: "2027-04-01" });
  const next = fixture({ id: "next", effective_date: "2027-04-01" });
  assert.equal(currentAgreement([old, next], "2027-03-31"), old);
  assert.equal(currentAgreement([old, next], "2027-04-01"), next);
  assert.equal(currentAgreement([old], "2027-04-01"), undefined);
  assert.equal(currentAgreement([], "2027-04-01"), undefined);
  assert.equal(agreementStatus(next, "2027-03-31"), "Future");
  assert.equal(agreementStatus({ ...old, is_active: false }, "2027-04-01"), "Ended");
  assert.equal(agreementStatus(fixture({ is_active: false }), "2027-04-01"), "Disabled");
});

test("money, fractional hours, ordinal days and date-only presentation", () => {
  const m = harness().load("@/lib/billing/model");
  assert.equal(m.formatMoney(500), "$500.00");
  assert.equal(m.formatMoney(125.5), "$125.50");
  assert.equal(m.formatIncludedHours(0), "No included hours");
  assert.equal(m.formatIncludedHours(1), "1 hour / month");
  assert.equal(m.formatIncludedHours(1.5), "1.5 hours / month");
  assert.equal(m.formatIncludedHours(1.25), "1.25 hours / month");
  assert.equal(m.formatBillingCycle(1), "Monthly on the 1st");
  assert.equal(m.formatBillingCycle(11), "Monthly on the 11th");
  assert.equal(m.formatBillingCycle(22), "Monthly on the 22nd");
  assert.equal(m.formatBusinessDate("2027-01-01"), "January 1, 2027");
});

test("validation rejects malformed dates, decimal rounding, negatives, overflow and invalid settings", () => {
  const { validateBilling } = harness().load("@/lib/billing/validation");
  assert.equal(validateBilling(form()).valid, true);
  assert.equal(validateBilling(form({ monthly_fee: " 0.00 " })).data.monthly_fee, 0);
  for (const field of ["monthly_fee", "included_hours", "overage_hourly_rate"]) {
    for (const value of ["", "-1", "NaN", "Infinity", "1.001", "1e2", "999999999999"]) assert.ok(validateBilling(form({ [field]: value })).errors[field], `${field}: ${value}`);
  }
  for (const date of ["", "2027-02-29", "2027-04-31", "01/01/2027", "0000-01-01"]) assert.ok(validateBilling(form({ effective_date: date })).errors.effective_date);
  assert.equal(validateBilling(form({ effective_date: "2028-02-29" })).valid, true);
  assert.ok(validateBilling(form({ end_mode: "specific_date", end_date: "2027-01-01" })).errors.end_date);
  for (const value of ["0", "29", "1.5"]) assert.ok(validateBilling(form({ billing_cycle_day: value })).errors.billing_cycle_day);
  for (const value of ["0", "-15", "1.5", "2147483648"]) assert.ok(validateBilling(form({ rounding_increment_minutes: value })).errors.rounding_increment_minutes);
  assert.ok(validateBilling(form({ rollover_enabled: "anything" })).errors.rollover_enabled);
});

test("billing section renders optional setup, current terms, history and no delete/edit pricing action", () => {
  const h = harness();
  const { CustomerBilling } = h.load("@/components/billing/customer-billing");
  const render = (agreements) => require("react-dom/server").renderToStaticMarkup(require("react").createElement(CustomerBilling, { customerId, agreements, today: "2027-01-01" }));
  const empty = render([]);
  assert.match(empty, /No retainer/);
  assert.match(empty, /Set up retainer/);
  const markup = render([fixture(), fixture({ effective_date: "2028-01-01" }), fixture({ effective_date: "2018-01-01", end_date: "2019-01-01" })]);
  for (const label of ["Monthly retainer", "$500.00", "1.5 hours / month", "$125.00 / hour", "Monthly on the 1st", "Beginning of period", "Each time entry rounds up to 15 minutes", "Do not roll over", "Until cancellation", "Current", "Future", "Ended", "End retainer"]) assert.ok(markup.includes(label), label);
  assert.doesNotMatch(markup, /delete|Edit billing/i);
});

test("setup action uses an explicit field whitelist and maps overlap errors", async () => {
  const h = harness();
  const { createRetainer } = h.load("@/actions/billing");
  await assert.rejects(createRetainer(customerId, {}, form({ id: "injected", customer_id: "injected", created_at: "injected" })), (error) => error.url === `/customers/${customerId}`);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].customer_id, customerId);
  const insert = h.calls.find((call) => call.operation === "insert").payload;
  for (const key of ["id", "created_at", "updated_at", "end_mode"]) assert.equal(key in insert, false);
  h.fail("23P01");
  assert.match((await createRetainer(customerId, {}, form())).message, /overlaps an existing agreement/);
  h.fail("42501");
  assert.doesNotMatch((await createRetainer(customerId, {}, form())).message, /Private technical details|42501/);
});

test("ending requires confirmation, preserves terms and row, returns no retainer at end boundary", async () => {
  const h = harness();
  h.rows.push(fixture());
  const { endRetainer } = h.load("@/actions/billing");
  const { businessDate, currentAgreement } = h.load("@/lib/billing/model");
  const today = businessDate();
  assert.ok((await endRetainer(customerId, agreementId, {}, form({ cancellation_mode: "now", end_date: today }))).errors.confirmation);
  assert.equal(h.rows[0].end_date, null);
  const before = { ...h.rows[0] };
  await assert.rejects(endRetainer(customerId, agreementId, {}, form({ cancellation_mode: "now", end_date: today, confirmation: "yes" })), (error) => error.url === `/customers/${customerId}`);
  assert.deepEqual(h.rows[0], { ...before, end_date: today });
  assert.equal(currentAgreement(h.rows, today), undefined);
  assert.equal(h.calls.filter((call) => call.operation === "update").length, 1);
  assert.deepEqual(h.calls.find((call) => call.operation === "update").payload, { end_date: today });
});

test("end action rejects stale, past, cross-customer and concurrent changes", async () => {
  const h = harness(); h.rows.push(fixture());
  const { endRetainer } = h.load("@/actions/billing");
  const today = h.load("@/lib/billing/model").businessDate();
  assert.ok((await endRetainer(customerId, agreementId, {}, form({ cancellation_mode: "scheduled", end_date: "2010-01-01", confirmation: "yes" }))).errors.end_date);
  assert.match((await endRetainer("32345678-1234-4234-8234-123456789012", agreementId, {}, form({ cancellation_mode: "now", end_date: today, confirmation: "yes" }))).message, /no longer current/);
  h.conflict();
  assert.match((await endRetainer(customerId, agreementId, {}, form({ cancellation_mode: "now", end_date: today, confirmation: "yes" }))).message, /changed while you were working/);
  assert.equal(h.rows[0].end_date, null);
});

test("billing reads and actions all require authentication", async () => {
  const h = harness(); h.denyAuth();
  const actions = h.load("@/actions/billing");
  const reads = h.load("@/lib/billing/server");
  for (const operation of [() => actions.createRetainer(customerId, {}, form()), () => actions.endRetainer(customerId, agreementId, {}, form()), () => reads.getBillingAgreements(customerId), () => reads.getBillingAgreement(customerId, agreementId)]) {
    await assert.rejects(operation(), (error) => error.url === "/login");
  }
  assert.equal(h.calls.length, 0);
});

test("billing reads scope by customer and load history past one page", async () => {
  const h = harness();
  h.rows.push(...Array.from({ length: 101 }, (_, index) => fixture({ id: String(index) })));
  h.rows.push(fixture({ customer_id: "other" }));
  assert.equal((await h.load("@/lib/billing/server").getBillingAgreements(customerId)).length, 101);
  assert.equal(h.calls.length, 2);
});


test("retainer duration requires a specific date or explicitly stores NULL until cancellation", () => {
  const { validateBilling } = harness().load("@/lib/billing/validation");
  assert.equal(validateBilling(form()).data.end_date, null);
  const cancelledDate = validateBilling(form({ end_date: "2028-01-01" }));
  assert.equal(cancelledDate.valid, true);
  assert.equal(cancelledDate.data.end_date, null);
  assert.equal("end_mode" in cancelledDate.data, false);
  const dated = validateBilling(form({ end_mode: "specific_date", end_date: "2027-04-01" }));
  assert.equal(dated.valid, true);
  assert.equal(dated.data.end_date, "2027-04-01");
  for (const end_date of ["", "2027-01-01", "2026-12-31", "2027-02-30"]) {
    assert.ok(validateBilling(form({ end_mode: "specific_date", end_date })).errors.end_date);
  }
  assert.ok(validateBilling(form({ end_mode: "unknown" })).errors.end_mode);
});

test("setup defaults to Until cancellation and exposes an explicit dated option", () => {
  const { BillingForm } = harness().load("@/components/billing/billing-form");
  const markup = require("react-dom/server").renderToStaticMarkup(require("react").createElement(BillingForm, { customerId, today: "2027-01-01" }));
  assert.match(markup, /Until cancellation/);
  assert.match(markup, /End on a specific date/);
  assert.match(markup, /checked=""[^>]*value="until_cancellation"/);
  assert.doesNotMatch(markup, /name="end_date"/);
});


test("End now ignores client dates, preserves history, and ends on the server New York date", async () => {
  const h = harness(); h.rows.push(fixture());
  const { endRetainer } = h.load("@/actions/billing");
  const { businessDate, currentAgreement, agreementStatus } = h.load("@/lib/billing/model");
  const today = businessDate();
  const original = { ...h.rows[0] };
  await assert.rejects(endRetainer(customerId, agreementId, {}, form({ cancellation_mode: "now", end_date: "2099-01-01", today: "1900-01-01", confirmation: "yes" })), (error) => error.url === `/customers/${customerId}`);
  assert.deepEqual(h.rows, [{ ...original, end_date: today }]);
  assert.equal(currentAgreement(h.rows, today), undefined);
  assert.equal(agreementStatus(h.rows[0], today), "Ended");
  assert.ok(h.calls.every((call) => call.operation !== "delete"));
  assert.deepEqual(h.calls.find((call) => call.operation === "update").payload, { end_date: today });
});

test("scheduled cancellation remains current before the date and ends on its exclusive boundary", async () => {
  const h = harness(); h.rows.push(fixture());
  const { businessDate, currentAgreement, agreementStatus } = h.load("@/lib/billing/model");
  const today = businessDate();
  const future = new Date(`${today}T12:00:00Z`);
  future.setUTCDate(future.getUTCDate() + 10);
  const endDate = future.toISOString().slice(0, 10);
  const before = { ...h.rows[0] };
  await assert.rejects(h.load("@/actions/billing").endRetainer(customerId, agreementId, {}, form({ cancellation_mode: "scheduled", end_date: endDate, confirmation: "yes" })), (error) => error.url === `/customers/${customerId}`);
  assert.deepEqual(h.rows, [{ ...before, end_date: endDate }]);
  assert.equal(currentAgreement(h.rows, today), h.rows[0]);
  assert.equal(currentAgreement(h.rows, endDate), undefined);
  assert.equal(agreementStatus(h.rows[0], endDate), "Ended");
  assert.ok(h.calls.every((call) => call.operation !== "delete"));
});

test("scheduled cancellation rejects today, past, missing and malformed dates", async () => {
  const h = harness(); h.rows.push(fixture());
  const today = h.load("@/lib/billing/model").businessDate();
  for (const endDate of [today, "2010-01-01", "", "2027-02-30"]) {
    const state = await h.load("@/actions/billing").endRetainer(customerId, agreementId, {}, form({ cancellation_mode: "scheduled", end_date: endDate, confirmation: "yes" }));
    assert.ok(state.errors.end_date);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.rows[0].end_date, null);
});

test("End now permits same-day start/end without a client date and preserves history", async () => {
  const h = harness(); h.rows.push(fixture());
  const actions = h.load("@/actions/billing");
  assert.ok((await actions.endRetainer(customerId, agreementId, {}, form({ cancellation_mode: "other", confirmation: "yes" }))).errors.cancellation_mode);
  const { businessDate, currentAgreement, agreementStatus } = h.load("@/lib/billing/model");
  const today = businessDate();
  h.rows[0].effective_date = today;
  const before = { ...h.rows[0] };
  await assert.rejects(actions.endRetainer(customerId, agreementId, {}, form({ cancellation_mode: "now", confirmation: "yes" })), (error) => error.url === `/customers/${customerId}`);
  assert.deepEqual(h.rows, [{ ...before, end_date: today }]);
  assert.equal(currentAgreement(h.rows, today), undefined);
  assert.equal(agreementStatus(h.rows[0], today), "Ended");
  assert.ok(h.calls.every((call) => call.operation !== "delete"));
  h.rows.push(fixture({ id: "successor", effective_date: today }));
  assert.equal(currentAgreement(h.rows, today).id, "successor");
});

test("end form defaults to End now with immediate confirmation and no date input", () => {
  const { EndRetainerForm } = harness().load("@/components/billing/end-retainer-form");
  const markup = require("react-dom/server").renderToStaticMarkup(require("react").createElement(EndRetainerForm, { customerId, agreementId, today: "2027-01-01", existingEnd: null }));
  assert.match(markup, /End now/);
  assert.match(markup, /Schedule an end date/);
  assert.match(markup, /retainer will end immediately/);
  assert.match(markup, /checked=""[^>]*value="now"/);
  assert.doesNotMatch(markup, /name="end_date"/);
});
