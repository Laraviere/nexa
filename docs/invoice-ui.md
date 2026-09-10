# Manual Invoice UI milestone

Protected routes: `/invoices`, `/invoices/new`, `/invoices/[id]`. The navigation now links to Invoices. List filters map All/Draft/Finalized/Void to the existing database values, and lists paginate 25 rows at a time. Detail reads all ordered lines and customer/contact/address **snapshots**, never current customer display values. Persisted amounts come from `invoice_totals`; missing totals produce an error rather than an invented zero.

Creation imports the generated `create_manual_invoice` Args and Returns types. The form collects customer, New York issue date, notes, terms and ordered manual lines. Only description, quantity, unit and unit_rate are sent per line. No tax entry, discounts, source claims, editing, payments, PDF or emailing are implemented. Existing nonzero tax amounts remain visible on invoice detail, and total tax is displayed from the database.

The form can add/remove unsaved lines; remaining array order becomes saved order through the RPC. Decimal validation preserves strings through submission, checks valid dates and exact supported quantity/rate precision, and rejects blank/invalid fields before RPC. The preview is explicitly labeled and never sent as a persisted total.

The creation Server Action authenticates independently, validates an allowlist, and calls only `supabase.rpc('create_manual_invoice', ...)`. Success returns a generated-type result ID to the client, which replaces the route with the saved detail page. No direct invoice/item inserts exist in this application workflow.

## Retry behavior

One server-generated request UUID belongs to the form lifecycle. Before submission, the tab stores the exact draft and request UUID in sessionStorage, scoped to the authenticated user. Pending submission disables controls. An ambiguous RPC/transport failure keeps controls frozen and offers Retry same submission; it reuses the exact payload/key. Reloading the new-invoice route restores the pending submission after hydration and keeps it frozen until resolved. No new key is generated on an automatic retry.

Known validation/customer failures permit corrections; success clears the pending record. If browser storage cannot retain the retry record, creation is blocked before a mutation is sent. Session storage is tab-scoped: recovery after the tab/session is permanently closed is not guaranteed; the invoice list remains the place to inspect saved invoices. Storage contains draft details, not authentication credentials. No raw database error messages are rendered.

## Finalization

Only drafts show Finalize invoice. It expands a confirmation requiring acknowledgement that finalized invoices cannot be edited. The authenticated action performs one guarded UPDATE of `status='sent'` with matching invoice ID and `status='draft'`; existing database triggers enforce validity/immutability. The UI calls it Finalized and explicitly states that no email is sent. No edit, hard-delete or void action is offered.

## Validation

`tests/invoices.test.mjs` tests validation boundaries, generated-contract RPC payload construction, same-key retries and sanitized uncertain/known failures. `tests/invoices.local.test.mjs` builds and starts Next against local Docker, uses authenticated cookies and real Server Actions, checks list/create/detail/finalization, snapshots, dates, totals/tax display, duplicate submission, one/multiple lines, filtering and immutable finalized lines.

Financial history cannot be hard-deleted even in tests. The local functional test voids its synthetic invoices and archives its synthetic customer; it does not disable guards, reset local data or change schema. These clearly named local fixtures remain as history. Temporary test auth accounts are removed.

Responsive markup uses bounded content width, stacked mobile line cards, min-width-zero fields, wrapping metadata/actions and breakable long amounts. The browser connector reported no available browser during this milestone, so real viewport/hydration interaction and visual checks remain a manual review item; HTTP tests do not establish those results.
