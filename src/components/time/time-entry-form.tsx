"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { saveTimeEntry } from "@/actions/time";
import { formatBillingCycle, formatMoney } from "@/lib/billing/model";
import { isBusinessDate } from "@/lib/billing/validation";
import type { TimeContext, TimeCustomer } from "@/lib/time/model";
import type { TimeField, TimeFormState } from "@/lib/time/validation";

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-600/20";

export function TimeEntryForm({ customers, today }: { customers: TimeCustomer[]; today: string }) {
  const [state, action, pending] = useActionState(saveTimeEntry, {} as TimeFormState);
  const [values, setValues] = useState({ customer_id: "", work_date: today, description: "", hours: "0", minutes: "0", is_billable: "true", hourly_rate: "" });
  const [revision, refresh] = useState(0);
  const [preview, setPreview] = useState<{ key: string; data?: TimeContext; error?: string }>();
  const validSelection = !!values.customer_id && isBusinessDate(values.work_date);
  const key = `${values.customer_id}/${values.work_date}/${revision}`;
  const context = preview?.key === key ? preview : undefined;
  useEffect(() => {
    if (!validSelection) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ customer_id: values.customer_id, work_date: values.work_date });
    fetch(`/time/context?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || response.redirected) throw new Error("Context unavailable");
        const data: TimeContext = await response.json();
        if (!controller.signal.aborted) setPreview({ key, data });
      }).catch(() => {
        if (!controller.signal.aborted) setPreview({ key, error: "Unable to load billing context. Try refreshing, or sign in again." });
      });
    return () => controller.abort();
  }, [key, validSelection, values.customer_id, values.work_date]);
  const agreement = context?.data?.agreement;
  const needsRate = !!context?.data && !agreement && values.is_billable === "true";
  function field(name: TimeField) {
    return { id: name, name, value: values[name],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues((previous) => ({ ...previous, [name]: event.target.value })),
      "aria-invalid": !!state.errors?.[name], "aria-describedby": state.errors?.[name] ? `${name}-error` : undefined };
  }
  function error(name: TimeField) {
    return state.errors?.[name] && <p id={`${name}-error`} className="mt-1 text-sm text-rose-700">{state.errors[name]}</p>;
  }
  return <form action={action} noValidate className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
    <fieldset disabled={pending} className="space-y-6 disabled:opacity-70">
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label htmlFor="customer_id" className="mb-2 block text-sm font-medium">Customer</label><select {...field("customer_id")} required className={inputClass}><option value="">Choose a customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.company_name}{customer.is_active ? "" : " (Archived)"}</option>)}</select>{error("customer_id")}</div>
        <div><label htmlFor="work_date" className="mb-2 block text-sm font-medium">Work date</label><input {...field("work_date")} type="date" required className={inputClass} />{error("work_date")}<p className="mt-1 text-xs text-slate-500">New York business date</p></div>
      </div>
      <div aria-live="polite" className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
        {!validSelection ? <p>Choose a customer and work date to see billing details.</p> : !context ? <p>Loading billing context…</p> : context.error ? <p role="alert">{context.error}</p> : agreement ? <><h2 className="font-semibold text-slate-950">Retainer</h2><p className="mt-1">{agreement.included_hours} included {agreement.included_hours === 1 ? "hour" : "hours"} per billing period</p><p>{formatBillingCycle(agreement.billing_cycle_day)}</p><p>Rounding: {agreement.rounding_increment_minutes} minutes per entry</p><p>Overage rate: {formatMoney(agreement.overage_hourly_rate)}/hour</p></> : <><h2 className="font-semibold text-slate-950">No retainer</h2><p className="mt-1">Billable work uses your hourly rate and rounds up to 15 minutes per entry.</p></>}
        {validSelection && <button type="button" onClick={() => refresh((value) => value + 1)} className="mt-3 font-medium text-cyan-700 hover:underline">Refresh billing context</button>}
      </div>
      <div><label htmlFor="description" className="mb-2 block text-sm font-medium">Description</label><textarea {...field("description")} required rows={4} placeholder="What did you work on?" className={inputClass} />{error("description")}</div>
      <fieldset><legend className="mb-2 text-sm font-medium">Actual time worked</legend><div className="grid grid-cols-2 gap-4">
        <div><label htmlFor="hours" className="mb-2 block text-sm text-slate-600">Hours</label><input {...field("hours")} type="number" min="0" max="35791394" step="1" required className={inputClass} />{error("hours")}</div>
        <div><label htmlFor="minutes" className="mb-2 block text-sm text-slate-600">Minutes</label><input {...field("minutes")} type="number" min="0" max="59" step="1" required className={inputClass} />{error("minutes")}</div>
      </div></fieldset>
      <div><label htmlFor="is_billable" className="mb-2 block text-sm font-medium">Billing</label><select {...field("is_billable")} className={inputClass}><option value="true">Billable</option><option value="false">Non-billable</option></select>{error("is_billable")}</div>
      {needsRate && <div><label htmlFor="hourly_rate" className="mb-2 block text-sm font-medium">Hourly rate (USD)</label><input {...field("hourly_rate")} type="text" inputMode="decimal" required placeholder="125.00" className={inputClass} />{error("hourly_rate")}<p className="mt-1 text-xs text-slate-500">Saved with this entry as its historical rate.</p></div>}
      <p className="text-sm text-slate-500">{values.is_billable === "false" ? "Non-billable work preserves actual duration and uses 0 billable minutes." : "Enter the time actually worked. The saved entry will show its rounded billable duration."}</p>
    </fieldset>
    {state.message && <p role="alert" className="mt-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{state.message}</p>}
    <div className="mt-8 flex items-center gap-4 border-t border-slate-100 pt-6"><button disabled={pending || (validSelection && !context?.data)} className="rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60">{pending ? "Saving…" : "Save time entry"}</button><Link href="/time" className="text-sm font-medium text-slate-600">Cancel</Link></div>
  </form>;
}
