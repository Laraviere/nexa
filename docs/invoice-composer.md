# Unified Invoice Composer

The primary workflow is `/invoices` → **New Invoice** → `/invoices/new`. The composer calls the authenticated `preview_customer_invoice` action when customer/as-of changes and saves solely through `create_composed_invoice`. Both contracts use generated Database Args/Returns aliases. The JSON candidates are decoded into a small validated display projection.

Suggested charges show database descriptions, amounts and friendly type labels. All suggestions default selected; each can be deselected. Selected suggestions also appear in Invoice items alongside optional custom rows. No custom row is required for suggested-only invoices. Empty suggestions show “No billing activity is ready to invoice.” and still allow custom-only saving.

Eligibility, money for suggested charges, source periods, revisions and allocation decisions come from the database. The browser only sums selected candidate amounts and custom-item estimates for composition. Persisted detail/list totals and invoice lines continue to come from the saved database records. Due date remains an informational payment-terms preview until creation.

## Refresh and concurrency

Changing customer/as-of immediately makes the previous snapshot unusable; it cannot be submitted or included in totals. Loading replaces candidates, selection and revision. Effect cancellation ignores older responses that arrive after a newer customer/date request. Refresh explicitly reloads suggestions and defaults the refreshed set to selected for review; it never saves automatically.

`STALE_INVOICE_PREVIEW` displays “Billing activity changed since this invoice was prepared.” Save remains blocked until **Refresh charges** completes. Custom lines, notes and terms are retained. Confirmed validation/stale failures retire the submission UUID before further edits; changed payloads do not reuse a committed request's identity.

Before mutation, the exact payload, UUID and reviewed preview are retained in user-scoped tab session storage. Uncertain results freeze financial inputs and allow only the same submission to be retried. Reload restores that request without fetching a different preview. Pending state and an immediate submission guard prevent obvious double submission. Storage failure prevents saving. Successful save opens the persisted draft.

## Editing and lifecycle

The list retains one **New Invoice** action. The main composer saves with the atomic creation RPC. Existing invoice detail pages provide **Edit Invoice** and reuse the composer at `/invoices/[id]/edit`, saving with `update_composed_invoice`. See `invoice-editing.md` for claim/history and legacy-status behavior. The approval workflow has been removed; existing legacy sent rows display **Editable**, and editing reopens them to Draft. Void remains historical.

The document layout uses flexible widths, stacked mobile suggestion cards/custom rows and aligned desktop columns. Amounts wrap instead of forcing horizontal overflow. Native labels/checkboxes, loading/status messages and clear primary actions support keyboard and assistive-technology use.

## Validation

- `invoice-composer.test.mjs`: generated-contract action, optional custom rows, exact retries/error mapping, response race protection, default selection/deselection, stale refresh/revision replacement and recovery without re-previewing.
- `invoice-composer.local.test.mjs`: authenticated HTTP preview/save, relevant retainer fee/prior overage, no in-progress/historical catch-up, suggested/custom/mixed saves, deselected availability, selected claims, stale response, hourly grouping, totals, retries and approval.
- Existing application suites and database composer/generator regressions remain applicable.

A browser was unavailable during this implementation; visual desktop/mobile review is still required. No database changes, hosted writes or generated-type edits were made. Backend contracts and safeguards are documented in `invoice-composer-backend.md`.
