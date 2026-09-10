# Customer invoice generation database foundation

Migration: `20260913120000_generate_customer_invoice.sql`. No previous migration, manual creation RPC, usage calculation, timer or UI is edited.

```sql
public.generate_customer_invoice(
  p_customer_id uuid,
  p_issue_date date,
  p_request_id uuid,
  p_as_of_date date default null,
  p_notes text default null,
  p_terms text default null
)
```

Returns one row: `outcome text`, `invoice_id uuid`, `invoice_number integer`, `issue_date date`, `due_date date`, `status text`, `as_of_date date`, `subtotal numeric`, `tax_total numeric`, `total numeric`.

`outcome` is `created` or `nothing_to_invoice`. Empty results have no invoice ID, number, status, due date or totals. A nonempty retry returns the original invoice identity and its current persisted status/totals, as manual creation does; it does not undo finalization or voiding.

## Eligibility and scope

The reference date is explicit, or defaults to today's America/New_York business date. It is separate from the invoice issue date. All calculations use date-only values. An explicit reference date may be today or earlier. A future reference date is rejected so it cannot turn unfinished overage into an eligible charge. The issue date remains independent. The read-only classification helper can evaluate other reference dates for inspection, but generation always enforces the server business-date boundary.

Normal generation selects at most the current agreement-specific period and its immediately completed predecessor. It never scans backwards for missing claims. For billing day 15 and September 15 as-of, this means the September 15–October 15 advance fee and August 15–September 15 overage; missing June/July charges are not added.

- Current period: find the latest nonempty agreement version effective by the reference date. If it still covers that date, use `get_retainer_period_usage(agreement_id, as_of_date)` for its exact clipped period. Its full advance fee is eligible, including shortened first/last periods. Full allowance and no proration remain unchanged.
- Previous period: resolve the agreement covering `current_period_start - 1`, then ask the usage RPC for that date. This finds either the preceding monthly period or the adjacent predecessor version. A service gap prevents jumping to an unrelated historical version. Only complete positive overage from that selected period can be generated.
- After cancellation with no current version, only the latest nonempty version's final completed period is considered, using `end_date - 1`. Its unclaimed overage remains collectible; no older periods or missed advance fees are collected.
- Arrears terms (`bill_in_advance=false`) retain end-of-period charging: only the selected immediately completed period's full arrears fee is eligible, never older missed fees.
- Administratively disabled agreements produce no automatic fixed fee. Their captured overage remains eligible within the same selected-period rules; disabling never rewrites references.
- Active overlapping fee/overage claims are checked **after** selection. A claimed period is skipped, never replaced by an older unclaimed period. Whole-period overage continues to use the usage RPC's snapshots, exact allocations and expected amount; an active claim blocks late additions and second automatic period claims.
- Hourly: live billable entries with no captured governing agreement, work_date <= reference date. Uses stored rounded_minutes and captured hourly_rate. Equal rates group into one line; distinct rates remain separate.
- Included support never creates a billed allocation. Non-billable/voided time and future-dated work are not charged.
- Explicit zero rates/fees remain valid and can produce zero-dollar lines with real source claims.

No optional manual additions were added. The existing manual RPC remains the separate manual workflow. No tax, discount, fee-proration, payment, source-editing, PDF, email or background-generation workflow is introduced.

## Exact sources, order and amounts

For each hourly entry, PostgreSQL subtracts the union of active `int8range` claims from `[0, rounded_minutes)`. This retains exact holes: an existing `[10,20)` claim in a 30-minute entry leaves `[0,10)` and `[20,30)`, not an arbitrary remaining 20 minutes.

Each positive overage allocation claims `[included_minutes, rounded_minutes)` from the usage result. One complete period is one overage line. The generated line amount must equal the usage RPC's authoritative overage_amount; a mismatch aborts the transaction. Hourly amounts use the existing exact minutes × captured rate / 60 calculation and per-line cent rounding. Totals are read from invoice_totals.

Order is fixed: selected current advance fee, selected prior arrears fee if applicable, selected prior overage, then hourly groups by numeric rate. Positions are contiguous. Allocation order is work date, creation timestamp, entry ID and offset. Description dates display the inclusive human end (`period_end - 1`), including years, while source metadata remains `[start,end)`.

## Coverage and unbilled time

A new stable, security-invoker helper `get_time_entry_invoiceability(uuid,date)` returns caller-visible classification and exact available ranges. The updated security-invoker `unbilled_time_entries` preserves its existing columns and partially-unclaimed row eligibility, then appends:

- `covered_minutes`: currently included allowance minutes that are not already claimed.
- `chargeable_minutes`: eligible unclaimed hourly or completed, unclaimed-period overage minutes.
- `deferred_minutes`: unclaimed future work or overage in a still-open period.
- `blocked_minutes`: late overage for an already-claimed period, or a usage context needing review.
- `billing_status`: hourly, future_work, retainer_open, retainer_completed, retainer_claimed or needs_review.

The partition is `uninvoiced_minutes = covered + chargeable + deferred + blocked`. Already claimed minutes remain separate. Existing invoice claims take precedence if later work changes the live included/overage boundary; nothing rewrites invoice history. Unsupported usage (rollover, conflicting snapshots, unavailable context) is blocked in the read model rather than advertised as chargeable. Actual generation fails explicitly on unsupported retainer usage, rolling everything back.

