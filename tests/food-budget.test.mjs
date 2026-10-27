import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateFoodEstimate, calculateFoodBudget, calculateBudget, calculateDestinationBudget } from "../src/lib/budget.ts";
import { createStore, ValidationError } from "../src/lib/store.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Food planning", dateLabel: "2027", homeCity: "Boston", travelers: 2, notes: "", ...overrides });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Paris", stay: "A few nights", notes: "", ...overrides });
const restaurantInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "restaurants", name: "Lunch", price: "12.25", address: "", url: "", notes: "", included: true, ...overrides });
const dates = { arrivalDate: "2027-03-01", departureDate: "2027-03-04" };
const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
const food = (store, id) => calculateFoodBudget(store.getSnapshot(), destination(store, id));
const estimate = (overrides = {}) => calculateFoodEstimate({ ...dates, foodDailyMinor: 101, foodCurrency: "USD", ...overrides });
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  return { store, tripId: store.applyMutation(tripInput()).id };
}
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-food-budget-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}

test("food uses half-day endpoints and rounds once per destination in currency minor units", () => {
  for (const [departureDate, days, subtotalMinor] of [["2027-03-01", 0.5, 51], ["2027-03-02", 1, 101], ["2027-03-04", 3, 303]]) {
    assert.deepEqual(estimate({ departureDate }), { days, dailyMinor: 101, currency: "USD", subtotalMinor });
  }
  for (const [currency, minor, total] of [["USD", 1, 1], ["USD", 100, 50], ["JPY", 101, 51], ["KWD", 1001, 501], ["EUR", 0, 0]]) {
    assert.equal(estimate({ departureDate: dates.arrivalDate, foodDailyMinor: minor, foodCurrency: currency }).subtotalMinor, total);
  }
  assert.equal(estimate({ arrivalDate: "2027-03-13", departureDate: "2027-03-15" }).days, 2, "DST does not change calendar days");
  assert.equal(estimate({ arrivalDate: "2028-02-28", departureDate: "2028-03-01" }).days, 2);
  for (const fields of [{ foodDailyMinor: null }, { foodCurrency: null }, { arrivalDate: null }, { departureDate: null }, { foodDailyMinor: 0, arrivalDate: null }, { arrivalDate: "2027-03-05" }]) {
    assert.equal(estimate(fields).subtotalMinor, null, JSON.stringify(fields));
  }
  assert.equal(estimate({ foodDailyMinor: null }).days, 3);
  assert.equal(estimate({ departureDate: null }).dailyMinor, 101);
  assert.equal(estimate({ foodDailyMinor: Number.MAX_SAFE_INTEGER }).subtotalMinor, null, "an unsafe subtotal is never presented as exact money");
});

test("itemized defaults and explicit switches preserve restaurants and the saved daily estimate", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, dates)).id;
  assert.equal(destination(store, id).foodBudgetMode, "itemized");
  assert.equal(destination(store, id).foodDailyMinor, null);
  assert.equal(destination(store, id).foodCurrency, null);
  store.applyMutation(restaurantInput(id));
  store.applyMutation(restaurantInput(id, { name: "Unknown price", price: "" }));
  store.applyMutation(restaurantInput(id, { name: "Alternative", price: "9999", included: false }));
  const candidates = store.getSnapshot().candidates;
  const itemized = { mode: "itemized", totalsByCurrency: { USD: 1225 }, knownCount: 1, missingCount: 1, complete: false };
  assert.deepEqual(food(store, id), itemized);
  const initial = calculateBudget(store.getSnapshot(), tripId);
  store.applyMutation(destinationInput(tripId, { id, foodDailyAmount: "80.25", foodCurrency: "EUR" }));
  assert.deepEqual(food(store, id), itemized, "entering an estimate never changes the active method");
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), initial);
  store.applyMutation(destinationInput(tripId, { id, foodBudgetMode: "daily" }));
  assert.deepEqual(food(store, id), { mode: "daily", totalsByCurrency: { EUR: 24075 }, knownCount: 1, missingCount: 0, complete: true });
  const dailyBudget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(dailyBudget.foodByCurrency, { EUR: 24075 });
  assert.equal(dailyBudget.restaurantsCents, 0);
  assert.equal(dailyBudget.foodMissingCount, 0);
  assert.equal(dailyBudget.missingCount, initial.missingCount - 1);
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), id).totalsByCurrency, { EUR: 24075 });
  for (const mode of ["itemized", "daily"]) {
    store.applyMutation(destinationInput(tripId, { id, foodBudgetMode: mode }));
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), mode === "itemized" ? initial : dailyBudget);
    assert.deepEqual(store.getSnapshot().candidates, candidates);
    assert.equal(destination(store, id).foodDailyMinor, 8025);
    assert.equal(destination(store, id).foodCurrency, "EUR");
  }
});

