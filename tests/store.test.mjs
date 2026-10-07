import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createStore, ValidationError } from "../src/lib/store.ts";
import { calculateBudget, formatMoney } from "../src/lib/budget.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Japan in spring", dateLabel: "Spring 2027", homeCity: "New York", travelers: 2, notes: "An idea worth exploring.", ...overrides });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Tokyo", stay: "4 nights", notes: "", ...overrides });
const candidateInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "hotels", name: "A lovely hotel", price: "200.33", address: "", url: "https://example.com", notes: "", included: true, ...overrides });
const legInput = (id, overrides = {}) => ({ type: "leg.save", id, method: "Flight", price: "100.01", departure: "Morning", arrival: "Evening", url: "https://example.com/flights", notes: "Two passengers", ...overrides });
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const { id: tripId } = store.applyMutation(tripInput());
  return { store, tripId };
}
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-store-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}
const legsFor = (store, tripId) => store.getSnapshot().legs.filter((leg) => leg.tripId === tripId);
const pair = (leg) => JSON.stringify([leg.fromId, leg.toId]);

test("complete create, edit, clear, and delete flows preserve the trip relationships", (t) => {
  const { store, tripId } = setup(t);
  assert.deepEqual(store.getSnapshot().legs, []);
  const { id: destinationId } = store.applyMutation(destinationInput(tripId));
  const route = legsFor(store, tripId);
  assert.equal(route.length, 2);
  assert.deepEqual(route.map((leg) => [leg.fromId, leg.toId]), [[null, destinationId], [destinationId, null]]);
  store.applyMutation(legInput(route[0].id));
  assert.equal(legsFor(store, tripId)[0].priceCents, 10001);
  store.applyMutation({ type: "leg.clear", id: route[0].id });
  assert.equal(legsFor(store, tripId)[0].priceCents, null);
  assert.equal(legsFor(store, tripId)[0].method, "");
  const { id: hotelId } = store.applyMutation(candidateInput(destinationId));
  const { id: activityId } = store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Museum", price: "0" }));
  const { id: restaurantId } = store.applyMutation(candidateInput(destinationId, { category: "restaurants", name: "Dinner", price: "90" }));
  store.applyMutation(candidateInput(destinationId, { id: hotelId, name: "Updated hotel", price: "250.95", notes: "Breakfast included" }));
  store.applyMutation(candidateInput(destinationId, { id: activityId, category: "activities", name: "Museum tour", price: "25" }));
  store.applyMutation(candidateInput(destinationId, { id: restaurantId, category: "restaurants", name: "Dinner", price: "95" }));
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === hotelId).priceCents, 25095);
  store.applyMutation({ type: "candidate.delete", id: activityId });
  assert.equal(store.getSnapshot().candidates.length, 2);
  store.applyMutation(destinationInput(tripId, { id: destinationId, stay: "5 nights", notes: "Stay downtown" }));
  store.applyMutation(tripInput({ id: tripId, name: "Japan 2027", travelers: 3 }));
  assert.equal(store.getSnapshot().trips[0].name, "Japan 2027");
  assert.equal(store.getSnapshot().destinations[0].stay, "5 nights");
  store.applyMutation({ type: "trip.delete", id: tripId });
  assert.deepEqual(store.getSnapshot(), { trips: [], destinations: [], legs: [], candidates: [] });
});

