import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAccount } from "@/auth";
import { getDestinationName, getDestinationSnapshot } from "@/lib/store";
import PlannerApp from "@/components/planner-app";
import type { Category } from "@/lib/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function generateMetadata({ params }: { params: Promise<{ destinationId: string; category: string }> }): Promise<Metadata> {
  const { destinationId, category } = await params;
  const account = await requireAccount();
  const labels: Record<string, string> = { hotels: "Hotels", activities: "Activities", restaurants: "Restaurants", church: "Church" };
  const city = getDestinationName(account.id, destinationId);
  return { title: labels[category] && city ? `${labels[category]} · ${city}` : "Destination not found" };
}
export default async function DestinationIdeasPage({ params }: { params: Promise<{ destinationId: string; category: string }> }) {
  const { destinationId, category } = await params;
  const account = await requireAccount();
  if (!["hotels", "activities", "restaurants", "church"].includes(category)) notFound();
  const destination = getDestinationSnapshot(account.id, destinationId);
  if (!destination) notFound();
  return <PlannerApp key={destinationId + category} initialData={destination.data} destinationAccess={{ [destinationId]: destination.access }} destinationId={destinationId} category={category === "church" ? undefined : category as Category} church={category === "church"} />;
}
