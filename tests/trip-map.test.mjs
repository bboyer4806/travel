import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { journeyAirportNames, journeyPlaceNames, mapLayout, placeRole, popupPosition, previewPosition, tripJourney } from "../src/lib/trip-map.ts";
import { prepared, setup, tripInput } from "./budget-fixtures.mjs";

const legSave = (id, overrides = {}) => ({ type: "leg.save", id, method: "", price: "", departure: "", arrival: "", url: "", notes: "", ...overrides });
const entry = (kind, place) => ({ id: randomUUID(), kind, place, arrival: "", departure: "", notes: "" });
const found = (latitude, longitude, label = "Found place") => ({ status: "found", latitude, longitude, label });
const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const photo = () => ({ id: randomUUID(), ...prepared(new Uint8Array(webp)) });

/** A trip from Wooster to Vienna, chosen from a suggestion, and Salzburg, typed, and back, with layovers and a stop. */
function plannedTrip(t, trip = {}) {
  const { store, tripId } = setup(t, tripInput({ homeCity: "Wooster, OH", ...trip }));
  const vienna = store.applyMutation({ type: "stop.add", tripId, city: "Vienna, State of Vienna, Austria", cityFromSuggestion: true }).id;
  const salzburg = store.applyMutation({ type: "stop.add", tripId, city: "Salzburg" }).id;
  const legs = store.getSnapshot().legs.filter((leg) => leg.tripId === tripId);
  const leg = (from, to) => legs.find((item) => item.fromId === from && item.toId === to);
  const out = entry("layover", "Frankfurt (FRA)"), lunch = entry("stop", " Lunch in Frankfurt "), back = entry("layover", "Munich");
  store.applyMutation(legSave(leg(null, vienna).id, { method: "Flight", itinerary: [out, lunch] }));
  store.applyMutation(legSave(leg(vienna, salzburg).id, { method: "Train" }));
  store.applyMutation(legSave(leg(salzburg, null).id, { method: "Rental car, then flight", itinerary: [back] }));
  return { store, tripId, vienna, salzburg, leg, out, lunch, back };
}

test("a trip's journey lists its departure, destinations, itinerary stops and return in travel order", (t) => {
  const { store, tripId, vienna, salzburg, leg, out, lunch, back } = plannedTrip(t);
  const journey = tripJourney(store.getSnapshot(), tripId);
  const [first, middle, last] = [leg(null, vienna), leg(vienna, salzburg), leg(salzburg, null)];
  assert.deepEqual(journey.places.map(({ key, kind, place, label, target, number, connection }) => [key, kind, place, label, target, number, connection]), [
    ["departure", "departure", "Wooster, OH", "Wooster, OH", "connection-" + first.id, null, null],
    ["itinerary-" + first.id + "-" + out.id, "layover", "Frankfurt (FRA)", "Frankfurt (FRA)", "itinerary-" + first.id + "-" + out.id, null, "Wooster, OH → Vienna, Austria"],
    ["itinerary-" + first.id + "-" + lunch.id, "stop", "Lunch in Frankfurt", "Lunch in Frankfurt", "itinerary-" + first.id + "-" + lunch.id, null, "Wooster, OH → Vienna, Austria"],
    ["destination-" + vienna, "destination", "Vienna, State of Vienna, Austria", "Vienna, Austria", "destination-" + vienna, 1, null],
    ["destination-" + salzburg, "destination", "Salzburg", "Salzburg", "destination-" + salzburg, 2, null],
    ["itinerary-" + last.id + "-" + back.id, "layover", "Munich", "Munich", "itinerary-" + last.id + "-" + back.id, null, "Salzburg → Wooster, OH"],
    ["return", "return", "Wooster, OH", "Wooster, OH", "connection-" + last.id, null, null],
  ]);
  assert.deepEqual(journey.legs, [
    { id: first.id, method: "Flight", from: "Wooster, OH", to: "Vienna, Austria", details: [{ term: "Transportation", value: "Flight" }], places: ["departure", "itinerary-" + first.id + "-" + out.id, "itinerary-" + first.id + "-" + lunch.id, "destination-" + vienna] },
    { id: middle.id, method: "Train", from: "Vienna, Austria", to: "Salzburg", details: [{ term: "Transportation", value: "Train" }], places: ["destination-" + vienna, "destination-" + salzburg] },
    { id: last.id, method: "Rental car, then flight", from: "Salzburg", to: "Wooster, OH", details: [{ term: "Transportation", value: "Rental car, then flight" }], places: ["destination-" + salzburg, "itinerary-" + last.id + "-" + back.id, "return"] },
  ]);
  // A trip returning to its departing city looks the city up once.
  assert.deepEqual(journeyPlaceNames(journey), ["Wooster, OH", "Frankfurt (FRA)", "Lunch in Frankfurt", "Vienna, State of Vienna, Austria", "Salzburg", "Munich"]);

  // Reordering the route reorders the journey, and its connections follow the new route.
  store.applyMutation({ type: "stop.move", id: salzburg, direction: "up" });
  const moved = tripJourney(store.getSnapshot(), tripId);
  assert.deepEqual(moved.places.filter((place) => place.kind === "destination").map((place) => [place.label, place.number]), [["Salzburg", 1], ["Vienna, Austria", 2]]);
  assert.deepEqual(moved.legs.map((item) => [item.from, item.to]), [["Wooster, OH", "Salzburg"], ["Salzburg", "Vienna, Austria"], ["Vienna, Austria", "Wooster, OH"]]);
});