test("adding, editing, selecting, deselecting, and removing restaurants never change either method", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, foodBudgetMode: "daily", foodDailyAmount: "80", foodCurrency: "USD" })).id;
  for (const mode of ["daily", "itemized"]) {
    store.applyMutation(destinationInput(tripId, { id, foodBudgetMode: mode }));
    const saved = destination(store, id);
    const verify = (itemizedCents) => {
      assert.deepEqual(destination(store, id), saved);
      assert.deepEqual(food(store, id).totalsByCurrency, { USD: mode === "daily" ? 24000 : itemizedCents });
      assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).foodByCurrency, { USD: mode === "daily" ? 24000 : itemizedCents });
    };
    const first = store.applyMutation(restaurantInput(id, { price: "10" })).id;
    verify(1000);
    const second = store.applyMutation(restaurantInput(id, { name: "Dinner", price: "20", included: false })).id;
    verify(1000);
    store.applyMutation(restaurantInput(id, { id: first, price: "15" })); verify(1500);
    store.applyMutation({ type: "candidate.include", id: second, included: true }); verify(3500);
    store.applyMutation({ type: "candidate.include", id: first, included: false }); verify(2000);
    store.applyMutation({ type: "candidate.delete", id: second });
    assert.deepEqual(destination(store, id), saved);
    assert.deepEqual(food(store, id).totalsByCurrency, mode === "daily" ? { USD: 24000 } : {});
    store.applyMutation({ type: "candidate.delete", id: first });
    assert.deepEqual(destination(store, id), saved);
  }
});

test("daily amount and explicit duration recalculate food while traveler count and stay notes do not", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, foodBudgetMode: "daily", foodDailyAmount: "10", foodCurrency: "USD" })).id;
  const assertTotal = (total) => {
    assert.equal(calculateFoodEstimate(destination(store, id)).subtotalMinor, total);
    assert.deepEqual(food(store, id).totalsByCurrency, { USD: total });
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).totalsByCurrency, { USD: total });
  };
  assertTotal(3000);
  store.applyMutation(destinationInput(tripId, { id, foodDailyAmount: "20" })); assertTotal(6000);
  store.applyMutation(destinationInput(tripId, { id, departureDate: "2027-03-02" })); assertTotal(2000);
  store.applyMutation(destinationInput(tripId, { id, departureDate: "2027-03-01" })); assertTotal(1000);
  for (const travelers of [1, 9, 999]) { store.applyMutation(tripInput({ id: tripId, travelers })); assertTotal(1000); }
  store.applyMutation(destinationInput(tripId, { id, stay: "Several months" })); assertTotal(1000);
  store.applyMutation(restaurantInput(id));
  store.applyMutation(destinationInput(tripId, { id, foodBudgetMode: "itemized" }));
  const itemized = food(store, id);
  store.applyMutation(destinationInput(tripId, { id, departureDate: "2027-03-04", foodDailyAmount: "30" }));
  assert.equal(calculateFoodEstimate(destination(store, id)).subtotalMinor, 9000);
  assert.deepEqual(food(store, id), itemized, "inactive estimate changes do not affect itemized totals");
  store.applyMutation(destinationInput(tripId, { id, foodBudgetMode: "daily" })); assertTotal(9000);
});

