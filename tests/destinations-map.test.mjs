import assert from "node:assert/strict";
import test from "node:test";
import { destinationHref, destinationNames, destinationsMapLayout, lookupCity, markersAt } from "../src/lib/destinations-map.ts";
import { createStore } from "../src/lib/store.ts";
import { newItem } from "./budget-fixtures.mjs";

// TRA-180: what the Destinations page's map shows of saved destinations and the places found for them.
const destination = (id, city, overrides = {}) => ({ id, city, cityFromSuggestion: false, sharedBy: null, ...overrides });
const found = (latitude, longitude, label = "Found at " + latitude) => ({ status: "found", latitude, longitude, label });

test("a destination is named as its card names it, by its full saved city when another card shows the same name, and by whose it is when that still isn't enough", () => {
  const names = destinationNames([
    // Chosen from the suggestions, shown with their state, so they differ already.
    destination("oregon", "Portland, Oregon, United States", { cityFromSuggestion: true }),
    destination("maine", "Portland, Maine, United States", { cityFromSuggestion: true }),
    // Both would show as San Jose, Philippines, so each is named by the province saved with it.
    destination("ecija", "San Jose, Nueva Ecija, Philippines", { cityFromSuggestion: true }),
    destination("mindoro", "San Jose, Occidental Mindoro, Philippines", { cityFromSuggestion: true }),
    // Typed, shown exactly as saved.
    destination("texas", "Paris, TX"),
    destination("france", "Paris"),
    // The same city saved by the account and by the owner of a trip shared with it.
    destination("mine", "Vienna, Vienna, Austria", { cityFromSuggestion: true }),
    destination("theirs", "Vienna, Vienna, Austria", { cityFromSuggestion: true, sharedBy: "Smoke Owner" }),
  ]);
  assert.deepEqual(Object.fromEntries(names), {
    oregon: "Portland, Oregon",
    maine: "Portland, Maine",
    ecija: "San Jose, Nueva Ecija, Philippines",
    mindoro: "San Jose, Occidental Mindoro, Philippines",
    texas: "Paris, TX",
    france: "Paris",
    mine: "Vienna, Vienna, Austria",
    theirs: "Vienna, Vienna, Austria, shared by Smoke Owner",
  });
  // A shared destination whose name is its own needs no more.
  assert.deepEqual(Object.fromEntries(destinationNames([destination("theirs", "Graz", { sharedBy: "Smoke Owner" }), destination("mine", "Vienna")])), { theirs: "Graz", mine: "Vienna" });
});

test("each destination found is on the map once, where it was found, and those it can't show are listed with why", () => {
  const destinations = [
    destination("atlantis", "Atlantis"),
    destination("graz", "Graz"),
    destination("pending", "Linz"),
    destination("vienna", "Vienna"),
    destination("wien", "Vienna, Austria"),
    destination("zell", "Zell am See"),
  ];
  const locations = {
    atlantis: { status: "missing" },
    graz: found(47.06667, 15.45, "Graz, Styria, Austria"),
    // Linz hasn't been answered yet, so it is in neither.
    vienna: found(48.20849, 16.37208, "Vienna, Austria"),
    // Two names for one city, found at the same place, are each on the map.
    wien: found(48.20849, 16.37208, "Vienna, Austria"),
    zell: { status: "unavailable" },
  };
  const layout = destinationsMapLayout(destinations, destinations.map((item) => item.id), locations);
  assert.deepEqual(layout.mapped, [
    { id: "graz", name: "Graz", position: [47.06667, 15.45], found: "Graz, Styria, Austria" },
    { id: "vienna", name: "Vienna", position: [48.20849, 16.37208], found: "Vienna, Austria" },
    { id: "wien", name: "Vienna, Austria", position: [48.20849, 16.37208], found: "Vienna, Austria" },
  ]);
  assert.deepEqual(layout.unmapped, [
    { id: "atlantis", name: "Atlantis", reason: "missing" },
    { id: "zell", name: "Zell am See", reason: "unavailable" },
  ]);
  // Each destination is in one place at most.
  const ids = [...layout.mapped, ...layout.unmapped].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.includes("pending"), false);
});

