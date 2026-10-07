import { notFound } from "next/navigation";
import PlannerApp from "@/components/planner-app";
import { getSnapshot } from "@/lib/store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const data = getSnapshot();
  if (!data.trips.some((trip) => trip.id === tripId)) notFound();
  return <PlannerApp key={tripId} initialData={data} tripId={tripId} />;
}