test("zero is known and clearing amount or duration is missing only in daily mode without requiring restaurants", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { foodBudgetMode: "daily" })).id;
  const missing = { mode: "daily", totalsByCurrency: {}, knownCount: 0, missingCount: 1, complete: false };
  assert.deepEqual(food(store, id), missing);
  store.applyMutation(destinationInput(tripId, { id, foodDailyAmount: "0", foodCurrency: "USD" }));
  assert.deepEqual(food(store, id), missing, "zero still requires a known duration");
  store.applyMutation(destinationInput(tripId, { id, ...dates }));
  assert.deepEqual(food(store, id), { mode: "daily", totalsByCurrency: { USD: 0 }, knownCount: 1, missingCount: 0, complete: true });
  assert.equal(calculateBudget(store.getSnapshot(), tripId).foodMissingCount, 0);
  store.applyMutation(destinationInput(tripId, { id, foodDailyAmount: "  " }));
  assert.deepEqual(food(store, id), missing);
  assert.equal(destination(store, id).foodDailyMinor, null);
  assert.equal(destination(store, id).foodCurrency, "USD");
  assert.equal(calculateBudget(store.getSnapshot(), tripId).foodMissingCount, 1);
  store.applyMutation(destinationInput(tripId, { id, foodBudgetMode: "itemized", foodCurrency: null, arrivalDate: null, departureDate: null }));
  assert.deepEqual(food(store, id), { mode: "itemized", totalsByCurrency: {}, knownCount: 0, missingCount: 0, complete: true });
  assert.equal(calculateBudget(store.getSnapshot(), tripId).foodMissingCount, 0);
  assert.deepEqual(store.getSnapshot().candidates, []);
});

test("food totals separate currencies, isolate trips, and never count inactive restaurants or estimates", (t) => {
  const { store, tripId } = setup(t);
  const ids = [];
  for (const [currency, amount, minor] of [["USD", "10.01", 1001], ["eur", "2.05", 205], ["JPY", "101", 101], ["KWD", "1.001", 1001], ["EUR", "3.05", 305]]) {
    const id = store.applyMutation(destinationInput(tripId, { ...dates, departureDate: dates.arrivalDate, hotelNightlyAmount: "0", hotelCurrency: "USD", miscDailyAmount: "0", miscCurrency: "USD", foodBudgetMode: "daily", foodDailyAmount: amount, foodCurrency: currency })).id;
    ids.push(id);
    assert.equal(destination(store, id).foodDailyMinor, minor);
    assert.equal(destination(store, id).foodCurrency, currency.toUpperCase());
    store.applyMutation(restaurantInput(id, { price: "9999" }));
    store.applyMutation(restaurantInput(id, { name: "Unknown", price: "" }));
  }
  const itemized = store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: "0", hotelCurrency: "USD", miscDailyAmount: "0", miscCurrency: "USD", foodDailyAmount: "9999", foodCurrency: "EUR" })).id;
  store.applyMutation(restaurantInput(itemized, { price: "1.23" }));
  store.applyMutation(restaurantInput(itemized, { price: "9999", included: false }));
  store.applyMutation(restaurantInput(ids[0], { category: "activities", price: "2" }));
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "1", departure: "", arrival: "", url: "", notes: "" });
  store.applyMutation({ type: "homeItem.save", tripId, name: "Pet care", price: "3", notes: "", completed: false });
  store.applyMutation({ type: "homeItem.save", tripId, name: "Pause mail", price: "", notes: "", completed: false });
  const otherTrip = store.applyMutation(tripInput({ name: "Other trip" })).id;
  store.applyMutation(destinationInput(otherTrip, { ...dates, foodBudgetMode: "daily", foodDailyAmount: "99999", foodCurrency: "EUR" }));
  const budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.foodByCurrency, { USD: 624, EUR: 256, JPY: 51, KWD: 501 });
  assert.deepEqual(budget.totalsByCurrency, { USD: 1824, EUR: 256, JPY: 51, KWD: 501 });
  assert.equal(budget.restaurantsCents, 624);
  assert.equal(budget.totalCents, 1824);
  assert.equal(budget.foodMissingCount, 0);
  assert.equal(budget.complete, true);
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), ids[1]).totalsByCurrency, { USD: 0, EUR: 103 });
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), itemized).totalsByCurrency, { USD: 123 });
});

