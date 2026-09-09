import "server-only";

import { customerClient } from "@/lib/customers/server";
import type { TimeContext, TimeCustomer } from "@/lib/time/model";

export async function getTimeCustomers() {
  const supabase = await customerClient();
  const customers: TimeCustomer[] = [];
  // Include archived customers for historical work; never silently truncate choices.
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.from("customers").select("id,company_name,is_active")
      .order("company_name").order("id").range(offset, offset + 99);
    if (error) throw new Error("Unable to load customers for time entry.");
    customers.push(...data);
    if (data.length < 100) return customers;
  }
}

// Callers authenticate and validate both inputs before this read. This is a
// preview/preflight only: INSERT's database trigger captures authoritative terms.
export async function readTimeContext(supabase: Awaited<ReturnType<typeof customerClient>>, customerId: string, workDate: string): Promise<TimeContext> {
  const { data: customer, error: customerError } = await supabase.from("customers").select("id")
    .eq("id", customerId).maybeSingle();
  if (customerError || !customer) throw new Error("This customer is unavailable. Choose another customer or refresh.");
  const { data, error } = await supabase.from("customer_billing_agreements")
    .select("included_hours,rounding_increment_minutes,overage_hourly_rate,billing_cycle_day")
    .eq("customer_id", customerId).eq("is_active", true).lte("effective_date", workDate)
    .or(`end_date.is.null,end_date.gt.${workDate}`).maybeSingle();
  if (error) throw new Error("Unable to load billing context. Please try again.");
  return { agreement: data };
}

export async function getRecentTime(page: number) {
  const supabase = await customerClient();
  const { data, error } = await supabase.from("time_entries")
    .select("*,customers!time_entries_customer_fk(id,company_name)")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * 25, page * 25);
  if (error) throw new Error("Unable to load time entries.");
  return { entries: data.slice(0, 25), hasNext: data.length > 25 };
}
