import { tripVisits } from "./budget.ts";
import { formatSavedDestinationLabel } from "./destination-label.ts";
import type { PlaceLocation } from "./location-search.ts";
import type { Snapshot } from "./types.ts";

/** What a place on a trip's map is (TRA-44). Layovers and stops come from its connections' itineraries. */
export type MapPlaceKind = "departure" | "return" | "destination" | "layover" | "stop";

/**
 * A place in a trip's journey. `place` is the saved text the map looks up, empty when none is saved, and `label` how the
 * trip page shows it. `target` is the ID of what it stands for on the trip page: a destination's card, the connection
 * leaving or reaching a trip endpoint, or an itinerary entry. `number` is a destination's place in the route, from 1.
 */
export interface MapPlace { key: string; kind: MapPlaceKind; place: string; label: string; target: string | null; number: number | null; connection: string | null }

/** A travel connection: its saved Transportation text and the keys of the places it passes, from where it leaves to where it arrives. */
export interface MapLeg { id: string; method: string; from: string; to: string; places: string[] }

/** A trip's places in travel order, departure first and return last, and its connections in route order. */
export interface Journey { places: MapPlace[]; legs: MapLeg[] }

/** A latitude and longitude. Longitudes can pass ±180 so that lines take the shorter way across the 180th meridian. */
export type Position = [number, number];

/** A place the map shows. A departure and return at the same position show as one marker, `roundTrip`. */
export interface MapMarker { key: string; kind: MapPlaceKind | "roundTrip"; position: Position; label: string; number: number | null; target: string | null; found: string }

/** A connection's straight lines between the places it passes that the map shows, and where its transportation shows. */
export interface MapLine { id: string; points: Position[]; badge: Position; method: string; from: string; to: string; target: string }

/** A place the map doesn't show, and why: none is saved, no place has its name, or the lookup couldn't be made. */
export interface UnmappedPlace { key: string; kind: MapPlaceKind | "roundTrip"; label: string; number: number | null; connection: string | null; reason: "notAdded" | "missing" | "unavailable" }

export interface MapLayout { markers: MapMarker[]; lines: MapLine[]; unmapped: UnmappedPlace[] }

/** What a place on a trip's map is, in words, such as "Destination 2" or "Departure and return". */
export function placeRole(kind: MapPlaceKind | "roundTrip", number: number | null): string {
  switch (kind) {
    case "departure": return "Departure";
    case "return": return "Return";
    case "roundTrip": return "Departure and return";
    case "destination": return number === null ? "Destination" : "Destination " + number;
    case "layover": return "Layover";
    case "stop": return "Stop along the way";
  }
}

/** The ID of a connection's card on the trip page. */
export function connectionTarget(legId: string): string { return "connection-" + legId; }
/** The ID of an itinerary entry on the trip page. Entries are unique within their connection. */
export function itineraryTarget(legId: string, stopId: string): string { return "itinerary-" + legId + "-" + stopId; }

/**
 * A trip's journey: its departure, each destination in route order with the itinerary of the connection that reaches it
 * before it, and its return, with the itinerary of the last connection before it. A trip returns to its departing city
 * unless it has a return city.
 */
export function tripJourney(snapshot: Snapshot, tripId: string): Journey {
  const trip = snapshot.trips.find((item) => item.id === tripId);
  if (!trip) throw new Error("A trip's journey needs the trip.");
  const visits = tripVisits(snapshot, tripId);
  const returnCity = trip.returnCity ?? trip.homeCity;
  // The same names the connections show on the trip page.
  const endName = (id: string | null, end: "from" | "to") => id === null
    ? (end === "from" ? trip.homeCity || "Departing city" : returnCity || "Return city")
    : formatSavedDestinationLabel(visits.find(({ stop }) => stop.id === id)?.visit ?? { city: "", cityFromSuggestion: false }) || "Destination";
  const route = visits.length ? [null, ...visits.map(({ stop }) => stop.id), null] : [];
  const legs = route.slice(1).map((to, index) => snapshot.legs.find((leg) => leg.tripId === tripId && leg.fromId === route[index] && leg.toId === to));
  const keyOf = (id: string | null, end: "from" | "to") => id === null ? (end === "from" ? "departure" : "return") : "destination-" + id;
  const first = legs[0], last = legs.at(-1);
  const places: MapPlace[] = [{ key: "departure", kind: "departure", place: trip.homeCity.trim(), label: trip.homeCity, target: first ? connectionTarget(first.id) : null, number: null, connection: null }];
  const mapLegs: MapLeg[] = [];
  route.slice(1).forEach((to, index) => {
    const leg = legs[index];
    const connection = endName(route[index], "from") + " → " + endName(to, "to");
    const stops: MapPlace[] = leg ? leg.itinerary.map((stop) => ({ key: itineraryTarget(leg.id, stop.id), kind: stop.kind, place: stop.place.trim(), label: stop.place, target: itineraryTarget(leg.id, stop.id), number: null, connection })) : [];
    places.push(...stops);
    if (to !== null) {
      const visit = visits[index].visit;
      places.push({ key: keyOf(to, "to"), kind: "destination", place: visit.city.trim(), label: formatSavedDestinationLabel(visit), target: "destination-" + to, number: index + 1, connection: null });
    }
    if (leg) mapLegs.push({ id: leg.id, method: leg.method, from: endName(route[index], "from"), to: endName(to, "to"), places: [keyOf(route[index], "from"), ...stops.map((stop) => stop.key), keyOf(to, "to")] });
  });
  places.push({ key: "return", kind: "return", place: returnCity.trim(), label: returnCity, target: last ? connectionTarget(last.id) : null, number: null, connection: null });
  return { places, legs: mapLegs };
}

