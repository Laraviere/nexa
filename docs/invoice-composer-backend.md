# Invoice Composer backend

Migration: `20260914120000_invoice_composer.sql`. Local-only validation. No prior migration, UI, generated types, table, index, RLS policy or source constraint is edited. The new migration replaces the existing generator function's planning block with a call to the extracted shared planner; its transaction and request-result behavior remain intact.

## Preview contract

```sql
public.preview_customer_invoice(
  p_customer_id uuid,
  p_as_of_date date default null
)
returns table (as_of_date date, revision text, candidates jsonb)
```

One row is always returned for an available customer, including when `candidates=[]`. Null as-of resolves to today's New York business date. Future/nonfinite dates are rejected. Preview is STABLE, SECURITY INVOKER, has an empty search_path, and works inside a READ ONLY transaction. It never reserves sources, consumes a number or creates financial rows.

Candidate objects contain `candidate_id`, `source_type`, `description`, `quantity`, `unit`, `unit_rate`, and `amount`. Retainer candidates also contain `billing_agreement_id`, `period_start` and exclusive `period_end`; time candidates contain `billed_minutes`. Hourly candidates are grouped by captured `unit_rate`. No allocation ranges or internal expected-amount fields appear in the public preview.

IDs are SHA-256 hashes of a versioned identity containing customer, resolved as-of, source type, agreement/period and rate. IDs are stable for unchanged identities; they are identifiers, not authorization or reservation tokens. Save accepts only IDs present in its freshly reconstructed preview.

## Shared eligibility and revision

`invoice_candidate_plan(uuid,date)` contains the eligibility code extracted from `generate_customer_invoice`. The compatibility generator and `invoice_preview_state(uuid,date)` both call it. The public preview and composer call the latter helper, which enriches candidates and constructs the revision.

The planner retains current advance fees, the immediately completed relevant overage period, adjacent version behavior, final-period cancellation behavior, arrears terms, disabled-fee rules, full fee/allowance without proration, exact hourly range subtraction, captured-rate grouping, and active claim exclusions. No older retainer period traversal or automatic catch-up was added.

The revision is SHA-256 over a versioned canonical JSONB representation of:

- Resolved as-of and the complete ordered plan, including exact server-side allocations.
- The visible customer row, including payment terms and snapshot fields.
- That customer's agreement rows.
- That customer's recorded time rows through the as-of date.

UTC and ISO date formatting are pinned for canonical timestamp serialization. Two unchanged previews yield the same revision across session timezones. Source changes can invalidate all selections, including custom-only composer requests. This is intentionally conservative: even an unrelated historical time edit or future agreement edit can require a refresh. Existing customer indexes bound those reads; no historical allowance-period traversal or new index is introduced. Large customer histories may eventually warrant a narrower revision projection.

The helper functions are read-only SECURITY INVOKER and authenticated-only. Their internal plan includes source ranges already visible under existing authenticated table access; application clients should consume the public preview, which omits those details. No SECURITY DEFINER privilege bridge is introduced.

## Atomic save contract

```sql
public.create_composed_invoice(
  p_customer_id uuid,
  p_issue_date date,
  p_as_of_date date,
  p_request_id uuid,
  p_revision text,
  p_selected_candidate_ids text[],
  p_custom_items jsonb,
  p_notes text default null,
  p_terms text default null
)
returns table (
  invoice_id uuid, invoice_number integer,
  issue_date date, due_date date, status text,
  company_name_snapshot text, as_of_date date,
  subtotal numeric, tax_total numeric, total numeric
)
```

Submit the resolved preview `as_of_date` explicitly. Candidate arrays must be non-null, contain no nulls or duplicate IDs, and have at most 1000 members. Order of selected IDs is normalized as set intent. Custom arrays contain zero to 1000 ordered objects. At least one selected candidate or custom item is required; empty requests are rejected without creating an invoice or durable empty result.

Custom objects accept only description, quantity, unit, unit_rate and optional tax_amount. Decimal strings/numbers normalize to equal numeric intent. Precision, ranges, supported units and protected-field rejection match `create_manual_invoice`. Source metadata, computed amounts and allocation ranges are forbidden. Tax defaults to zero.

Save serializes on the established request advisory-lock namespace, checks existing immutable invoice request metadata first, then takes the shared customer-generation lock, customer FOR UPDATE, agreement FOR SHARE, and time-row FOR UPDATE locks. It recomputes the preview and verifies the entire revision before inserting anything. Unknown candidates are rejected; selected generated amounts and complete allocations are derived from the server plan.

It inserts one draft header, selected generated items and their claims/allocations, then custom items. Existing database triggers supply numbering, snapshots and due date. Generated amounts are checked against the reviewed database plan. Results come from persisted invoices and invoice_totals. Any error rolls back the header, all lines, claims and request metadata.

Final order: selected current/prior fees in planner order, selected completed overage, selected hourly groups by rate, then custom lines in user-entered order. Deselected candidates remain unclaimed; retainer overage cannot be partially selected within a candidate.

## Idempotency, conflicts and security

The existing invoices.creation_request_id/creation_request_payload fields store normalized composer intent with an operation discriminator. No new ledger is created. A same-key retry returns the existing invoice and current persisted status/totals before source revalidation, even after approval/voiding. Conflicting payloads or keys from another creation operation are rejected, including keys used for the generator's terminal empty results. Successful retries consume no number.

Stale review raises `P0001` with the stable message prefix `STALE_INVOICE_PREVIEW:`. The UI should refresh/review and use a new submission lifecycle, not automatically accept changed charges. Unknown/duplicate selection, empty input, invalid custom data or request conflicts use `22023`; unavailable customer uses `P0002`. Unique/exclusion/deadlock conflicts produce `40001`: retry the same request to resolve uncertainty, then refresh if stale. Existing source constraints remain the final defense against callers that do not cooperate with advisory locks. Sequence gaps after rolled-back inserts are normal.

EXECUTE is revoked from PUBLIC, anon and service_role for all four new functions and granted only to authenticated. Existing table privileges, RLS, immutable approval behavior and compatibility RPC permissions remain unchanged. Unsupported usage contexts still fail closed rather than producing invented charges; the separate existing custom-only manual RPC remains available.

## Validation

`tests/database/invoice_composer.test.mjs` freshly replays all 14 migrations into a disposable local database, runs existing SQL regressions against the new shared planner, and adds real same-key/different-key composer concurrency and READ ONLY preview checks. `invoice_composer.sql` covers selection/deselection, relevant periods, exclusions, partial hourly ranges, deterministic/timezone-stable revisions, stale/forged/empty rejection, source-only/custom-only/mixed saves, exact allocations/totals, snapshots/dates, late custom failure, source-claim failure, key collisions, RLS and anonymous denial.

Local Docker migration application does not reset development data. No hosted changes or type regeneration are part of this step. The next UI milestone must integrate these contracts after hosted application and generated type refresh.
