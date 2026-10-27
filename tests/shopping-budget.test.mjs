import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget, calculateDestinationBudget } from "../src/lib/budget.ts";
import { createStore, ValidationError } from "../src/lib/store.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Shopping trip", dateLabel: "2027", homeCity: "Boston", travelers: 2, notes: "", ...overrides });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Paris", stay: "A few nights", notes: "", ...overrides });
const candidateInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "activities", name: "Museum", price: "3", address: "", url: "", notes: "", included: true, ...overrides });
const dates = { arrivalDate: "2027-03-01", departureDate: "2027-03-04" };
const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  return { store, tripId: store.applyMutation(tripInput()).id };
}
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-shopping-budget-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}

// Shopping is optional, unlike estimates that require a price before a budget is complete.
test("unset shopping adds neither cost nor missing estimate; explicit zero is a known contribution without dates", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId)).id;
  assert.equal(destination(store, id).shoppingMinor, null);
  assert.equal(destination(store, id).shoppingCurrency, null);
  const baseline = calculateBudget(store.getSnapshot(), tripId);
  const baselineDestination = calculateDestinationBudget(store.getSnapshot(), id);
  assert.deepEqual(baseline.shoppingByCurrency, {});
  assert.equal(baseline.missingCount, 4, "only two route legs, hotel, and miscellaneous are missing");
  store.applyMutation(destinationInput(tripId, { id, shoppingCurrency: "EUR" }));
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), baseline);
  store.applyMutation(destinationInput(tripId, { id, shoppingAmount: "0" }));
  const zero = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(zero.shoppingByCurrency, { EUR: 0 });
  assert.deepEqual(zero.totalsByCurrency, { EUR: 0 });
  assert.equal(zero.knownCount, baseline.knownCount + 1);
  assert.equal(zero.missingCount, baseline.missingCount);
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), id), { ...baselineDestination, totalsByCurrency: { EUR: 0 }, knownCount: baselineDestination.knownCount + 1 });
  store.applyMutation(destinationInput(tripId, { id, shoppingAmount: "  " }));
  assert.equal(destination(store, id).shoppingMinor, null);
  assert.equal(destination(store, id).shoppingCurrency, "EUR");
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), baseline);
  store.applyMutation(destinationInput(tripId, { id, shoppingCurrency: null }));
  assert.equal(destination(store, id).shoppingCurrency, null);
});

test("shopping edits, omitted fields, currency changes, zero, and clearing persist after reopening", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = store.applyMutation(destinationInput(tripId)).id;
    for (const [fields, minor, currency] of [
      [{ shoppingAmount: "12.345", shoppingCurrency: " kwd " }, 12345, "KWD"],
      [{ notes: "Edited by an older client" }, 12345, "KWD"],
      [{ shoppingAmount: "19.876" }, 19876, "KWD"],
      [{ shoppingAmount: "101", shoppingCurrency: "JPY" }, 101, "JPY"],
      [{ shoppingAmount: "0", shoppingCurrency: "EUR" }, 0, "EUR"],
      [{ shoppingAmount: "" }, null, "EUR"],
      [{ shoppingCurrency: "USD" }, null, "USD"],
      [{ shoppingAmount: "", shoppingCurrency: null }, null, null],
    ]) {
      store.applyMutation(destinationInput(tripId, { id, ...fields }));
      const before = store.getSnapshot();
      const budget = calculateBudget(before, tripId);
      store.close(); store = createStore(path);
      assert.deepEqual(store.getSnapshot(), before);
      assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
      assert.equal(destination(store, id).shoppingMinor, minor);
      assert.equal(destination(store, id).shoppingCurrency, currency);
    }
  } finally { store.close(); }
});

