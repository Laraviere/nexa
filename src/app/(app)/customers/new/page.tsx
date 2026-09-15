import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/detail";
import Link from "next/link";
import { CustomerForm } from "@/components/customers/customer-form";

export default function NewCustomerPage() {
  return <PageContainer width="form"><div className="nexa-form-page"><Link href="/customers" className="text-sm font-medium text-cyan-700">← Customers</Link><PageHeader title="Add customer" status={null} actions={null}/><CustomerForm /></div></PageContainer>;
}
