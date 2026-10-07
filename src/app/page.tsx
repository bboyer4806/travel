import PlannerApp from "@/components/planner-app";
import { getSnapshot } from "@/lib/store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default function HomePage() {
  return <PlannerApp key="home" initialData={getSnapshot()} />;
}
