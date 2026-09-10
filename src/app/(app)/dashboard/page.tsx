import { DashboardOverview } from "@/components/dashboard/overview";
import { getDashboard } from "@/lib/dashboard/server";
export default async function DashboardPage() {
  return <DashboardOverview data={await getDashboard()}/>;
}
