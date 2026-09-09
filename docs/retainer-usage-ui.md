# Current retainer usage UI

The Billing section on `/customers/[id]` now requests usage for the current
agreement and the server's America/New_York business date. The date is computed
once and shared with current-agreement selection and the Billing display.
Customers without a current agreement make no usage RPC call and show no widget.

`src/lib/billing/usage-server.ts` uses the existing authenticated, cookie-backed
Supabase client and `get_retainer_period_usage`. Arguments and summary types are
aliases of generated Database types. Customer/agreement identity and returned
period applicability are checked before display. No time-entry sums, billing-day
period derivation, rate multiplication or authoritative money rounding occur in
application code. No new caching or persistence is introduced.

The workspace types initially lacked the RPC despite the supplied hosted-state
note. `database.ts` was regenerated from local Docker Supabase; the diff adds only
the generated RPC Args/Returns. This validates the local signature, not an
independent inspection of hosted Supabase. No hosted generation was run.

The summary displays the RPC's exclusive date range, included allowance, total
rounded usage, remaining allowance, overage minutes and its authoritative period
charge formatted as USD. Zero allowance reads “No included hours”; empty usage
retains the full allowance. The progress indicator uses RPC included minutes used
and allowance, while adjacent text also exposes total usage above the allowance.

Expandable native details display the allocation date and rounded, included and
overage minutes. A partially included entry keeps both allocation values. No
per-entry charges are invented. The generated allocations field is JSON, so a
runtime parser narrows just its display fields; malformed detail gets a friendly
fallback without exposing JSON or discarding valid period totals. The component
preserves RPC order and does not re-sort or re-allocate.

`0A000` maps to the rollover-not-supported message. `22023` maps to a billing
terms/date/allowance consistency message; `P0002` to an unavailable agreement;
`42501` to a permissions message; unexpected/network/invalid responses to a generic
usage-loading message. Errors stay within Billing so other customer information
remains accessible. Raw database messages are never rendered.

Saving manual time invalidates the affected customer detail page as well as
`/time`. The Time page has a short instruction pointing users to the customer
for current usage; it does not request an RPC for every historical entry.
Historical browsing, invoices, timers, services and payments remain out of scope.

## Validation

```
node --test tests/billing.test.mjs tests/customers.test.mjs tests/time.test.mjs tests/retainer-usage-ui.test.mjs
node --test tests/database/*.test.mjs
npm run lint
npm run typecheck
node --test tests/retainer-usage-ui.local.test.mjs
node --test tests/time.local.test.mjs
node --test tests/billing-change.local.test.mjs
```

Run HTTP suites sequentially: each invokes `npm run build` and starts a local
production server. The usage suite signs in with a synthetic local account,
checks rendered customer pages against actual RPC results, and cleans up only
its own fixtures. It covers current/empty/zero allowance, partial overage, stored
rounding, void/non-billable exclusion, fresh version periods, exact RPC money,
rollover errors, no-retainer customers and unauthenticated access.

React streams closed details content separately from the initial panel markup;
the HTTP assertions inspect the complete response for allocations. Interactive
browser verification was unavailable. No migrations, database functions, RLS,
grants or hosted state were changed for this UI step; pre-existing migration,
SQL-test and engine-documentation edits were preserved.
