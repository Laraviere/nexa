# Atomic manual invoice creation

Migration: `20260912120000_create_manual_invoice_rpc.sql`. No prior migration is edited.

```sql
public.create_manual_invoice(
  p_customer_id uuid,
  p_issue_date date,
  p_items jsonb,
  p_request_id uuid,
  p_notes text default null,
  p_terms text default null
)
```

Returns one row containing `invoice_id uuid`, `invoice_number integer`, `issue_date date`, `due_date date`, `status text`, `company_name_snapshot text`, `subtotal numeric`, `tax_total numeric`, and `total numeric`.

The function is SECURITY INVOKER with an empty search_path and qualified business-object references. Only authenticated has EXECUTE; PUBLIC, anon and service_role do not. Existing customer/invoice/item privileges and RLS remain authoritative. No service-role credentials, security-definer privilege elevation, hard-coded user IDs, or new table grants are used.

## Input and creation contract

The customer, finite issue date and request UUID are mandatory. Customer lookup uses caller visibility and locks the customer while creation runs. Customer unavailable returns P0002. Items must be an ordered array of 1–1000 objects. Each item accepts only description, quantity, unit, unit_rate, and optional tax_amount. Unknown/protected properties are rejected, including explicit positions, source_type, amounts, IDs, periods and timestamps.

Description must contain non-whitespace text. Units are hour, minute, flat, each, mile, month and custom. Quantity must be positive, fit numeric(20,8) and have no significant precision beyond eight decimals. Rate is nonnegative numeric(12,2); optional tax is nonnegative numeric(24,2), default zero. Numeric JSON values or decimal strings normalize to the same numeric intent. NaN, infinity, excessive precision/range, null numerics and malformed values are rejected before column casts can silently round them. No client financial totals are accepted.

Array order maps to contiguous positions 1…N. Every inserted line is manual with no source agreement, time allocation or period claim. The existing invoice trigger captures customer data, payment terms and due date; the identity assigns the number and stored generated expressions calculate line amounts. Result totals are read from invoice_totals.

The function call is transactional. A line failure rolls back the header, all lines, and the request reservation. Sequence gaps on rollback are acceptable. Validation maps expected failures to 22023 with stable descriptions; the future application should map these to friendly messages rather than print raw database errors. Other database failures still abort the operation.

## Durable retry semantics

Two nullable columns are added to invoices: creation_request_id UUID and creation_request_payload JSONB. A unique request-key constraint and a paired-null/object check preserve integrity while allowing existing/other-workflow invoices to keep NULL metadata. A new update trigger makes both columns immutable, including for drafts. The helper has no direct application EXECUTE privilege.

The payload stores original customer, issue date, notes, terms and normalized ordered manual items. Decimal spelling, JSON object key order, and omitted tax versus explicit zero do not change intent. Changed item order, numeric values, descriptions, customer/date/notes/terms are treated as different intent. No general-purpose idempotency framework or cryptographic hashing extension is needed.

A transaction advisory lock derived from the request UUID serializes duplicate RPC calls before invoice insertion. Hash collisions only serialize unrelated requests; UUID uniqueness remains authoritative. After the lock, an identical persisted intent returns the same invoice without inserting rows or consuming another number. A different intent returns 22023: `Request ID was already used with different invoice data.` Higher-isolation stale-snapshot/unique races may return 40001 and must retry the identical request; no automatic retry loop is built into SQL.

Request keys should be generated once per creation attempt and retained across network retries. This is the existing single-user permission model: authenticated users already have direct invoice INSERT access. This function is not a new multi-tenant authorization boundary.

## Future draft editing

Retries compare the immutable original payload, not current draft fields. They return current persisted invoice values/totals and never restore an old draft or undo finalization/voiding. Future editing RPCs must preserve creation metadata and use a separate editing/retry contract. Reusing the creation key for changed content is rejected. A voided invoice retry still returns that void invoice; a deliberate new invoice uses a new creation key.

Draft line replacement/removal, tax UI, time/retainer generation, payment ledger, email/PDF and UI remain unimplemented. The existing trigger that blocks line deletion remains unchanged.

## Local validation

The dedicated database runner replays every migration in a disposable Docker database and executes existing customer, retainer, time, usage, timer and invoice SQL suites, followed by the RPC regression suite. It tests ordered creation, DB snapshots/numbers/dates/totals, invalid/protected inputs, real second-insert rollback, no allocation rows, normalized retries, request metadata protection, post-edit/post-finalization retries, caller RLS and denied anon execution.

Concurrency checks exercise eight identical calls and conflicting simultaneous calls. They verify exactly one invoice and that a subsequent retry leaves the identity sequence unchanged. No hosted type generation or hosted changes are needed for local testing.
