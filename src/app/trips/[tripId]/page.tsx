import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAccount } from "@/auth";
import { getTripName } from "@/lib/store";
import PlannerApp from "@/components/planner-app";
import { getTripSnapshot } from "@/lib/store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function generateMetadata({ params }: { params: Promise<{ tripId: string }> }): Promise<Metadata> {
  const { tripId } = await params;
  const account = await requireAccount();
  return { title: getTripName(account.id, tripId) ?? "Trip not found" };
}
export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const account = await requireAccount();
  // A trip that isn't this account's to open is not found, the same as one that doesn't exist.
  const trip = getTripSnapshot(account.id, tripId);
  if (!trip) notFound();
  return <PlannerApp key={tripId} initialData={trip.data} access={{ [tripId]: trip.access }} tripId={tripId} />;
}
