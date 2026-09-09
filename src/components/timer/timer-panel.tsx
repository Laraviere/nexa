"use client";
import { useActionState, useEffect, useState } from "react";
import { startTimer, stopTimer, cancelTimer } from "@/actions/timer";
import { elapsedTimer, timerDate, type Timer, type TimerState } from "@/lib/timer/model";
import { formatMoney } from "@/lib/billing/model";
import type { TimeCustomer, TimeContext } from "@/lib/time/model";

const input = "block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/20";
const button = "inline-flex min-h-11 w-40 max-w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700 disabled:cursor-not-allowed disabled:opacity-60";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
function Elapsed({ timer, serverNow }: { timer: Timer; serverNow: number }) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (timer.stop_requested_at) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timer.stop_requested_at]);
  return <p aria-label={timer.stop_requested_at ? "Elapsed duration, fixed" : "Elapsed duration, live"} className="mt-1 break-all font-mono text-4xl font-medium tabular-nums text-slate-950">{elapsedTimer(timer.started_at, timer.stop_requested_at, now)}</p>;
}
function Start({ customers, today }: { customers: TimeCustomer[]; today: string }) {
  const [state, action, pending] = useActionState(startTimer, {} as TimerState);
  const [customer, setCustomer] = useState("");
  const [billable, setBillable] = useState("true");
  const [preview, setPreview] = useState<{ key: string; data?: TimeContext; failed?: boolean }>();
  const key = `${customer}/${today}`;
  const context = preview?.key === key ? preview : undefined;
  useEffect(() => {
    if (!customer) return;
    const controller = new AbortController();
    fetch(`/time/context?${new URLSearchParams({ customer_id: customer, work_date: today })}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok || response.redirected) throw new Error("Context unavailable");
        const data: TimeContext = await response.json();
        if (!controller.signal.aborted) setPreview({ key, data });
      }).catch(() => { if (!controller.signal.aborted) setPreview({ key, failed: true }); });
    return () => controller.abort();
  }, [customer, today, key]);
  const needsRate = billable === "true" && context?.data && !context.data.agreement;
  const readyLabel = "mb-1 block text-sm font-medium text-slate-700";
  return <form action={action} className="space-y-4">
    <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-60">
      <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,9fr)_minmax(0,11fr)]">
        <div className="min-w-0"><label htmlFor="timer-customer" className={readyLabel}>Customer</label><select id="timer-customer" name="customer_id" value={customer} onChange={event => setCustomer(event.target.value)} required className={input}><option value="">Choose a customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.company_name}{c.is_active ? "" : " (Archived)"}</option>)}</select></div>
        <div className="min-w-0"><label htmlFor="timer-description" className={readyLabel}>Work description</label><textarea id="timer-description" name="description" required rows={2} placeholder="What are you working on?" className={`${input} resize-y`} /></div>
      </div>
      <fieldset className="min-w-0"><legend className={readyLabel}>Billing</legend><div className="flex w-60 max-w-full rounded-lg border border-slate-300 bg-white">
        {[["true", "Billable"], ["false", "Non-billable"]].map(([value, text]) => <label key={value} className="min-w-0 flex-1 cursor-pointer first:rounded-l-md last:rounded-r-md">
          <input type="radio" name="is_billable" value={value} checked={billable === value} onChange={event => setBillable(event.target.value)} className="peer sr-only" />
          <span className="flex h-10 items-center justify-center rounded-[inherit] text-sm font-medium text-slate-600 peer-checked:bg-cyan-700 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cyan-700">{text}</span>
        </label>)}
      </div></fieldset>
      <div role="status" className="text-sm text-slate-600">
        {!customer ? <p>Select a customer to view billing context.</p> : context?.failed ? <p className="text-rose-700">Unable to load billing context. Refresh and try again.</p> : !context?.data ? <p>Loading billing context…</p> : context.data.agreement ? <><p className="font-semibold text-slate-900">Monthly retainer</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{context.data.agreement.included_hours} hr included · {formatMoney(context.data.agreement.overage_hourly_rate)}/hr overage · {context.data.agreement.rounding_increment_minutes}-min rounding</p></> : <><p className="font-semibold text-slate-900">No retainer</p><p className="mt-0.5 text-xs text-slate-500">{billable === "true" ? "Hourly rate required for billable work." : "Non-billable work uses no billing allowance."}</p></>}
      </div>
      {needsRate && <div className="w-full sm:w-64"><label htmlFor="timer-rate" className={readyLabel}>Hourly rate (USD)</label><input id="timer-rate" name="hourly_rate" inputMode="decimal" required className={input} /></div>}
    </fieldset>
    {state.message && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{state.message}</p>}
    <div className="flex justify-end border-t border-slate-100 pt-3"><button className={`${button} max-sm:w-full bg-cyan-700 hover:bg-cyan-800`} disabled={pending || !context?.data}>{pending ? "Starting…" : "Start timer"}</button></div>
  </form>;
}

function Controls({ timer }: { timer: Timer }) {
  const [stopState, stopAction, stopping] = useActionState(stopTimer, {} as TimerState);
  const [cancelState, cancelAction, canceling] = useActionState(cancelTimer, {} as TimerState);
  const pending = !!timer.stop_requested_at || stopState.pendingFinalization;
  return <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
    {pending && <p className="text-sm leading-5 text-amber-900">Your stop time was saved, but the time entry still needs to be finalized.</p>}
    <form action={stopAction} className="space-y-3">
      <input type="hidden" name="timer_id" value={timer.id} />
      {pending && timer.is_billable && <div className="max-w-sm"><label htmlFor="retry-rate" className={label}>Hourly rate for work without a retainer (USD)</label><input id="retry-rate" name="hourly_rate" inputMode="decimal" defaultValue={timer.hourly_rate ?? ""} className={input} disabled={stopping || canceling} /><p className="mt-1 text-xs text-slate-600">Supply a rate if any part of this work had no retainer. Retainer rates remain unchanged.</p></div>}
      {stopState.message && <p role="alert" className="text-sm text-amber-900">{stopState.message}</p>}
      <div className="flex justify-end"><button className={`${button} ${pending ? "bg-amber-800 hover:bg-amber-900" : "bg-slate-900 hover:bg-slate-800"}`} disabled={stopping || canceling}>{stopping ? "Saving…" : pending ? "Retry finalization" : "Stop timer"}</button></div>
    </form>
    {!pending && <details className="text-right"><summary className="inline-block cursor-pointer rounded px-2 py-2 text-sm text-slate-600 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700">Cancel timer</summary><form action={cancelAction} className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left">
      <input type="hidden" name="timer_id" value={timer.id} />
      <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" name="confirm" value="yes" required disabled={stopping || canceling} className="mt-1" />Discard this timer without recording any time.</label>
      <button disabled={stopping || canceling} className={`${button} bg-rose-700 hover:bg-rose-800`}>{canceling ? "Canceling…" : "Confirm cancellation"}</button>
    </form></details>}
    {cancelState.message && <p role="alert" className="text-sm text-rose-700">{cancelState.message}</p>}
  </div>;
}

export function TimerPanel({ timer, customers, today, serverNow }: { timer: (Timer & { customers: { company_name: string } | null }) | null; customers: TimeCustomer[]; today: string; serverNow: number }) {
  return <section aria-labelledby="timer-heading" className={`mb-8 max-w-2xl rounded-xl border bg-white p-4 shadow-sm sm:p-5 ${timer?.stop_requested_at ? "border-amber-200" : "border-slate-200"}`}>
    <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div><h2 id="timer-heading" className="text-lg font-semibold text-slate-950">Timer</h2>{!timer && <p className="mt-0.5 text-xs leading-5 text-slate-500">Track work as you perform it.</p>}</div>
      <span aria-label={timer ? timer.stop_requested_at ? "Stopped — pending finalization" : "Timer running" : "Ready to start"} className={`rounded-full px-3 py-1 text-xs font-medium ${timer?.stop_requested_at ? "bg-amber-50 text-amber-900" : timer ? "bg-cyan-50 text-cyan-900" : "bg-slate-100 text-slate-600"}`}>{timer ? timer.stop_requested_at ? "Pending finalization" : "Running" : "Ready"}</span>
    </header>
    {timer ? <>
      <div className="grid gap-3 sm:grid-cols-2 sm:items-center">
        <div className="min-w-0"><p className="break-words font-semibold text-slate-950">{timer.customers?.company_name ?? "Customer unavailable"}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{timer.description}</p><p className="mt-2 text-xs text-slate-500">{timer.is_billable ? "Billable" : "Non-billable"}</p></div>
        <div className="min-w-0 sm:text-right"><p className="text-xs text-slate-500">{timer.stop_requested_at ? "Elapsed · fixed" : "Elapsed"}</p><Elapsed key={`${timer.id}/${timer.stop_requested_at ?? "running"}`} timer={timer} serverNow={serverNow} /></div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{timer.stop_requested_at ? "Stopped " : "Started "}<time dateTime={timer.stop_requested_at ?? timer.started_at}>{timerDate(timer.stop_requested_at ?? timer.started_at)}</time> · New York</p>
      <Controls key={timer.id} timer={timer} />
    </> : <Start customers={customers} today={today} />}
  </section>;
}
