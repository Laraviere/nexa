"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customerClient } from "@/lib/customers/server";
import { readTimeContext } from "@/lib/time/server";
import { timeSaveError, validateTime, validHourlyRate, type TimeFormState } from "@/lib/time/validation";
import type { TablesInsert } from "@/types/database";

export async function saveTimeEntry(_previous: TimeFormState, form: FormData): Promise<TimeFormState> {
  const supabase = await customerClient();
  const result = validateTime(form);
  if (!result.valid) return { errors: result.errors, message: "Please check the highlighted fields." };
  const { values } = result;
  let context;
  try {
    context = await readTimeContext(supabase, values.customer_id, values.work_date);
  } catch {
    return { message: "Unable to confirm the customer and billing terms. Refresh the billing context and try again." };
  }
  const needsRate = values.is_billable === "true" && !context.agreement;
  if (needsRate && !validHourlyRate(values.hourly_rate)) return {
    errors: { hourly_rate: "Enter a non-negative hourly rate with up to 10 whole-number digits and 2 decimal places." },
    message: "A billable entry without a retainer needs an hourly rate. Refresh the billing context if it has changed.",
  };
  // Explicit whitelist: no client agreement IDs, snapshots, rounded duration,
  // timer timestamps, void flags or audit fields can reach the INSERT.
  const entry = {
    customer_id: values.customer_id, work_date: values.work_date,
    description: values.description, actual_minutes: result.actualMinutes,
    is_billable: values.is_billable === "true", hourly_rate: needsRate ? Number(values.hourly_rate) : null,
  } satisfies TablesInsert<"time_entries">;
  try {
    const { data, error } = await supabase.from("time_entries").insert(entry).select("id").single();
    if (error || !data) return { message: timeSaveError(error?.code) };
  } catch {
    return { message: "Unable to confirm the save. Check recent entries before trying again to avoid recording the work twice." };
  }
  revalidatePath("/time");
  revalidatePath(`/customers/${values.customer_id}`);
  redirect("/time");
}
