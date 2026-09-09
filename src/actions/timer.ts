"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customerClient } from "@/lib/customers/server";
import { readTimeContext } from "@/lib/time/server";
import { businessDate } from "@/lib/billing/model";
import { formText } from "@/lib/billing/validation";
import { isCustomerId } from "@/lib/customers/validation";
import { validHourlyRate } from "@/lib/time/validation";
import { stopStatus, timerError, type TimerState } from "@/lib/timer/model";
import type { Database, TablesInsert } from "@/types/database";

function refreshTimer(customer?: string) {
  revalidatePath("/time");
  if (customer) revalidatePath(`/customers/${customer}`);
}
export async function startTimer(_previous: TimerState, form: FormData): Promise<TimerState> {
  const supabase = await customerClient();
  const customer = formText(form, "customer_id"), description = formText(form, "description"), billable = formText(form, "is_billable");
  if (!isCustomerId(customer) || !description || !["true", "false"].includes(billable)) return { message: "Choose a customer, enter a description, and select billable or non-billable." };
  let context;
  try { context = await readTimeContext(supabase, customer, businessDate()); }
  catch { return { message: "Unable to confirm current billing context. Refresh and try again." }; }
  const needsRate = billable === "true" && !context.agreement;
  const rate = formText(form, "hourly_rate");
  if (needsRate && !validHourlyRate(rate)) return { message: "Billable work without a retainer requires a valid hourly rate with up to two decimal places." };
  // Generated Insert requires this field; the trigger always replaces this server-only placeholder.
  const input = { started_at: new Date().toISOString(), customer_id: customer, description, is_billable: billable === "true", hourly_rate: needsRate ? Number(rate) : null } satisfies TablesInsert<"running_timers">;
  try {
    const { error } = await supabase.from("running_timers").insert(input);
    if (error) { refreshTimer(); return { message: timerError(error.code) }; }
  } catch { return { message: timerError() }; }
  refreshTimer();
  redirect("/time");
}
export async function stopTimer(_previous: TimerState, form: FormData): Promise<TimerState> {
  const supabase = await customerClient();
  const id = formText(form, "timer_id"), rate = formText(form, "hourly_rate");
  if (!isCustomerId(id)) return { message: "This timer is unavailable. Refresh and try again." };
  // Do not reject a first Stop because of a rate: the RPC must preserve Stop time.
  // Rate input is offered on retry only; invalid retries leave the stored time intact.
  if (rate && !validHourlyRate(rate)) return { message: "Enter a non-negative hourly rate with up to two decimal places." };
  const { data: timer, error: readError } = await supabase.from("running_timers").select("customer_id").eq("id", id).maybeSingle();
  if (readError) return { message: timerError(readError.code) };
  const args = { p_timer_id: id, ...(rate ? { p_hourly_rate: Number(rate) } : {}) } satisfies Database["public"]["Functions"]["stop_time_timer"]["Args"];
  try {
    const { data, error } = await supabase.rpc("stop_time_timer", args);
    refreshTimer(timer?.customer_id);
    if (error) return { message: timerError(error.code) };
    const status = stopStatus(data, id);
    if (status === "pending_finalization") return { pendingFinalization: true, message: "Your stop time was saved, but Nexa could not finish creating the time entry. Retry finalization to complete it." };
    if (status !== "completed") return { message: timerError() };
  } catch { refreshTimer(timer?.customer_id); return { message: timerError() }; }
  redirect("/time");
}
export async function cancelTimer(_previous: TimerState, form: FormData): Promise<TimerState> {
  const supabase = await customerClient();
  const id = formText(form, "timer_id");
  if (!isCustomerId(id) || formText(form, "confirm") !== "yes") return { message: "Confirm cancellation to discard this timer without recording time." };
  const args = { p_timer_id: id } satisfies Database["public"]["Functions"]["cancel_time_timer"]["Args"];
  try {
    const { data, error } = await supabase.rpc("cancel_time_timer", args);
    refreshTimer();
    if (error) return { message: timerError(error.code) };
    if (!data) return { message: timerError("P0002") };
  } catch { refreshTimer(); return { message: timerError() }; }
  redirect("/time");
}
