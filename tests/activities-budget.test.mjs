import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateActivitiesBudget, calculateBudget, calculateDestinationBudget } from "../src/lib/budget.ts";
import { createStore, ValidationError } from "../src/lib/store.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Activity planning", dateLabel: "2027", homeCity: "Boston", travelers: 2, notes: "", ...overrides });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Paris", stay: "A few nights", notes: "", ...overrides });
const activityInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "activities", name: "Museum", price: "12.25", address: "", url: "", notes: "", included: true, ...overrides });
const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  return { store, tripId: store.applyMutation(tripInput()).id };
}
function activities(store, id) {
  const snapshot = store.getSnapshot();
  return calculateActivitiesBudget(snapshot, snapshot.destinations.find((item) => item.id === id));
}
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-activities-budget-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}

test("itemized is the default; explicit switches preserve activities and the saved general budget", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId)).id;
  assert.equal(destination(store, id).activitiesBudgetMode, "itemized");
  assert.equal(destination(store, id).activitiesGeneralMinor, null);
  assert.equal(destination(store, id).activitiesCurrency, null);
  store.applyMutation(activityInput(id));
  store.applyMutation(activityInput(id, { name: "Undecided cost", price: "" }));
  store.applyMutation(activityInput(id, { name: "Unselected alternative", price: "9999", included: false }));
  const candidates = store.getSnapshot().candidates;
  const itemized = { mode: "itemized", totalsByCurrency: { USD: 1225 }, knownCount: 1, missingCount: 1, complete: false };
  assert.deepEqual(activities(store, id), itemized);
  const initialBudget = calculateBudget(store.getSnapshot(), tripId);
  store.applyMutation(destinationInput(tripId, { id, activitiesGeneralAmount: "80.25", activitiesCurrency: "EUR" }));
  assert.deepEqual(activities(store, id), itemized, "saving an amount does not choose its method");
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), initialBudget);
  store.applyMutation(destinationInput(tripId, { id, activitiesBudgetMode: "general" }));
  assert.deepEqual(activities(store, id), { mode: "general", totalsByCurrency: { EUR: 8025 }, knownCount: 1, missingCount: 0, complete: true });
  let budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.activitiesByCurrency, { EUR: 8025 });
  assert.equal(budget.activitiesCents, 0);
  assert.equal(budget.activitiesMissingCount, 0);
  assert.equal(budget.missingCount, initialBudget.missingCount - 1, "an excluded unpriced activity does not make the general budget incomplete");
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), id).totalsByCurrency, { EUR: 8025 });
  assert.deepEqual(store.getSnapshot().candidates, candidates);
  store.applyMutation(destinationInput(tripId, { id, activitiesBudgetMode: "itemized" }));
  assert.deepEqual(activities(store, id), itemized);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), initialBudget);
  assert.deepEqual(store.getSnapshot().candidates, candidates);
  assert.equal(destination(store, id).activitiesGeneralMinor, 8025);
  assert.equal(destination(store, id).activitiesCurrency, "EUR");
  store.applyMutation(destinationInput(tripId, { id, activitiesBudgetMode: "general" }));
  budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.activitiesByCurrency, { EUR: 8025 }, "switching back counts the saved estimate once");
});

test("adding, editing, selecting, and deleting activity ideas never switch the general method", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { activitiesBudgetMode: "general", activitiesGeneralAmount: "80", activitiesCurrency: "USD" })).id;
  const savedDestination = destination(store, id);
  const expected = activities(store, id);
  const verify = () => {
    assert.deepEqual(destination(store, id), savedDestination);
    assert.deepEqual(activities(store, id), expected);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).activitiesByCurrency, { USD: 8000 });
  };
  const first = store.applyMutation(activityInput(id, { price: "10" })).id;
  verify();
  const second = store.applyMutation(activityInput(id, { name: "Walking tour", price: "20", included: false })).id;
  verify();
  for (const input of [
    activityInput(id, { id: first, price: "15" }),
    { type: "candidate.include", id: second, included: true },
    { type: "candidate.include", id: first, included: false },
    { type: "candidate.delete", id: second },
    activityInput(id, { id: first, price: "18" }),
  ]) {
    store.applyMutation(input);
    verify();
  }
  store.applyMutation(destinationInput(tripId, { id, activitiesBudgetMode: "itemized" }));
  assert.deepEqual(activities(store, id), { mode: "itemized", totalsByCurrency: { USD: 1800 }, knownCount: 1, missingCount: 0, complete: true });
  assert.equal(destination(store, id).activitiesGeneralMinor, 8000);
});