test("route changes retain only unchanged connections, and deleting destinations cascades ideas", (t) => {
  const { store, tripId } = setup(t);
  const a = store.applyMutation(destinationInput(tripId, { city: "Tokyo" })).id;
  const homeToA = legsFor(store, tripId)[0];
  store.applyMutation(legInput(homeToA.id));
  const b = store.applyMutation(destinationInput(tripId, { city: "Kyoto" })).id;
  const c = store.applyMutation(destinationInput(tripId, { city: "Osaka" })).id;
  assert.equal(legsFor(store, tripId)[0].id, homeToA.id);
  assert.equal(legsFor(store, tripId)[0].priceCents, 10001);
  const oldLegs = legsFor(store, tripId);
  for (const leg of oldLegs) store.applyMutation(legInput(leg.id));
  store.applyMutation({ type: "destination.move", id: c, direction: "up" });
  const reordered = legsFor(store, tripId);
  assert.deepEqual(reordered.map((leg) => [leg.fromId, leg.toId]), [[null, a], [a, c], [c, b], [b, null]]);
  assert.equal(reordered[0].id, homeToA.id);
  assert.equal(reordered[0].priceCents, 10001);
  assert.ok(reordered.slice(1).every((leg) => leg.priceCents === null && !oldLegs.some((old) => old.id === leg.id)));
  const stable = store.getSnapshot();
  store.applyMutation({ type: "destination.move", id: a, direction: "up" });
  assert.deepEqual(store.getSnapshot(), stable, "moving beyond a route boundary is a no-op");
  store.applyMutation(candidateInput(c));
  store.applyMutation({ type: "destination.delete", id: c });
  assert.deepEqual(legsFor(store, tripId).map((leg) => [leg.fromId, leg.toId]), [[null, a], [a, b], [b, null]]);
  assert.equal(store.getSnapshot().candidates.length, 0);
  assert.deepEqual(store.getSnapshot().destinations.map((item) => item.position), [0, 1]);
  store.applyMutation({ type: "destination.delete", id: a });
  store.applyMutation({ type: "destination.delete", id: b });
  assert.equal(legsFor(store, tripId).length, 0);
});

test("home and city changes clear affected transport details; notes edits preserve them", (t) => {
  const { store, tripId } = setup(t);
  const a = store.applyMutation(destinationInput(tripId)).id;
  const b = store.applyMutation(destinationInput(tripId, { city: "Kyoto" })).id;
  const c = store.applyMutation(destinationInput(tripId, { city: "Osaka" })).id;
  for (const leg of legsFor(store, tripId)) store.applyMutation(legInput(leg.id));
  store.applyMutation(tripInput({ id: tripId, notes: "New notes" }));
  assert.ok(legsFor(store, tripId).every((leg) => leg.priceCents === 10001));
  store.applyMutation(tripInput({ id: tripId, homeCity: "Boston" }));
  assert.deepEqual(legsFor(store, tripId).map((leg) => leg.priceCents), [null, 10001, 10001, null]);
  for (const leg of legsFor(store, tripId)) store.applyMutation(legInput(leg.id));
  store.applyMutation(destinationInput(tripId, { id: b, city: "Nara" }));
  assert.deepEqual(legsFor(store, tripId).map((leg) => leg.priceCents), [10001, null, null, 10001]);
  assert.deepEqual(legsFor(store, tripId).map(pair), [[null, a], [a, b], [b, c], [c, null]].map((route) => JSON.stringify(route)));
});

test("budget totals use selected ideas, exact cents, and whole-party transport costs", (t) => {
  const { store, tripId } = setup(t);
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  const route = legsFor(store, tripId);
  store.applyMutation(legInput(route[0].id));
  store.applyMutation(legInput(route[1].id, { price: "20.25" }));
  const hotelId = store.applyMutation(candidateInput(destinationId)).id;
  const alternativeId = store.applyMutation(candidateInput(destinationId, { name: "Alternative", price: "9999", included: false })).id;
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Park", price: "0" }));
  store.applyMutation(candidateInput(destinationId, { category: "restaurants", name: "Lunch", price: "40.01" }));
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Maybe later", price: "", included: false }));
  const budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget, { totalCents: 36060, travelCents: 12026, hotelsCents: 20033, activitiesCents: 0, restaurantsCents: 4001, knownCount: 5, missingCount: 0, complete: true });
  store.applyMutation({ type: "candidate.include", id: alternativeId, included: true });
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === hotelId).included, false);
  assert.equal(store.getSnapshot().candidates.filter((item) => item.category === "hotels" && item.included).length, 1);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).hotelsCents, 999900);
  store.applyMutation(candidateInput(destinationId, { id: hotelId, included: true }));
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === alternativeId).included, false);
  assert.equal(formatMoney(36060), "$360.60");
  assert.equal(formatMoney(0), "$0");
});

