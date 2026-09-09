import Link from "next/link";
import { TimeEntryForm } from "@/components/time/time-entry-form";
import { businessDate } from "@/lib/billing/model";
import { getTimeCustomers } from "@/lib/time/server";

export default async function NewTimePage() {
  const customers = await getTimeCustomers();
  return <><Link href="/time" className="text-sm font-medium text-cyan-700">← Back to time</Link><h1 className="mt-4 text-3xl font-semibold tracking-tight">Add time entry</h1><p className="mb-8 mt-2 text-slate-600">Record work for a customer, using the date it was performed.</p>{customers.length ? <TimeEntryForm customers={customers} today={businessDate()} /> : <div className="rounded-xl border border-slate-200 bg-white p-8"><p>Add a customer before recording time.</p><Link href="/customers/new" className="mt-4 inline-block font-medium text-cyan-700">Add customer</Link></div>}</>;
}
