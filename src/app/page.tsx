import { requireAccount } from "@/auth";
import PlannerApp from "@/components/planner-app";
import { getHomeOverview } from "@/lib/store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function HomePage() {
  await requireAccount("/");
  const { data, budgets } = getHomeOverview();
  return <PlannerApp key="home" initialData={data} initialBudgets={budgets} />;
}