The view evaluates today in New York. For a historical/reference date use the helper with that date. The classification helper deliberately retains historical chargeability for inspection: `chargeable_minutes > 0` does not by itself mean the normal generator will select a retainer period. Future UI must also apply the selected-period policy; it must not treat all uninvoiced minutes as money owed. Covered-only rows remain for backward-compatible accounting visibility and do not represent pending extra charges. The helper is a correctness-first per-entry calculation and calls the usage RPC for retainer entries; large histories may need a period-batched read optimization later.

## Detecting missed historical periods

Normal generation leaves older fees, overage and time allocations unclaimed. No records are marked billed or discarded. A future explicit historical review can enumerate reference dates inside each nonempty agreement, call `get_retainer_period_usage` and deduplicate `(billing_agreement_id, period_start, period_end)`. Compare those periods with active overlapping `invoice_items` claims separately for `retainer_fee` and `retainer_overage`. For example, this read-only inspection of a known historical period returns missing claim flags:

```sql
select u.billing_agreement_id, u.period_start, u.period_end, u.overage_minutes,
  not exists (select from public.invoice_items i
    where i.billing_agreement_id=u.billing_agreement_id and i.released_at is null
      and i.source_type='retainer_fee'
      and daterange(i.period_start,i.period_end,'[)') && daterange(u.period_start,u.period_end,'[)')) as fee_unclaimed,
  u.overage_minutes > 0 and not exists (select from public.invoice_items i
    where i.billing_agreement_id=u.billing_agreement_id and i.released_at is null
      and i.source_type='retainer_overage'
      and daterange(i.period_start,i.period_end,'[)') && daterange(u.period_start,u.period_end,'[)')) as overage_unclaimed
from public.get_retainer_period_usage(:agreement_id, :historical_reference_date) u;
```

`get_time_entry_invoiceability` and `unbilled_time_entries` also expose unclaimed completed historical overage for discovery, while covered allowance remains distinct. These are inspection tools, not automatic catch-up authorization. No historical charge creation workflow is implemented here.

## Transactions, concurrency and history

Generation validates inputs and serializes by request UUID using the manual RPC's advisory-lock namespace. Distinct generation requests for one customer serialize on a separate customer advisory lock. It locks the customer row, agreement rows and existing time rows before planning sources. These row locks protect source snapshots; concurrent related writes can wait and deadlocks/serialization races must retry.

The customer row lock also coordinates FK inserts, while the existing unique/exclusion constraints remain the final authority against external/direct competing claims. No direct caller is assumed to honor the generation advisory lock. Any conflicting claim aborts the whole generation with retryable SQLSTATE 40001. Retrying recalculates only if the previous attempt never committed.

After planning, the RPC either writes header, all lines, claims, precise allocations and a terminal request result, or rolls everything back. The existing identity and invoice trigger supply invoice numbers, customer snapshots and due dates. No empty invoice is inserted. Sequence gaps after aborted writes remain acceptable.

Voiding releases existing fee/overage/time claims. A new generation key can rebill eligible released sources; all prior rows and values remain. Retrying the original key still returns the old invoice, even if now void. Historically linked time remains immutable under the unchanged existing guards. Backdated hourly work can create a new invoice; late retainer overage with an active period claim is blocked for future explicit adjustment/void-rebill handling.

## Durable requests and compatibility

`invoice_generation_requests` stores request_id (UUID PK), customer_id (restrictive FK), original request_payload (JSONB), resolved as_of_date, optional unique invoice_id (restrictive FK), and created_at. It is append-only and records terminal empty results too. A repeated empty request remains empty even after new work arrives; use a new key for a new evaluation.

Generated invoices also use the existing immutable creation_request_id/payload columns. Their payload includes an operation discriminator. A reused key with different arguments or another invoice operation is rejected with 22023. A null reference-date argument fingerprints as null, so a retry after midnight reuses its saved resolved horizon rather than becoming a new operation.

One compatibility-only INSERT trigger on invoices prevents manual creation from reusing a key already consumed by an empty generation result. The manual RPC itself and its normal behavior remain unchanged. A guard validates nonempty result-to-invoice metadata and prevents ledger updates/deletion. This retains the existing trusted single-user direct-table permission model; it is not a new multi-tenant authorization framework.

## Security and validation

Generation and the read helper are SECURITY INVOKER with empty search_path and authenticated-only EXECUTE. Existing RLS stays in force. The new ledger has RLS with authenticated SELECT/INSERT only; no UPDATE/DELETE. Trigger helpers have direct EXECUTE revoked. No security-definer functions, service-role credentials, broad grant changes or destructive cascades are added.

Customer unavailable is P0002; invalid arguments or key reuse is 22023; concurrent claim/deadlock conflicts are 40001. Unsupported usage retains the existing explicit error classes. The future application must map errors to friendly text without showing raw internals.

Regression coverage includes fresh full replay, boundary dates, full clipped fees, agreement versions, arrears/disabled behavior, whole completed overage and exact source ranges, grouped hourly rounding, middle-range prior claims, exclusions, coverage partition, void/rebill, backdated history, durable empty and nonempty retries, real allocation-failure rollback, caller RLS and concurrent request keys. Local Docker only; no hosted modification or type regeneration.