test("a separate return city is its own endpoint, and a trip without destinations has only its endpoints", (t) => {
  const { store, tripId } = plannedTrip(t, { returnCity: "Chicago, IL" });
  const journey = tripJourney(store.getSnapshot(), tripId);
  assert.deepEqual(journey.places.at(-1).place, "Chicago, IL");
  assert.equal(journey.legs.at(-1).to, "Chicago, IL");

  const empty = setup(t, tripInput({ homeCity: "" }));
  const endpoints = tripJourney(empty.store.getSnapshot(), empty.tripId);
  assert.deepEqual(endpoints, { places: [
    { key: "departure", kind: "departure", place: "", label: "", target: null, number: null, connection: null, photo: null },
    { key: "return", kind: "return", place: "", label: "", target: null, number: null, connection: null, photo: null },
  ], legs: [] });
  assert.deepEqual(journeyPlaceNames(endpoints), []);
  // A blank departing city is named as on the trip page's connections.
  const visited = empty.store.applyMutation({ type: "stop.add", tripId: empty.tripId, city: "Lisbon" }).id;
  assert.ok(visited);
  assert.deepEqual(tripJourney(empty.store.getSnapshot(), empty.tripId).legs.map((item) => [item.from, item.to]), [["Departing city", "Lisbon"], ["Lisbon", "Return city"]]);
});

test("each destination on the journey and the map has its primary photo, with its focal point, and every other place none (TRA-143)", (t) => {
  const { store, tripId } = plannedTrip(t);
  // Porto, saved before it joined the trip, is visited on a stop with an ID of its own.
  const porto = store.applyMutation({ type: "destination.create", city: "Porto" }).id;
  const stop = store.applyMutation({ type: "stop.add", tripId, city: "Porto" }).id;
  assert.notEqual(stop, porto);
  const photos = [photo(), photo()];
  store.applyMutation({ type: "destination.save", id: porto, gallery: { add: photos, remove: [], mainImageId: photos[1].id, focus: [{ id: photos[1].id, focusX: 20, focusY: 80 }] } });
  const version = (id) => store.getSnapshot().destinations.find((item) => item.id === porto).images.find((image) => image.id === id).version;
  /** The journey's places that have photos, with their photos. */
  const withPhotos = () => tripJourney(store.getSnapshot(), tripId).places.filter((place) => place.photo !== null).map((place) => [place.key, place.photo]);
  // The primary photo rather than the gallery's first, named by the destination's ID, which its address takes.
  assert.deepEqual(withPhotos(), [["destination-" + stop, { destinationId: porto, id: photos[1].id, version: version(photos[1].id), focusX: 20, focusY: 80, widths: null }]]);
  const snapshot = store.getSnapshot(), saved = structuredClone(snapshot);
  const journey = tripJourney(snapshot, tripId);
  assert.deepEqual([...new Set(journey.places.filter((place) => place.photo === null).map((place) => place.kind))].sort(), ["departure", "destination", "layover", "return", "stop"],
    "the trip's ends, layovers, stops and destinations without photos have none");
  const layout = mapLayout(journey, Object.fromEntries(journeyPlaceNames(journey).map((name, index) => [name, found(40 + index, 10 + index)])));
  assert.deepEqual(layout.markers.filter((marker) => marker.photo !== null).map((marker) => [marker.key, marker.photo]), withPhotos());
  assert.ok(layout.markers.length > 1 && layout.markers.every((marker) => marker.photo === null || marker.kind === "destination"));
  assert.deepEqual(snapshot, saved, "the trip's data is only read");

  // Choosing another primary photo, recentering it, or removing every photo changes the journey's.
  store.applyMutation({ type: "destination.save", id: porto, gallery: { add: [], remove: [], mainImageId: photos[0].id } });
  assert.deepEqual(withPhotos(), [["destination-" + stop, { destinationId: porto, id: photos[0].id, version: version(photos[0].id), focusX: 50, focusY: 50, widths: null }]]);
  store.applyMutation({ type: "destination.save", id: porto, gallery: { add: [], remove: [], focus: [{ id: photos[0].id, focusX: 75, focusY: 25 }] } });
  assert.deepEqual(withPhotos(), [["destination-" + stop, { destinationId: porto, id: photos[0].id, version: version(photos[0].id), focusX: 75, focusY: 25, widths: null }]]);
  store.applyMutation({ type: "destination.save", id: porto, gallery: { add: [], remove: photos.map((item) => item.id), mainImageId: null, order: [] } });
  assert.deepEqual(withPhotos(), []);
});

