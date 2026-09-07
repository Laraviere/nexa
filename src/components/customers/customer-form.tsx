"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveCustomer } from "@/actions/customers";
import { commonPaymentTerms, paymentTermsLabel, type Customer, type CustomerField, type CustomerFormState } from "@/lib/customers/validation";

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-600/20";
const fields: { name: CustomerField; label: string; type?: string; autoComplete?: string }[] = [
  { name: "company_name", label: "Company / customer name", autoComplete: "organization" },
  { name: "primary_contact_name", label: "Primary contact", autoComplete: "name" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
  { name: "billing_address_line1", label: "Address line 1", autoComplete: "address-line1" },
  { name: "billing_address_line2", label: "Address line 2", autoComplete: "address-line2" },
  { name: "billing_city", label: "City", autoComplete: "address-level2" },
  { name: "billing_state", label: "State / province", autoComplete: "address-level1" },
  { name: "billing_postal_code", label: "Postal code", autoComplete: "postal-code" },
  { name: "billing_country", label: "Country", autoComplete: "country-name" },
];

export function CustomerForm({ customer }: { customer?: Customer }) {
  const [state, action, pending] = useActionState(saveCustomer.bind(null, customer?.id ?? null), {} as CustomerFormState);
  const initialDays = customer?.default_payment_terms_days ?? 30;
  const [terms, setTerms] = useState(commonPaymentTerms.includes(initialDays) ? String(initialDays) : "custom");
  const cancelHref = customer ? `/customers/${customer.id}` : "/customers";
  function error(name: CustomerField) {
    return state.errors?.[name] ? <p id={`${name}-error`} className="mt-1 text-sm text-rose-700">{state.errors[name]}</p> : null;
  }
  return (
    <form action={action} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8" noValidate>
      <p className="mb-6 text-sm text-slate-500">Company / customer name is required. All other contact and address fields are optional.</p>
      <fieldset disabled={pending} className="space-y-8 disabled:opacity-70">
        <div className="grid gap-5 sm:grid-cols-2">
          {fields.map((field, index) => (
            <div key={field.name} className={index === 4 ? "sm:col-span-2" : ""}>
              {index === 4 && <h2 className="mb-5 border-t border-slate-100 pt-6 text-lg font-semibold">Billing address</h2>}
              <label htmlFor={field.name} className="mb-2 block text-sm font-medium">{field.label}{field.name === "company_name" ? " *" : ""}</label>
              <input className={inputClass} id={field.name} name={field.name} type={field.type ?? "text"} autoComplete={field.autoComplete} required={field.name === "company_name"} defaultValue={state.values?.[field.name] ?? customer?.[field.name] ?? ""} aria-invalid={!!state.errors?.[field.name]} aria-describedby={state.errors?.[field.name] ? `${field.name}-error` : undefined} />
              {error(field.name)}
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 pt-6">
          <label htmlFor="payment_terms" className="mb-2 block text-sm font-medium">Default payment terms</label>
          <select id="payment_terms" className={inputClass} name={terms === "custom" ? undefined : "default_payment_terms_days"} value={terms} onChange={(event) => setTerms(event.target.value)} aria-describedby={state.errors?.default_payment_terms_days ? "default_payment_terms_days-error" : undefined}>
            {commonPaymentTerms.map((days) => <option key={days} value={days}>{paymentTermsLabel(days)}</option>)}
            <option value="custom">Custom number of days</option>
          </select>
          {terms === "custom" && (
            <div className="mt-4">
              <label htmlFor="default_payment_terms_days" className="mb-2 block text-sm font-medium">
                Payment due in (days)
              </label>
              <input
                className={inputClass}
                id="default_payment_terms_days"
                name="default_payment_terms_days"
                type="number"
                min="0"
                max="2147483647"
                step="1"
                defaultValue={state.values?.default_payment_terms_days ?? initialDays}
                aria-invalid={!!state.errors?.default_payment_terms_days}
                aria-describedby={state.errors?.default_payment_terms_days ? "default_payment_terms_days-error" : undefined}
              />
            </div>
          )}
          {error("default_payment_terms_days")}
        </div>
        <div><label htmlFor="notes" className="mb-2 block text-sm font-medium">Notes</label><textarea className={inputClass} id="notes" name="notes" rows={5} defaultValue={state.values?.notes ?? customer?.notes ?? ""} /></div>
      </fieldset>
      {state.message && <p role="alert" className="mt-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{state.message}</p>}
      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-6">
        <button disabled={pending} className="rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60">{pending ? "Saving…" : customer ? "Save changes" : "Create customer"}</button>
        <Link href={cancelHref} className="text-sm font-medium text-slate-600 hover:text-slate-950">Cancel</Link>
      </div>
    </form>
  );
}
