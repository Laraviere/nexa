"use client";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
export default function SettingsError({reset}:{reset:()=>void}){return <Surface role="alert"><h2 className="text-lg font-semibold">Unable to load settings</h2><Button onClick={reset} className="mt-4">Try again</Button></Surface>;}
