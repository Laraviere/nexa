"use client";
import { useActionState } from "react";
import { saveChecksPayableTo, savePaymentSettings } from "@/actions/payments";
import { paymentMethods, type PaymentSettings } from "@/lib/payments/model";
export function PaymentSettingsForm({settings}:{settings:PaymentSettings}) {
  const [state,action,pending] = useActionState(savePaymentSettings,{});
  return <form action={action} className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="text-lg font-semibold">Payment methods</h2><p className="mt-2 text-sm text-slate-600">Choose which payment methods are available when recording invoice payments.</p>
    <fieldset disabled={pending} className="my-5 divide-y divide-slate-100"><legend className="sr-only">Enabled payment methods</legend>{Object.entries(paymentMethods).map(([method,label])=><label key={method} className="flex cursor-pointer items-center justify-between gap-4 py-4 font-medium"><span>{label}</span><span className="relative inline-flex"><input type="checkbox" role="switch" name={`${method}_enabled`} defaultChecked={settings[`${method}_enabled` as keyof PaymentSettings] === true} className="peer sr-only"/><span aria-hidden="true" className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-cyan-500 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-700 peer-focus-visible:ring-offset-2"/><span aria-hidden="true" className="absolute left-1 top-1 size-4 rounded-full bg-white transition peer-checked:translate-x-5"/></span></label>)}</fieldset>
    <p className="text-xs text-slate-500">Changes affect future payment entry only. Historical payments remain unchanged.</p>
    {state.message&&<p role="status" className="mt-4 text-sm">{state.message}</p>}
    <div className="mt-5 flex justify-end"><button disabled={pending} className="w-full rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold disabled:opacity-50 sm:w-auto">{pending?"Saving…":"Save changes"}</button></div>
  </form>;
}

export function CheckInstructionsForm({settings}:{settings:PaymentSettings}) {
  const [state,action,pending] = useActionState(saveChecksPayableTo,{});
  return <form action={action} className="mt-6 max-w-2xl rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="text-lg font-semibold">Invoice check instructions</h2>
    <label className="mt-4 block text-sm font-medium">Checks payable to
      <input name="checks_payable_to" defaultValue={settings.checks_payable_to ?? ""} maxLength={200} disabled={pending} aria-describedby="check-payee-help" className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"/>
    </label>
    <p id="check-payee-help" className="mt-2 text-sm text-slate-600">Shown on newly generated invoice PDFs, including existing invoices. Leave blank to hide. Not shown on quotes.</p>
    {state.message&&<p role="status" className="mt-4 text-sm">{state.message}</p>}
    <div className="mt-5 flex justify-end"><button disabled={pending} className="w-full rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold disabled:opacity-50 sm:w-auto">{pending?"Saving…":"Save check instructions"}</button></div>
  </form>;
}
