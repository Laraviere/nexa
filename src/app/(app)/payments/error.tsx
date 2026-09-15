"use client";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
export default function PaymentError({reset}:{reset:()=>void}) {
  return <Surface role="alert"><h1 className="font-semibold">Unable to load payments</h1><p className="mt-2 text-sm text-slate-600">Please try again in a moment.</p><Button onClick={reset} className="mt-4">Try again</Button></Surface>;
}