test("a destination's preview goes above its marker, below it where there's no room above, and always within the map (TRA-143)", () => {
  const map = { width: 600, height: 378 }, preview = { width: 200, height: 132 }, radius = 15;
  // Centered 6 pixels above the marker.
  assert.deepEqual(previewPosition({ x: 300, y: 250 }, preview, map, radius), { x: 200, y: 97 });
  assert.deepEqual(previewPosition({ x: 300, y: 161 }, preview, map, radius), { x: 200, y: 8 }, "just room above, 8 pixels from the top");
  // Near the top, below the marker instead.
  assert.deepEqual(previewPosition({ x: 300, y: 160 }, preview, map, radius), { x: 200, y: 181 });
  assert.deepEqual(previewPosition({ x: 300, y: 20 }, preview, map, radius), { x: 200, y: 41 });
  // Near the left or right edge, moved across to stay 8 pixels inside the map, in each corner too.
  assert.deepEqual(previewPosition({ x: 20, y: 250 }, preview, map, radius), { x: 8, y: 97 });
  assert.deepEqual(previewPosition({ x: 590, y: 250 }, preview, map, radius), { x: 392, y: 97 });
  assert.deepEqual(previewPosition({ x: 10, y: 10 }, preview, map, radius), { x: 8, y: 31 });
  assert.deepEqual(previewPosition({ x: 595, y: 370 }, preview, map, radius), { x: 392, y: 217 });
  // On a phone's shorter map, a tall preview with room on neither side goes on the side with more, within the map.
  const phone = { width: 343, height: 298 }, tall = { width: 160, height: 140 };
  assert.deepEqual(previewPosition({ x: 171, y: 165 }, tall, phone, radius), { x: 91, y: 8 });
  assert.deepEqual(previewPosition({ x: 171, y: 130 }, tall, phone, radius), { x: 91, y: 150 });
  // A preview larger than the map keeps its top left corner in view.
  assert.deepEqual(previewPosition({ x: 50, y: 50 }, { width: 400, height: 400 }, { width: 300, height: 300 }, radius), { x: 8, y: 8 });
});

test("a connection's popup goes above or below its transportation, or beside it where neither has room, never over it (TRA-175)", () => {
  const map = { width: 600, height: 378 }, badge = { width: 46, height: 22 }, popup = { width: 240, height: 120 };
  // Where a destination's preview would go, when that clears the transportation: above it, or below it near the top.
  assert.deepEqual(popupPosition({ x: 300, y: 250 }, popup, map, badge), { x: 180, y: 113 });
  assert.deepEqual(popupPosition({ x: 300, y: 100 }, popup, map, badge), { x: 180, y: 117 });
  assert.deepEqual(popupPosition({ x: 300, y: 250 }, popup, map, badge), previewPosition({ x: 300, y: 250 }, popup, map, 11));
  // Too tall for above or below the transportation in the middle of the map: on its right, 6 pixels from it, centered on it.
  const tall = { width: 240, height: 260 };
  assert.deepEqual(popupPosition({ x: 200, y: 189 }, tall, map, badge), { x: 229, y: 59 });
  // Near the map's right edge, on its left, and near its top, moved down within the map.
  assert.deepEqual(popupPosition({ x: 500, y: 189 }, tall, map, badge), { x: 231, y: 59 });
  assert.deepEqual(popupPosition({ x: 200, y: 100 }, tall, map, badge), { x: 229, y: 8 });
  // On a phone's map with room on no side, where a preview would go, as close to it as the map allows.
  const phone = { width: 343, height: 298 }, phonePopup = { width: 220, height: 200 };
  assert.deepEqual(popupPosition({ x: 171, y: 150 }, phonePopup, phone, badge), previewPosition({ x: 171, y: 150 }, phonePopup, phone, 11));
  assert.deepEqual(popupPosition({ x: 171, y: 150 }, phonePopup, phone, badge), { x: 61, y: 8 });
});

