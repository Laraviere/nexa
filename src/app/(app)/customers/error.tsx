"use client";
import { Button, ButtonLink } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";



export default function CustomersError({ reset }: { reset: () => void }) {
  return <Surface role="alert"><h1 className="text-xl font-semibold">Unable to load customer information</h1><p className="mt-2 text-slate-600">Please try again in a moment.</p><div className="mt-4 flex flex-wrap items-end gap-3"><Button onClick={reset} className="mt-4">Try again</Button><ButtonLink href="/customers">Back to customers</ButtonLink></div></Surface>;
}
