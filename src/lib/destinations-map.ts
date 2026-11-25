import { formatSavedDestinationLabel } from "./destination-label.ts";
import type { PlaceLocation } from "./location-search.ts";

/**
 * A saved destination on the Destinations page's map (TRA-180): its saved ID and city, and the name of the account it
 * belongs to when that isn't the signed-in account, as its card's Shared by says, or null for the account's own.
 */
export interface MapDestination { id: string; city: string; cityFromSuggestion: boolean; sharedBy: string | null }

/** A destination's page in Destinations, which the map opens for it (TRA-180). */
export function destinationHref(id: string): string {
  return "/destinations/" + id;
}

/** What the map looks a destination up by: its saved city, as a trip's map looks up its destinations (TRA-44). */
export function lookupCity(destination: Pick<MapDestination, "city">): string {
  return destination.city.trim();
}

/**
 * Where `/api/destinations-map` found a destination (TRA-180): what `locatePlaces` answered for the city it looked up, with
 * that city, so an answer for a city renamed since is never shown.
 */
export type DestinationLocation = PlaceLocation & { city: string };

/** What `/api/destinations-map` answers: where each destination the account can open is, by its saved ID. */
export interface DestinationsMapAnswer { destinations: Record<string, DestinationLocation> }

/** A latitude and longitude. */
export type Position = [number, number];

/** A point on the map at one zoom, in pixels. */
export interface Point { x: number; y: number }

/** A destination the map shows: its saved ID, its name on the map, and where it was found, with that place's label. */
export interface MappedDestination { id: string; name: string; position: Position; found: string }

/** A marker the map draws at one zoom: where it is, and each destination it shows. */
export interface DestinationsMarker { key: string; position: Position; destinations: MappedDestination[] }

/** A destination the map can't show, and why: no place has its city's name, or the lookup couldn't be made right now. */
export interface UnmappedDestination { id: string; name: string; reason: "missing" | "unavailable" }

/** What the map shows of the destinations the search shows: those found, and those it can't show. */
export interface DestinationsMapLayout { mapped: MappedDestination[]; unmapped: UnmappedDestination[] }

/**
 * Each destination's name on the map, by its saved ID (TRA-180): the name its card shows, or its full saved city when
 * another destination's card shows the same name, as its card then shows too, so same-named cities are told apart by the
 * region or country saved with them. A destination another account saved under the same name, as when someone shares a
 * trip to a city the account saved too, also says whose it is.
 */
export function destinationNames(destinations: readonly MapDestination[]): Map<string, string> {
  const repeated = (names: Map<string, string>, id: string) => destinations.some((other) => other.id !== id && names.get(other.id) === names.get(id));
  const short = new Map(destinations.map((item) => [item.id, formatSavedDestinationLabel(item)]));
  const named = new Map(destinations.map((item) => [item.id, repeated(short, item.id) ? item.city : short.get(item.id)!]));
  return new Map(destinations.map((item) => {
    const name = named.get(item.id)!;
    return [item.id, item.sharedBy !== null && repeated(named, item.id) ? name + ", shared by " + item.sharedBy : name];
  }));
}

/**
 * What the Destinations page's map shows of the `shown` destinations, those its search shows, for the locations found so
 * far (TRA-180): each destination found, where it was found, and each it can't show. A destination is in at most one of
 * them, once, by its saved ID, however many trips visit it, and one whose lookup hasn't answered is in neither. Both keep
 * the order of `destinations`, which names them all.
 */
export function destinationsMapLayout(destinations: readonly MapDestination[], shown: readonly string[], locations: Readonly<Record<string, PlaceLocation | undefined>>): DestinationsMapLayout {
  const names = destinationNames(destinations);
  const showing = new Set(shown);
  const mapped: MappedDestination[] = [];
  const unmapped: UnmappedDestination[] = [];
  for (const destination of destinations) {
    const location = locations[destination.id];
    if (!showing.has(destination.id) || !location) continue;
    const name = names.get(destination.id)!;
    if (location.status === "found") mapped.push({ id: destination.id, name, position: [location.latitude, location.longitude], found: location.label });
    else unmapped.push({ id: destination.id, name, reason: location.status });
  }
  return { mapped, unmapped };
}

/**
 * The markers the map draws at one zoom (TRA-180): one for each destination, but destinations whose points at that zoom,
 * as `point` gives them, are closer than `size`, a marker's width, share one, at the first one's position, so no marker
 * covers another, and each destination is reached from the shared marker. Destinations found at the same place share one
 * at every zoom, and zooming in sets the others apart. Markers keep the order of `destinations`, and each is keyed by the
 * IDs of its destinations.
 */
export function markersAt(destinations: readonly MappedDestination[], point: (position: Position) => Point, size: number): DestinationsMarker[] {
  const groups: { at: Point; destinations: MappedDestination[] }[] = [];
  for (const destination of destinations) {
    const at = point(destination.position);
    const group = groups.find((item) => Math.hypot(item.at.x - at.x, item.at.y - at.y) < size);
    if (group) group.destinations.push(destination);
    else groups.push({ at, destinations: [destination] });
  }
  return groups.map(({ destinations: shared }) => ({ key: shared.map((item) => item.id).join(" "), position: shared[0].position, destinations: shared }));
}
