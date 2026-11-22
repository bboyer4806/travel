import type { Coordinates, SavedCoordinates } from "./coordinates";
import type { PlaceAnswer, PlaceText } from "./place-search";
import type { CandidateImage, Snapshot } from "./types";

/** The places a destination's map shows (TRA-130), in the order its checkboxes and Not on the map name them. */
export const MAP_CATEGORIES = ["hotels", "activities", "restaurants", "churches"] as const;
export type MapCategory = typeof MAP_CATEGORIES[number];
export const MAP_CATEGORY_LABELS: Record<MapCategory, string> = { hotels: "Hotels", activities: "Activities", restaurants: "Restaurants", churches: "Churches" };
/** What one place of each category is called, as its marker's popup names it. */
export const MAP_PLACE_LABELS: Record<MapCategory, string> = { hotels: "Hotel", activities: "Activity", restaurants: "Restaurant", churches: "Church" };

/**
 * A hotel, activity, restaurant or church saved for a destination, by its saved ID, with the text it is looked up by, any
 * coordinates saved for it (TRA-150), and its primary photo, which its marker's popup shows, or null without photos (TRA-152).
 */
export interface SavedPlace { id: string; category: MapCategory; name: string; address: string; coordinates: SavedCoordinates | null; photo: CandidateImage | null }

/** A saved idea's or church's primary photo (TRA-152): the one its photos mark as main, or null when it has no photos. */
function primaryPhoto(images: readonly CandidateImage[], mainImageId: string | null): CandidateImage | null {
  return images.find((image) => image.id === mainImageId) ?? null;
}

/**
 * Every hotel, activity, restaurant and church saved for a destination, selected for the budget or not, each once: its
 * ideas by category in their saved order, then its churches as its Church section lists them.
 */
export function destinationPlaces(snapshot: Pick<Snapshot, "candidates" | "churches">, destinationId: string): SavedPlace[] {
  const ideas = MAP_CATEGORIES.flatMap((category) => snapshot.candidates.filter((item) => item.destinationId === destinationId && item.category === category).sort((a, b) => a.position - b.position));
  return [
    ...ideas.map(({ id, category, name, address, coordinates, images, mainImageId }) => ({ id, category, name, address, coordinates, photo: primaryPhoto(images, mainImageId) })),
    ...snapshot.churches.filter((item) => item.destinationId === destinationId).map(({ id, name, address, coordinates, images, mainImageId }) => ({ id, category: "churches" as const, name, address, coordinates, photo: primaryPhoto(images, mainImageId) })),
  ];
}

/**
 * The coordinates the map can show a place at (TRA-150): its saved ones, however far they are from its destination,
 * unless they wait to be reviewed since its address changed. It shows the place at them only when its address isn't
 * found, or it has none (TRA-163).
 */
export function mapCoordinates(place: SavedPlace): Coordinates | null {
  return place.coordinates && !place.coordinates.review ? place.coordinates : null;
}

/**
 * What the map looks a place up by (TRA-163): its address, and its name when no place has its address or it has none,
 * as since TRA-130. A place with coordinates to show it at is looked up by its address alone, since they show it when
 * its address isn't found, and not at all without an address. Null for a place that isn't looked up.
 */
export function lookupText(place: SavedPlace): PlaceText | null {
  if (!mapCoordinates(place)) return { address: place.address, name: place.name };
  return place.address.trim() ? { address: place.address, name: "" } : null;
}

/** What a place is looked up by, with its destination's city. A place whose key changes is looked up again. */
export function placeKey(city: string, place: SavedPlace): string {
  return JSON.stringify([city, lookupText(place)]);
}

/**
 * What `/api/destination-map/[destinationId]` answers: whether the destination itself was found, as the trip map finds it,
 * and the answer for each saved place looked up, by its saved ID, with the key of the text it was looked up by. A place
 * with coordinates to show it at and no address isn't looked up (TRA-163).
 */
export interface DestinationMapAnswer {
  area: "found" | "missing" | "unavailable";
  places: Record<string, PlaceAnswer & { key: string }>;
}

/** A latitude and longitude. */
export type Position = [number, number];

/**
 * A place a marker shows: `found` is the address OpenStreetMap has where it was found, or null for a place shown at its
 * saved coordinates (TRA-150), which are `approximate` when they mark only roughly where it is, never at an address.
 */
export type MappedPlace = SavedPlace & { found: string | null; approximate: boolean };

/** One marker: a position, and every place found there, as when a hotel and its restaurant share a building. */
export interface DestinationMarker { key: string; position: Position; places: MappedPlace[] }

/** A place the map can't show, and why. */
export type UnmappedPlace = SavedPlace & { reason: "missing" | "ambiguous" | "unavailable" };

/** What the map shows of the categories selected: its markers, and the places it can't show, by category. */
export interface DestinationMapLayout { markers: DestinationMarker[]; unmapped: { category: MapCategory; places: UnmappedPlace[] }[] }

/** Where a marker shows a place, with the address it was found at, or null at its coordinates, and whether those are approximate. */
interface Spot { latitude: number; longitude: number; found: string | null; approximate: boolean }

/**
 * Where the map shows a place (TRA-163): where its lookup found it, or else at its coordinates to show it at, once its
 * lookup answers without finding it, or at once when it isn't looked up. Null while its lookup has no answer yet or is
 * pending, and for a place without coordinates that isn't found.
 */
function spotOf(place: SavedPlace, answer: PlaceAnswer | undefined): Spot | null {
  if (answer?.status === "found") return { latitude: answer.latitude, longitude: answer.longitude, found: answer.label, approximate: false };
  const coordinates = mapCoordinates(place);
  const answered = answer !== undefined && answer.status !== "pending";
  return coordinates && (answered || !lookupText(place)) ? { latitude: coordinates.latitude, longitude: coordinates.longitude, found: null, approximate: coordinates.accuracy === "approximate" } : null;
}

/**
 * What a destination's map shows of the places in the `shown` categories, for the answers so far: one marker for each
 * position where places are, and each place it can't show, grouped by category. A place is where its lookup found it,
 * or else at its saved coordinates (TRA-163), once its address is looked up without finding it, or at once without an
 * address. A place whose lookup has no answer yet, or is still pending, is in neither.
 */
export function destinationMapLayout(places: readonly SavedPlace[], answers: Readonly<Record<string, PlaceAnswer | undefined>>, shown: readonly MapCategory[]): DestinationMapLayout {
  const selected = places.filter((place) => shown.includes(place.category));
  const markers: DestinationMarker[] = [];
  for (const place of selected) {
    const spot = spotOf(place, answers[place.id]);
    if (!spot) continue;
    const key = spot.latitude + "," + spot.longitude;
    const mapped = { ...place, found: spot.found, approximate: spot.approximate };
    const marker = markers.find((item) => item.key === key);
    if (marker) marker.places.push(mapped);
    else markers.push({ key, position: [spot.latitude, spot.longitude], places: [mapped] });
  }
  const unmapped = MAP_CATEGORIES.filter((category) => shown.includes(category)).map((category) => ({
    category,
    places: selected.flatMap((place): UnmappedPlace[] => {
      const status = answers[place.id]?.status;
      return place.category === category && !mapCoordinates(place) && (status === "missing" || status === "ambiguous" || status === "unavailable") ? [{ ...place, reason: status }] : [];
    }),
  })).filter((group) => group.places.length > 0);
  return { markers, unmapped };
}
