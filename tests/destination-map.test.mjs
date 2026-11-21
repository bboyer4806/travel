import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { destinationMapLayout, destinationPlaces, MAP_CATEGORIES, mapCoordinates, placeKey } from "../src/lib/destination-map.ts";
import { candidateInput, newItem, prepared, setup } from "./budget-fixtures.mjs";

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
    { id: ids.hotel, category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4", coordinates: null, photo: null },
    { id: ids.museum, category: "activities", name: "Albertina", address: "", coordinates: null, photo: null },
    { id: ids.palace, category: "activities", name: "Schönbrunn Palace", address: "", coordinates: null, photo: null },
    { id: ids.cafe, category: "restaurants", name: "Café Central", address: "Herrengasse 14", coordinates: null, photo: null },
    { id: ids.church, category: "churches", name: "St. Stephen's Cathedral", address: "Stephansplatz 3", coordinates: null, photo: null },
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
    { id: "h1", category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4", coordinates: null },
    { id: "h2", category: "hotels", name: "Hotel Nowhere", address: "", coordinates: null },
    { id: "a1", category: "activities", name: "Albertina", address: "", coordinates: null },
    { id: "a2", category: "activities", name: "Prater", address: "", coordinates: null },
    { id: "r1", category: "restaurants", name: "Figlmüller", address: "", coordinates: null },
    { id: "r2", category: "restaurants", name: "Café Central", address: "Herrengasse 14", coordinates: null },
    { id: "c1", category: "churches", name: "St. Stephen's Cathedral", address: "Stephansplatz 3", coordinates: null },
    { id: "c2", category: "churches", name: "St. Peter's", address: "", coordinates: null },
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
  assert.deepEqual(all.markers[0], { key: "48.20406,16.36949", position: [48.20406, 16.36949], places: [{ ...places[0], found: "Found", approximate: false }] });
});

