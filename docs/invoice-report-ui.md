# Invoice history / reporting UI

`/invoices` now uses `get_invoice_report` through the authenticated server client. The regenerated `Database["public"]["Functions"]["get_invoice_report"]["Args"]` and `Returns[number]` are imported directly. The JSON `rows` field is narrowed at runtime for safe rendering; no parallel handwritten RPC interface or financial filtering/calculation is introduced. Generated types and database objects are unchanged by this UI milestone.

## Filters and URL state

A GET form supports `q`, `workflow`, `payment`, `customer`, `from`, `to`, `overdue=1`, and `sort`. Filters map directly to RPC arguments. Blank search becomes no search. New links use `workflow`; old `status` URLs remain supported when `workflow` is absent, including Dashboard links. Existing `all` workflow/payment URLs normalize to no filter. Sort values are newest, oldest and highest_balance. Page size is always 25 and RPC metadata drives Previous/Next and counts. Applying filters resets to page 1; pagination preserves normalized filters. Clear filters returns to `/invoices`. The filter form remounts when URL state changes so browser inputs reflect navigation.

Issue-date input validation rejects invalid/reversed ranges without a report call. Unsupported values, duplicate known query keys and invalid page/customer values receive friendly messages. No `p_as_of_date` is sent by the UI: the RPC resolves New York today. Validation never recomputes overdue or payment status.

Current customer labels load in batches without excluding archived records. Rows use saved company snapshots. Archived options are labelled `(Archived)`; unavailable customer choices never display a UUID as their label. Customer-read failures show a notice while allowing a successful report to remain visible.

## Presentation and totals

Compact summary cards display returned invoice_count, total_invoiced, amount_paid and outstanding_balance across the full filtered set, not page sums. The page explicitly explains the RPC's Void policy: All includes Void count but excludes Void money; Void-only shows historical amounts and zero collectible outstanding. Individual Void row balances remain historical values from the RPC.

The report uses a fixed-layout, 48px-target table when its content container has at least 680px of available width, accounting for the sidebar and page padding. Narrower containers use stacked invoice cards. The two-row toolbar uses the same container threshold; mobile controls wrap. Summary values share one compact strip, and policy copy sits behind “About these totals.” The From/To controls are explicitly empty without URL dates, with form autocomplete disabled. Pagination shows the displayed range from RPC page metadata. Invoice number and customer link to the same invoice detail; money aligns right, long content wraps, dates are formatted without timezone shifts, and Overdue text follows `row.overdue` exactly. Payment and workflow labels remain separate. New Invoice stays the primary action. No charts, export, email, automation or new reporting route was added.

Empty results show “No invoices match these filters.” and Clear filters. An out-of-range page also offers First page. Report failures show “Unable to load invoice report.” with retained filters, a reload retry and the app shell. No raw database errors are displayed.

## Validation

`tests/invoice-report.test.mjs` validates URL/argument mapping, generated-return JSON narrowing, friendly errors, full-set summary rendering, pagination, archived labels, mobile structure and RPC-authoritative statuses. `tests/invoice-report.local.test.mjs` uses local Docker Supabase plus the real Next server, creates 27 synthetic invoices, and checks filter combinations/sorts, inclusive dates, auth, direct RPC equivalence, page-spanning totals, Void policy, legacy links, history snapshots, invoice links and validation/empty states. Fixtures are voided/archived and the temporary user removed.

Older invoice list integration assertions now search for their fixture rather than assuming newest creation always appears on page 1; the specified order is issue date then invoice number. No existing invoice creation/edit/payment/PDF semantics change.

The browser connection is unavailable in this session. Structural responsive tests pass, but actual viewport clipping and visual review remain manual. Customer options are loaded fully for the selector; a searchable/paginated selector may become useful at much larger customer counts. Report rows remain server-paginated with exact database aggregates.
