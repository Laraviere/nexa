# Editable invoice lifecycle

Migration: `20260915120000_edit_composed_invoices.sql`. Applied and tested locally only. No hosted operation or reset. The local inspection before implementation found 2 draft, 1 legacy sent, and 29 void invoices. These are local counts, not a statement about hosted data.

## Policy

The former review button wrote `status=sent`. Header/item guards treated it as immutable and allocations could only release on void. There is no implemented delivery system, so that value is not evidence of delivery.

The review/approval action and component are removed. Draft, Ready and Sent invoice detail pages provide **Edit Invoice**. With the Ready lifecycle migration, Draft, Ready and Sent retain their status during edits. Sent displays a delivery-unverified note. Existing timestamps are preserved and the complete previous header is recorded in immutable edit history. There is no bulk status rewrite. Void remains noneditable historical data and retains its final composition/totals.

Customer ID, invoice number and captured customer/payment-term snapshots remain fixed. Changing issue date derives due date from the original captured payment terms. Notes and terms are editable. Custom descriptions, quantities, units and rates are editable; existing explicit tax amounts are preserved. Generated descriptions are editable, but generated quantities/rates and precise source allocations remain database-controlled. Selected generated charges can be retained, removed, or added where eligible. Arbitrary manual overrides of generated prices/usage are not introduced.

## Storage and guards

`invoice_items.superseded_at` marks replaced lines. Their values and original positions remain historical and cannot be edited again. A partial unique index enforces positions only for current lines. A retirement update is restricted by the item guard to an otherwise unchanged draft line; PostgreSQL assigns its timestamp and releases its claims. An AFTER trigger releases that item's allocation rows atomically. Released allocation rows remain immutable, and time entries with invoice history remain protected forever.

`invoice_totals` sums only nonsuperseded lines. It still includes the last composition of void invoices even though their claims have been released. Detail reads use that same current-line filter, preventing historical lines from being displayed or counted twice.

Retained generated lines keep their source IDs, financial values and allocations. Only their descriptions/positions may change. The edit journal records before-images of their earlier display values. Custom lines are replaced with new rows, never deleted. The workflow grants no DELETE privilege and retains the existing authenticated direct-table trust model; valid line retirement is guarded at the database boundary, not unlocked by a spoofable session flag or application bypass.

`invoice_edit_requests` stores the unique edit UUID, normalized intent, previous header and previous current lines. It supports exact retries and preserves legacy review metadata; it is a minimal edit journal, not a customer-facing revision or delivery system. Future delivery and correction audit features can build on preserved rows and before-images.

## Preview and edit APIs

```sql
preview_invoice_edit(p_invoice_id uuid, p_as_of_date date)
-- returns as_of_date date, revision text, candidates jsonb

update_composed_invoice(
  p_invoice_id uuid,
  p_issue_date date,
  p_as_of_date date,
  p_request_id uuid,
  p_revision text,
  p_selected_candidate_ids text[],
  p_custom_items jsonb,
  p_descriptions jsonb default '{}',
  p_notes text default null,
  p_terms text default null
)
-- returns invoice_id, invoice_number, issue_date, due_date,
-- status, subtotal, tax_total, total
```

Edit preview includes retained generated lines from this invoice plus eligible new charges from the existing shared planner. Retained IDs are stable SHA-256 identities; their historical source periods do not become new catch-up charges. The public JSON omits internal row IDs/allocation ranges. Retained candidates have `retained=true`, allowing the editor to select current charges and leave new suggestions unchecked. New charges still obey normal no-catch-up and complete-overage policies.

The revision covers the current header/lines plus the normal customer billing revision. Save recomputes it under request/customer/source/invoice locks. It validates selected candidates and description overrides server-side. In one transaction it reopens a legacy invoice, retires deselected sources and old custom lines, retains/reorders selected existing sources, creates selected new source lines/allocations and custom lines, checks exact time allocation completeness, then appends edit history. Any failure restores the entire previous composition and claims.

Order is retained generated lines in their existing order, eligible new generated lines in planner order, then custom lines in entered order. New positions do not affect invoice number. Existing selected overage remains a complete historical claim; adding a new overage candidate claims the full eligible period. Removing a generated line releases only its claims; it becomes eligible again where the ordinary period rules allow.

Same UUID/payload returns the same invoice without applying the edit twice. Conflicting reuse fails. A stale revision produces `STALE_INVOICE_PREVIEW`; competing edits have one winner. Unique/exclusion/deadlock races are retryable. Existing request-key collision checks extend across creation and editing. All new RPCs are SECURITY INVOKER, authenticated-only, with empty search paths and existing RLS. No security-definer or guard-bypass flags are used.

## Application

`/invoices/[id]/edit` reuses the composer populated with current custom lines, notes, terms, issue date and captured customer terms. Generated charges load through edit preview. Customer is disabled, current source charges default selected, new suggestions default unselected, and selected charge descriptions are editable. Primary action is **Save Changes**, secondary action **Cancel**. An uncertain submission retains the exact UUID/payload/preview in invoice-specific session storage and disables edits until resolved. A confirmed stale result requires refresh/review.

Types were regenerated from local Docker because the edit migration is not hosted yet. Apply the migration to hosted and regenerate linked types before deploying these application changes there. No hosted application was performed by this task.

## Validation and boundaries

Database tests cover custom replacement, numbers/snapshots/dates/tax/totals, legacy reopening, retained descriptions, source removal/reclaim, no double claims, exact allocations, late-failure rollback, retry/stale/concurrent edits, RLS and no DELETE privileges. Existing financial/customer/billing/time/timer suites run as well. The obsolete historical assertion that legacy sent can never reopen is conditional on the old schema; new tests verify the replacement behavior.

Application tests cover populated editing, authenticated actions, fixed customer, default retained selection, new suggestions unselected, tax preservation, atomic update-only calls, retries and stale feedback. Browser visual verification remains pending because no browser is connected. The local integration tests preserve void/archived synthetic fixtures instead of deleting financial history.

Limits: customer changes, arbitrary generated quantity/rate overrides, and void editing are intentionally unsupported. Unsupported billing contexts still fail closed under the shared preview rules. No payments, delivery, PDF, background billing, full revision UI, or hard-delete UI is added.
