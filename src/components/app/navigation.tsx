"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";

export const navigation = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Customers", href: "/customers" },
  { label: "Time", href: "/time" },
  { label: "Quotes", href: "/quotes" },
  { label: "Invoices", href: "/invoices" },
  { label: "Payments", href: "/payments" },
  { label: "Settings", href: "/settings" },
] as const;

export function activeSection(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return <Link href="/dashboard" aria-label="Nexa dashboard" className="inline-flex min-h-11 items-center gap-3 rounded-md text-white">
    <Image src="/icon.svg" width={36} height={36} alt="" unoptimized />
    <span className="text-lg font-semibold tracking-tight">Nexa</span>
  </Link>;
}

export function AppNavigation() {
  const pathname = usePathname();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const current = navigation.find(item => activeSection(pathname, item.href));
  function links(mobile = false) {
    return navigation.map(item => {
      const active = activeSection(pathname, item.href);
      return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
        onClick={mobile ? () => { if (disclosure.current) disclosure.current.open = false; } : undefined}
        className={`flex min-h-11 items-center rounded-md border-l-2 px-3 py-2.5 text-sm ${item.href === "/settings" ? "mt-4" : ""} ${active ? "border-brand-cyan bg-white/10 font-semibold text-white" : "border-transparent font-medium text-slate-300 hover:bg-white/5 hover:text-white"}`}>
        {item.label}
      </Link>;
    });
  }
  return <>
    <aside aria-label="Workspace sidebar" className="nexa-dark hidden border-r border-white/5 bg-brand-navy lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-y-auto">
      <div className="px-5 pb-5 pt-6"><Brand /></div>
      <nav aria-label="Main navigation" className="space-y-1 px-3">{links()}</nav>
      <div className="mx-3 mb-4 mt-auto border-t border-white/10 pt-4"><SignOutButton appearance="dark" /></div>
    </aside>
    <header className="nexa-dark border-b border-white/10 bg-brand-navy px-4 sm:px-6 lg:hidden">
      <details key={pathname} ref={disclosure} className="group" onKeyDown={event => {
        if (event.key === "Escape" && disclosure.current?.open) {
          disclosure.current.open = false;
          disclosure.current.querySelector("summary")?.focus();
          event.preventDefault();
        }
      }}>
        <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 rounded-md py-2 text-white [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2.5"><Image src="/icon.svg" width={32} height={32} alt="" unoptimized /><span className="font-semibold">Nexa</span><span className="border-l border-white/20 pl-2.5 text-xs text-slate-300">{current?.label ?? "Workspace"}</span></span>
          <span className="flex min-h-11 shrink-0 items-center rounded-md border border-white/20 px-3 text-sm font-medium"><span className="group-open:hidden">Menu</span><span className="hidden group-open:inline">Close</span><span className="sr-only"> navigation</span></span>
        </summary>
        <nav aria-label="Mobile navigation" className="space-y-1 border-t border-white/10 py-3">{links(true)}</nav>
        <div className="border-t border-white/10 py-3"><SignOutButton appearance="dark" /></div>
      </details>
    </header>
  </>;
}