test("shopping is the whole-stay party total and stays independent of dates, travelers, stay notes, and miscellaneous", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, miscDailyAmount: "10", miscCurrency: "USD", shoppingAmount: "123.45", shoppingCurrency: "USD" })).id;
  const verify = (miscellaneous) => {
    const saved = destination(store, id);
    assert.equal(saved.shoppingMinor, 12345);
    assert.equal(saved.shoppingCurrency, "USD");
    const budget = calculateBudget(store.getSnapshot(), tripId);
    assert.deepEqual(budget.shoppingByCurrency, { USD: 12345 });
    assert.deepEqual(budget.miscellaneousByCurrency, miscellaneous ? { USD: miscellaneous } : {});
    assert.deepEqual(budget.totalsByCurrency, { USD: 12345 + miscellaneous });
    assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), id).totalsByCurrency, { USD: 12345 + miscellaneous });
  };
  verify(3000);
  store.applyMutation(destinationInput(tripId, { id, departureDate: "2027-03-01" })); verify(500);
  for (const travelers of [1, 9, 999]) { store.applyMutation(tripInput({ id: tripId, travelers })); verify(500); }
  store.applyMutation(destinationInput(tripId, { id, stay: "Several months", departureDate: "2027-03-11" })); verify(10000);
  store.applyMutation(destinationInput(tripId, { id, arrivalDate: null, departureDate: null })); verify(0);
  assert.equal(destination(store, id).miscDailyMinor, 1000, "shopping never replaces miscellaneous");
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "", miscCurrency: null })); verify(0);
  store.applyMutation(destinationInput(tripId, { id, shoppingAmount: "25" }));
  assert.equal(destination(store, id).miscDailyMinor, null);
  assert.equal(destination(store, id).miscCurrency, null);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).shoppingByCurrency, { USD: 2500 });
});

test("shopping contributes exactly once, sums matching currencies, separates other currencies and isolates trips", (t) => {
  const { store, tripId } = setup(t);
  const ids = [];
  for (const [shoppingCurrency, shoppingAmount, minor] of [["USD", "10.01", 1001], ["eur", "2.05", 205], ["JPY", "101", 101], ["KWD", "1.001", 1001], ["EUR", "3.05", 305]]) {
    const id = store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: "0", hotelCurrency: "USD", miscDailyAmount: "0", miscCurrency: "USD", shoppingAmount, shoppingCurrency })).id;
    ids.push(id);
    assert.equal(destination(store, id).shoppingMinor, minor);
    assert.equal(destination(store, id).shoppingCurrency, shoppingCurrency.toUpperCase());
    assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), id).totalsByCurrency, { USD: 0, [shoppingCurrency.toUpperCase()]: minor });
  }
  store.applyMutation(destinationInput(tripId, { id: ids[0], miscDailyAmount: "10" }));
  store.applyMutation(candidateInput(ids[0]));
  store.applyMutation(candidateInput(ids[0], { category: "restaurants", price: "4" }));
  store.applyMutation(candidateInput(ids[0], { price: "9999", included: false }));
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "1", departure: "", arrival: "", url: "", notes: "" });
  store.applyMutation({ type: "homeItem.save", tripId, name: "Pet care", price: "5", notes: "", completed: true });
  store.applyMutation({ type: "homeItem.save", tripId, name: "Pause mail", price: "", notes: "", completed: false });
  const otherTrip = store.applyMutation(tripInput({ name: "Other trip" })).id;
  store.applyMutation(destinationInput(otherTrip, { shoppingAmount: "99999", shoppingCurrency: "EUR" }));
  const budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.shoppingByCurrency, { USD: 1001, EUR: 510, JPY: 101, KWD: 1001 });
  assert.deepEqual(budget.miscellaneousByCurrency, { USD: 3000 });
  assert.deepEqual(budget.totalsByCurrency, { USD: 5801, EUR: 510, JPY: 101, KWD: 1001 });
  assert.equal(budget.totalCents, 5801);
  assert.equal(budget.activitiesCents, 300);
  assert.equal(budget.restaurantsCents, 400);
  assert.equal(budget.homeCents, 500);
  assert.equal(budget.travelCents, 600);
  assert.equal(budget.complete, true);
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), ids[0]).totalsByCurrency, { USD: 4701 });
});

