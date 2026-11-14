import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedStore } from "./owned-store.mjs";
import { addCity, newItem } from "./budget-fixtures.mjs";
import { calculateBudget } from "../src/lib/budget.ts";

const trip = (name, startDate) => ({
  type: "trip.save", ...newItem(), name, startDate, dateLabel: "", homeCity: "New York", travelers: 2, notes: "",
});
const destination = (store, tripId, city, nights) => addCity((input) => store.applyMutation(input).id, tripId, city, { nights });
const hotel = (destinationId) => ({
  type: "candidate.save", ...newItem(), destinationId, category: "hotels", name: "Hotel",
  price: "100.50", address: "", url: "", notes: "", included: true,
});

test("scoped trip and destination snapshots omit unrelated data", (t) => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const first = store.applyMutation(trip("Europe", "2027-06-01")).id;
  const second = store.applyMutation(trip("Asia", "2027-08-01")).id;
  const rome = destination(store, first, "Rome", 3);
  const paris = destination(store, first, "Paris", 2);
  const tokyo = destination(store, second, "Tokyo", 5);
  store.applyMutation(hotel(rome));
  store.applyMutation(hotel(paris));
  store.applyMutation(hotel(tokyo));

  const full = store.getSnapshot();
  const scoped = store.getTripSnapshot(first).data;
  assert.deepEqual(scoped.trips.map((item) => item.id), [first]);
  assert.deepEqual(scoped.stops.map((item) => item.id), [rome, paris]);
  assert.deepEqual(scoped.destinations.map((item) => item.id).sort(), [rome, paris].sort());
  assert.equal(scoped.candidates.length, 2);
  assert.ok(scoped.candidates.every((item) => item.destinationId !== tokyo));

  const category = store.getTripSnapshot(first, rome).data;
  assert.equal(category.trips.length, 1);
  assert.equal(category.stops.length, 2, "A category editor still sees its trip route");
  assert.deepEqual(category.destinations.map((item) => item.id), [rome], "only its own destination's research");
  assert.equal(category.candidates.length, 1);
  assert.equal(category.candidates[0].destinationId, rome);

  const place = store.getDestinationSnapshot(rome).data;
  assert.deepEqual([place.destinations.map((item) => item.id), place.trips.map((item) => item.id), place.stops.map((item) => item.id)], [[rome], [first], [rome]]);
  assert.equal(place.candidates.length, 1);
  assert.deepEqual([place.legs, place.homeItems], [[], []], "a destination page sends no trip's connections or At home items");

  const home = store.getHomeOverview();
  assert.equal(home.data.trips.length, 2);
  assert.equal(home.data.candidates.length, 0, "Home sends no idea details to the browser");
  assert.equal(home.data.legs.length, 0);
  assert.equal(Object.keys(home.data.destinations[0]).sort().join(","), "city,cityFromSuggestion,id", "a trip card shows its cities as Destinations does");
  assert.equal(Object.keys(home.data.stops[0]).sort().join(","), "destinationId,id,position,tripId");
  for (const record of full.trips) {
    assert.deepEqual(home.budgets[record.id], calculateBudget(full, record.id));
  }

  const result = store.applyMutation({ type: "candidate.include", id: full.candidates[0].id, included: false });
  assert.deepEqual(result, { id: full.candidates[0].id }, "Mutations return only the affected ID, not a snapshot");
  assert.deepEqual(store.getHomeOverview().budgets[first], calculateBudget(store.getSnapshot(), first));
  store.checkHealth();
});

test("only the affected trip's schedule changes after mutations", (t) => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const first = store.applyMutation(trip("First", "2027-06-01")).id;
  const second = store.applyMutation(trip("Second", "2027-07-01")).id;
  const firstStop = destination(store, first, "Rome", 2);
  const otherStop = destination(store, second, "Tokyo", 3);
  const otherDate = store.getSnapshot().stops.find((item) => item.id === otherStop).arrivalDate;
  store.applyMutation({ type: "destination.save", id: firstStop, stopId: firstStop, nights: 4 });
  assert.equal(store.getSnapshot().stops.find((item) => item.id === otherStop).arrivalDate, otherDate);
  assert.equal(store.getSnapshot().trips.find((item) => item.id === first).endDate, "2027-06-05");
  assert.equal(store.getSnapshot().trips.find((item) => item.id === second).endDate, "2027-07-04");
});
