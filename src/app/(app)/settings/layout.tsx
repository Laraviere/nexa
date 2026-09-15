import Link from "next/link";
import { PageHeader } from "@/components/ui/detail";
import { PageContainer } from "@/components/ui/page-container";
export default function SettingsLayout({children}:{children:React.ReactNode}) {
  return <PageContainer width="form"><div className="nexa-form-page"><PageHeader title="Settings" context="Manage payment methods and invoice check instructions." status={null} actions={null}/><nav aria-label="Settings" className="mb-6 border-b border-structural"><Link href="/settings/payments" aria-current="page" className="inline-flex min-h-11 items-center border-b-2 border-primary px-3 text-sm font-semibold text-primary">Payments</Link></nav>{children}</div></PageContainer>;
}
