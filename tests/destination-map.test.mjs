import assert from "node:assert/strict";
import test from "node:test";
import { destinationMapLayout, destinationPlaces, MAP_CATEGORIES, placeKey } from "../src/lib/destination-map.ts";
import { candidateInput, newItem, setup } from "./budget-fixtures.mjs";

const churchInput = (destinationId, overrides = {}) => ({ type: "church.save", destinationId, name: "St. Mary's", address: "", denomination: "", url: "", massTimes: [], ...overrides, ...newItem(overrides) });
const found = (latitude, longitude, label = "Found") => ({ status: "found", latitude, longitude, label });
/** Every combination of the map's categories, the empty one included. */
const combinations = MAP_CATEGORIES.reduce((sets, category) => [...sets, ...sets.map((set) => [...set, category])], [[]]);

/** A trip visiting Vienna, with a hotel, two activities, a restaurant and a church there, and a hotel in another city. */
function vienna(t) {
  const { store, tripId } = setup(t);
  const stopId = store.applyMutation({ type: "stop.add", tripId, city: "Vienna" }).id;
  const destinationId = store.getSnapshot().stops.find((stop) => stop.id === stopId).destinationId;
  const add = (input) => store.applyMutation(input).id;
  const ids = {
    hotel: add(candidateInput(destinationId, "hotels", { name: "Hotel Sacher", address: "Philharmonikerstraße 4", included: false })),
    museum: add(candidateInput(destinationId, "activities", { name: "Albertina" })),
    palace: add(candidateInput(destinationId, "activities", { name: "Schönbrunn Palace", included: false })),
    cafe: add(candidateInput(destinationId, "restaurants", { name: "Café Central", address: "Herrengasse 14" })),
    church: add(churchInput(destinationId, { name: "St. Stephen's Cathedral", address: "Stephansplatz 3" })),
  };
  const otherStop = store.applyMutation({ type: "stop.add", tripId, city: "Salzburg" }).id;
  const salzburg = store.getSnapshot().stops.find((stop) => stop.id === otherStop).destinationId;
  add(candidateInput(salzburg, "hotels", { name: "Hotel Sacher Salzburg" }));
  return { store, tripId, stopId, destinationId, ids };
}

