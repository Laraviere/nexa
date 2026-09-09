"use client";

export default function TimeError({ reset }: { reset: () => void }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-xl font-semibold">Unable to load time information</h1><p className="mt-2 text-slate-600">Please try again in a moment.</p><button onClick={reset} className="mt-5 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white">Try again</button></div>;
}
