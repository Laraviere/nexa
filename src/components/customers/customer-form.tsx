"use client";
import { InlineNotice } from "@/components/ui/feedback";
import { SectionHeading, surfaceStyles } from "@/components/ui/surface";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/form";

import { useActionState, useState } from "react";
import { saveCustomer } from "@/actions/customers";
import { commonPaymentTerms, paymentTermsLabel, type Customer, type CustomerField, type CustomerFormState } from "@/lib/customers/validation";

const inputClass = "w-full";
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
    <form action={action} className={surfaceStyles("standard", "nexa-form-page")} noValidate>
      <p className="mb-6 text-sm text-slate-500">Company / customer name is required. All other contact and address fields are optional.</p>
      <fieldset disabled={pending} className="space-y-8 disabled:opacity-70">
        {[{title:"Customer",group:fields.slice(0,1)},{title:"Primary contact",group:fields.slice(1,4)},{title:"Billing address",group:fields.slice(4)}].map(({title,group})=><section key={title} className="nexa-form-section"><SectionHeading>{title}</SectionHeading><div className="nexa-form-grid">
          {group.map((field) => (
            <div key={field.name}>
              <FormField id={field.name} label={field.label} required={field.name === "company_name"} error={state.errors?.[field.name]}>
              <Input className={inputClass} id={field.name} name={field.name} type={field.type ?? "text"} autoComplete={field.autoComplete} required={field.name === "company_name"} defaultValue={state.values?.[field.name] ?? customer?.[field.name] ?? ""} />
              </FormField>
            </div>
          ))}
        </div></section>)}
        <div className="nexa-form-section"><SectionHeading>Billing</SectionHeading>
          <label htmlFor="payment_terms" className="mb-2 block text-sm font-medium">Default payment terms</label>
          <Select id="payment_terms" className={inputClass} name={terms === "custom" ? undefined : "default_payment_terms_days"} value={terms} onChange={(event) => setTerms(event.target.value)} aria-describedby={state.errors?.default_payment_terms_days ? "default_payment_terms_days-error" : undefined}>
            {commonPaymentTerms.map((days) => <option key={days} value={days}>{paymentTermsLabel(days)}</option>)}
            <option value="custom">Custom number of days</option>
          </Select>
          {terms === "custom" && (
            <div className="mt-4">
              <label htmlFor="default_payment_terms_days" className="mb-2 block text-sm font-medium">
                Payment due in (days)
              </label>
              <Input
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
        <div className="nexa-form-section"><SectionHeading>Other information</SectionHeading><label htmlFor="notes" className="mb-2 block text-sm font-medium">Notes</label><Textarea className={inputClass} id="notes" name="notes" rows={5} defaultValue={state.values?.notes ?? customer?.notes ?? ""} /></div>
      </fieldset>
      {state.message && <InlineNotice tone="error" role="alert" className="mt-5">{state.message}</InlineNotice>}
      <div className="nexa-form-actions">
        <ButtonLink variant="secondary" href={cancelHref}>Cancel</ButtonLink>
        <Button variant="primary" disabled={pending}>{pending ? "Saving…" : customer ? "Save changes" : "Create customer"}</Button>
      </div>
    </form>
  );
}
