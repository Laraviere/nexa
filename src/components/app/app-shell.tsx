import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";

const navigation: ReadonlyArray<{ label: string; href?: string }> = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Customers", href: "/customers" },
  { label: "Time", href: "/time" },
  { label: "Quotes", href: "/quotes" },
  { label: "Invoices", href: "/invoices" },
  { label: "Payments" },
  { label: "Settings", href: "/settings" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 lg:flex">
      <aside className="border-b border-slate-200 bg-white lg:flex lg:min-h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-5 py-5 lg:px-6">
          <span className="flex size-9 items-center justify-center rounded-lg bg-cyan-400 font-semibold text-slate-950">
            N
          </span>
          <span className="font-semibold tracking-tight">Nexa</span>
        </div>

        <nav aria-label="Main navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:px-4 lg:py-4">
          {navigation.map((item) =>
            item.href ? (
              <Link
                className="flex shrink-0 items-center rounded-lg bg-cyan-50 px-3 py-2.5 text-sm font-medium text-cyan-800"
                href={item.href}
                key={item.label}
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="flex shrink-0 cursor-not-allowed items-center rounded-lg px-3 py-2.5 text-sm text-slate-400"
                key={item.label}
              >
                {item.label}
              </span>
            ),
          )}
        </nav>

        <div className="border-t border-slate-100 p-4 lg:mt-auto lg:p-5">
          <SignOutButton />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="border-b border-slate-200 bg-white/80 px-5 py-4 backdrop-blur sm:px-8">
          <p className="text-sm text-slate-500">Internal workspace</p>
        </header>
        {children}
      </div>
    </div>
  );
}
