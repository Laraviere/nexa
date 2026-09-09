import Link from "next/link";
import { formatBusinessDate } from "@/lib/billing/model";
import { formatDuration } from "@/lib/time/model";
import { getRecentTime } from "@/lib/time/server";

export default async function TimePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestedPage = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  const { entries, hasNext } = await getRecentTime(page);
  return <>
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">Customer work</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Time</h1><p className="mt-2 text-slate-600">Recent time entries, newest recorded first. Open a customer to view current retainer usage.</p></div><Link href="/time/new" className="rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800">Add time entry</Link></div>
    {entries.length ? <ul aria-label="Recent time entries" className="space-y-3">{entries.map((entry) => <li key={entry.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/customers/${entry.customer_id}`} className="font-semibold text-cyan-800 hover:underline">{entry.customers?.company_name ?? "Customer unavailable"}</Link><p className="mt-1 text-sm text-slate-500"><time dateTime={entry.work_date}>{formatBusinessDate(entry.work_date)}</time></p></div><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{entry.is_billable ? "Billable" : "Non-billable"}</span><span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-800">{entry.billing_agreement_id ? "Retainer" : "No retainer"}</span>{entry.voided_at && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">Voided</span>}</div></div>
      <p className="mt-4 whitespace-pre-wrap break-words text-sm text-slate-700">{entry.description}</p>
      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm"><div><dt className="text-slate-500">Actual duration</dt><dd className="mt-1 font-semibold">{formatDuration(entry.actual_minutes)}</dd></div><div><dt className="text-slate-500">Billable duration (rounded)</dt><dd className="mt-1 font-semibold">{formatDuration(entry.rounded_minutes)}</dd></div></dl>
      {entry.voided_at && <p className="mt-3 text-sm text-amber-800">Excluded from billing usage. Reason: {entry.void_reason}</p>}
    </li>)}</ul> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><h2 className="text-lg font-semibold">No time entries {page === 1 ? "yet" : "on this page"}</h2><p className="mt-2 text-sm text-slate-600">Record the actual time spent working for a customer.</p><Link href={page === 1 ? "/time/new" : "/time"} className="mt-5 inline-block text-sm font-semibold text-cyan-700">{page === 1 ? "Add time entry" : "View recent entries"}</Link></div>}
    {(page > 1 || hasNext) && <nav aria-label="Time entry pages" className="mt-6 flex justify-between text-sm">{page > 1 ? <Link href={`/time?page=${page - 1}`} className="text-cyan-700">← Previous</Link> : <span />}<span>Page {page}</span>{hasNext ? <Link href={`/time?page=${page + 1}`} className="text-cyan-700">Next →</Link> : <span />}</nav>}
  </>;
}