test("missing general amounts and known zero remain distinct without requiring activity entries or dates", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { activitiesBudgetMode: "general" })).id;
  const missing = { mode: "general", totalsByCurrency: {}, knownCount: 0, missingCount: 1, complete: false };
  assert.deepEqual(activities(store, id), missing);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).activitiesMissingCount, 1);
  store.applyMutation(destinationInput(tripId, { id, activitiesGeneralAmount: "0", activitiesCurrency: "USD" }));
  assert.deepEqual(activities(store, id), { mode: "general", totalsByCurrency: { USD: 0 }, knownCount: 1, missingCount: 0, complete: true });
  assert.equal(destination(store, id).activitiesGeneralMinor, 0);
  assert.equal(destination(store, id).arrivalDate, null);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).activitiesByCurrency, { USD: 0 });
  store.applyMutation(destinationInput(tripId, { id, activitiesGeneralAmount: "  " }));
  assert.deepEqual(activities(store, id), missing);
  assert.equal(destination(store, id).activitiesGeneralMinor, null);
  assert.equal(destination(store, id).activitiesCurrency, "USD");
  store.applyMutation(destinationInput(tripId, { id, activitiesBudgetMode: "itemized" }));
  assert.deepEqual(activities(store, id), { mode: "itemized", totalsByCurrency: {}, knownCount: 0, missingCount: 0, complete: true });
  assert.equal(calculateBudget(store.getSnapshot(), tripId).activitiesMissingCount, 0);
  assert.deepEqual(store.getSnapshot().candidates, []);
});

test("the general amount covers the whole party and stay, independent of dates, stay notes, or travelers", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { activitiesBudgetMode: "general", activitiesGeneralAmount: "12.345", activitiesCurrency: "KWD" })).id;
  const expected = activities(store, id);
  for (const fields of [
    { arrivalDate: "2027-03-01", departureDate: "2027-03-01", stay: "Same-day visit" },
    { arrivalDate: "2027-03-01", departureDate: "2027-03-20", stay: "19 nights" },
    { arrivalDate: null, departureDate: null, stay: "An unknown number of months" },
    { notes: "Unrelated legacy edit" },
  ]) {
    store.applyMutation(destinationInput(tripId, { id, ...fields }));
    assert.deepEqual(activities(store, id), expected);
    assert.equal(destination(store, id).activitiesGeneralMinor, 12345);
  }
  for (const travelers of [1, 9, 999]) {
    store.applyMutation(tripInput({ id: tripId, travelers }));
    assert.deepEqual(activities(store, id), expected);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).activitiesByCurrency, { KWD: 12345 });
  }
});

