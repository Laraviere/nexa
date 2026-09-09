import { customerClient } from "@/lib/customers/server";
import { isCustomerId } from "@/lib/customers/validation";
import { isBusinessDate } from "@/lib/billing/validation";
import { readTimeContext } from "@/lib/time/server";

export async function GET(request: Request) {
  const supabase = await customerClient();
  const params = new URL(request.url).searchParams;
  const customer = params.get("customer_id") ?? "";
  const date = params.get("work_date") ?? "";
  const headers = { "Cache-Control": "private, no-store" };
  if (!isCustomerId(customer) || !isBusinessDate(date)) return Response.json({ message: "Choose a customer and valid work date." }, { status: 400, headers });
  try {
    return Response.json(await readTimeContext(supabase, customer, date), { headers });
  } catch {
    return Response.json({ message: "Unable to load billing context. Refresh and try again." }, { status: 503, headers });
  }
}
