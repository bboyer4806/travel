import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAccount } from "@/auth";
import { getStopName } from "@/lib/store";
import PlannerApp from "@/components/planner-app";
import { getTripSnapshot } from "@/lib/store";
import type { Category } from "@/lib/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// `stopId` is one of the trip's stops. Each kept the ID its destination had in the trip before schema 21, so earlier links still open.
export async function generateMetadata({ params }: { params: Promise<{ tripId: string; stopId: string; category: string }> }): Promise<Metadata> {
  const { tripId, stopId, category } = await params;
  const account = await requireAccount();
  const labels: Record<string, string> = { hotels: "Hotels", activities: "Activities", restaurants: "Restaurants", church: "Church" };
  const city = getStopName(account.id, tripId, stopId);
  return { title: labels[category] && city ? `${labels[category]} · ${city}` : "Destination not found" };
}
export default async function IdeasPage({ params }: { params: Promise<{ tripId: string; stopId: string; category: string }> }) {
  const { tripId, stopId, category } = await params;
  const account = await requireAccount();
  if (!["hotels", "activities", "restaurants", "church"].includes(category)) notFound();
  const trip = getTripSnapshot(account.id, tripId, stopId);
  if (!trip || !trip.data.stops.some((stop) => stop.id === stopId && stop.tripId === tripId)) notFound();
  return <PlannerApp key={tripId + stopId + category} initialData={trip.data} access={{ [tripId]: trip.access }} tripId={tripId} stopId={stopId} category={category === "church" ? undefined : category as Category} church={category === "church"} />;
}