test("invalid methods, amounts, currencies, dates, overflow and ownership reject the entire save", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, foodBudgetMode: "daily", foodDailyAmount: "100", foodCurrency: "USD" })).id;
  store.applyMutation(restaurantInput(id));
  const otherTrip = store.applyMutation(tripInput({ name: "Other trip" })).id;
  const before = store.getSnapshot();
  for (const fields of [
    ...["automatic", "general", "", null, 1].map((foodBudgetMode) => ({ foodBudgetMode })),
    ...["-1", "NaN", "Infinity", "1e2", "1.234", "100000000.01", null, 1].map((foodDailyAmount) => ({ foodDailyAmount, foodCurrency: "USD" })),
    { foodDailyAmount: "1.1", foodCurrency: "JPY" }, { foodDailyAmount: "1.0001", foodCurrency: "KWD" },
    { foodDailyAmount: "0", foodCurrency: null }, { foodDailyAmount: "1", foodCurrency: "" },
    { foodCurrency: "XYZ" }, { foodCurrency: 1 },
    { arrivalDate: "2027-02-29" }, { departureDate: "2027-02-28" },
    { arrivalDate: "0001-01-01", departureDate: "9999-12-31", foodDailyAmount: "100000000", foodCurrency: "KWD" },
  ]) {
    for (const existingId of [undefined, id]) {
      assert.throws(() => store.applyMutation(destinationInput(tripId, { ...dates, id: existingId, city: "Must not save", foodBudgetMode: "itemized", ...fields })), ValidationError);
      assert.deepEqual(store.getSnapshot(), before);
    }
  }
  for (const input of [
    ...["JPY", null, ""].map((foodCurrency) => destinationInput(tripId, { id, foodCurrency })),
    destinationInput(otherTrip, { id, foodBudgetMode: "itemized" }),
    destinationInput(tripId, { id: randomUUID(), foodBudgetMode: "daily" }),
  ]) { assert.throws(() => store.applyMutation(input), ValidationError); assert.deepEqual(store.getSnapshot(), before); }
  store.applyMutation(destinationInput(tripId, { id, foodDailyAmount: "100000000", foodCurrency: "KWD" }));
  const large = store.getSnapshot();
  assert.throws(() => store.applyMutation(destinationInput(tripId, { id, arrivalDate: "0001-01-01", departureDate: "9999-12-31" })), ValidationError);
  assert.deepEqual(store.getSnapshot(), large, "date-only edits also validate the saved daily subtotal");
  store.applyMutation(destinationInput(tripId, { id, foodDailyAmount: "120", foodCurrency: "JPY" }));
  assert.equal(destination(store, id).foodDailyMinor, 120);
  store.applyMutation(destinationInput(tripId, { id, foodDailyAmount: "" }));
  store.applyMutation(destinationInput(tripId, { id, foodCurrency: "EUR" }));
  assert.equal(destination(store, id).foodCurrency, "EUR", "currency alone may change when the amount is absent");
});

test("methods, saved daily amounts, restaurant selections and totals survive reopening", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = store.applyMutation(destinationInput(tripId, { ...dates, foodBudgetMode: "daily", foodDailyAmount: "12.345", foodCurrency: "KWD" })).id;
    store.applyMutation(restaurantInput(id));
    store.applyMutation(restaurantInput(id, { name: "Maybe", included: false, price: "" }));
    for (const mode of ["daily", "itemized", "daily"]) {
      store.applyMutation(destinationInput(tripId, { id, foodBudgetMode: mode }));
      const before = store.getSnapshot();
      const budget = calculateBudget(before, tripId);
      store.close(); store = createStore(path);
      assert.deepEqual(store.getSnapshot(), before);
      assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
      assert.equal(destination(store, id).foodDailyMinor, 12345);
      assert.equal(destination(store, id).foodCurrency, "KWD");
    }
  } finally { store.close(); }
});

test("schema 10 migration retains itemized costs and prior budget settings; replay preserves food settings", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: "125.25", hotelCurrency: "EUR", miscDailyAmount: "10.01", miscCurrency: "USD", activitiesBudgetMode: "general", activitiesGeneralAmount: "55.55", activitiesCurrency: "EUR" })).id;
    store.applyMutation(restaurantInput(id));
    store.applyMutation(restaurantInput(id, { name: "Unknown", price: "" }));
    store.applyMutation(restaurantInput(id, { name: "Alternative", price: "999", included: false }));
    const before = store.getSnapshot();
    const budget = calculateBudget(before, tripId);
    store.close(); store = null;
    let observer = new DatabaseSync(path);
    observer.exec("ALTER TABLE destinations DROP COLUMN foodBudgetMode; ALTER TABLE destinations DROP COLUMN foodDailyMinor; ALTER TABLE destinations DROP COLUMN foodCurrency; PRAGMA user_version = 10;");
    observer.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    assert.equal(destination(store, id).foodBudgetMode, "itemized");
    store.applyMutation(destinationInput(tripId, { id, foodBudgetMode: "daily", foodDailyAmount: "81.25", foodCurrency: "EUR" }));
    const saved = store.getSnapshot();
    const savedBudget = calculateBudget(saved, tripId);
    store.close(); store = null;
    observer = new DatabaseSync(path);
    assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 13);
    observer.exec("PRAGMA user_version = 10;");
    observer.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), saved);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), savedBudget);
    observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 13);
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});
