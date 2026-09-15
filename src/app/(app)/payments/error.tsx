"use client";
export default function PaymentError({reset}:{reset:()=>void}) {
  return <div className="rounded-xl border border-slate-200 bg-white p-6"><h1 className="font-semibold">Unable to load payments</h1><p className="mt-2 text-sm text-slate-600">Please try again in a moment.</p><button onClick={reset} className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold">Try again</button></div>;
}
