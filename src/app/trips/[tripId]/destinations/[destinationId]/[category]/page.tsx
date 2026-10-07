import { notFound } from "next/navigation";
import PlannerApp from "@/components/planner-app";
import { getSnapshot } from "@/lib/store";
import type { Category } from "@/lib/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function IdeasPage({ params }: { params: Promise<{ tripId: string; destinationId: string; category: string }> }) {
  const { tripId, destinationId, category } = await params;
  if (!["hotels", "activities", "restaurants"].includes(category)) notFound();
  const data = getSnapshot();
  if (!data.trips.some((trip) => trip.id === tripId) ||
      !data.destinations.some((destination) => destination.id === destinationId && destination.tripId === tripId)) notFound();
  return <PlannerApp key={tripId + destinationId + category} initialData={data} tripId={tripId} destinationId={destinationId} category={category as Category} />;
}
