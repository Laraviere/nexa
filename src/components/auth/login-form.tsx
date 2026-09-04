"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setErrorMessage("Enter your email and password to continue.");
      return;
    }

    setIsPending(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      setErrorMessage("Unable to sign in. Check your email and password and try again.");
      setIsPending(false);
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-cyan-400 text-lg font-semibold text-slate-950">
            N
          </span>
          <span className="text-xl font-semibold tracking-tight">Nexa</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/20 sm:p-8">
          <div className="mb-8">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-300">
              Internal operations
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Sign in to Nexa
            </h1>
            <p className="mt-3 leading-6 text-slate-400">
              Use your Nexa account to continue to the workspace.
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200" htmlFor="email">
                Email
              </label>
              <input
                autoComplete="email"
                className="h-12 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                id="email"
                inputMode="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                value={email}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200" htmlFor="password">
                Password
              </label>
              <input
                autoComplete="current-password"
                className="h-12 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                id="password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>

            {errorMessage ? (
              <p className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm leading-5 text-rose-200" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <button
              className="h-12 w-full rounded-xl bg-cyan-400 px-4 font-semibold text-slate-950 transition hover:bg-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Authorized Nexa access only
        </p>
      </div>
    </div>
  );
}
