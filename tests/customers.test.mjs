import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real TypeScript modules with an in-memory Supabase boundary.
// These checks do not replace an authenticated smoke test against Supabase/RLS.
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const id = "12345678-1234-4234-8234-123456789012";
function harness() {
  const rows = new Map();
  const calls = [];
  const revalidated = [];
  let authenticated = true;
  let failure = false;
  const client = {
    auth: { getClaims: async () => ({ data: authenticated ? { claims: { sub: "test-user" } } : null, error: null }) },
    from(table) {
      assert.equal(table, "customers");
      let operation = "select", payload, target, active, range;
      const query = {
        insert(value) { operation = "insert"; payload = value; return query; },
        update(value) { operation = "update"; payload = value; return query; },
        select() { return query; },
        eq(field, value) { if (field === "id") target = value; if (field === "is_active") active = value; return query; },
        order() { return query; },
        range(from, to) { range = [from, to]; return query; },
        or(value) { calls.push({ filter: value }); return query; },
        async single() { return execute(true); },
        async maybeSingle() { return execute(true); },
        then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
      };
      function execute(single) {
        calls.push({ operation, payload, target, active, range });
        if (failure) return { data: null, error: { message: "private database error" } };
        if (operation === "insert") rows.set(id, { ...payload, id, is_active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
        if (operation === "update" && rows.has(target)) rows.set(target, { ...rows.get(target), ...payload });
        if (single) return { data: rows.get(target ?? id) ?? null, error: null };
        const data = [...rows.values()].filter((row) => active === undefined || row.is_active === active);
        return { data: range ? data.slice(range[0], range[1] + 1) : data, count: data.length, error: null };
      }
      return query;
    },
  };
  function signal(type, value) { throw Object.assign(new Error(type), { type, value }); }
  const overrides = {
    "server-only": {},
    "next/navigation": { redirect: (url) => signal("redirect", url), notFound: () => signal("notFound") },
    "next/cache": { revalidatePath: (...args) => revalidated.push(args) },
    "@/lib/supabase/server": { createClient: async () => client },
    "next/link": { __esModule: true, default: ({ children, ...props }) => require("react").createElement("a", props, children) },
  };
  const cache = new Map();
  function load(name) {
    if (name in overrides) return overrides[name];
    if (!name.startsWith("@/")) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const base = path.join(root, "src", name.slice(2));
    const filename = [base + ".ts", base + ".tsx"].find(fs.existsSync);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loadedModule = { exports: {} };
    cache.set(name, loadedModule);
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(load, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return { load, rows, calls, revalidated, setAuthenticated: (value) => { authenticated = value; }, setFailure: (value) => { failure = value; } };
}
function form(values = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ company_name: "  Acme  ", default_payment_terms_days: "30", ...values })) data.set(key, value);
  return data;
}
function redirected(promise, destination) {
  return assert.rejects(promise, (error) => error.type === "redirect" && error.value === destination);
}

test("validation trims text, normalizes optional blanks and rejects invalid input", () => {
  const { validateCustomer, paymentTermsLabel } = harness().load("@/lib/customers/validation");
  const valid = validateCustomer(form({ primary_contact_name: "  Jane Smith  ", email: " jane@example.com ", notes: "  " }));
  assert.equal(valid.valid, true);
  assert.equal(valid.data.company_name, "Acme");
  assert.equal(valid.data.primary_contact_name, "Jane Smith");
  assert.equal(valid.data.email, "jane@example.com");
  assert.equal(valid.data.notes, null);
  assert.ok(validateCustomer(form({ company_name: " \n " })).errors.company_name);
  assert.ok(validateCustomer(form({ email: "bad@" })).errors.email);
  for (const days of ["-1", "1.5", "", "NaN", "Infinity", "2147483648", "1e3"]) {
    assert.ok(validateCustomer(form({ default_payment_terms_days: days })).errors.default_payment_terms_days, days);
  }
  for (const days of ["0", "15", "30", "45", "60", "22"]) assert.equal(validateCustomer(form({ default_payment_terms_days: days })).valid, true);
  assert.equal(paymentTermsLabel(0), "Due on receipt");
  assert.equal(paymentTermsLabel(22), "Net 22");
});

test("create, read, edit, archive, inactive filter and reactivate workflow", async () => {
  const h = harness();
  const actions = h.load("@/actions/customers");
  const reads = h.load("@/lib/customers/server");
  const list = h.load("@/app/(app)/customers/page").default;
  const render = require("react-dom/server").renderToStaticMarkup;
  assert.match(render(await list({ searchParams: Promise.resolve({}) })), /No active customers/);
  await redirected(actions.saveCustomer(null, {}, form({ id: "injected", created_at: "injected", updated_at: "injected", is_active: "false" })), `/customers/${id}`);
  assert.equal((await reads.getCustomer(id)).company_name, "Acme");
  const inserted = h.calls.find((call) => call.operation === "insert").payload;
  for (const key of ["id", "created_at", "updated_at", "is_active"]) assert.equal(key in inserted, false);
  assert.match(render(await list({ searchParams: Promise.resolve({}) })), /Acme/);
  await redirected(actions.saveCustomer(id, {}, form({ company_name: "Updated Co", default_payment_terms_days: "22" })), `/customers/${id}`);
  assert.equal((await reads.getCustomer(id)).default_payment_terms_days, 22);
  assert.equal(h.rows.get(id).company_name, "Updated Co");
  const unconfirmed = await actions.setCustomerActive(id, false, {}, new FormData());
  assert.match(unconfirmed.message, /Confirm/);
  assert.equal(h.rows.get(id).is_active, true);
  await actions.setCustomerActive(id, false, {}, form({ confirm_archive: "yes" }));
  assert.equal(h.rows.get(id).is_active, false);
  assert.doesNotMatch(render(await list({ searchParams: Promise.resolve({}) })), /Updated Co/);
  assert.match(render(await list({ searchParams: Promise.resolve({ status: "archived" }) })), /Updated Co/);
  await actions.setCustomerActive(id, true, {}, new FormData());
  assert.match(render(await list({ searchParams: Promise.resolve({}) })), /Updated Co/);
  assert.equal(h.rows.get(id).is_active, true);
  assert.equal(h.revalidated.length, 4);
  assert.ok(h.calls.every((call) => call.operation !== "delete"));
});

test("authentication guards reads and every mutation", async () => {
  const h = harness();
  h.setAuthenticated(false);
  const actions = h.load("@/actions/customers");
  await redirected(h.load("@/lib/customers/server").getCustomer(id), "/login");
  await redirected(actions.saveCustomer(null, {}, form()), "/login");
  await redirected(actions.saveCustomer(id, {}, form()), "/login");
  await redirected(actions.setCustomerActive(id, false, {}, form({ confirm_archive: "yes" })), "/login");
  await redirected(actions.setCustomerActive(id, true, {}, form()), "/login");
  assert.equal(h.calls.length, 0);
});

test("invalid and missing IDs use not-found behavior; errors do not leak", async () => {
  const h = harness();
  const reads = h.load("@/lib/customers/server");
  for (const customerId of ["invalid", id]) await assert.rejects(reads.getCustomer(customerId), (error) => error.type === "notFound");
  const actions = h.load("@/actions/customers");
  const invalid = await actions.saveCustomer(null, {}, form({ company_name: " " }));
  assert.ok(invalid.errors.company_name);
  h.setFailure(true);
  for (const result of [await actions.saveCustomer(null, {}, form()), await actions.saveCustomer(id, {}, form()), await actions.setCustomerActive(id, true, {}, form())]) {
    assert.match(result.message, /Unable/);
    assert.doesNotMatch(result.message, /private database error/);
  }
  assert.equal(h.revalidated.length, 0);
});

test("list search quotes filter syntax and keeps pagination server-side", async () => {
  const h = harness();
  await h.load("@/app/(app)/customers/page").default({ searchParams: Promise.resolve({ q: 'a,b_%"', status: "all", page: "2" }) });
  assert.deepEqual(h.calls.find((call) => call.operation === "select").range, [25, 49]);
  const filter = h.calls.find((call) => call.filter).filter;
  assert.ok(filter.startsWith('company_name.ilike."%'));
  assert.ok(filter.includes('primary_contact_name.ilike."%'));
  assert.ok(filter.includes('\\"'));
  assert.ok(filter.includes('\\\\_'));
  assert.ok(filter.includes('\\\\%'));
});

test("detail and shared form render customer fields, New York dates and no delete UI", async () => {
  const h = harness();
  await redirected(h.load("@/actions/customers").saveCustomer(null, {}, form({ primary_contact_name: "Jane Smith", billing_address_line1: "100 Main St", notes: "Customer notes" })), `/customers/${id}`);
  const render = require("react-dom/server").renderToStaticMarkup;
  const detail = render(await h.load("@/app/(app)/customers/[id]/page").default({ params: Promise.resolve({ id }) }));
  for (const value of ["Acme", "Jane Smith", "100 Main St", "Customer notes", "Net 30", "Dec 31, 2025", "Archive customer", "Edit customer"]) assert.ok(detail.includes(value), value);
  assert.doesNotMatch(detail, /delete/i);
  const { CustomerForm } = h.load("@/components/customers/customer-form");
  const markup = render(require("react").createElement(CustomerForm, { customer: { ...h.rows.get(id), default_payment_terms_days: 22 } }));
  for (const field of h.load("@/lib/customers/validation").textFields) assert.ok(markup.includes(`name="${field}"`), field);
  assert.ok(markup.includes('name="default_payment_terms_days"'));
  assert.ok(markup.includes('value="22"'));
  for (const field of ["id", "created_at", "updated_at"]) assert.ok(!markup.includes(`name="${field}"`));
});
