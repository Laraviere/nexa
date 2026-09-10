"use client";
export default function InvoiceError({ reset }: { reset: () => void }) {
  return <div role="alert" className="rounded-xl border border-slate-200 bg-white p-6"><h1 className="text-xl font-semibold">Unable to load invoice information</h1><p className="mt-2 text-slate-600">Please try again in a moment.</p><button onClick={reset} className="mt-4 font-medium text-cyan-700">Try again</button></div>;
}
