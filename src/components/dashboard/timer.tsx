"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { elapsedTimer } from "@/lib/timer/model";
import type { DashboardData } from "@/lib/dashboard/server";
export function DashboardTimer({timer,observedAt}:{timer:NonNullable<DashboardData["timer"]>;observedAt:number}) {
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{
    if(timer.stop_requested_at)return;
    const start=performance.now();
    const interval=setInterval(()=>setElapsed(performance.now()-start),1000);
    return()=>clearInterval(interval);
  },[timer.id,timer.stop_requested_at,observedAt]);
  const pending=!!timer.stop_requested_at;
  return <section aria-label="Current timer" className={`flex min-w-0 flex-col gap-4 rounded-xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${pending?"border-amber-200 bg-amber-50":"border-cyan-200 bg-cyan-50"}`}>
    <div className="min-w-0"><p className={`text-xs font-semibold ${pending?"text-amber-800":"text-cyan-800"}`}>{pending?"Stopped — pending finalization":"Running"}</p><p className="mt-1 break-words font-semibold text-slate-950">{timer.customers?.company_name??"Customer"}</p><p className="mt-1 break-words text-sm text-slate-600">{timer.description}</p></div>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-4"><span aria-label={pending?"Fixed elapsed duration":"Elapsed duration"} className="text-xl font-semibold tabular-nums text-slate-950">{elapsedTimer(timer.started_at,timer.stop_requested_at,observedAt+elapsed)}</span><Link href="/time" className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800">{pending?"Retry / fix in Time":"View Timer"}</Link></div>
  </section>;
}
