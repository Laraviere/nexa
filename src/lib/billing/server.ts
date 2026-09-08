import "server-only";

import { notFound } from "next/navigation";
import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
import type { BillingAgreement } from "@/lib/billing/model";

export async function getBillingAgreements(customerId: string) {
  const supabase = await customerClient();
  if (!isCustomerId(customerId)) notFound();
  const agreements: BillingAgreement[] = [];
  // Avoid silently truncating history at the API's row limit.
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.from("customer_billing_agreements").select("*")
      .eq("customer_id", customerId).order("effective_date", { ascending: false }).order("id")
      .range(offset, offset + 99);
    if (error) throw new Error("Unable to load billing agreements.");
    agreements.push(...data);
    if (data.length < 100) return agreements;
  }
}

export async function getBillingAgreement(customerId: string, agreementId: string) {
  const supabase = await customerClient();
  if (!isCustomerId(customerId) || !isCustomerId(agreementId)) notFound();
  const { data, error } = await supabase.from("customer_billing_agreements").select("*")
    .eq("customer_id", customerId).eq("id", agreementId).maybeSingle();
  if (error) throw new Error("Unable to load billing agreement.");
  if (!data) notFound();
  return data;
}
