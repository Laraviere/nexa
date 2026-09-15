import { StatusBadge } from "@/components/ui/status-badge";
export function CustomerStatus({ active }: { active: boolean }) {
  return <StatusBadge domain="customer" status={active ? "active" : "archived"}/>;
}
