import { requireAccount } from "@/auth";
import PlannerApp from "@/components/planner-app";
import { getDestinationsOverview } from "@/lib/store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: "Destinations" };
export default async function DestinationsPage() {
  const account = await requireAccount();
  const { data, access } = getDestinationsOverview(account.id);
  return <PlannerApp key="destinations" initialData={data} destinationAccess={access} destinationList />;
}
