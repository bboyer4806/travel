import { requireAccount } from "@/auth";
import PlannerApp from "@/components/planner-app";
import { getHomeOverview } from "@/lib/store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function HomePage() {
  const account = await requireAccount();
  const { data, budgets, access } = getHomeOverview(account.id);
  return <PlannerApp key="home" initialData={data} initialBudgets={budgets} access={access} />;
}
