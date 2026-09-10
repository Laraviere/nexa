# Operational dashboard

`/dashboard` uses the authenticated Supabase server client and existing RLS. The overview has no mutations, service-role usage, schema changes, charts or new dependencies. A failed core read shows an error/retry screen rather than misleading zero values. All business dates come from the server's America/New_York date; monthly metrics use calendar month start inclusive, next month start exclusive. Retainer periods remain agreement-specific and are supplied by the existing RPC.

## Read sources

- Outstanding: positive `invoice_payment_summary.balance_due` for non-Void invoices, including Draft. Values are summed in integer cents without recomputing balances.
- Ready count: database exact count of workflow `ready`, including settled Ready invoices.
- Payments this month: stored amounts of non-voided `invoice_payments`, by `payment_date`, including legitimate historical payments on Draft/Void invoices.
- Billable time this month: stored `rounded_minutes`, by `work_date`, for billable, non-voided completed time entries. Actual minutes are not used for this KPI.
- Invoice attention: overdue positive balances first, then Ready, Sent, partially paid, Draft. Overdue means due date before today's New York date, positive balance, non-Void. Six rows, stable due-date/invoice-number tie-breaking. The summary view has no exposed relationship, so invoice metadata is batch-read. Six additional Draft candidates allow zero-balance preparation work to appear.
- Recent payments: five active ledger rows ordered by payment date, creation time, ID; embedded invoice number/customer snapshot and friendly method labels. Future-dated recorded payments can appear in recent history but not in the current-month KPI.
- Retainers: currently effective, enabled agreements only. At most 25 agreements, five concurrent `get_retainer_period_usage` calls at a time. The response selects summary columns (not allocation JSON); no allowance calculation is duplicated. Overage first, then <=25% remaining; zero allowance alone is omitted. Five attention rows. Per-agreement errors and incomplete coverage are displayed explicitly.
- Recent time: five completed, non-voided entries ordered by creation time and ID. Actual and stored rounded billable durations are both shown, with customer links.
- Timer: existing `running_timers` read. Running display advances from the server observation using a monotonic elapsed clock; pending finalization uses its fixed stop timestamp. Dashboard provides only a link to Time, with no timer mutation controls.

Quick actions link to `/invoices/new`, `/time/new`, `/time`, `/customers/new`; an existing timer changes Start Timer to View Timer. KPI cards wrap into two/four columns, lists form two desktop columns and one mobile column, and long text wraps. There are no horizontally scrolling tables.

## Existing database limits

The local API returns `PGRST123` for aggregate selects (aggregates disabled). Existing views/RPCs provide no dashboard-wide sums or grouped retainer scan. No database configuration or objects were changed. The fallback reads only filtered numeric KPI columns, in pages of 200, capped at 2,000 rows per metric with a one-row overflow probe. Incomplete totals display Unavailable, never a truncated number; incomplete invoice/retainer scans carry visible notices. This is bounded for current single-user scale, not an unlimited reporting solution.

A future read-only dashboard summary/attention RPC could perform sums, joins and priority limits inside PostgreSQL and provide one consistent snapshot. A grouped retainer attention endpoint could replace up to 25 usage calls. Separate reads currently represent a live overview, not one atomic financial report; records changing during pagination can affect the observation. Authoritative invoice/customer detail remains the place to act.

## Validation

`tests/dashboard.test.mjs` covers New York midnight/month/year and DST boundaries, exact cent sums, priority, allowance thresholds, empty/limited states, quick links, responsive structure, and running/fixed timer rendering. `tests/dashboard.local.test.mjs` exercises the read layer with an authenticated local RLS client, fixture KPI deltas, exclusions, retainer RPCs, running and pending timers, and the real Next HTTP route/authentication. Fixtures are archived/voided and business settings restored; existing developer timers are preserved. Browser automation was unavailable in this session; rendered mobile clipping and visual review remain manual checks.
