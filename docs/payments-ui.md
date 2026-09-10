# Payments UI

The hosted-generated `Database` types contain payment_settings and invoice_payments Row/Insert/Update, invoice_payment_summary, and record_invoice_payment, void_invoice_payment and update_payment_settings. The application imports table types and RPC Args directly. No generated types are edited by this milestone. Function return columns may be nullable at runtime even where the generator emits string; void timestamps are handled by presence rather than assuming a non-null value.

## Settings

Settings was a disabled navigation placeholder. It now links to `/settings`, which redirects to `/settings/payments`. The new Settings layout uses the existing Nexa shell and styles. Three accessible native checkbox switches save through the authenticated update_payment_settings server action. At least one method is required, and the interface explains that historical payments remain unchanged.

## Invoice detail

The existing Total uses invoice_payment_summary.invoice_total. A compact separate Payment section shows the derived payment status, amount_paid and balance_due directly from that view. No balances are calculated in JavaScript. The workflow badge remains independent. Mark as Paid appears only for a Ready or Sent invoice with positive remaining balance, and opens an inline panel. Amount defaults to the remaining balance and date to the server's New York business date. Smaller partial amounts are supported. The method controls use native radios with friendly labels and show only enabled settings.

Draft shows “Payment recording becomes available once this invoice is marked Ready.” Its payment summary/history and Mark Ready workflow action remain visible. Void and zero-balance invoices have no new-payment action. An already-submitted uncertain request can still be confirmed with its original key; it cannot bypass database eligibility for a new insert.

The server action validates input shape and exact decimal precision, then calls record_invoice_payment. It does not insert ledger rows or preempt the database's balance/method/idempotency guards. A method disabled while the form is open produces a friendly message and returns current settings so options update. Overpayments are rejected rather than clamped.

Each opened form gets a request UUID. Before sending, it stores the exact submitted fields and request key in tab session storage scoped by authenticated subject and invoice. Pending submissions block duplicates. An uncertain response freezes the submitted fields and offers Retry same payment. Reloading that tab restores the pending submission. A definite validation rejection permits correcting inputs; success clears the saved request, closes the panel and refreshes the invoice. Session storage is required for recording so the application does not knowingly send an unrecoverable request. Recovery after closing the tab/browser is outside this milestone; check history before starting a new payment if the prior outcome remains unknown.

Payment History loads all rows in payment-date/creation/id order, including voided rows and payments using disabled methods. Each active payment has a confirmation panel requiring a reason, calling void_invoice_payment only. Voided rows keep their amount/reference/notes and show Void plus the reason. This is a ledger correction, not a refund. Void invoices retain history and explicitly identify balances as non-collectible; no new-payment action is offered.

## Security and error handling

Every action authenticates independently with customerClient; reads and RPCs use the existing authenticated Supabase session and RLS. No service role, direct client mutations or payment DELETE is used. The eligibility correction is enforced by `20260918120000_require_payment_eligible_invoice.sql`: new inserts require Ready/Sent after the existing parent lock; Draft rejection uses SQLSTATE `P1001`, mapped to “This invoice must be marked Ready before a payment can be recorded.” Historical Draft payments and exact-key retries remain valid. Server errors are mapped to user-facing messages without raw SQL. Revalidation refreshes invoice summaries/history and relevant Settings views.

## Validation

`tests/payments.test.mjs` covers typed RPC arguments, validation, mapped errors, enabled-method/default rendering, switches/radios, history, exact-payload recovery retries and double-submission protection.

`tests/payments.local.test.mjs` builds/runs Next against local Docker and drives actual authenticated server actions. It verifies all settings toggles and all-disabled rejection; historical disabled-method display and disabled-method races; Draft rejection and historical Draft summary/retries; partial/final payments on Ready/Sent; authoritative amounts and balances; overpayment; same-key retries; authenticated actions; confirmation/reason-required payment voiding; preserved Void invoice history. It restores original business settings, voids/archives synthetic fixtures and removes the test login without deleting payment history.

Responsive classes stack amount/date fields and wrap method/history controls on mobile. Render tests verify those structures. The in-app browser was unavailable, so interactive visual/mobile review remains outstanding. Review `/settings/payments` and any `/invoices/[id]` in a local authenticated browser. PDF, email, refunds and recurring work are unchanged.
