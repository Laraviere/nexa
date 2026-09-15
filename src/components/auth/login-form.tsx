"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { InlineNotice } from "@/components/ui/feedback";
import { surfaceStyles } from "@/components/ui/surface";

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
    <div className="nexa-workspace flex min-h-dvh items-center justify-center bg-brand-navy px-4 py-8 sm:px-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <Image src="/icon.svg" width={44} height={44} alt="" unoptimized/>
          <span className="text-xl font-semibold tracking-tight">Nexa</span>
        </div>

        <div className={surfaceStyles("standard", "text-ink")}>
          <div className="mb-6">
            <p className="text-sm font-medium text-primary">
              Internal operations
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Sign in to Nexa
            </h1>
            <p className="mt-3 text-sm leading-6 text-secondary">
              Use your Nexa account to continue to the workspace.
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div>
              <label className="mb-2 block text-sm font-medium text-ink" htmlFor="email">
                Email
              </label>
              <Input
                autoComplete="email"
                className="w-full"
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
              <label className="mb-2 block text-sm font-medium text-ink" htmlFor="password">
                Password
              </label>
              <Input
                autoComplete="current-password"
                className="w-full"
                id="password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>

            {errorMessage ? (
              <InlineNotice tone="error" role="alert">
                {errorMessage}
              </InlineNotice>
            ) : null}

            <Button
              className="w-full"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Signing in…" : "Sign In"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-300">
          Authorized Nexa access only
        </p>
      </div>
    </div>
  );
}
