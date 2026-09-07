import "server-only";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isCustomerId } from "@/lib/customers/validation";

export async function customerClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/login");
  return supabase;
}

export async function getCustomer(id: string) {
  const supabase = await customerClient();
  if (!isCustomerId(id)) notFound();
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to load customer.");
  if (!data) notFound();
  return data;
}
