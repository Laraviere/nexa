"use client";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
export default function DashboardError({reset}:{reset:()=>void}) {
  return <Surface role="alert"><h1 className="text-2xl font-semibold">Dashboard unavailable</h1><p className="mt-3 text-sm text-slate-600">We could not load a complete overview. Please try again.</p><Button onClick={reset} className="mt-4">Try again</Button></Surface>;
}
