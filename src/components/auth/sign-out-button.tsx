"use client";

import { useTransition } from "react";

import { signOut } from "@/actions/auth";

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isPending}
      onClick={() => startTransition(() => void signOut())}
      type="button"
    >
      {isPending ? "Signing out…" : "Sign Out"}
    </button>
  );
}
