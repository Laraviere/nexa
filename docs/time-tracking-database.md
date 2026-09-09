# Time Tracking database foundation

Migration: `20260908180000_create_time_entries.sql`. This is a local foundation;
it does not introduce Time Tracking UI, running timers, services, allocation, or invoices.

## Complete `public.time_entries` schema

| Column | PostgreSQL type / default | Purpose |
| --- | --- | --- |
| `id` | `uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()` | Stable record and allocation tie-breaker. |
| `customer_id` | `uuid NOT NULL` | Customer reference; restrictive FK. |
| `billing_agreement_id` | `uuid NULL` | Dated agreement captured at insertion; NULL means non-retainer work. |
| `work_date` | `date NOT NULL` | Explicit New York business date; finite, no implicit current-date default. |
| `description` | `text NOT NULL` | Work description; at least one non-whitespace character. |
| `actual_minutes` | `integer NOT NULL` | Positive whole minutes of actual work. |
| `is_billable` | `boolean NOT NULL DEFAULT true` | Determines whether the entry has billing/allowance consumption. |
| `rounding_increment_minutes` | `integer NOT NULL DEFAULT 15` | Positive immutable rounding snapshot; agreement overrides default for retainers. |
| `rounded_minutes` | `bigint GENERATED ALWAYS ... STORED NOT NULL` | Per-entry rounded billing duration, zero when non-billable. |
| `hourly_rate` | `numeric(12,2) NULL` | Immutable USD hourly/overage rate snapshot. Required for billable work. |
| `billing_cycle_day_snapshot` | `integer NULL` | Retainer period anchor, 1–28. |
| `included_hours_snapshot` | `numeric(10,2) NULL` | Retainer allowance terms, not allocation or an allowance per entry. |
| `rollover_enabled_snapshot` | `boolean NULL` | Captured retainer setting; no rollover calculation yet. |
| `started_at` | `timestamptz NULL` | Optional completed timer's exact start. |
| `ended_at` | `timestamptz NULL` | Optional exact end, paired with start. |
| `voided_at` | `timestamptz NULL` | Soft-void marker; no hard DELETE privilege. |
| `void_reason` | `text NULL` | Required nonblank reason when voided. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Stable creation order; immutable on UPDATE. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Maintained by the existing `public.set_updated_at()` trigger. |

## Actual and billable duration

The generated column calculates `((actual + increment - 1) / increment) * increment`
with integer division. Casting to bigint **before** addition prevents integer
overflow. No floating-point time or money calculations are used.

At increment 15, actual durations 1, 15, 16, 18, 31, 46 produce 15, 15, 30, 30,
45, 60 billing minutes. Two separate 18-minute entries produce 60 billing
minutes, not 45. Non-billable entries retain actual time but produce zero rounded
minutes. Voided entries retain both durations for history; usage queries must
exclude `voided_at IS NOT NULL`.

The client cannot insert or update an arbitrary rounded duration. Corrections to
actual minutes automatically recalculate it using the original rounding snapshot.

## Resolution, snapshots and correction

The SECURITY INVOKER `capture_time_entry_billing` trigger resolves the customer's
agreement whose `[effective_date, end_date)` range contains `work_date`. Empty
periods cover no date. Resolution uses dated history, not today's current agreement.
New entries also require `is_active = true`. A disabled agreement does not govern
newly recorded work, even when its dates apply. Existing entries retain their
captured agreement ID and snapshots after that agreement is disabled; UPDATE
does not run agreement resolution again.

For retainer work the trigger copies agreement ID, rounding increment, overage
rate, billing day, included hours and rollover setting. Caller-supplied versions
of those snapshots cannot override the source terms. If an explicit agreement ID
does not match the customer/date resolution, insertion fails.

The selected agreement is locked with `FOR SHARE`, then its customer/date and
`is_active` status are rechecked. If a concurrent change invalidated or disabled it while
the insert waited, SQLSTATE `40001` asks the caller to retry the whole operation.
The exclusion constraint guarantees at most one dated agreement. A no-agreement
result represents the state at capture; later agreement creation does not
retroactively reclassify existing entries.

For non-retainer work the caller explicitly supplies the hourly rate for billable
entries. No customer default rate, service dependency or invented zero/free rate
is introduced. Zero is permitted when intentionally supplied. The rounding
increment defaults to 15 and can be explicitly supplied. Non-billable non-retainer
work may have a NULL rate. Retainer-only snapshots are NULL for non-retainer work.

Identity, customer, work date, agreement, rate, rounding and retainer snapshots are
immutable after INSERT. Correct those by voiding and creating a replacement.
Description, actual duration, billable flag and optional completed-timer evidence
can be corrected now, while all records are uninvoiced. Changing non-billable time
with a NULL rate to billable cannot bypass the required-rate constraint; a
replacement with an explicit rate is needed. This is a modest correction strategy,
not a full audit log.

Later agreement amendments, including same-day cancellation/change, never refresh
existing snapshots during description/duration edits. Any intentional retrospective
reconciliation must be explicit; the reference remains to the captured version.

## Billing state and future invoices

There are no invoices in this foundation, so **all non-voided billable entries are
unbilled**. `public.unbilled_time_entries` is a read-only SECURITY INVOKER view of
exactly those rows, using the caller's table privileges and RLS. There is no
independent billed boolean/string, fake invoice ID, or unvalidated billed timestamp.

The future invoice migration must atomically introduce actual invoice-line or
allocation linkage, revise this view to exclude linked time, and forbid correction,
voiding or deletion of invoice-linked entries. It must also handle concurrent
invoice generation and credit/reversal semantics before invoicing is enabled.
Invoice lines must snapshot billed amounts, rates, durations and allocation; they
must not recalculate issued invoices from mutable source agreements.

