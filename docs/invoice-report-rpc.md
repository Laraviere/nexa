# Invoice reporting RPC

Migration: `20260919120000_create_invoice_report_rpc.sql`. Backend only; no reporting UI, financial/lifecycle changes, indexes, table changes or hosted operations.

## Contract

```sql
public.get_invoice_report(
  p_search text default null,
  p_workflow_status text default null,
  p_payment_status text default null,
  p_customer_id uuid default null,
  p_issue_date_from date default null,
  p_issue_date_to date default null,
  p_overdue_only boolean default false,
  p_sort text default 'newest',
  p_page integer default 1,
  p_page_size integer default 25,
  p_as_of_date date default null
)
```

Always returns one row: `resolved_as_of_date date`, `page integer`, `page_size integer`, `total_rows bigint`, `total_pages bigint`, `invoice_count bigint`, `total_invoiced numeric`, `amount_paid numeric`, `outstanding_balance numeric`, `rows jsonb`.

`rows` is an ordered array of objects with exactly: `invoice_id`, `invoice_number`, `customer_id`, `company_name_snapshot`, `issue_date`, `due_date`, `workflow_status`, `payment_status`, `invoice_total`, `amount_paid`, `balance_due`, `overdue`. Identifiers/dates/status/name are JSON strings, invoice number and money are JSON numbers, overdue is boolean. There are no item/allocation details or internal sorting fields. Money retains PostgreSQL numeric arithmetic; consumers must not round/recompute payment state.

An empty match returns count/pages/money zero and `[]`. A positive out-of-range page returns `[]` with full-set counts/aggregates unchanged. Page remains the requested page. Defaults are page 1, size 25; size 1–100 is enforced and offset arithmetic uses bigint.

## Filters and sorting

NULL workflow/payment means All; literal `all` is rejected. Workflow values: draft, ready, sent, void. Payment values: unpaid, partially_paid, paid, taken directly from `invoice_payment_summary`. Filters combine with AND.

Search trims surrounding POSIX whitespace; whitespace-only is no filter. It matches exact invoice-number text OR a case-insensitive literal substring of the saved company snapshot. `%`, `_`, quotes and backslashes are ordinary characters, not patterns or executable SQL. UUIDs/current company names are not searched. Search is limited to 500 characters. Customer ID matches `invoices.customer_id` without filtering customer activity; archived and renamed customers retain their historical snapshots.

Issue-date bounds are inclusive and optional independently. Dates must be finite; From after To is rejected. `p_as_of_date` defaults to the server's current America/New_York business date, independent of the session/browser timezone. An explicit value supports deterministic historical reports/tests.

Overdue is non-Void AND positive balance AND due date strictly before as-of date. Due today, paid/zero-balance and Void invoices are not overdue. It is derived, never stored.

Sorts: newest = issue date descending, invoice number descending; oldest = both ascending; highest_balance = balance descending, then issue date descending and invoice number descending. Unique invoice numbers make ties deterministic. Historical Void balances remain visible/sortable, even though they are never collectible.

Unsupported filter/sort values, null/invalid pagination, null overdue-only, non-finite dates, reversed range and oversized search raise SQLSTATE `22023` with a specific validation message. Invalid UUID/date/integer syntax is rejected by PostgreSQL's typed inputs before execution.

## Financial policy and consistency

Every row's totals/payment state come directly from `invoice_payment_summary`. Count includes all matching invoices. Unless workflow is explicitly Void, all Void money is excluded from aggregate invoiced, paid and outstanding totals. For Void-only, invoiced/paid are historical authoritative totals (paid still excludes voided payment ledger entries); outstanding is always zero. Otherwise outstanding sums positive balances of non-Void matches. Aggregates cover the entire filtered set, not the page.

One SQL statement uses a materialized filtered CTE for both page rows and aggregates. The function is STABLE, SECURITY INVOKER, with an empty search path and schema-qualified application objects. Calling-statement snapshot semantics keep reports internally consistent during concurrent payments. No locks or writes are introduced. Separate later calls can naturally see later changes.

EXECUTE is explicitly revoked from PUBLIC, anon, authenticated and service_role, then granted only to authenticated. Existing caller RLS on invoices and the security-invoker payment view remains in force for both rows and totals. No RLS or table grants change.

## Performance and validation

Existing indexes include invoice primary key/unique invoice number, `invoices_issue_idx`, `invoices_customer_issue_idx`, the Sent due-date partial index, current invoice-item invoice/position index, and payment invoice/date plus active-payment indexes. No new index is justified by current scale. Workflow-only filtering has no dedicated index; highest-balance ordering and filtered totals must evaluate matching balances. Exact reporting still scans matching rows inside PostgreSQL, but returns at most 100 objects and one summary, with no application-side scan/cap.

Snapshot substring search, invoice-number text search, optional-filter plans, broad All reports and large offsets may need measured tuning at scale. Consider exact numeric search/index usage, a composite sort index, trigram search or specialized query planning only after EXPLAIN/production volume evidence. The materialized filtered set can spill for large reports; it is an intentional consistency/reuse tradeoff.

`tests/database/invoice_report.sql` covers all filter types, combinations, validation, archived/snapshot search, literal search safety, date/as-of semantics, sort/page/empty behavior, full-set exact aggregates, Void policy, source-view equality, caller RLS, authenticated-only execution and unchanged history. Its runner replays all migrations and existing SQL regressions, verifies a read-only transaction, and tests a payment committing between report reads in one statement. All existing database runners remain separate and unchanged.

After a separately authorized hosted application, regenerate linked Database types before building the reporting UI. Existing generated types are not manually changed in this backend milestone.
