"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customerClient } from "@/lib/customers/server";
import { isCustomerId, validateCustomer, type CustomerFormState } from "@/lib/customers/validation";

export async function saveCustomer(id: string | null, _previous: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const supabase = await customerClient();
  const result = validateCustomer(formData);
  if (!result.valid) return { values: result.values, errors: result.errors, message: "Please check the highlighted fields." };
  if (id !== null && !isCustomerId(id)) return { values: result.values, message: "This customer could not be found." };
  let savedId: string;
  try {
    const query = id === null
      ? supabase.from("customers").insert(result.data)
      : supabase.from("customers").update(result.data).eq("id", id);
    const { data, error } = await query.select("id").single();
    if (error || !data) return { values: result.values, message: "Unable to save the customer. Please try again." };
    savedId = data.id;
  } catch {
    return { values: result.values, message: "Unable to save the customer. Please try again." };
  }
  revalidatePath("/customers", "layout");
  redirect(`/customers/${savedId}`);
}

export async function setCustomerActive(id: string, active: boolean, _previous: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const supabase = await customerClient();
  if (!isCustomerId(id) || typeof active !== "boolean") return { message: "This customer could not be found." };
  if (!active && formData.get("confirm_archive") !== "yes") return { message: "Confirm that you want to archive this customer." };
  try {
    const { data, error } = await supabase.from("customers").update({ is_active: active }).eq("id", id).select("id").single();
    if (error || !data) return { message: "Unable to update customer status. Please try again." };
  } catch {
    return { message: "Unable to update customer status. Please try again." };
  }
  revalidatePath("/customers", "layout");
  return { message: active ? "Customer reactivated." : "Customer archived." };
}
