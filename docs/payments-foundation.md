# Payments database foundation

Migration: `20260917120000_create_invoice_payments.sql`. This milestone adds only database objects and regression coverage. Existing applied migrations, invoice financial calculations, invoice workflow statuses, source claims, UI, PDF and hosted schema are unchanged.

## Settings

`payment_settings` is a business-wide singleton: a boolean primary key constrained to true, seeded by the migration. Cash, Check and Card all default to enabled. All flags are non-null and at least one must be true. Authenticated callers can SELECT and UPDATE; they cannot insert, delete or truncate the singleton. Its identity/creation timestamp are guarded and `set_updated_at()` maintains the update timestamp.

`update_payment_settings(p_cash_enabled boolean, p_check_enabled boolean, p_card_enabled boolean)` validates all flags, updates the singleton atomically and returns it. Guarded direct UPDATE is also supported. No existing Settings table was present. All authenticated internal users share these settings; there are no per-user preferences or invented administrator roles.

The payment INSERT trigger reads this row `FOR SHARE` until transaction completion. A concurrent settings change serializes with that read. If disabling a method wins first, the payment fails; if the payment wins first, it commits validly and disabling affects only later payments. No historical payment is invalidated.

## Ledger

`invoice_payments` contains UUID `id`, required restrictive `invoice_id` FK, exact `amount`, date-only `payment_date`, `payment_method` (`cash`, `check`, `card` only), optional reference/notes, required unique `request_id`, void timestamp/reason, and creation/update timestamps. Reference is limited to 500 characters, notes to 10,000, and void reason to 2,000. Blank optional RPC fields normalize to null.

Amount uses unrestricted PostgreSQL `numeric` with checks enforcing `0 < amount <= 9999999999.99` and `amount = trunc(amount,2)`. This intentionally has the effective range/precision of numeric(12,2) without silently rounding excess fractional cents before validation. NaN, infinities, zero and negatives are rejected on direct inserts as well as through the RPC. Trailing zero precision is logically equivalent (100 and 100.00 are the same amount).

Payment dates must be finite. RPC callers supply a date; the direct table default uses the New York business date. No time-zone conversion of supplied dates and no artificial ban on historical/future date-only values are introduced. Creation time is server managed, with the existing transaction-timestamp convention; void time uses the authoritative clock.

Original payment details, invoice association and request key are immutable. To correct an entry, void it with a reason and record a new payment with a new request key. `void_invoice_payment(p_payment_id uuid, p_reason text)` stamps the void time and returns the historical row. Repeating the same reason is safe; conflicting reasons or attempts to unvoid/rewrite history are rejected. This is correction of a ledger entry, not a refund or movement of money.

## Record RPC and retries

```sql
record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_request_id uuid,
  p_reference text default null,
  p_notes text default null
)
```

Returns payment_id, invoice_id, payment_voided_at, invoice_total, amount_paid, balance_due, payment_status, payment_count and latest_payment_date. The original migration accepted Draft, Ready and Sent. Follow-up `20260918120000_require_payment_eligible_invoice.sql` restricts NEW payments to Ready/Sent under the same invoice lock; Draft raises SQLSTATE `P1001`, Void retains its existing rejection. No historical payment changes, and exact-key retries return the original record even on Draft/Void. Invoice editability is unchanged.

Request UUIDs belong to the payment namespace, independent of invoice creation/edit request UUIDs. A transaction advisory lock plus unique constraint prevents duplicate submissions. Same key and normalized payment details return the same payment ID with the **current** summary; conflicting details fail. A retry after disabling the method, voiding the payment or voiding its invoice returns the original accessible payment without recreating it. `payment_voided_at` makes a corrected original payment explicit.

## Balances and invoice edits

`invoice_payment_summary` is a `security_invoker` view over authoritative `invoice_totals` and non-voided payments. It exposes invoice_id, invoice_status, invoice_total, amount_paid, balance_due, payment_status, payment_count and latest_payment_date. No duplicated stored balance or invoice paid boolean is introduced. Partial and multiple payments sum with PostgreSQL numeric arithmetic; exactly the remaining amount succeeds, exceeding it fails.

Payment status is `unpaid`, `partially_paid` or `paid`, separate from Draft/Ready/Sent/Void. A zero-total invoice has zero balance and is considered paid with zero payment records. Void invoice summaries remain historical: their valid payments are retained, and their displayed balance must not be presented as collectible in future UI. Voiding an invoice does not reverse any payments. Individual payment corrections remain possible on a Void invoice.

Payment inserts/corrections touch and lock the parent invoice row, the same serialization point used by existing invoice edits, child writes and voids. Under repeatable-read isolation this creates a real row version so stale transactions fail with serialization errors rather than relying on an outdated balance. Callers must retry failed transactions with the same request key.

Two initially deferred constraint triggers (on invoice_items and invoice_payments) check that valid payments do not exceed the final invoice total. This also prevents later invoice edits from creating an unsupported credit balance. Atomic edits may temporarily retire lines before replacing them; the check uses the final transaction state. Reducing a total below already-recorded payments is intentionally rejected: correct erroneous ledger entries first. An actual customer refund/credit requires a future feature and must not be fabricated by voiding a real valid payment. Other edits remain supported; no existing invoice RPC or calculation is replaced.

PostgreSQL references: https://www.postgresql.org/docs/current/sql-createtrigger.html and https://www.postgresql.org/docs/current/transaction-iso.html.

## Security and indexes

Both new tables have RLS. Authenticated ledger access is SELECT/INSERT/UPDATE and requires access to the referenced invoice; all mutation safety is enforced by triggers even for direct table writes. Settings grants are SELECT/UPDATE. No anonymous or authenticated DELETE/TRUNCATE grants. The summary uses caller RLS. Public/anon/service_role RPC execution is explicitly revoked; only authenticated is granted EXECUTE (database owners remain administrative). RPCs/triggers are security invoker with an empty search path. Trigger functions are not exposed for direct authenticated execution.

Indexes: primary keys; unique payment request key; `(invoice_id, payment_date DESC, created_at DESC, id)` for deterministic history; partial `(invoice_id) WHERE voided_at IS NULL` for active balances. No invoice/source indexes are altered.

## Local validation and next milestone

`tests/database/invoice_payments.test.mjs` replays all 18 migrations, verifies preservation of a pre-upgrade Draft payment, in a disposable local database and runs prior SQL regressions, payment validation, settings/permissions/RLS tests, and real independent-session concurrency tests. Coverage includes duplicate and competing requests, both settings/payment orderings, repeatable-read stale balances, and both invoice-edit/payment orderings, and both workflow/payment orderings. Existing generation/composer/edit concurrency coverage is retained.

Local migration application is additive; no reset of local development data is required. No hosted operation is authorized in this step. Generated application database types remain as last generated from hosted schema; no UI consumes Payments yet. After reviewing/applying the migration to hosted in a later step, regenerate linked types before building Payments or Settings UI.