test("a journey's departure, return and layovers may be airport codes, never its destinations or other stops (TRA-132)", (t) => {
  const { store, tripId } = plannedTrip(t, { homeCity: "CLE", returnCity: "PHL" });
  assert.deepEqual(journeyAirportNames(tripJourney(store.getSnapshot(), tripId)), ["CLE", "Frankfurt (FRA)", "Munich", "PHL"]);
});

/** A journey from home to two destinations and back, with a layover on the way out, as `tripJourney` builds one. */
const journey = {
  places: [
    { key: "departure", kind: "departure", place: "Home", label: "Home", target: "connection-out", number: null, connection: null, photo: null },
    { key: "layover", kind: "layover", place: "Layover", label: "Layover", target: "itinerary-out-1", number: null, connection: "Home → First", photo: null },
    { key: "first", kind: "destination", place: "First", label: "First", target: "destination-first", number: 1, connection: null, photo: null },
    { key: "second", kind: "destination", place: "Second", label: "Second", target: "destination-second", number: 2, connection: null, photo: null },
    { key: "return", kind: "return", place: "Home", label: "Home", target: "connection-back", number: null, connection: null, photo: null },
  ],
  legs: [
    { id: "out", method: "Flight", from: "Home", to: "First", places: ["departure", "layover", "first"] },
    { id: "between", method: "Train", from: "First", to: "Second", places: ["first", "second"] },
    { id: "back", method: "Flight", from: "Second", to: "Home", places: ["second", "return"] },
  ],
};

test("the map marks each place found, joins each connection's places in order, and shows a round trip's endpoint once", () => {
  const layout = mapLayout(journey, { Home: found(40, -80, "Home, Ohio, United States"), Layover: found(50, 8), First: found(48, 16), Second: found(47, 13) });
  assert.deepEqual(layout.markers.map(({ key, kind, position, label, number, target }) => [key, kind, position, label, number, target]), [
    ["departure", "roundTrip", [40, -80], "Home", null, "connection-out"],
    ["layover", "layover", [50, 8], "Layover", null, "itinerary-out-1"],
    ["first", "destination", [48, 16], "First", 1, "destination-first"],
    ["second", "destination", [47, 13], "Second", 2, "destination-second"],
  ]);
  assert.equal(layout.markers[0].found, "Home, Ohio, United States");
  assert.deepEqual(layout.lines.map(({ id, points, method, from, to, target }) => [id, points, method, from, to, target]), [
    ["out", [[40, -80], [50, 8], [48, 16]], "Flight", "Home", "First", "connection-out"],
    ["between", [[48, 16], [47, 13]], "Train", "First", "Second", "connection-between"],
    ["back", [[47, 13], [40, -80]], "Flight", "Second", "Home", "connection-back"],
  ]);
  assert.deepEqual(layout.unmapped, []);
  // Transportation shows a third of the way along each connection's longest line, from where it leaves.
  const [outBadge] = layout.lines.map((line) => line.badge);
  assert.ok(Math.abs(outBadge[1] - (-80 + 88 / 3)) < 1e-9, "on the line from home to the layover");
  assert.ok(outBadge[0] > 40 + 10 / 3, "straight on the map, whose latitudes stretch toward the poles");
});

test("connections back along the same line show their transportation apart", () => {
  const roundTrip = { places: [journey.places[0], journey.places[2], journey.places[4]], legs: [
    { id: "out", method: "Flight", from: "Home", to: "First", places: ["departure", "first"] },
    { id: "back", method: "Flight", from: "First", to: "Home", places: ["first", "return"] },
  ] };
  const [out, back] = mapLayout(roundTrip, { Home: found(40, -80), First: found(48, 16) }).lines;
  assert.deepEqual(out.points, [...back.points].reverse());
  assert.ok(Math.abs(out.badge[1] - (-80 + 96 / 3)) < 1e-9 && Math.abs(back.badge[1] - (16 - 96 / 3)) < 1e-9, "a third of the way from each end");
});

