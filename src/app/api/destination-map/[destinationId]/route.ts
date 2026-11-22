import { currentAccount, signedOutResponse } from "@/auth";
import { destinationPlaces, lookupText, placeKey, type DestinationMapAnswer } from "@/lib/destination-map";
import { locatePlaces } from "@/lib/location-search";
import { locateNear, type PlaceAnswer } from "@/lib/place-search";
import { getDestinationSnapshot } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where each hotel, activity, restaurant and church saved for a destination is on its map (TRA-130), by saved ID. The
 * destination is found by its city as the trip map finds it (TRA-44), and its places around it by what `lookupText`
 * gives: their saved addresses and names, or only the address of a place with coordinates to show it at, which the map
 * uses when its address isn't found (TRA-163). One with coordinates and no address isn't looked up, so Nominatim is
 * never asked about it. Places still waiting their turn are pending, for the map to ask again.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ destinationId: string }> }) {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  const { destinationId } = await params;
  // A destination that isn't this account's to open is not found, the same as one that doesn't exist.
  const snapshot = getDestinationSnapshot(account.id, destinationId);
  if (!snapshot) return Response.json({ error: "This destination is no longer here." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const destination = snapshot.data.destinations.find((item) => item.id === destinationId)!;
  const lookups = destinationPlaces(snapshot.data, destinationId).flatMap((place) => {
    const text = lookupText(place);
    return text ? [{ id: place.id, text, key: placeKey(destination.city, place) }] : [];
  });
  const city = destination.city.trim();
  const area = (await locatePlaces([city]))[city];
  // Without the destination, its places can't be looked up around it.
  const answers: Record<string, PlaceAnswer> = area.status === "found" ? await locateNear(area, Object.fromEntries(lookups.map(({ id, text }) => [id, text])))
    : Object.fromEntries(lookups.map(({ id }) => [id, { status: area.status }]));
  const answer: DestinationMapAnswer = { area: area.status, places: Object.fromEntries(lookups.map(({ id, key }) => [id, { key, ...answers[id] }])) };
  return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
}