test("places found at one position share a marker, and places still being looked up are on neither the map nor the list", () => {
  const places = [
    { id: "hotel", category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4", coordinates: null },
    { id: "cafe", category: "restaurants", name: "Café Sacher", address: "Philharmonikerstraße 4", coordinates: null },
    { id: "museum", category: "activities", name: "Albertina", address: "", coordinates: null },
    { id: "palace", category: "activities", name: "Schönbrunn Palace", address: "", coordinates: null },
  ];
  const sacher = found(48.20406, 16.36949, "Hotel Sacher, 4, Philharmonikerstraße");
  const layout = destinationMapLayout(places, { hotel: sacher, cafe: sacher, museum: { status: "pending" } }, MAP_CATEGORIES);
  assert.deepEqual(layout.markers, [{ key: "48.20406,16.36949", position: [48.20406, 16.36949], places: [{ ...places[0], found: sacher.label, approximate: false }, { ...places[1], found: sacher.label, approximate: false }] }]);
  assert.deepEqual(layout.unmapped, []);
  // With restaurants unchecked, the marker shows the hotel alone.
  assert.deepEqual(destinationMapLayout(places, { hotel: sacher, cafe: sacher }, ["hotels"]).markers[0].places.map((place) => place.id), ["hotel"]);
});

// TRA-150: places with saved coordinates are on the map at once, wherever they are, and aren't looked up.
const SACHER = { latitude: 48.20406, longitude: 16.36949, accuracy: "exact" };
const RENTAL = { latitude: 48.2167, longitude: 16.3958, accuracy: "approximate" };
const MELK = { latitude: 48.22842, longitude: 15.33437, accuracy: "exact" };
const coordinated = (coordinates, review = false) => ({ ...coordinates, review });

test("saved coordinates place a place without a lookup, however far from its destination, ahead of any answer, and approximate ones say so", () => {
  const places = [
    { id: "hotel", category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4", coordinates: coordinated(SACHER) },
    { id: "rental", category: "hotels", name: "Leopoldstadt apartment", address: "Address withheld", coordinates: coordinated(RENTAL) },
    { id: "abbey", category: "activities", name: "Melk Abbey", address: "", coordinates: coordinated(MELK) },
    { id: "museum", category: "activities", name: "Albertina", address: "", coordinates: null },
    { id: "cafe", category: "restaurants", name: "Café Central", address: "Herrengasse 14", coordinates: null },
    { id: "moved", category: "restaurants", name: "Figlmüller", address: "Bäckerstraße 6", coordinates: coordinated({ latitude: 48.20918, longitude: 16.37466, accuracy: "exact" }, true) },
    { id: "church", category: "churches", name: "St. Stephen's Cathedral", address: "Stephansplatz 3", coordinates: coordinated({ latitude: 48.20857, longitude: 16.37307, accuracy: "exact" }) },
  ];
  // A lookup may still answer for a place with coordinates, as from a page opened before they were saved: they come first.
  const answers = { hotel: found(48.2, 16.37, "Elsewhere"), museum: { status: "missing" }, cafe: found(48.21036, 16.36564, "Café Central, 14, Herrengasse"), moved: { status: "ambiguous" }, rental: { status: "pending" } };
  const layout = destinationMapLayout(places, answers, MAP_CATEGORIES);
  assert.deepEqual(layout.markers.map((marker) => [marker.position, marker.places.map(({ id, found: shown, approximate }) => [id, shown, approximate])]), [
    [[48.20406, 16.36949], [["hotel", null, false]]],
    [[48.2167, 16.3958], [["rental", null, true]]],
    [[48.22842, 15.33437], [["abbey", null, false]]],
    [[48.21036, 16.36564], [["cafe", "Café Central, 14, Herrengasse", false]]],
    [[48.20857, 16.37307], [["church", null, false]]],
  ], "Melk Abbey, 80 km away, is where its coordinates are, not moved to Vienna");
  // Coordinates waiting for review aren't used, so that place is looked up like any other, and listed when it isn't found.
  assert.deepEqual(layout.unmapped.map((group) => [group.category, group.places.map(({ id, reason }) => [id, reason])]), [["activities", [["museum", "missing"]]], ["restaurants", [["moved", "ambiguous"]]]]);
  const ids = [...layout.markers.flatMap((marker) => marker.places), ...layout.unmapped.flatMap((group) => group.places)].map((place) => place.id);
  assert.deepEqual(ids.toSorted(), places.map((place) => place.id).toSorted(), "every place once, on one marker or in the list");
  // Found where its coordinates were confirmed, the place that moved shows there once more.
  assert.deepEqual(destinationMapLayout(places, { ...answers, moved: found(48.20831, 16.37734, "Figlmüller, 6, Bäckerstraße") }, ["restaurants"]).markers.map((marker) => marker.places.map((place) => [place.id, place.found])), [[["cafe", "Café Central, 14, Herrengasse"]], [["moved", "Figlmüller, 6, Bäckerstraße"]]]);
  // The categories filter places with coordinates as they do every other.
  for (const shown of combinations) {
    const marked = destinationMapLayout(places, answers, shown).markers.flatMap((marker) => marker.places.map((place) => place.id));
    assert.deepEqual(marked, places.filter((place) => shown.includes(place.category) && (mapCoordinates(place) || answers[place.id]?.status === "found")).map((place) => place.id), "markers for " + shown);
  }
});

test("places at the same coordinates share one marker, whether saved or found there", () => {
  const places = [
    { id: "hotel", category: "hotels", name: "Hotel Sacher", address: "", coordinates: coordinated(SACHER) },
    { id: "cafe", category: "restaurants", name: "Café Sacher", address: "", coordinates: null },
    { id: "rental", category: "hotels", name: "Rental", address: "", coordinates: coordinated(RENTAL) },
    { id: "room", category: "hotels", name: "Room", address: "", coordinates: coordinated(RENTAL) },
  ];
  const layout = destinationMapLayout(places, { cafe: found(SACHER.latitude, SACHER.longitude, "Hotel Sacher, 4, Philharmonikerstraße") }, MAP_CATEGORIES);
  assert.deepEqual(layout.markers.map((marker) => [marker.key, marker.places.map((place) => [place.id, place.approximate])]), [
    ["48.20406,16.36949", [["hotel", false], ["cafe", false]]],
    ["48.2167,16.3958", [["rental", true], ["room", true]]],
  ]);
});

test("a destination's places carry their saved coordinates, and only usable ones place them", (t) => {
  const { store, destinationId, ids } = vienna(t);
  store.applyMutation(candidateInput(destinationId, "hotels", { id: ids.hotel, name: "Hotel Sacher", address: "Philharmonikerstraße 4", included: false, coordinates: SACHER }));
  store.applyMutation(churchInput(destinationId, { id: ids.church, name: "St. Stephen's Cathedral", address: "Stephansplatz 3", coordinates: RENTAL }));
  const places = () => Object.fromEntries(destinationPlaces(store.getDestinationSnapshot(destinationId).data, destinationId).map((place) => [place.id, place]));
  assert.deepEqual([places()[ids.hotel].coordinates, places()[ids.church].coordinates, places()[ids.museum].coordinates], [coordinated(SACHER), coordinated(RENTAL), null]);
  assert.deepEqual([mapCoordinates(places()[ids.hotel]), mapCoordinates(places()[ids.museum])], [coordinated(SACHER), null]);
  // A new address leaves the church's coordinates for review, so the map looks it up again by its new address.
  store.applyMutation(churchInput(destinationId, { id: ids.church, name: "St. Stephen's Cathedral", address: "Stephansplatz 1" }));
  assert.equal(places()[ids.church].coordinates.review, true);
  assert.equal(mapCoordinates(places()[ids.church]), null);
});

// TRA-152: each place's primary photo, which its marker's popup shows.
const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const photo = () => ({ id: randomUUID(), ...prepared(webp) });

test("a destination's places carry their primary photos, the same in a trip and in Destinations, and photos never change what they are looked up by (TRA-152)", (t) => {
  const { store, tripId, destinationId, ids } = vienna(t);
  const places = () => Object.fromEntries(destinationPlaces(store.getDestinationSnapshot(destinationId).data, destinationId).map((place) => [place.id, place]));
  const keys = () => Object.fromEntries(Object.values(places()).map((place) => [place.id, placeKey("Vienna", place)]));
  /** A saved photo, with the version the store gave it, which its address names. */
  const saved = (kind, id, imageId) => store.getDestinationSnapshot(destinationId).data[kind].find((item) => item.id === id).images.find((image) => image.id === imageId);
  const before = keys();
  // The hotel gets two photos, the first its main photo, and the church one.
  const [lobby, facade, nave] = [photo(), photo(), photo()];
  const hotel = (overrides) => candidateInput(destinationId, "hotels", { id: ids.hotel, name: "Hotel Sacher", address: "Philharmonikerstraße 4", included: false, ...overrides });
  const church = (overrides) => churchInput(destinationId, { id: ids.church, name: "St. Stephen's Cathedral", address: "Stephansplatz 3", ...overrides });
  store.applyMutation(hotel({ gallery: { add: [lobby, facade], remove: [] } }));
  store.applyMutation(church({ gallery: { add: [nave], remove: [] } }));
  assert.deepEqual(places()[ids.hotel].photo, saved("candidates", ids.hotel, lobby.id));
  assert.deepEqual(places()[ids.church].photo, saved("churches", ids.church, nave.id));
  assert.deepEqual([places()[ids.museum].photo, places()[ids.palace].photo, places()[ids.cafe].photo], [null, null, null], "places without photos have none");
  assert.deepEqual(destinationPlaces(store.getTripSnapshot(tripId).data, destinationId), Object.values(places()), "the trip's card shows the same photos");
  // Choosing the hotel's second photo as its main photo shows that one, not its first.
  store.applyMutation(hotel({ gallery: { add: [], remove: [], mainImageId: facade.id } }));
  assert.deepEqual(places()[ids.hotel].photo, saved("candidates", ids.hotel, facade.id));
  // Removing the church's only photo leaves it without one.
  store.applyMutation(church({ gallery: { add: [], remove: [nave.id] } }));
  assert.equal(places()[ids.church].photo, null);
  // Photos never change what a place is looked up by, so the map looks nothing up again for them.
  assert.deepEqual(keys(), before);
});
