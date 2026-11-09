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
  await requireAccount();
  return { title: getTripName(tripId) ?? "Trip not found" };
}
export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  await requireAccount();
  const data = getTripSnapshot(tripId);
  if (!data.trips.some((trip) => trip.id === tripId)) notFound();
  return <PlannerApp key={tripId} initialData={data} tripId={tripId} />;
}
