"use client";
export default function SettingsError({reset}:{reset:()=>void}){return <div role="alert" className="rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold">Unable to load settings</h2><button onClick={reset} className="mt-3 text-sm font-semibold text-cyan-700">Try again</button></div>;}
