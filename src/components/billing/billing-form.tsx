"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createRetainer } from "@/actions/billing";
import type { BillingField, BillingFormState } from "@/lib/billing/validation";

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-600/20";
export function BillingForm({ customerId, today }: { customerId: string; today: string }) {
  const [state, action, pending] = useActionState(createRetainer.bind(null, customerId), {} as BillingFormState);
  const [endMode, setEndMode] = useState("until_cancellation");
  function field(name: BillingField, label: string, type: string, initial = "", required = false) {
    return (
      <div>
        <label htmlFor={name} className="mb-2 block text-sm font-medium">{label}{required ? " *" : ""}</label>
        <input id={name} name={name} type={type} inputMode={type === "text" ? "decimal" : undefined}
          defaultValue={state.values?.[name] ?? initial} required={required} className={inputClass}
          aria-invalid={!!state.errors?.[name]} aria-describedby={state.errors?.[name] ? `${name}-error` : undefined} />
        {state.errors?.[name] && <p id={`${name}-error`} className="mt-1 text-sm text-rose-700">{state.errors[name]}</p>}
      </div>
    );
  }
  function choice(name: "bill_in_advance" | "rollover_enabled", label: string, initial: string, options: [string, string][]) {
    return (
      <div>
        <label htmlFor={name} className="mb-2 block text-sm font-medium">{label}</label>
        <select id={name} name={name} defaultValue={state.values?.[name] ?? initial} className={inputClass}>
          {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        {state.errors?.[name] && <p className="mt-1 text-sm text-rose-700">{state.errors[name]}</p>}
      </div>
    );
  }
  const advancedError = ["billing_cycle_day", "rounding_increment_minutes", "bill_in_advance", "rollover_enabled"]
    .some((field) => state.errors?.[field as BillingField]);
  return (
    <form action={action} noValidate className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <p className="mb-6 text-sm text-slate-600">Set monthly terms for this customer. Fields marked * are required. Amounts are in USD.</p>
      <fieldset disabled={pending} className="space-y-6 disabled:opacity-60">
        <div className="grid gap-5 sm:grid-cols-2">
          {field("monthly_fee", "Monthly fee ($)", "text", "", true)}
          {field("included_hours", "Included support hours / month", "text", "", true)}
          {field("overage_hourly_rate", "Overage rate ($ / hour)", "text", "", true)}
          {field("effective_date", "Effective date", "date", today, true)}
        </div>
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-medium">Retainer duration</legend>
          {[
            ["until_cancellation", "Until cancellation"],
            ["specific_date", "End on a specific date"],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-3 text-sm">
              <input type="radio" name="end_mode" value={value} checked={endMode === value}
                onChange={() => setEndMode(value)} className="size-4 accent-cyan-700"
                aria-describedby={state.errors?.end_mode ? "end_mode-error" : undefined} />
              {label}
            </label>
          ))}
          {state.errors?.end_mode && <p id="end_mode-error" className="text-sm text-rose-700">{state.errors.end_mode}</p>}
          {endMode === "specific_date" ? (
            <div className="max-w-sm pt-2">{field("end_date", "End date (exclusive)", "date", "", true)}</div>
          ) : (
            <p className="text-sm leading-6 text-slate-500">The retainer continues until cancellation. Use End retainer later to set its cancellation date.</p>
          )}
        </fieldset>
        <p className="text-sm leading-6 text-slate-500">Dates use New York business days. An end date is the first day these terms no longer apply.</p>
        <details open={advancedError || undefined} className="rounded-xl border border-slate-200 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Advanced billing settings</summary>
          <p className="my-4 text-sm leading-6 text-slate-600">Standard setup: monthly on day 1, billed at the beginning of the period, each entry rounded up to 15 minutes, and no rollover. Included hours reset every month.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            {field("billing_cycle_day", "Billing cycle day (1–28)", "number", "1", true)}
            {field("rounding_increment_minutes", "Round each entry up to (minutes)", "number", "15", true)}
            {choice("bill_in_advance", "Billing timing", "true", [["true", "Beginning of period"], ["false", "End of period"]])}
            {choice("rollover_enabled", "Unused included hours", "false", [["false", "Do not roll over"], ["true", "Roll over"]])}
          </div>
        </details>
      </fieldset>
      {state.message && <p role="alert" className="mt-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{state.message}</p>}
      <div className="mt-6 flex items-center gap-4 border-t border-slate-100 pt-6">
        <button disabled={pending} className="rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60">{pending ? "Saving…" : "Set up retainer"}</button>
        <Link href={`/customers/${customerId}`} className="text-sm font-medium text-slate-600">Cancel</Link>
      </div>
    </form>
  );
}