One time entry may feed multiple invoice components (included/overage), so an
allocation/link table may be more appropriate than forcing a single invoice item
ID into each entry. That decision remains with the invoice foundation.

## Billing periods and partial overage

Use the entry's snapshotted billing day, never `date_trunc('month', work_date)` as
an assumed period start. Construct the anchor in the work-date month; if the work
date precedes it, use the previous month's anchor. The exclusive end is one
calendar month after that start. Dates 1–28 exist in every month.

Clip this monthly cycle to the governing agreement's `[effective_date, end_date)`:
the allowance period starts at the later of the monthly anchor and `effective_date`,
and ends at the earlier of the next monthly anchor and a non-NULL `end_date`.
NULL `end_date` imposes no upper limit. An empty agreement range covers no work date.

**Every new agreement version starts a fresh, full included-hours allowance on
its effective date. Do not prorate included hours between versions.** For billing
day 15, with old terms providing 1 hour and new terms effective September 8
providing 2 hours:

| Agreement | Allowance period (exclusive end) | Full included hours |
| --- | --- | --- |
| Old | August 15 → September 8 | 1 |
| New | September 8 → September 15 | 2 |
| New | September 15 → October 15 | 2 |

Group allocation by **customer, governing `billing_agreement_id`, and
agreement-specific period**. Never merge different versions merely because their
work dates fall in the same nominal monthly cycle. Existing references, date
ranges and billing-day/included-hours snapshots support this without new columns.
Historical allocation must use the captured reference even if that agreement is
later administratively disabled; the enabled filter applies only to new resolution.

Usage is the sum of rounded billable, non-voided minutes in the applicable
agreement-specific customer period. The future engine must use a single allowance
per such period, not sum `included_hours_snapshot` across entries. Convert hours to minutes with exact numeric
arithmetic; two-decimal hours may produce fractional allowance minutes.

A deterministic order can use `work_date`, then `created_at`, then `id`. Optional
start timestamps can provide finer ordering later if an explicit policy defines
where untimed manual entries fall. For allowance B, earlier rounded usage U and
entry duration R:

```
included = min(R, max(B - U, 0))
overage  = R - included
```

B=60, U=45, R=30 yields 15 included and 15 overage. Backdated/corrected/voided
uninvoiced entries may change that allocation, so neither included nor overage
minutes are permanently classified in this table.

The allowance-period policy above is settled; the allocation engine is not
implemented here. Fee proration, rollover, and reconciliation of changes crossing
previously invoiced usage still belong to future billing/invoice work.

## Future timers

Start/end timestamps are optional together, finite and strictly increasing.
`work_date` must match the start's New York date; the exclusive end may reach its
next midnight but cannot cross it. The stored actual whole minutes must equal
`ceil(elapsed_seconds / 60)`. Exact timestamps retain seconds, including partial
minutes and DST effects.

A future running-timer lifecycle can be separate and produce completed entries
on stop; no historical table replacement is required. Split work at New York
midnight before insertion so every entry has one governing work date. Each split
entry rounds independently under this foundation's per-entry rule; the timer UX
must make that policy explicit. No incomplete timer record is inserted here.

## Integrity, indexes and privileges

Both customer and agreement FKs use ON UPDATE/DELETE RESTRICT. The agreement FK
uses `(billing_agreement_id, customer_id)` and a new unique key on the agreement's
`(id, customer_id)`. This necessary supporting index is the only structural change
to an existing table. Even an owner cannot move a referenced agreement to a
different customer or cascade away referenced business history.

Checks enforce positive actual minutes/increment, nonnegative generated minutes,
nonnegative finite rates/allowances (numeric typmods reject infinities and overflow;
checks reject NaN), required billable rates, complete retainer snapshots, finite
work dates/audit timestamps, valid optional timer pairs and paired void reasons.

Indexes, beyond the primary key:

- `(customer_id, work_date, created_at, id)` for customer history and periods.
- `(billing_agreement_id, work_date) WHERE billing_agreement_id IS NOT NULL` for
  agreement usage and FK checks.
- `(work_date, created_at, id)` for work lists across customers.
- `(customer_id, work_date, created_at, id) WHERE is_billable AND voided_at IS NULL`
  for the initial unbilled queue; revisit when invoice linkage is added.

RLS has authenticated SELECT/INSERT/UPDATE policies. Explicit table grants are
SELECT/INSERT/UPDATE only; PUBLIC and anon access are revoked, with no DELETE or
TRUNCATE for authenticated. The view grants only SELECT. The trigger function has
an empty search path, runs as invoker, and is not granted as an application RPC.
There are no service-role client credentials or authorization bypasses.

## Local verification

```
node --test tests/database/time_entries.test.mjs
docker exec -i supabase_db_nexa psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < tests/database/time_entries.sql
node --test tests/billing.test.mjs tests/customers.test.mjs
npm run lint
npm run typecheck
node --test tests/billing-change.local.test.mjs
```

The database runner replays migrations and all database regression scripts in a
disposable local database. It checks enabled/disabled resolution, retained history,
and real concurrent terms-change/disable races. A transaction-only restrictive
policy and two synthetic caller identities prove the unbilled view enforces table
RLS, in addition to checking its `security_invoker = true` configuration and anon
denial. Test fixtures and the temporary policy are rolled back.
The existing billing functional test runs `npm run build`
and real authenticated Next HTTP requests against local Supabase, cleaning up its
own fixtures. No hosted type regeneration is appropriate until hosted application.

PostgreSQL references: [generated columns](https://www.postgresql.org/docs/17/ddl-generated-columns.html)
and [invoker views](https://www.postgresql.org/docs/17/sql-createview.html).
