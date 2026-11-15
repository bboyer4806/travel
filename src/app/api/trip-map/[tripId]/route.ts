import { currentAccount, signedOutResponse } from "@/auth";
import { locatePlaces } from "@/lib/location-search";
import { getTripSnapshot } from "@/lib/store";
import { journeyPlaceNames, tripJourney } from "@/lib/trip-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where each place on a trip's map is (TRA-44): its departing, destination, itinerary and return places, looked up by their saved names. */
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  const { tripId } = await params;
  // A trip that isn't this account's to open is not found, the same as one that doesn't exist.
  const trip = getTripSnapshot(account.id, tripId);
  if (!trip) return Response.json({ error: "This trip is no longer here." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const places = await locatePlaces(journeyPlaceNames(tripJourney(trip.data, tripId)));
  return Response.json({ places }, { headers: { "Cache-Control": "no-store" } });
}