test("a destination's map has every hotel, activity, restaurant and church saved for it, selected or not, the same in a trip and in Destinations", (t) => {
  const { store, tripId, destinationId, ids } = vienna(t);
  const places = destinationPlaces(store.getTripSnapshot(tripId).data, destinationId);
  assert.deepEqual(places, [
    { id: ids.hotel, category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4" },
    { id: ids.museum, category: "activities", name: "Albertina", address: "" },
    { id: ids.palace, category: "activities", name: "Schönbrunn Palace", address: "" },
    { id: ids.cafe, category: "restaurants", name: "Café Central", address: "Herrengasse 14" },
    { id: ids.church, category: "churches", name: "St. Stephen's Cathedral", address: "Stephansplatz 3" },
  ]);
  // The destination's own page, outside the trip, and its stop's idea page in the trip have the same places.
  assert.deepEqual(destinationPlaces(store.getDestinationSnapshot(destinationId).data, destinationId), places);
  // Ideas follow their saved order.
  store.applyMutation({ type: "candidate.move", id: ids.palace, direction: "up" });
  assert.deepEqual(destinationPlaces(store.getDestinationSnapshot(destinationId).data, destinationId).map((place) => place.id), [ids.hotel, ids.palace, ids.museum, ids.cafe, ids.church]);
});

test("adding, editing and removing saved places changes the map's places, each once, and only text it looks up changes their keys", (t) => {
  const { store, destinationId, ids } = vienna(t);
  const places = () => destinationPlaces(store.getDestinationSnapshot(destinationId).data, destinationId);
  const keys = () => Object.fromEntries(places().map((place) => [place.id, placeKey("Vienna", place)]));
  const before = keys();
  const added = store.applyMutation(candidateInput(destinationId, "restaurants", { name: "Figlmüller" })).id;
  store.applyMutation({ type: "candidate.delete", id: ids.museum });
  store.applyMutation({ type: "church.delete", id: ids.church, destinationId });
  // Choosing an idea for the budget, or changing its price, doesn't change what it is looked up by.
  store.applyMutation({ type: "candidate.include", id: ids.palace, included: true });
  store.applyMutation({ ...candidateInput(destinationId, "restaurants", { id: ids.cafe, name: "Café Central", address: "Herrengasse 14", price: "40" }) });
  store.applyMutation({ ...candidateInput(destinationId, "hotels", { id: ids.hotel, name: "Hotel Sacher Wien", address: "Philharmonikerstraße 4" }) });
  const after = keys();
  assert.deepEqual(Object.keys(after).sort(), [ids.hotel, ids.palace, ids.cafe, added].sort());
  assert.equal(new Set(places().map((place) => place.id)).size, places().length, "each place once");
  assert.equal(after[ids.palace], before[ids.palace]);
  assert.equal(after[ids.cafe], before[ids.cafe]);
  assert.notEqual(after[ids.hotel], before[ids.hotel], "a new name is looked up again");
  const [hotel] = places();
  assert.notEqual(placeKey("Vienna", { ...hotel, address: "Kärntner Ring 1" }), placeKey("Vienna", hotel), "so is a new address");
  assert.notEqual(placeKey("Vienna, Austria", hotel), placeKey("Vienna", hotel), "and a new city for the destination");
});

test("every combination of categories filters the markers and the places not on the map alike", () => {
  const places = [
    { id: "h1", category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4" },
    { id: "h2", category: "hotels", name: "Hotel Nowhere", address: "" },
    { id: "a1", category: "activities", name: "Albertina", address: "" },
    { id: "a2", category: "activities", name: "Prater", address: "" },
    { id: "r1", category: "restaurants", name: "Figlmüller", address: "" },
    { id: "r2", category: "restaurants", name: "Café Central", address: "Herrengasse 14" },
    { id: "c1", category: "churches", name: "St. Stephen's Cathedral", address: "Stephansplatz 3" },
    { id: "c2", category: "churches", name: "St. Peter's", address: "" },
  ];
  const answers = {
    h1: found(48.20406, 16.36949), h2: { status: "missing" }, a1: found(48.20462, 16.36818), a2: { status: "unavailable" },
    r1: { status: "ambiguous" }, r2: found(48.21036, 16.36564), c1: found(48.20857, 16.37307), c2: { status: "missing" },
  };
  for (const shown of combinations) {
    const layout = destinationMapLayout(places, answers, shown);
    const marked = layout.markers.flatMap((marker) => marker.places.map((place) => place.id));
    const unmapped = layout.unmapped.flatMap((group) => group.places.map((place) => place.id));
    const expected = (statusFound) => places.filter((place) => shown.includes(place.category) && (answers[place.id].status === "found") === statusFound).map((place) => place.id);
    assert.deepEqual(marked, expected(true), "markers for " + shown);
    assert.deepEqual(unmapped, expected(false), "not on the map for " + shown);
    // Not on the map groups places by category, in the checkboxes' order, without empty groups.
    assert.deepEqual(layout.unmapped.map((group) => group.category), MAP_CATEGORIES.filter((category) => shown.includes(category) && places.some((place) => place.category === category && answers[place.id].status !== "found")));
    for (const group of layout.unmapped) assert.ok(group.places.every((place) => place.category === group.category));
  }
  const all = destinationMapLayout(places, answers, MAP_CATEGORIES);
  assert.deepEqual(all.unmapped.flatMap((group) => group.places.map(({ id, reason }) => [id, reason])), [["h2", "missing"], ["a2", "unavailable"], ["r1", "ambiguous"], ["c2", "missing"]]);
  assert.deepEqual(all.markers[0], { key: "48.20406,16.36949", position: [48.20406, 16.36949], places: [{ ...places[0], found: "Found" }] });
});

test("places found at one position share a marker, and places still being looked up are on neither the map nor the list", () => {
  const places = [
    { id: "hotel", category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4" },
    { id: "cafe", category: "restaurants", name: "Café Sacher", address: "Philharmonikerstraße 4" },
    { id: "museum", category: "activities", name: "Albertina", address: "" },
    { id: "palace", category: "activities", name: "Schönbrunn Palace", address: "" },
  ];
  const sacher = found(48.20406, 16.36949, "Hotel Sacher, 4, Philharmonikerstraße");
  const layout = destinationMapLayout(places, { hotel: sacher, cafe: sacher, museum: { status: "pending" } }, MAP_CATEGORIES);
  assert.deepEqual(layout.markers, [{ key: "48.20406,16.36949", position: [48.20406, 16.36949], places: [{ ...places[0], found: sacher.label }, { ...places[1], found: sacher.label }] }]);
  assert.deepEqual(layout.unmapped, []);
  // With restaurants unchecked, the marker shows the hotel alone.
  assert.deepEqual(destinationMapLayout(places, { hotel: sacher, cafe: sacher }, ["hotels"]).markers[0].places.map((place) => place.id), ["hotel"]);
});
