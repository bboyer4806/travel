import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedStore } from "./owned-store.mjs";
import { calculateBudget } from "../src/lib/budget.ts";

const trip = (name, startDate) => ({
  type: "trip.save", name, startDate, dateLabel: "", homeCity: "New York", travelers: 2, notes: "",
});
const destination = (tripId, city, nights) => ({
  type: "destination.save", tripId, city, stay: "", notes: "", nights,
});
const hotel = (destinationId) => ({
  type: "candidate.save", destinationId, category: "hotels", name: "Hotel",
  price: "100.50", address: "", url: "", notes: "", included: true,
});

test("scoped trip and destination snapshots omit unrelated data", (t) => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const first = store.applyMutation(trip("Europe", "2027-06-01")).id;
  const second = store.applyMutation(trip("Asia", "2027-08-01")).id;
  const rome = store.applyMutation(destination(first, "Rome", 3)).id;
  const paris = store.applyMutation(destination(first, "Paris", 2)).id;
  const tokyo = store.applyMutation(destination(second, "Tokyo", 5)).id;
  store.applyMutation(hotel(rome));
  store.applyMutation(hotel(paris));
  store.applyMutation(hotel(tokyo));

  const full = store.getSnapshot();
  const scoped = store.getSnapshot({ tripId: first });
  assert.deepEqual(scoped.trips.map((item) => item.id), [first]);
  assert.deepEqual(scoped.destinations.map((item) => item.id), [rome, paris]);
  assert.equal(scoped.candidates.length, 2);
  assert.ok(scoped.candidates.every((item) => item.destinationId !== tokyo));

  const category = store.getSnapshot({ tripId: first, destinationId: rome });
  assert.equal(category.trips.length, 1);
  assert.equal(category.destinations.length, 2, "A category editor still sees its trip route");
  assert.equal(category.candidates.length, 1);
  assert.equal(category.candidates[0].destinationId, rome);

  const home = store.getHomeOverview();
  assert.equal(home.data.trips.length, 2);
  assert.equal(home.data.candidates.length, 0, "Home sends no idea details to the browser");
  assert.equal(home.data.legs.length, 0);
  assert.equal(Object.keys(home.data.destinations[0]).sort().join(","), "city,id,position,tripId");
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
  const firstStop = store.applyMutation(destination(first, "Rome", 2)).id;
  const otherStop = store.applyMutation(destination(second, "Tokyo", 3)).id;
  const otherDate = store.getSnapshot().destinations.find((item) => item.id === otherStop).arrivalDate;
  store.applyMutation({ type: "destination.save", id: firstStop, tripId: first, nights: 4 });
  assert.equal(store.getSnapshot().destinations.find((item) => item.id === otherStop).arrivalDate, otherDate);
  assert.equal(store.getSnapshot().trips.find((item) => item.id === first).endDate, "2027-06-05");
  assert.equal(store.getSnapshot().trips.find((item) => item.id === second).endDate, "2027-07-04");
});
