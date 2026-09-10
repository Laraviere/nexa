# Generate Invoice UI

`/invoices/generate` is a compatibility route. The primary workflow at `/invoices/new` now uses the authoritative preview and atomic composer RPC; see `invoice-composer.md`. Both use the existing invoice list, persisted detail lines, and explicit draft approval.

The form defaults issue and as-of dates to the server's current America/New_York business date. Clearing the optional as-of date lets the RPC resolve today. The displayed customer summary describes today's enabled, date-applicable agreement; it is informational and does not predict historical invoice eligibility. There is no client-side charge preview or catch-up workflow.

The authenticated action uses the generated `generate_customer_invoice` Args and Returns types. Its sole financial write is that RPC. A successful result opens the existing draft; `nothing_to_invoice` stays on the form as a normal status message. Stored descriptions, quantities, rates and totals are displayed by the existing detail page without recalculation.

Each submission retains its UUID and exact payload in user-scoped tab session storage before calling the action. Pending submissions are guarded. Uncertain outcomes freeze edits and allow the same request to be retried, including after reload. A confirmed empty result ends that request and creates a fresh key for the next evaluation. Storage failure prevents submission. Clearing browser storage before resolving an uncertain request forfeits this recovery mechanism.

Local validation:

- `tests/invoice-generation.test.mjs`: input validation, generated RPC-only action, friendly errors, exact retries, recovery after reload, double-submit guard, empty-result editing, customer context and draft navigation.
- `tests/invoice-generation.local.test.mjs`: authenticated Next HTTP actions against local Docker Supabase, NY defaults, current fee/prior overage, historical/in-progress exclusions, hourly grouping, persisted draft/list/detail, nothing-to-invoice, retry uniqueness and finalization.
- Database generation tests remain authoritative for transaction, allocation, claim and concurrency rules.

Integration fixtures retain void invoices and archived customers locally because financial history is intentionally nondeletable. No hosted writes are performed. Mobile styling stacks fields and uses flexible widths; an actual mobile browser review is still needed when a browser is available.
