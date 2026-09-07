import Link from "next/link";
import { CustomerForm } from "@/components/customers/customer-form";

export default function NewCustomerPage() {
  return <div className="max-w-3xl"><Link href="/customers" className="text-sm font-medium text-cyan-700">← Customers</Link><h1 className="mt-4 mb-6 text-3xl font-semibold tracking-tight">Add customer</h1><CustomerForm /></div>;
}
