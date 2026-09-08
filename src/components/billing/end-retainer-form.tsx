"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { endRetainer } from "@/actions/billing";
import { formatBusinessDate } from "@/lib/billing/model";
import { isBusinessDate, type BillingFormState } from "@/lib/billing/validation";

export function EndRetainerForm({ customerId, agreementId, today, existingEnd }: {
  customerId: string; agreementId: string; today: string; existingEnd: string | null;
}) {
  const [state, action, pending] = useActionState(endRetainer.bind(null, customerId, agreementId), {} as BillingFormState);
  const [mode, setMode] = useState("now");
  const [scheduledDate, setScheduledDate] = useState(existingEnd ?? "");
  const [confirmed, setConfirmed] = useState(false);
  // Only sets the date input's minimum. End now always resolves its date on the server.
  const nextDay = new Date(`${today}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const earliestScheduleDate = nextDay.toISOString().slice(0, 10);
  const validSchedule = isBusinessDate(scheduledDate) && scheduledDate > today;
  return (
    <form action={action} noValidate className="mt-6 space-y-5">
      <fieldset disabled={pending} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-semibold">When should the retainer end?</legend>
          {[
            ["now", "End now", "Stops the retainer immediately."],
            ["scheduled", "Schedule an end date", "Retainer remains active until the selected date."],
          ].map(([value, label, description]) => (
            <label key={value} className="flex items-start gap-3 rounded-lg border border-slate-200 p-4">
              <input type="radio" name="cancellation_mode" value={value} checked={mode === value}
                onChange={() => { setMode(value); setConfirmed(false); }}
                aria-describedby={state.errors?.cancellation_mode ? "cancellation-mode-error" : undefined}
                className="mt-1 size-4 accent-cyan-700" />
              <span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-sm text-slate-600">{description}</span></span>
            </label>
          ))}
          {state.errors?.cancellation_mode && <p id="cancellation-mode-error" className="text-sm text-rose-700">{state.errors.cancellation_mode}</p>}
        </fieldset>
        {mode === "scheduled" && (
          <div>
            <label htmlFor="end_date" className="mb-2 block text-sm font-medium">Scheduled end date</label>
            <input id="end_date" name="end_date" type="date" required min={earliestScheduleDate} max={existingEnd ?? undefined}
              value={scheduledDate} onChange={(event) => { setScheduledDate(event.target.value); setConfirmed(false); }}
              aria-invalid={!!state.errors?.end_date} aria-describedby="end-date-help end-date-error"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/20" />
            <p id="end-date-help" className="mt-2 text-sm text-slate-600">Choose a future New York business date. The retainer will no longer apply on that date.</p>
            <p id="end-date-error" className="mt-2 text-sm text-rose-700">{state.errors?.end_date}</p>
          </div>
        )}
        <label className="flex items-start gap-3 text-sm leading-6">
          <input type="checkbox" name="confirmation" value="yes" required checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)} disabled={mode === "scheduled" && !validSchedule}
            className="mt-1 size-4 accent-cyan-700" />
          <span>
            {mode === "now" ? "I confirm this retainer will end immediately, on today’s New York business date."
              : validSchedule ? `I confirm this retainer will end on ${formatBusinessDate(scheduledDate)} (New York business date).`
                : "Select a future end date to confirm scheduled cancellation."}
            {" "}Its billing history will remain available.
          </span>
        </label>
        {state.errors?.confirmation && <p className="text-sm text-rose-700">{state.errors.confirmation}</p>}
      </fieldset>
      {state.message && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{state.message}</p>}
      <div className="flex items-center gap-4 border-t border-slate-100 pt-5">
        <button disabled={pending || !confirmed} className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
          {pending ? "Saving…" : mode === "now" ? "Confirm end now" : "Confirm scheduled end"}
        </button>
        <Link href={`/customers/${customerId}`} className="text-sm font-medium text-slate-600">Cancel</Link>
      </div>
    </form>
  );
}
