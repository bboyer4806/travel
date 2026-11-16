import { currentAccount, signedOutResponse } from "@/auth";
import { destinationPlaces, placeKey, type DestinationMapAnswer } from "@/lib/destination-map";
import { locatePlaces } from "@/lib/location-search";
import { locateNear, type PlaceAnswer } from "@/lib/place-search";
import { getDestinationSnapshot } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where each hotel, activity, restaurant and church saved for a destination is on its map (TRA-130), by saved ID. The
 * destination is found by its city as the trip map finds it (TRA-44), and its places by their saved addresses and names
 * around it. Places still waiting their turn are pending, for the map to ask again.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ destinationId: string }> }) {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  const { destinationId } = await params;
  // A destination that isn't this account's to open is not found, the same as one that doesn't exist.
  const snapshot = getDestinationSnapshot(account.id, destinationId);
  if (!snapshot) return Response.json({ error: "This destination is no longer here." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const destination = snapshot.data.destinations.find((item) => item.id === destinationId)!;
  const places = destinationPlaces(snapshot.data, destinationId);
  const city = destination.city.trim();
  const area = (await locatePlaces([city]))[city];
  // Without the destination, its places can't be looked up around it.
  const answers: Record<string, PlaceAnswer> = area.status === "found" ? await locateNear(area, Object.fromEntries(places.map((place) => [place.id, place])))
    : Object.fromEntries(places.map((place) => [place.id, { status: area.status }]));
  const answer: DestinationMapAnswer = { area: area.status, places: Object.fromEntries(places.map((place) => [place.id, { key: placeKey(destination.city, place), ...answers[place.id] }])) };
  return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
}
