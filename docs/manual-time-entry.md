# Manual Time Entry

`/time` lists the newest recorded entries, with 25 entries per page, customer
links, work dates, stored actual/rounded duration, billability and captured
retainer context. Voided rows remain visible and are labeled excluded from usage.
`/time/new` records completed manual work. Neither route offers deletion,
corrections, timers, invoicing, or allowance allocation.

The form starts on today's America/New_York business date. Hours and minutes
become positive integer `actual_minutes`. Customer/date changes request fresh
authenticated context at `/time/context`; aborted/stale responses cannot replace
the selected context. Archived customers remain selectable for historical work.

Context requires enabled agreements and `[effective_date,end_date)` date
applicability. The server action authenticates independently, validates inputs,
and reads context again before inserting an explicit whitelist. No client-supplied
agreement IDs, snapshots, rounding, timestamps, or void fields reach the insert.
The database resolver remains authoritative, including after concurrent changes.
Only non-retainer billable work requires a supplied nonnegative USD hourly rate.
The saved list reads database-generated rounded minutes; it never calculates
authoritative rounding in the browser or classifies included/overage usage.

No separate unbilled flag or view mutation is introduced. The recent list reads
`time_entries` because it must include non-billable and voided history as well.

## Validation and environment notes

The workspace's supplied `database.ts` did not contain the Time Tracking types.
It was regenerated using `supabase gen types --local --schema public,graphql_public`.
The generated table/view relationships include both the customer FK and composite
agreement/customer FK; existing customer, agreement and billing-RPC shapes remain
intact. Trigger helpers are not application RPCs. The local generator permits
rounded/view fields in write types, but those types do not override generated
column restrictions or database privileges; the action whitelist excludes them.
This file was not regenerated from or compared with the live hosted project.

The installed development database still has the earlier resolver without the
`is_active` filter. It was left unchanged under the instruction not to alter
triggers/schema. Fresh disposable replay of the final migration passes enabled,
disabled, historical-reference and concurrency regressions. Local HTTP tests
cover enabled historical agreements, hourly work and non-billable work; they do
not establish disabled-agreement behavior for the stale development installation.
Reconcile that local installation before using disabled agreements in manual QA.

Validation commands (run the two build-owning HTTP suites sequentially):

```
node --test tests/billing.test.mjs tests/customers.test.mjs tests/time.test.mjs
node --test tests/database/*.test.mjs
npm run lint
npm run typecheck
node --test tests/time.local.test.mjs
node --test tests/billing-change.local.test.mjs
```

Each HTTP suite runs `npm run build`, starts a local production server, uses
synthetic authenticated fixtures against Docker Supabase, and cleans up only its
own records. No migrations, policies, grants or hosted state change. Interactive
browser testing was unavailable; rendered pages and Server Actions were verified
over HTTP.
