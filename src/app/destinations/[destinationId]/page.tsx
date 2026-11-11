import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAccount } from "@/auth";
import { formatSavedDestinationLabel } from "@/lib/destination-label";
import { getDestinationName, getDestinationSnapshot } from "@/lib/store";
import PlannerApp from "@/components/planner-app";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function generateMetadata({ params }: { params: Promise<{ destinationId: string }> }): Promise<Metadata> {
  const { destinationId } = await params;
  const account = await requireAccount();
  const city = getDestinationName(account.id, destinationId);
  return { title: city ? formatSavedDestinationLabel(city) : "Destination not found" };
}
export default async function DestinationPage({ params }: { params: Promise<{ destinationId: string }> }) {
  const { destinationId } = await params;
  const account = await requireAccount();
  // A destination that isn't this account's to open is not found, the same as one that doesn't exist.
  const destination = getDestinationSnapshot(account.id, destinationId);
  if (!destination) notFound();
  return <PlannerApp key={destinationId} initialData={destination.data} destinationAccess={{ [destinationId]: destination.access }} destinationId={destinationId} />;
}
