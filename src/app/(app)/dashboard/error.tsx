"use client";
export default function DashboardError({reset}:{reset:()=>void}) {
  return <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8"><h1 className="text-2xl font-semibold">Dashboard unavailable</h1><p className="mt-3 text-sm text-slate-600">We could not load a complete overview. Please try again.</p><button onClick={reset} className="mt-5 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold">Try again</button></div>;
}
