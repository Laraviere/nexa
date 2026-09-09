# Timer database foundation

Migration: `20260909160000_create_running_timers.sql`. No timer UI is included.

## Temporary state and API

`public.running_timers` stores UUID identity, a restrictive customer foreign key,
nonblank description, explicit billability, optional numeric(12,2) fallback hourly
rate, authoritative `started_at`, an immutable nullable `stop_requested_at`, and audit timestamps. A unique constant-expression
index enforces one running timer globally for Nexa's single-user workspace.
Completed work continues to live exclusively in `public.time_entries`.

Start through an authenticated INSERT, returning the timer ID:

```sql
insert into public.running_timers(customer_id, description, is_billable, hourly_rate)
values (:customer_id, :description, :is_billable, :fallback_rate)
returning *;
```

The guard trigger overwrites any supplied start/audit timestamps with database
clock values. Billable work requires an explicit fallback rate when no enabled
agreement covers the start's New York business date. A retainer's rate is never
copied into the fallback field. Description, billability and fallback rate can be
corrected while running; ID, customer, start time and creation time are immutable.
The existing updated-at trigger maintains updates.

Stop through the finalization RPC:

```sql
select * from public.stop_time_timer(:timer_id);
-- Supply a missing/corrected non-retainer fallback rate if necessary:
select * from public.stop_time_timer(:timer_id, :fallback_rate);
```

The RPC returns JSON with `status` (`completed` or `pending_finalization`),
`timer_id`, `stop_requested_at`, `entries` (completed rows, or an empty array),
`error_code`, and a safe `message`. A pending result is a failed finalization,
not successful completion. Future callers must inspect `status`. Consumers should order completed entries by `started_at`. Stop locks the timer,
establishes its first stop timestamp once, and then attempts all inserts and the
final DELETE inside an exception subtransaction. A finalization error rolls back
only that work and returns pending status. The outer timestamp update remains
committable. Retries reuse that timestamp; elapsed duration never grows afterward.

The pending result must be committed. Do not turn it into a database exception or
roll back an enclosing transaction. PostgreSQL cannot retain a write if the outer
transaction is aborted, the connection dies before commit, or the database fails.
For durability across those failures a separately committed stop-request operation
would be needed. This contract preserves time across handled finalization errors
and committed retries, including a lost response after commit.

Cancel uses `public.cancel_time_timer(timer_id)` after future UI confirmation.
It locks the row, returns false if missing, deletes a truly running row, and raises
55000 if Stop has been requested. Authenticated direct DELETE is denied, so pending
work cannot bypass this check. A pending row blocks new starts until finalized.
Only fallback rate/description/billability remain correctable; callers cannot set,
replace, or clear the stop timestamp. Start ignores a supplied stop timestamp.

## Duration, dates and billing context

Split the exact timestamp interval at each `America/New_York` midnight. Calendar
midnights account for 23-hour and 25-hour DST dates. Every segment stores its exact
start/end timestamps and the matching work date. Ending exactly at midnight does
not create a zero-length next-day segment.

Actual minutes are `ceil(elapsed_seconds / 60)` independently per segment. Thus
18m20s becomes 19 actual minutes, 30s becomes 1, and exactly 18m stays 18. Existing
billing rounding runs separately per entry: 19 actual becomes 30 at a 15-minute
increment. A 10m/20m midnight split produces 15/30 rounded minutes. Partial minutes
on opposite sides of midnight each round up; their sum can exceed rounding the
whole session once. Non-billable rounded minutes remain zero. A nonpositive elapsed
interval is rejected without discarding the timer.

Agreement snapshots are resolved at **Stop**, through the existing time-entry
INSERT trigger, separately for each work date. Start only checks rate availability;
it does not freeze agreement identity or terms. Adjacent versions therefore supply
their own rates, rounding and allowance snapshots to the relevant segments. Disabled
agreements do not govern newly finalized entries. Existing completed snapshots are
never rewritten. The existing usage RPC includes finalized timer entries normally.

Agreement periods are date-based, not intraday timestamp-based. A same-day terms
change applies according to the agreement covering that date at finalization.
There is no artificial intraday split or start-time agreement snapshot. Concurrent
agreement changes use the existing resolver's locking/revalidation and can require
a retry; finalization remains atomic.

If any billable segment has no retainer and no fallback rate, Stop returns
`pending_finalization` with error code 22023, retaining the original stop time and
no partial entries. Supply a rate and retry; segments still end at the original
stop time even if the retry occurs on another business date.
A supplied fallback cannot override the resolver's retainer rate.

## Concurrency and access

The singleton index protects simultaneous starts, including uncommitted inserts.
Stop and Cancel serialize on the same timer row. Only the winner can finalize or
cancel. Repeated Stop raises P0002 for a missing/finalized/canceled/hidden timer and
cannot duplicate entries. A Cancel that loses to successful Stop returns false; after failed Stop it rejects pending cancellation.

RLS is enabled. Authenticated has SELECT/INSERT/UPDATE on temporary state and
EXECUTE on Stop and Cancel. Anon and PUBLIC have no timer access. Direct DELETE
is reserved for `nexa_timer_executor`, a NOLOGIN/NOBYPASSRLS role that inherits
authenticated permissions and policies. Authenticated is not a member of that role.
Stop and Cancel use SECURITY DEFINER with this role as owner, an empty search path,
and schema-qualified application objects. The role does not own application tables
and cannot bypass their RLS. It adds only timer DELETE to authenticated privileges.
This avoids a superuser-owned definer and prevents direct cancellation of pending
work. Existing completed-entry DELETE remains denied. The trigger stays INVOKER.

This remains a single-user global workspace policy, not a per-user ownership model.
A future multi-user design must revisit both the singleton and policies. There is
no persistent timer-session/idempotency ledger: after a lost successful response,
repeated Stop is safe but returns P0002 rather than the original completed rows.
Future UI should refresh running state and completed history when reconciling an
uncertain response. Long-running timers can produce many daily rows; there is no
arbitrary duration cap in this foundation.

## Local regression coverage

Run `node --test tests/database/running_timers.test.mjs` against local Docker.
The runner creates a disposable database, replays all eight migrations, compares
existing table/view definitions and grants, and runs all seven SQL regression
scripts. SQL fixtures and temporary restrictive policies roll back.

Exact date/duration tests temporarily replace only the two new functions' clock
calls inside a rollback-only test transaction. The shipped functions have no
client-supplied or GUC clock override. Real two-session races subsequently exercise
the restored production functions and verify the real start clock, simultaneous
starts, double Stop, both Stop/Cancel orderings, failed Stop racing Cancel, and concurrent retries.

Additional cases cover rate validation, partial rollback, safe retry, authoritative
snapshots, enabled-state changes, usage integration, midnight and DST, non-billable
rounding, immutable fields, customer FK protection, inherited authenticated SELECT/INSERT/DELETE RLS, and
actual anonymous denial. No hosted commands are part of these tests.
