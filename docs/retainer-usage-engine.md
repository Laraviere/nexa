# Retainer allowance and overage engine

Migration: `20260908220000_create_retainer_usage_engine.sql`.

## API

```sql
select * from public.get_retainer_period_usage(
  p_billing_agreement_id => '<agreement UUID>',
  p_reference_date => date '2026-09-08'
);
```

The agreement determines the customer. The reference date must be finite and
inside the agreement's `[effective_date,end_date)` range. Missing/inaccessible
agreements raise `P0002`; missing parameters, outside-range dates and zero-length
agreement requests raise `22023`. An hourly/non-retainer context is not accepted.
No date is implicitly taken from the browser, server clock or session timezone.

One row is returned, even for an empty period:

| Field | Type |
| --- | --- |
| `customer_id`, `billing_agreement_id` | uuid |
| `period_start`, `period_end` | date |
| `included_minutes_available`, `rounded_minutes_used` | numeric |
| `included_minutes_used`, `remaining_included_minutes` | numeric |
| `overage_minutes`, `overage_amount` | numeric |
| `allocations` | jsonb ordered array, `[]` when empty |

Each allocation contains `time_entry_id`, `work_date`, `created_at`,
`rounded_minutes`, `included_minutes`, `overage_minutes`, and `hourly_rate`.
Per-entry dollar amounts are deliberately omitted: the period summary is the
only authoritative charge. No allocations or totals are persisted; a corrected, backdated
or voided entry affects the next calculation.

## Periods and snapshots

Build the billing-day anchor in the reference month; if it is after the reference
date, use the previous month. The natural end is one month after that anchor.
Clip start to the agreement's effective date and end to its non-NULL end date.
Days 1–28 avoid month-end substitutions. All operations use business dates.

Every version receives its full allowance on its effective date. With billing
day 15, changing terms September 8 gives old `[August 15, September 8)` and new
`[September 8, September 15)` periods, followed by `[September 15, October 15)`.
No proration or pooling across versions occurs, and unused allowance expires.

For eligible captured entries, the billing-day snapshot is authoritative. All
billable, non-voided entries within that agreement's effective range must agree
on one billing day; mixed captured days raise `22023`. This deliberately flags a
version whose calendar was changed in place, even if a conflicting entry lies
in another monthly cycle. Financial changes should create a successor version.
If there is no eligible captured calendar, use the governing agreement's day.

Within the selected period, captured included-hours and rollover snapshots must
agree. Conflicts raise `22023`. Captured values override later parent edits;
without eligible entries in the period, the governing agreement supplies those
terms. Captured hourly rates must also agree across all eligible entries in the
selected period, including entries fully covered by the allowance. Conflicts
raise `22023` with a clear hourly-rate snapshot error. Voided, non-billable and
outside-period rates do not participate. A consistent captured rate overrides
the parent rate; empty periods use the agreement rate and still charge zero. Administrative disabling never removes previously captured references
from the calculation.

Only billable, non-voided entries matching customer, agreement and `[start,end)`
contribute. Stored rounded minutes are authoritative; actual minutes are not
rerounded. Non-retainer entries never enter this engine.

## Allocation and precision

Order by `work_date`, `created_at`, then `id`, all ascending. With allowance B,
earlier usage U and entry rounded minutes R:

```
included = min(R, max(B - U, 0))
overage  = R - included
```

Earlier usage uses an explicit window frame ending one row before the current
entry, so timestamp/date ties are deterministic. A 30-minute entry after 45 of
60 included minutes are used receives 15 included and 15 overage minutes.

All authoritative arithmetic uses PostgreSQL `numeric`. Included hours multiply
by 60 exactly: 1 → 60, 1.5 → 90, 0.25 → 15. Fractional-minute allowances (e.g.
0.01 hours → 0.6 minutes) raise `22023`; they are neither silently rounded nor
silently truncated. Existing agreement entry validation permits such values, so
a future usage UI must surface this limitation or align allowance validation.

The authoritative USD amount is
`round(total_period_overage_minutes * consistent_captured_hourly_rate / 60, 2)`.
All arithmetic is PostgreSQL numeric. Sum the overage minutes first, multiply by
the single period rate, divide by 60, then round once to cents. No entry-level
amounts are calculated or returned. PostgreSQL numeric ties round away from zero.

Two one-minute overages at $0.30/hour total $0.01; rounding each entry would
incorrectly total $0.02. With 1 and 16 overage minutes at $125/hour, the period
charge is $35.42, whereas entry-level cent rounding would give $35.41. Minute
allocation and ordering remain unchanged. This supports the future summarized
billing-period overage charge; no invoice or monthly retainer fee is built here.

Rollover is unsupported: captured `rollover_enabled=true` raises `0A000`. Empty
periods with agreement rollover enabled also fail. A later parent setting cannot
override an existing period's captured setting. Mixed settings fail as conflicting
snapshots. The engine never silently calculates rollover as zero.

## Security, stability and performance

The function is `STABLE`, `SECURITY INVOKER`, with `search_path = ''` and qualified
application relations. EXECUTE is explicitly revoked from PUBLIC, anon,
authenticated and service_role, then granted only to authenticated. Owners retain
their normal owner privileges. No table or view grants/policies change.

Caller table privileges and RLS apply to every read. Totals describe only the
rows that caller can see; the single-user policies currently permit all
business rows to authenticated. Future multi-user access must ensure a user can
see the complete billing scope before treating their totals as customer-wide.

STABLE reads use one statement snapshot; concurrent writes do not mix old and
new data within a call. A later call can reflect a committed correction. This is
not an invoice finalization lock or a permanent financial snapshot.

Existing `(billing_agreement_id,work_date)` and customer/date indexes support the
filtered reads. Calendar consistency requires scanning the agreement's eligible
history; period allocation sorts only the selected period. No new index or
materialized totals were added. A JSON array avoids the API row limit truncating
allocations, but very large periods can produce large responses; a paginated
allocation API is a future optimization if measurement justifies it.

Agreement effective/end dates are not copied into time-entry snapshots. Approved
version changes therefore use the governing version's date bounds. Retroactive
boundary edits can leave previously captured entries outside that version's
range; these entries are excluded by the requested period rules and require
explicit business reconciliation. The engine does not reassign history.

## Verification

```
node --test tests/database/*.test.mjs
node --test tests/billing.test.mjs tests/customers.test.mjs tests/time.test.mjs
npm run lint
npm run typecheck
node --test tests/time.local.test.mjs
node --test tests/billing-change.local.test.mjs
```

The engine runner replays all seven migrations and six SQL regression suites in
a disposable local database, checks existing table/view schema is unchanged,
and verifies fixtures roll back. The HTTP suites each execute `npm run build`
and must run sequentially. The new migration is applied locally using
`npx supabase migration up --local`; no hosted changes or type regeneration.

References: PostgreSQL [numeric arithmetic](https://www.postgresql.org/docs/17/datatype-numeric.html),
[window frames](https://www.postgresql.org/docs/17/functions-window.html), and
[STABLE statement snapshots](https://www.postgresql.org/docs/17/xfunc-volatility.html).

The unapplied-to-hosted migration uses `CREATE OR REPLACE FUNCTION`, allowing its
corrected definition to be safely reapplied to the local database without dropping
the function, creating another migration version, or changing migration history.
The same migration is also validated from scratch by the disposable replay suite.
