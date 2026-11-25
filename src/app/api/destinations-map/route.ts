import { currentAccount, signedOutResponse } from "@/auth";
import { lookupCity, type DestinationsMapAnswer } from "@/lib/destinations-map";
import { locatePlaces } from "@/lib/location-search";
import { getDestinationsOverview } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where each destination the account can open is on the Destinations page's map (TRA-180), by its saved ID: the account's
 * own and those of trips shared with it, in a trip or not, each looked up by its saved city as a trip's map looks up its
 * destinations (TRA-44), with the city it was looked up by. Nothing else of a destination is answered, and nothing is saved.
 */
export async function GET() {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  const { destinations } = getDestinationsOverview(account.id).data;
  const found = await locatePlaces(destinations.map((destination) => lookupCity(destination)));
  const answer: DestinationsMapAnswer = { destinations: Object.fromEntries(destinations.map((destination) => {
    const city = lookupCity(destination);
    return [destination.id, { ...found[city], city }];
  })) };
  return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
}
