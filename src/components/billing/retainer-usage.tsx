import { formatBusinessDate, formatMoney } from "@/lib/billing/model";
import { formatDuration } from "@/lib/time/model";
import { usageAllocations, type RetainerUsageResult } from "@/lib/billing/usage";

export function RetainerUsage({ result }: { result: RetainerUsageResult }) {
  if (result.status === "error") return <section aria-labelledby="retainer-usage-heading" className="mt-6 rounded-xl bg-slate-50 p-5">
    <h3 id="retainer-usage-heading" className="font-semibold">Current retainer usage</h3>
    <p role="status" className="mt-2 text-sm text-slate-600">{result.message}</p>
  </section>;
  const { summary } = result;
  const allocations = usageAllocations(summary.allocations);
  const hasAllowance = summary.included_minutes_available > 0;
  const hasOverage = summary.overage_minutes > 0;
  const hasRemaining = summary.remaining_included_minutes > 0;
  const allowanceStatus = !hasAllowance
    ? `No included hours${hasOverage ? ` — ${formatDuration(summary.overage_minutes)} overage` : ""}`
    : hasOverage
      ? `Included allowance exhausted — ${formatDuration(summary.overage_minutes)} overage`
      : hasRemaining
        ? `Within included allowance — ${formatDuration(summary.remaining_included_minutes)} remaining`
        : "Included allowance exhausted — no overage";
  return <section id="retainer-usage" aria-labelledby="retainer-usage-heading" className="mt-6 rounded-xl border border-cyan-100 bg-cyan-50/40 p-5">
    <h3 id="retainer-usage-heading" className="font-semibold">Current billing period</h3>
    <p className="mt-1 text-sm text-slate-700"><time dateTime={summary.period_start}>{formatBusinessDate(summary.period_start)}</time> – <time dateTime={summary.period_end}>{formatBusinessDate(summary.period_end)}</time></p>
    <p className="mt-1 text-xs text-slate-500">New York business dates · End date is exclusive</p>
    <dl className="mt-5 grid grid-cols-2 gap-5 lg:grid-cols-4">
      {[["Included", summary.included_minutes_available === 0 ? "No included hours" : formatDuration(summary.included_minutes_available)],
        ["Used", formatDuration(summary.rounded_minutes_used)],
        ["Remaining", formatDuration(summary.remaining_included_minutes)],
        ["Overage", formatDuration(summary.overage_minutes)]].map(([label, value]) => <div key={label}><dt className="text-sm text-slate-500">{label}</dt><dd className={`mt-1 font-semibold ${label === "Overage" && summary.overage_minutes > 0 ? "text-amber-800" : "text-slate-950"}`}>{value}</dd></div>)}
    </dl>
    <div className={`mt-5 rounded-lg p-3 ${hasOverage ? "border border-amber-200 bg-amber-50" : hasAllowance && !hasRemaining ? "bg-slate-100" : "bg-white/60"}`}>
      <p id="included-usage-status" role="status" className={`text-sm font-medium ${hasOverage ? "text-amber-900" : "text-slate-700"}`}>{allowanceStatus}</p>
      {hasAllowance && <>
        <label htmlFor="included-usage-progress" className="mt-2 block text-xs text-slate-600">{formatDuration(summary.rounded_minutes_used)} used of {formatDuration(summary.included_minutes_available)} included</label>
        <progress id="included-usage-progress" aria-describedby="included-usage-status" className={`mt-2 h-2 w-full ${hasOverage ? "accent-amber-600" : hasRemaining ? "accent-cyan-700" : "accent-slate-500"}`} value={summary.included_minutes_used} max={summary.included_minutes_available} />
      </>}
    </div>
    {summary.overage_minutes > 0 && <dl className="mt-5 border-t border-cyan-100 pt-4"><dt className="text-sm text-slate-600">Overage charge</dt><dd className="mt-1 text-xl font-semibold text-slate-950">{formatMoney(summary.overage_amount)}</dd></dl>}
    <details className="mt-5 border-t border-cyan-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-cyan-800">Time entry allocation{allocations ? ` (${allocations.length})` : ""}</summary>
      {allocations === null ? <p className="mt-3 text-sm text-slate-600">Entry allocation detail is unavailable. The period totals above are still available.</p> : allocations.length === 0 ? <p className="mt-3 text-sm text-slate-600">No billable time recorded for this period.</p> : <ul className="mt-3 space-y-3">{allocations.map((entry) => <li key={entry.time_entry_id} className="rounded-lg border border-slate-200 bg-white p-3"><time dateTime={entry.work_date} className="text-sm font-medium">{formatBusinessDate(entry.work_date)}</time><dl className="mt-2 grid grid-cols-3 gap-3 text-sm">{([["Rounded", entry.rounded_minutes], ["Included", entry.included_minutes], ["Overage", entry.overage_minutes]] as const).map(([label, minutes]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1">{formatDuration(minutes)}</dd></div>)}</dl></li>)}</ul>}
    </details>
  </section>;
}
