import type { PlaceAnswer } from "./place-search";
import type { Snapshot } from "./types";

/** The places a destination's map shows (TRA-130), in the order its checkboxes and Not on the map name them. */
export const MAP_CATEGORIES = ["hotels", "activities", "restaurants", "churches"] as const;
export type MapCategory = typeof MAP_CATEGORIES[number];
export const MAP_CATEGORY_LABELS: Record<MapCategory, string> = { hotels: "Hotels", activities: "Activities", restaurants: "Restaurants", churches: "Churches" };
/** What one place of each category is called, as its marker's popup names it. */
export const MAP_PLACE_LABELS: Record<MapCategory, string> = { hotels: "Hotel", activities: "Activity", restaurants: "Restaurant", churches: "Church" };

/** A hotel, activity, restaurant or church saved for a destination, by its saved ID, with the text it is looked up by. */
export interface SavedPlace { id: string; category: MapCategory; name: string; address: string }

/**
 * Every hotel, activity, restaurant and church saved for a destination, selected for the budget or not, each once: its
 * ideas by category in their saved order, then its churches as its Church section lists them.
 */
export function destinationPlaces(snapshot: Pick<Snapshot, "candidates" | "churches">, destinationId: string): SavedPlace[] {
  const ideas = MAP_CATEGORIES.flatMap((category) => snapshot.candidates.filter((item) => item.destinationId === destinationId && item.category === category).sort((a, b) => a.position - b.position));
  return [
    ...ideas.map(({ id, category, name, address }) => ({ id, category, name, address })),
    ...snapshot.churches.filter((item) => item.destinationId === destinationId).map(({ id, name, address }) => ({ id, category: "churches" as const, name, address })),
  ];
}

/** The saved text a place is looked up by, with its destination's city. A place whose key changes is looked up again. */
export function placeKey(city: string, place: SavedPlace): string {
  return JSON.stringify([city, place.address, place.name]);
}

/**
 * What `/api/destination-map/[destinationId]` answers: whether the destination itself was found, as the trip map finds it,
 * and each saved place's answer by its saved ID, with the key of the text it was looked up by.
 */
export interface DestinationMapAnswer {
  area: "found" | "missing" | "unavailable";
  places: Record<string, PlaceAnswer & { key: string }>;
}

/** A latitude and longitude. */
export type Position = [number, number];

/** A place a marker shows, with the address OpenStreetMap has for where it was found. */
export type MappedPlace = SavedPlace & { found: string };

/** One marker: a position, and every place found there, as when a hotel and its restaurant share a building. */
export interface DestinationMarker { key: string; position: Position; places: MappedPlace[] }

/** A place the map can't show, and why. */
export type UnmappedPlace = SavedPlace & { reason: "missing" | "ambiguous" | "unavailable" };

/** What the map shows of the categories selected: its markers, and the places it can't show, by category. */
export interface DestinationMapLayout { markers: DestinationMarker[]; unmapped: { category: MapCategory; places: UnmappedPlace[] }[] }

/**
 * What a destination's map shows of the places in the `shown` categories, for the answers so far: one marker for each
 * position where places were found, and each place it can't show, grouped by category. A place without an answer yet,
 * or still pending, is in neither.
 */
export function destinationMapLayout(places: readonly SavedPlace[], answers: Readonly<Record<string, PlaceAnswer | undefined>>, shown: readonly MapCategory[]): DestinationMapLayout {
  const selected = places.filter((place) => shown.includes(place.category));
  const markers: DestinationMarker[] = [];
  for (const place of selected) {
    const answer = answers[place.id];
    if (answer?.status !== "found") continue;
    const key = answer.latitude + "," + answer.longitude;
    const mapped = { ...place, found: answer.label };
    const marker = markers.find((item) => item.key === key);
    if (marker) marker.places.push(mapped);
    else markers.push({ key, position: [answer.latitude, answer.longitude], places: [mapped] });
  }
  const unmapped = MAP_CATEGORIES.filter((category) => shown.includes(category)).map((category) => ({
    category,
    places: selected.flatMap((place): UnmappedPlace[] => {
      const status = answers[place.id]?.status;
      return place.category === category && (status === "missing" || status === "ambiguous" || status === "unavailable") ? [{ ...place, reason: status }] : [];
    }),
  })).filter((group) => group.places.length > 0);
  return { markers, unmapped };
}
