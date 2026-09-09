import "server-only";
import { customerClient } from "@/lib/customers/server";
export async function getTimer() {
  const supabase = await customerClient();
  const { data, error } = await supabase.from("running_timers").select("*,customers(company_name)").maybeSingle();
  if (error) throw new Error("Unable to load the timer. Please refresh before starting work.");
  return { timer: data, observedAt: Date.now() };
}
