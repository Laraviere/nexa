"use client";

import Link from "next/link";

export default function CustomersError({ reset }: { reset: () => void }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-xl font-semibold">Unable to load customer information</h1><p className="mt-2 text-slate-600">Please try again in a moment.</p><div className="mt-5 flex gap-4"><button onClick={reset} className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white">Try again</button><Link href="/customers" className="px-2 py-2 text-sm font-medium text-cyan-700">Back to customers</Link></div></div>;
}
