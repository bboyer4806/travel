import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAccount } from "@/auth";
import { formatSavedDestinationLabel } from "@/lib/destination-label";
import { getDestinationName } from "@/lib/store";
import PlannerApp from "@/components/planner-app";
import { getTripSnapshot } from "@/lib/store";
import type { Category } from "@/lib/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function generateMetadata({ params }: { params: Promise<{ tripId: string; destinationId: string; category: string }> }): Promise<Metadata> {
  const { tripId, destinationId, category } = await params;
  const account = await requireAccount();
  const labels: Record<string, string> = { hotels: "Hotels", activities: "Activities", restaurants: "Restaurants", church: "Church" };
  const city = getDestinationName(account.id, tripId, destinationId);
  return { title: labels[category] && city ? `${labels[category]} · ${formatSavedDestinationLabel(city)}` : "Destination not found" };
}
export default async function IdeasPage({ params }: { params: Promise<{ tripId: string; destinationId: string; category: string }> }) {
  const { tripId, destinationId, category } = await params;
  const account = await requireAccount();
  if (!["hotels", "activities", "restaurants", "church"].includes(category)) notFound();
  const trip = getTripSnapshot(account.id, tripId, destinationId);
  if (!trip || !trip.data.destinations.some((destination) => destination.id === destinationId && destination.tripId === tripId)) notFound();
  return <PlannerApp key={tripId + destinationId + category} initialData={trip.data} access={{ [tripId]: trip.access }} tripId={tripId} destinationId={destinationId} category={category === "church" ? undefined : category as Category} church={category === "church"} />;
}