test("activity totals respect currency minor units and isolate destinations and trips without double-counting", (t) => {
  const { store, tripId } = setup(t);
  const ids = [];
  for (const [currency, amount, minor] of [["USD", "10.01", 1001], ["eur", "2.05", 205], ["JPY", "101", 101], ["KWD", "1.001", 1001], ["EUR", "3.05", 305]]) {
    const id = store.applyMutation(destinationInput(tripId, {
      arrivalDate: "2027-03-01", departureDate: "2027-03-02",
      hotelNightlyAmount: "0", hotelCurrency: "USD", miscDailyAmount: "0", miscCurrency: "USD",
      activitiesBudgetMode: "general", activitiesGeneralAmount: amount, activitiesCurrency: currency,
    })).id;
    ids.push(id);
    assert.equal(destination(store, id).activitiesGeneralMinor, minor);
    assert.equal(destination(store, id).activitiesCurrency, currency.toUpperCase());
    store.applyMutation(activityInput(id, { price: "9999" }));
  }
  const itemizedId = store.applyMutation(destinationInput(tripId, {
    arrivalDate: "2027-03-01", departureDate: "2027-03-02", hotelNightlyAmount: "0", hotelCurrency: "USD", miscDailyAmount: "0", miscCurrency: "USD",
    activitiesGeneralAmount: "9999", activitiesCurrency: "EUR",
  })).id;
  store.applyMutation(activityInput(itemizedId, { price: "1.23" }));
  store.applyMutation(activityInput(ids[0], { category: "restaurants", name: "Lunch", price: "2" }));
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "1", departure: "", arrival: "", url: "", notes: "" });
  store.applyMutation({ type: "homeItem.save", tripId, name: "Pet care", price: "3", notes: "", completed: false });
  const otherTripId = store.applyMutation(tripInput({ name: "Other trip" })).id;
  const otherId = store.applyMutation(destinationInput(otherTripId, { activitiesBudgetMode: "general", activitiesGeneralAmount: "99999", activitiesCurrency: "EUR" })).id;
  store.applyMutation(activityInput(otherId, { price: "99999" }));
  const budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.activitiesByCurrency, { USD: 1124, EUR: 510, JPY: 101, KWD: 1001 });
  assert.deepEqual(budget.totalsByCurrency, { USD: 2324, EUR: 510, JPY: 101, KWD: 1001 });
  assert.equal(budget.activitiesCents, 1124);
  assert.equal(budget.totalCents, 2324);
  assert.equal(budget.activitiesMissingCount, 0);
  assert.equal(budget.complete, true);
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), ids[1]).totalsByCurrency, { USD: 0, EUR: 205 });
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), itemizedId).totalsByCurrency, { USD: 123 });
});

test("invalid modes, amounts, currency changes, and destination ownership reject the entire save", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { activitiesBudgetMode: "general", activitiesGeneralAmount: "100", activitiesCurrency: "USD" })).id;
  store.applyMutation(activityInput(id));
  const otherTripId = store.applyMutation(tripInput({ name: "Other trip" })).id;
  const before = store.getSnapshot();
  for (const fields of [
    ...["automatic", "", null, 1].map((activitiesBudgetMode) => ({ activitiesBudgetMode })),
    ...["-1", "NaN", "Infinity", "1e2", "1.234", "100000000.01"].map((activitiesGeneralAmount) => ({ activitiesGeneralAmount, activitiesCurrency: "USD" })),
    { activitiesGeneralAmount: "1.1", activitiesCurrency: "JPY" },
    { activitiesGeneralAmount: "1.0001", activitiesCurrency: "KWD" },
    { activitiesGeneralAmount: "0", activitiesCurrency: null },
    { activitiesGeneralAmount: "1", activitiesCurrency: "" },
    { activitiesGeneralAmount: null }, { activitiesGeneralAmount: 1 },
    { activitiesCurrency: "XYZ" }, { activitiesCurrency: 1 },
  ]) {
    for (const existingId of [undefined, id]) {
      assert.throws(() => store.applyMutation(destinationInput(tripId, { id: existingId, city: "Must not save", activitiesBudgetMode: "itemized", ...fields })), ValidationError);
      assert.deepEqual(store.getSnapshot(), before);
    }
  }
  for (const currency of ["JPY", null, ""]) {
    assert.throws(() => store.applyMutation(destinationInput(tripId, { id, activitiesCurrency: currency })), ValidationError);
    assert.deepEqual(store.getSnapshot(), before, "changing a saved amount's currency requires re-entering or clearing it");
  }
  for (const input of [
    destinationInput(otherTripId, { id, activitiesBudgetMode: "itemized" }),
    destinationInput(tripId, { id: randomUUID(), activitiesBudgetMode: "general" }),
  ]) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  store.applyMutation(destinationInput(tripId, { id, activitiesGeneralAmount: "120", activitiesCurrency: "JPY" }));
  assert.equal(destination(store, id).activitiesGeneralMinor, 120);
  store.applyMutation(destinationInput(tripId, { id, activitiesGeneralAmount: "" }));
  assert.equal(destination(store, id).activitiesCurrency, "JPY");
  store.applyMutation(destinationInput(tripId, { id, activitiesCurrency: "EUR" }));
  assert.equal(destination(store, id).activitiesCurrency, "EUR", "a currency alone may change when there is no saved amount");
  store.applyMutation(destinationInput(tripId, { id, activitiesCurrency: null }));
  assert.equal(destination(store, id).activitiesCurrency, null);
  store.applyMutation(destinationInput(tripId, { id, activitiesGeneralAmount: "100000000", activitiesCurrency: "KWD" }));
  assert.equal(destination(store, id).activitiesGeneralMinor, 100000000000);
});

