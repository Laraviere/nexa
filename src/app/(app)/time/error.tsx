"use client";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";

export default function TimeError({ reset }: { reset: () => void }) {
  return <Surface role="alert"><h1 className="text-xl font-semibold">Unable to load time information</h1><p className="mt-2 text-slate-600">Please try again in a moment.</p><Button onClick={reset} className="mt-4">Try again</Button></Surface>;
}
