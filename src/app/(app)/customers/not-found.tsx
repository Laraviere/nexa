import { ButtonLink } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";

export default function CustomerNotFound() {
  return <Surface><h1 className="text-xl font-semibold">Customer not found</h1><p className="mt-2 text-slate-600">This customer does not exist or is no longer available.</p><ButtonLink href="/customers" className="mt-5">Back to customers</ButtonLink></Surface>;
}
