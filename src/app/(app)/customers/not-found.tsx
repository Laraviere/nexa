import Link from "next/link";

export default function CustomerNotFound() {
  return <div className="rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-xl font-semibold">Customer not found</h1><p className="mt-2 text-slate-600">This customer does not exist or is no longer available.</p><Link href="/customers" className="mt-5 inline-block text-sm font-medium text-cyan-700">Back to customers</Link></div>;
}
