"use client";

import { useTransition } from "react";

import { signOut } from "@/actions/auth";

export function SignOutButton({ appearance = "light" }: { appearance?: "light" | "dark" }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className={`min-h-11 w-full rounded-md px-3 py-2.5 text-left text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${appearance === "dark" ? "text-slate-300 hover:bg-white/5 hover:text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}
      disabled={isPending}
      onClick={() => startTransition(() => void signOut())}
      type="button"
    >
      {isPending ? "Signing out…" : "Sign Out"}
    </button>
  );
}