/** The saved names a journey's map looks up, each once, in travel order. */
export function journeyPlaceNames(journey: Journey): string[] {
  return [...new Set(journey.places.map((place) => place.place).filter(Boolean))];
}

/** The latitude Leaflet's Mercator map reaches, beyond which latitudes are drawn at its edge. */
const MAX_LATITUDE = 85.0511287798;
/** Mercator's vertical coordinate for a latitude, in which the map's straight lines are straight. */
function mercatorY(latitude: number): number {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}
function latitudeOf(y: number): number { return (Math.atan(Math.exp(y)) * 360) / Math.PI - 90; }

/** The point a fraction of the way along the straight line the map draws from `from` to `to`. */
function along(from: Position, to: Position, fraction: number): Position {
  const y = mercatorY(from[0]) + (mercatorY(to[0]) - mercatorY(from[0])) * fraction;
  return [latitudeOf(y), from[1] + (to[1] - from[1]) * fraction];
}

/**
 * Where a connection's transportation shows: a third of the way along its longest line, from where it leaves, so a
 * connection back along the same line shows its own apart from the one out.
 */
function badgePosition(points: Position[]): Position {
  let longest = 0, length = -1;
  points.slice(1).forEach((point, index) => {
    const segment = Math.hypot(mercatorY(point[0]) - mercatorY(points[index][0]), ((point[1] - points[index][1]) * Math.PI) / 180);
    if (segment > length) { longest = index; length = segment; }
  });
  return along(points[longest], points[longest + 1], 1 / 3);
}

/**
 * What a trip's map shows for the locations found so far: a marker for each place found, the lines of each connection
 * between them, and the places it can't show. A place whose lookup hasn't answered is in none of them. Longitudes follow
 * the journey, each within 180° of the place found before it, so a line crosses the Pacific instead of the whole world.
 */
export function mapLayout(journey: Journey, locations: Readonly<Record<string, PlaceLocation | undefined>>): MapLayout {
  const positions = new Map<string, Position>();
  const found = new Map<string, string>();
  let previous: number | null = null;
  for (const place of journey.places) {
    const location = place.place ? locations[place.place] : undefined;
    if (location?.status !== "found") continue;
    const longitude: number = previous === null ? location.longitude : location.longitude + 360 * Math.round((previous - location.longitude) / 360);
    positions.set(place.key, [location.latitude, longitude]);
    found.set(place.key, location.label);
    previous = longitude;
  }
  const markers: MapMarker[] = journey.places.flatMap((place) => {
    const position = positions.get(place.key);
    return position ? [{ key: place.key, kind: place.kind, position, label: place.label, number: place.number, target: place.target, found: found.get(place.key)! }] : [];
  });
  const departure = markers.find((marker) => marker.key === "departure");
  const arrival = markers.find((marker) => marker.key === "return");
  if (departure && arrival && departure.position[0] === arrival.position[0] && departure.position[1] === arrival.position[1]) {
    markers.splice(markers.indexOf(arrival), 1);
    markers[markers.indexOf(departure)] = { ...departure, kind: "roundTrip", label: departure.label === arrival.label ? departure.label : departure.label + " and " + arrival.label, target: departure.target ?? arrival.target };
  }
  // A connection's lines join the places it passes that the map shows, never places of another connection.
  const lines: MapLine[] = journey.legs.flatMap((leg) => {
    const points = leg.places.flatMap((key) => { const position = positions.get(key); return position ? [position] : []; });
    return points.length < 2 ? [] : [{ id: leg.id, points, badge: badgePosition(points), method: leg.method, from: leg.from, to: leg.to, target: connectionTarget(leg.id) }];
  });
  const unmapped: UnmappedPlace[] = journey.places.flatMap((place) => {
    if (positions.has(place.key)) return [];
    const status = place.place ? locations[place.place]?.status : undefined;
    const reason = !place.place ? "notAdded" : status === "missing" || status === "unavailable" ? status : null;
    return reason ? [{ key: place.key, kind: place.kind, label: place.label, number: place.number, connection: place.connection, reason }] : [];
  });
  const missingDeparture = unmapped.find((place) => place.key === "departure");
  const missingReturn = unmapped.find((place) => place.key === "return");
  if (missingDeparture && missingReturn && missingDeparture.label === missingReturn.label && missingDeparture.reason === missingReturn.reason) {
    unmapped.splice(unmapped.indexOf(missingReturn), 1);
    unmapped[unmapped.indexOf(missingDeparture)] = { ...missingDeparture, kind: "roundTrip" };
  }
  return { markers, lines, unmapped };
}