test("invalid shopping amounts, precision, currencies and ownership reject the entire save", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { shoppingAmount: "25", shoppingCurrency: "USD" })).id;
  const otherTrip = store.applyMutation(tripInput({ name: "Other trip" })).id;
  const before = store.getSnapshot();
  for (const fields of [
    ...["-1", "NaN", "Infinity", "1e2", "1,000", "1.234", "100000000.01", null, 1].map((shoppingAmount) => ({ shoppingAmount, shoppingCurrency: "USD" })),
    { shoppingAmount: "1.1", shoppingCurrency: "JPY" }, { shoppingAmount: "1.0001", shoppingCurrency: "KWD" },
    { shoppingAmount: "0", shoppingCurrency: null }, { shoppingAmount: "1", shoppingCurrency: "" },
    { shoppingAmount: "1", shoppingCurrency: "XYZ" }, { shoppingCurrency: 1 },
  ]) {
    for (const existingId of [undefined, id]) {
      assert.throws(() => store.applyMutation(destinationInput(tripId, { id: existingId, city: "Must not save", ...fields })), ValidationError);
      assert.deepEqual(store.getSnapshot(), before);
    }
  }
  for (const input of [
    destinationInput(tripId, { shoppingAmount: "1" }),
    ...["JPY", "EUR", "", null].map((shoppingCurrency) => destinationInput(tripId, { id, shoppingCurrency })),
    destinationInput(otherTrip, { id, shoppingAmount: "5" }),
    destinationInput(tripId, { id: randomUUID(), shoppingAmount: "5", shoppingCurrency: "USD" }),
  ]) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  store.applyMutation(destinationInput(tripId, { id, shoppingAmount: "100000000", shoppingCurrency: "KWD" }));
  assert.equal(destination(store, id).shoppingMinor, 100000000000);
});

test("schema 11 upgrades preserve budgets, routes, ideas, images and at-home items; replay retains shopping", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = store.applyMutation(destinationInput(tripId, { ...dates, image: webp, hotelNightlyAmount: "125.25", hotelCurrency: "EUR", miscDailyAmount: "10.01", miscCurrency: "USD", activitiesBudgetMode: "general", activitiesGeneralAmount: "55.55", activitiesCurrency: "EUR", foodBudgetMode: "daily", foodDailyAmount: "20", foodCurrency: "USD" })).id;
    const candidateId = store.applyMutation(candidateInput(id, { image: webp, links: [{ id: randomUUID(), url: "https://example.com/museum", description: "Tickets" }] })).id;
    store.applyMutation({ type: "homeItem.save", tripId, name: "House sitting", price: "23.95", notes: "Leave a key", completed: false });
    for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Flight", price: "100", departure: "Morning", arrival: "Evening", url: "", notes: "Booked", itinerary: [{ id: randomUUID(), kind: "layover", place: "London", arrival: "10:00", departure: "12:00", notes: "" }], links: [{ id: randomUUID(), url: "https://example.com/flights", description: "Booking" }] });
    const before = store.getSnapshot();
    const budget = calculateBudget(before, tripId);
    const image = store.getDestinationImage(id);
    const candidateImage = store.getCandidateImage(candidateId);
    store.close(); store = null;
    let observer = new DatabaseSync(path);
    observer.exec("ALTER TABLE destinations DROP COLUMN shoppingMinor; ALTER TABLE destinations DROP COLUMN shoppingCurrency; PRAGMA user_version = 11;");
    observer.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    assert.deepEqual(store.getDestinationImage(id), image);
    assert.deepEqual(store.getCandidateImage(candidateId), candidateImage);
    store.applyMutation(destinationInput(tripId, { id, shoppingAmount: "12.345", shoppingCurrency: "KWD" }));
    const saved = store.getSnapshot();
    const savedBudget = calculateBudget(saved, tripId);
    store.close(); store = null;
    observer = new DatabaseSync(path);
    assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 13);
    observer.exec("PRAGMA user_version = 11;");
    observer.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), saved);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), savedBudget);
    assert.deepEqual(store.getDestinationImage(id), image);
    assert.deepEqual(store.getCandidateImage(candidateId), candidateImage);
    observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 13);
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});
