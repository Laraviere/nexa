# Invoice workflow status

`20260916120000_invoice_ready_status.sql` adds Ready as an editable workflow state. It does not migrate existing rows or record delivery. Draft, Ready and Sent retain their status during atomic edits; Void is historical and read-only.

The detail page offers Mark Ready for Draft and Move to Draft for Ready, with a short confirmation. Both retain Edit Invoice. Sent retains Edit Invoice and displays that Nexa has not verified delivery. No manual Sent or sending action is exposed. The list filters are All, Draft, Ready, Sent and Void.

The database supports transitions among Draft, Ready and Sent, plus voiding any non-void invoice under the existing void rules. Entering Ready or Sent requires current line items and exact source allocations. Only a transition to Sent sets `sent_at` if no timestamp has already been recorded. Moving back to Ready or Draft preserves that historical timestamp; the timestamp does not establish actual email delivery. No existing statuses or timestamps are rewritten.

The status action compares both expected status and `updated_at` in its single authenticated update. A stale edit or status change requires refreshing. It changes no financial fields. Atomic edits retain immutable before-images, superseded lines, source-release behavior, invoice number and customer snapshots. The existing source and RLS rules remain in force.

Validation: `tests/database/invoice_ready.test.mjs` replays all migrations in a disposable local database, reruns prior database regressions and source-concurrency tests, and adds lifecycle assertions in `invoice_ready.sql`. Application and local integration coverage exercises controls, confirmations, authenticated transitions, stale revision rejection, Ready filtering, editable Ready/Sent and read-only Void.