test("places the map can't find are listed with why, and lines never stand in for them", () => {
  const layout = mapLayout(journey, { Home: found(40, -80), Layover: { status: "missing" }, First: { status: "unavailable" }, Second: found(47, 13) });
  assert.deepEqual(layout.markers.map((marker) => marker.key), ["departure", "second"]);
  // The way out reaches no place the map shows, and the way back joins Second to home. Nothing joins home to Second
  // across the missing First.
  assert.deepEqual(layout.lines.map((line) => [line.id, line.points]), [["back", [[47, 13], [40, -80]]]]);
  assert.deepEqual(layout.unmapped, [
    { key: "layover", kind: "layover", label: "Layover", number: null, connection: "Home → First", reason: "missing" },
    { key: "first", kind: "destination", label: "First", number: 1, connection: null, reason: "unavailable" },
  ]);
  // A lookup that hasn't answered shows nothing yet.
  assert.deepEqual(mapLayout(journey, { Home: found(40, -80) }), { markers: [{ key: "departure", kind: "roundTrip", position: [40, -80], label: "Home", number: null, target: "connection-out", found: "Found place", photo: null }], lines: [], unmapped: [] });
  // Within a connection, its places the map shows are joined in order around one it doesn't.
  assert.deepEqual(mapLayout(journey, { Home: found(40, -80), Layover: { status: "missing" }, First: found(48, 16) }).lines.map((line) => line.points), [[[40, -80], [48, 16]]]);
});

test("a blank or unfound endpoint is listed once for both roles, and different endpoints are each listed", () => {
  const blank = { places: journey.places.map((place) => place.key === "departure" || place.key === "return" ? { ...place, place: "", label: "" } : place), legs: journey.legs };
  assert.deepEqual(mapLayout(blank, {}).unmapped, [{ key: "departure", kind: "roundTrip", label: "", number: null, connection: null, reason: "notAdded" }]);
  assert.deepEqual(mapLayout(journey, { Home: { status: "missing" } }).unmapped, [{ key: "departure", kind: "roundTrip", label: "Home", number: null, connection: null, reason: "missing" }]);
  const elsewhere = { places: journey.places.map((place) => place.key === "return" ? { ...place, place: "Away", label: "Away" } : place), legs: journey.legs };
  assert.deepEqual(mapLayout(elsewhere, { Home: { status: "missing" }, Away: { status: "missing" } }).unmapped.map((place) => [place.kind, place.label]), [["departure", "Home"], ["return", "Away"]]);
  // Found at different places, they are separate markers.
  assert.deepEqual(mapLayout(elsewhere, { Home: found(40, -80), Away: found(41, -87) }).markers.map((marker) => marker.kind), ["departure", "return"]);
});

test("longitudes follow the journey across the 180th meridian, so lines take the shorter way", () => {
  const pacific = { places: [
    { key: "departure", kind: "departure", place: "Los Angeles", label: "Los Angeles", target: null, number: null, connection: null },
    { key: "tokyo", kind: "destination", place: "Tokyo", label: "Tokyo", target: "destination-tokyo", number: 1, connection: null },
    { key: "sydney", kind: "destination", place: "Sydney", label: "Sydney", target: "destination-sydney", number: 2, connection: null },
    { key: "return", kind: "return", place: "Los Angeles", label: "Los Angeles", target: null, number: null, connection: null },
  ], legs: [
    { id: "a", method: "Flight", from: "Los Angeles", to: "Tokyo", places: ["departure", "tokyo"] },
    { id: "b", method: "Flight", from: "Tokyo", to: "Sydney", places: ["tokyo", "sydney"] },
    { id: "c", method: "Flight", from: "Sydney", to: "Los Angeles", places: ["sydney", "return"] },
  ] };
  const layout = mapLayout(pacific, { "Los Angeles": found(34.05, -118.24), Tokyo: found(35.69, 139.69), Sydney: found(-33.87, 151.21) });
  assert.deepEqual(layout.markers.map((marker) => [marker.kind, marker.position]), [
    ["roundTrip", [34.05, -118.24]],
    ["destination", [35.69, 139.69 - 360]],
    ["destination", [-33.87, 151.21 - 360]],
  ]);
  assert.ok(layout.lines.every((line) => Math.abs(line.points[0][1] - line.points[1][1]) < 180));
});

test("each kind of place has its name on the map", () => {
  assert.deepEqual([["departure", null], ["return", null], ["roundTrip", null], ["destination", 3], ["layover", null], ["stop", null]].map(([kind, number]) => placeRole(kind, number)),
    ["Departure", "Return", "Departure and return", "Destination 3", "Layover", "Stop along the way"]);
});
