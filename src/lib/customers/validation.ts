import type { Tables } from "@/types/database";

export type Customer = Tables<"customers">;
export const textFields = [
  "company_name", "primary_contact_name", "email", "phone",
  "billing_address_line1", "billing_address_line2", "billing_city",
  "billing_state", "billing_postal_code", "billing_country", "notes",
] as const;
export type CustomerField = (typeof textFields)[number] | "default_payment_terms_days";
export type CustomerValues = Record<CustomerField, string>;
export type CustomerFormState = {
  message?: string;
  errors?: Partial<Record<CustomerField, string>>;
  values?: CustomerValues;
};
export const commonPaymentTerms = [0, 15, 30, 45, 60];
export function paymentTermsLabel(days: number) {
  return days === 0 ? "Due on receipt" : `Net ${days}`;
}
export function isCustomerId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
export function validateCustomer(formData: FormData) {
  const values = Object.fromEntries([...textFields, "default_payment_terms_days"].map((field) => {
    const value = formData.get(field);
    return [field, typeof value === "string" ? value.trim() : ""];
  })) as CustomerValues;
  const errors: NonNullable<CustomerFormState["errors"]> = {};
  if (!values.company_name) errors.company_name = "Enter a company or customer name.";
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = "Enter a valid email address.";
  }
  const days = Number(values.default_payment_terms_days);
  if (!/^\d+$/.test(values.default_payment_terms_days) || !Number.isSafeInteger(days) || days > 2147483647) {
    errors.default_payment_terms_days = "Enter a whole number from 0 to 2,147,483,647.";
  }
  // Only explicitly editable fields are sent to Supabase.
  const data = {
    ...Object.fromEntries(textFields.map((field) => [field, values[field] || null])) as Record<(typeof textFields)[number], string | null>,
    company_name: values.company_name,
    default_payment_terms_days: days,
  };
  return { values, errors, data, valid: Object.keys(errors).length === 0 };
}