test("both methods, saved estimates, activity selections, and totals survive reopening", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = store.applyMutation(destinationInput(tripId, { activitiesBudgetMode: "general", activitiesGeneralAmount: "12.345", activitiesCurrency: "KWD" })).id;
    store.applyMutation(activityInput(id));
    store.applyMutation(activityInput(id, { name: "Maybe", included: false, price: "" }));
    for (const mode of ["general", "itemized", "general"]) {
      store.applyMutation(destinationInput(tripId, { id, activitiesBudgetMode: mode }));
      const before = store.getSnapshot();
      const budget = calculateBudget(before, tripId);
      store.close();
      store = createStore(path);
      assert.deepEqual(store.getSnapshot(), before);
      assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
      assert.equal(destination(store, id).activitiesGeneralMinor, 12345);
      assert.equal(destination(store, id).activitiesCurrency, "KWD");
    }
  } finally { store.close(); }
});

test("schema 9 upgrades default to itemized without changing costs; replay preserves saved activities settings", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
  const tripId = store.applyMutation(tripInput()).id;
  const id = store.applyMutation(destinationInput(tripId, {
    arrivalDate: "2027-03-01", departureDate: "2027-03-04",
    hotelNightlyAmount: "125.25", hotelCurrency: "EUR", miscDailyAmount: "10.01", miscCurrency: "USD",
  })).id;
  store.applyMutation(activityInput(id));
  store.applyMutation(activityInput(id, { name: "Missing price", price: "" }));
  store.applyMutation(activityInput(id, { name: "Unselected", included: false, price: "900" }));
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId);
  store.close(); store = null;
  let observer = new DatabaseSync(path);
  observer.exec("ALTER TABLE destinations DROP COLUMN activitiesBudgetMode; ALTER TABLE destinations DROP COLUMN activitiesGeneralMinor; ALTER TABLE destinations DROP COLUMN activitiesCurrency; PRAGMA user_version = 9;");
  observer.close();
  store = createStore(path);
  assert.deepEqual(store.getSnapshot(), before);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
  assert.equal(destination(store, id).activitiesBudgetMode, "itemized");
  store.applyMutation(destinationInput(tripId, { id, activitiesBudgetMode: "general", activitiesGeneralAmount: "81.25", activitiesCurrency: "EUR" }));
  const saved = store.getSnapshot();
  const savedBudget = calculateBudget(saved, tripId);
  store.close(); store = null;
  observer = new DatabaseSync(path);
  assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 12);
  observer.exec("PRAGMA user_version = 9;");
  observer.close();
  store = createStore(path);
  assert.deepEqual(store.getSnapshot(), saved);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), savedBudget);
  observer = new DatabaseSync(path);
  try {
    assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 12);
    assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { observer.close(); }
  } finally { store?.close(); }
});