test("incomplete budgets distinguish unknown values from a known zero", (t) => {
  const { store, tripId } = setup(t);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 1);
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 3);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).knownCount, 0);
  const hotelId = store.applyMutation(candidateInput(destinationId, { price: "" })).id;
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Unknown tour", price: "" }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 4);
  store.applyMutation(candidateInput(destinationId, { id: hotelId, price: "0" }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 3);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).knownCount, 1);
  store.applyMutation(tripInput({ id: tripId, homeCity: "" }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 4);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).complete, false);
});

test("runtime validation rejects malformed values without modifying saved information", (t) => {
  const { store, tripId } = setup(t);
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  store.applyMutation(candidateInput(destinationId));
  const before = store.getSnapshot();
  const invalidInputs = [
    null, [], { type: "unknown" }, { type: "trip.delete", id: "wrong" },
    tripInput({ travelers: 0 }), tripInput({ travelers: 1.5 }), tripInput({ travelers: "2" }),
    tripInput({ name: " " }), tripInput({ name: "a".repeat(121) }),
    candidateInput(destinationId, { included: "true" }), candidateInput(destinationId, { category: "flights" }),
    candidateInput(destinationId, { price: null }),
    ...["-1", "NaN", "Infinity", "1.234", "$1", "1,000", "1e2", "100000000.01"].map((price) => candidateInput(destinationId, { price })),
    ...["javascript:alert(1)", "data:text/html,hello", "ftp://example.com", "https://user:password@example.com"].map((url) => candidateInput(destinationId, { url })),
    candidateInput(destinationId, { notes: "x".repeat(8001) }),
    { type: "leg.save", id: randomUUID(), method: "Flight", price: "20", departure: "", arrival: "", url: "", notes: "" },
  ];
  for (const input of invalidInputs) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  const accepted = store.applyMutation(candidateInput(destinationId, { price: ".50", included: false })).id;
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === accepted).priceCents, 50);
});

test("updates cannot move records into unrelated trips, destinations, or lists", (t) => {
  const { store, tripId } = setup(t);
  const otherTripId = store.applyMutation(tripInput({ name: "Europe" })).id;
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  const otherDestinationId = store.applyMutation(destinationInput(otherTripId, { city: "Paris" })).id;
  const hotelId = store.applyMutation(candidateInput(destinationId)).id;
  const before = store.getSnapshot();
  for (const input of [
    destinationInput(otherTripId, { id: destinationId }),
    candidateInput(otherDestinationId, { id: hotelId }),
    candidateInput(destinationId, { id: hotelId, category: "activities" }),
    destinationInput(randomUUID()),
    candidateInput(randomUUID()),
  ]) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
});

test("saved trips, routes, and selected ideas survive closing and reopening the database", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
    store.applyMutation(candidateInput(destinationId));
    store.applyMutation(legInput(legsFor(store, tripId)[0].id));
    const before = store.getSnapshot();
    store.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    store.applyMutation({ type: "trip.delete", id: tripId });
    assert.equal(store.getSnapshot().candidates.length, 0);
  } finally {
    store.close();
  }
});

test("a database failure rolls back hotel deselection and every partial mutation", (t) => {
  const path = fileDatabase(t);
  const store = createStore(path);
  const observer = new DatabaseSync(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
    store.applyMutation(candidateInput(destinationId));
    const before = store.getSnapshot();
    observer.exec("CREATE TRIGGER reject_test_hotel BEFORE INSERT ON candidates WHEN NEW.name = 'Fail me' BEGIN SELECT RAISE(ABORT, 'Injected database failure'); END;");
    assert.throws(() => store.applyMutation(candidateInput(destinationId, { name: "Fail me" })), /Injected database failure/);
    assert.deepEqual(store.getSnapshot(), before, "the previously selected hotel stays selected after a failed replacement");
    store.applyMutation(candidateInput(destinationId, { name: "Working replacement" }));
    assert.equal(store.getSnapshot().candidates.filter((item) => item.included).length, 1);
  } finally {
    observer.close();
    store.close();
  }
});
