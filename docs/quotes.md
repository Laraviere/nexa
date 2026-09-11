# Quotes and backdated invoices

## Database and deployment

`20260920120000_create_quotes.sql` is a new forward migration. It adds only Quote objects; existing invoice tables, triggers, source claims, sequences and payment logic are unchanged. Apply this migration to each environment before deploying the Quotes application code. No hosted migration is applied by the implementation.

`src/types/database.ts` was generated from local Supabase after migration. Regenerate from hosted Supabase after the migration is reviewed and applied there.

Quotes use an independent PostgreSQL identity beginning at 1001, displayed as `Q-1001`. Numbers are assigned only in the database. Sequence gaps after rolled-back transactions are normal; numbers are not reused.

The quote header, ordered normalized line snapshots and generated numeric subtotal/total live in one `quotes` row. This permits one consistent read for detail/PDF rendering and atomic draft replacement without partially saved lines. Quantities and rates use the invoice precision limits. Line amounts round to two decimal places in PostgreSQL, and quote totals sum those rounded amounts. Decimal strings are retained in the JSON snapshot so editing does not lose input precision in JavaScript. Quotes currently contain untaxed quantity/rate lines; no tax UI or tax calculation was added.

`quote_write_requests` records original create/edit payloads for retry safety. The form retains pending requests in session storage scoped to the signed-in user. Draft editing requires the current quote revision. The customer is fixed after creation, and contact details are captured when the quote is created.

Authorization follows Nexa's existing shared internal authenticated workspace. Quotes have RLS and authenticated SELECT only. Writes use narrowly granted `SECURITY DEFINER` RPCs with an empty search path and qualified object references. Anonymous users cannot read or call quote writes; authenticated users cannot directly modify/delete quote rows or forge a conversion link. These functions must be reconsidered if Nexa adds tenant-specific or per-customer authorization.

## Lifecycle

- Drafts are editable. Draft/Sent proposals can be marked Sent, Accepted or Declined, or moved back to Draft as appropriate.
- Sent records delivery performed outside Nexa; this milestone does not send email.
- Acceptance is a decision only; it never creates an invoice automatically.
- Accepted/Declined proposals can be reopened as Draft before conversion. Only an accepted, unconverted quote exposes conversion.
- Expiration is optional and inclusive: a quote is valid through the expiration date. Undecided Draft/Sent quotes display Expired beginning the following New York business date. No background job changes or deletes records. Expired proposals cannot be sent/accepted until their date is revised; an already accepted/declined decision survives expiration.
- Converted quotes cannot be edited or change status. Voiding or editing the resulting invoice does not reopen the quote or permit a second conversion.

Conversion locks the quote row and calls the existing `create_manual_invoice` RPC within the same transaction. A unique foreign key retains the resulting invoice reference. Repeated/concurrent conversion returns that invoice, even after subsequent invoice edits. The normal invoice sequence, draft lifecycle, current customer/contact/payment-term snapshots, exact line calculation and payment handling apply. Quote descriptions, quantities, units, rates, notes and terms are copied. Conversion does not allocate time or claim retainer charges. Both detail pages link to the related document.

## Invoice dates

Backdating was already supported by `invoices.issue_date` and invoice creation/edit RPCs. The form now labels the existing editable field **Invoice date**. New forms default to today's `America/New_York` business date. Selected dates remain calendar strings, and database dates are never converted through local timestamps. Due date is selected issue date plus customer payment terms (snapshotted on creation); creation/update timestamps remain actual system timestamps. Quote conversion also accepts an editable invoice date. Existing PDFs already display `issue_date` and `due_date`.

## Manual verification

1. Sign in locally; open Quotes and Create Quote. Select a customer, add at least two lines with decimal quantities/rates, and leave expiration blank. Save; confirm a `Q-` number and correct line totals.
2. Edit the Draft, change notes/terms and a rate, then save. Search the list by company or exact `Q-` number. Open its PDF and confirm QUOTE, quote date, customer details, lines and notes, with no payment/due-date labels.
3. Set an expiration date in a Draft. Confirm it is optional, cannot precede quote date, and displays as valid through that day. A past expiration displays Expired and prevents acceptance until revised.
4. Mark the quote Accepted. Confirm no invoice is created yet. Convert it using September 1 with a Net 30 customer. Confirm one normal-numbered Draft invoice, September 1 issue date and October 1 due date, copied amounts/notes/terms, and links in both directions.
5. Retry conversion or reload the accepted quote. Confirm only the existing invoice link remains. Edit the invoice normally; the original accepted quote must not change. Mark the invoice Ready and record a payment using the existing workflow.
6. Create a normal invoice with an earlier Invoice date. Verify the selected date and due date in its detail and PDF. Invoice numbering must continue independently of quote creation.
7. On mobile, check the Quote form/actions and horizontally scrollable list. Signed-out users must be redirected to login; PDF responses must remain private.

## Automated validation

- `node --test tests/quotes.test.mjs`: validation, expiration, RPC inputs/retries, quote PDF pagination/access and date-only backdating.
- `node --test tests/database/quotes.test.mjs`: fresh migration replay in a disposable local Docker database, quote permissions/lifecycle/conversion, concurrent retries and independent sequences, plus all existing SQL billing regressions.
- `node --test tests/quotes.local.test.mjs`: production build pointed explicitly at local Supabase; real authenticated routes, server actions, PDF endpoints and invoice links. Removes only its UUID-addressed local test fixtures afterward.
- Existing application tests, lint, typecheck and production build must also pass.
