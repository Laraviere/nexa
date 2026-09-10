import Link from "next/link";
export default function SettingsLayout({children}:{children:React.ReactNode}) {
  return <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10"><h1 className="text-3xl font-semibold tracking-tight">Settings</h1><nav aria-label="Settings" className="my-6"><Link href="/settings/payments" aria-current="page" className="inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Payments</Link></nav>{children}</main>;
}