test("destinations whose markers would cover each other at a zoom share one, which zooming in sets apart, and destinations found at one place always share one", () => {
  const mapped = (id, latitude, longitude) => ({ id, name: id, position: [latitude, longitude], found: id });
  const destinations = [mapped("graz", 47.06667, 15.45), mapped("innsbruck", 47.26266, 11.39454), mapped("salzburg", 47.79941, 13.04399), mapped("vienna", 48.20849, 16.37208), mapped("wien", 48.20849, 16.37208)];
  // Points at a zoom, as a Mercator map draws them: a degree is 2^zoom pixels across here, for simple numbers.
  const at = (zoom) => ([latitude, longitude]) => ({ x: longitude * 2 ** zoom, y: -latitude * 2 ** zoom });
  const shared = (zoom) => markersAt(destinations, at(zoom), 30).map((marker) => [marker.key, marker.position]);
  // Zoomed out, every Austrian city's marker would cover the first's, Graz's, so all share it, there.
  assert.deepEqual(shared(2), [["graz innsbruck salzburg vienna wien", [47.06667, 15.45]]]);
  // Closer, Graz and Vienna, 23 pixels apart here, and Innsbruck and Salzburg, 28 apart, still would, each pair less than a
  // marker's 30 pixels.
  assert.deepEqual(shared(4), [["graz vienna wien", [47.06667, 15.45]], ["innsbruck salzburg", [47.26266, 11.39454]]]);
  // Closer again, each has its own marker, but Vienna and Vienna, Austria, found at one place.
  assert.deepEqual(shared(6), [["graz", [47.06667, 15.45]], ["innsbruck", [47.26266, 11.39454]], ["salzburg", [47.79941, 13.04399]], ["vienna wien", [48.20849, 16.37208]]]);
  assert.deepEqual(shared(18).at(-1), ["vienna wien", [48.20849, 16.37208]]);
  // A shared marker lists its destinations in order, as found.
  assert.deepEqual(markersAt(destinations, at(6), 30).at(-1).destinations, [destinations[3], destinations[4]]);
});

test("the search's destinations alone are shown, and named as among every destination", () => {
  const destinations = [
    destination("atlantis", "Atlantis"),
    destination("ecija", "San Jose, Nueva Ecija, Philippines", { cityFromSuggestion: true }),
    destination("mindoro", "San Jose, Occidental Mindoro, Philippines", { cityFromSuggestion: true }),
    destination("vienna", "Vienna"),
  ];
  const locations = { atlantis: { status: "missing" }, ecija: found(15.79, 120.99), mindoro: found(12.35, 121.07), vienna: found(48.20849, 16.37208) };
  const names = (layout) => [layout.mapped.map((item) => item.name), layout.unmapped.map((item) => item.name)];
  const all = destinationsMapLayout(destinations, destinations.map((item) => item.id), locations);
  assert.deepEqual(names(all), [["San Jose, Nueva Ecija, Philippines", "San Jose, Occidental Mindoro, Philippines", "Vienna"], ["Atlantis"]]);
  // A search for one San Jose still names it by its province, as its card does.
  assert.deepEqual(names(destinationsMapLayout(destinations, ["mindoro"], locations)), [["San Jose, Occidental Mindoro, Philippines"], []]);
  assert.deepEqual(names(destinationsMapLayout(destinations, ["atlantis", "vienna"], locations)), [["Vienna"], ["Atlantis"]]);
  // No destination matching shows nothing, and every one shows again once the search is cleared.
  assert.deepEqual(destinationsMapLayout(destinations, [], locations), { mapped: [], unmapped: [] });
  assert.deepEqual(destinationsMapLayout(destinations, destinations.map((item) => item.id), locations), all);
});

test("a destination in several trips is on the map once, by the saved ID its page opens with, looked up by its saved city", (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const owner = store.authorizeAccount("owner@example.com");
  const trip = (name) => store.applyMutation(owner.id, { type: "trip.save", ...newItem(), name, dateLabel: "", homeCity: "Wooster, OH", travelers: 2, notes: "" }).id;
  const stops = [trip("Austria"), trip("Alps"), trip("Danube")].map((tripId) => store.applyMutation(owner.id, { type: "stop.add", tripId, city: "Vienna" }).id);
  const { data } = store.getDestinationsOverview(owner.id);
  assert.equal(data.stops.length, 3, "three trips visit it");
  assert.equal(new Set(data.stops.map((stop) => stop.destinationId)).size, 1, "one destination");
  const [vienna] = data.destinations;
  assert.equal(lookupCity(vienna), vienna.city, "looked up by its saved city");
  const destinations = data.destinations.map(({ id, city, cityFromSuggestion }) => ({ id, city, cityFromSuggestion, sharedBy: null }));
  const layout = destinationsMapLayout(destinations, destinations.map((item) => item.id), { [vienna.id]: found(48.20849, 16.37208, "Vienna, Austria") });
  assert.deepEqual(layout.mapped.map((item) => item.id), [vienna.id]);
  assert.equal(destinationHref(vienna.id), "/destinations/" + vienna.id);
  assert.ok(stops.every((id) => data.stops.some((stop) => stop.id === id)));
});
