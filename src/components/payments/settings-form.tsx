"use client";
import { InlineNotice } from "@/components/ui/feedback";
import { SectionHeading, surfaceStyles } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form";
import { useActionState } from "react";
import { saveChecksPayableTo, savePaymentSettings } from "@/actions/payments";
import { paymentMethods, type PaymentSettings } from "@/lib/payments/model";
export function PaymentSettingsForm({settings}:{settings:PaymentSettings}) {
  const [state,action,pending] = useActionState(savePaymentSettings,{});
  return <form action={action} className={surfaceStyles("standard", "w-full")}>
    <SectionHeading>Payment methods</SectionHeading><p className="mt-2 text-sm text-slate-600">Choose which payment methods are available when recording invoice payments. At least one method must remain enabled.</p>
    <fieldset disabled={pending} className="my-5 divide-y divide-slate-100"><legend className="sr-only">Enabled payment methods</legend>{Object.entries(paymentMethods).map(([method,label])=><label key={method} className="flex cursor-pointer items-center justify-between gap-4 py-4 font-medium"><span>{label}</span><span className="relative inline-flex items-center gap-3"><input type="checkbox" role="switch" name={`${method}_enabled`} defaultChecked={settings[`${method}_enabled` as keyof PaymentSettings] === true} className="peer sr-only"/><span aria-hidden="true" className="hidden text-xs font-normal text-secondary peer-checked:block">Enabled</span><span aria-hidden="true" className="text-xs font-normal text-secondary peer-checked:hidden">Disabled</span><span aria-hidden="true" className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-cyan-500 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-700 peer-focus-visible:ring-offset-2"/><span aria-hidden="true" className="absolute right-6 top-1 size-4 rounded-full bg-white transition peer-checked:translate-x-5"/></span></label>)}</fieldset>
    <p className="text-xs text-slate-500">Changes affect future payment entry only. Historical payments remain unchanged.</p>
    {state.message&&<InlineNotice tone="info" role="status" className="mt-4">{state.message}</InlineNotice>}
    <div className="nexa-form-actions"><Button variant="primary" disabled={pending} className="w-full sm:w-auto">{pending?"Saving…":"Save changes"}</Button></div>
  </form>;
}

export function CheckInstructionsForm({settings}:{settings:PaymentSettings}) {
  const [state,action,pending] = useActionState(saveChecksPayableTo,{});
  return <form action={action} className={surfaceStyles("standard", "mt-6 w-full")}>
    <SectionHeading>Invoice check instructions</SectionHeading>
    <FormField id="check-payee" label="Checks payable to" className="mt-4" help="Shown on newly generated invoice PDFs, including existing invoices. Leave blank to hide. Not shown on quotes.">
      <Input name="checks_payable_to" defaultValue={settings.checks_payable_to ?? ""} maxLength={200} disabled={pending}/>
    </FormField>
    {state.message&&<InlineNotice tone="info" role="status" className="mt-4">{state.message}</InlineNotice>}
    <div className="nexa-form-actions"><Button variant="primary" disabled={pending} className="w-full sm:w-auto">{pending?"Saving…":"Save check instructions"}</Button></div>
  </form>;
}
