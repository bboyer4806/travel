import assert from "node:assert/strict";
import test from "node:test";
import { calculateBudget, calculateDestinationBudget, calculateMiscellaneous } from "../src/lib/budget.ts";
import { budgetDays } from "../src/lib/destination-duration.ts";
import { createStore } from "../src/lib/store.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Miscellaneous budget", dateLabel: "2027", homeCity: "Boston", travelers: 2, notes: "", ...overrides });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Paris", stay: "Dates to confirm", arrivalDate: "2027-03-01", departureDate: "2027-03-04", miscDailyAmount: "10.01", miscCurrency: "USD", notes: "", ...overrides });
const candidateInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "hotels", name: "Selected hotel", price: "0", address: "", url: "", notes: "", included: true, ...overrides });
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  return { store, tripId: store.applyMutation(tripInput()).id };
}
const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
const calculation = (overrides = {}) => calculateMiscellaneous({ arrivalDate: "2027-03-01", departureDate: "2027-03-01", miscDailyMinor: 101, miscCurrency: "USD", ...overrides });

test("budget days count half-day endpoints using calendar dates, including DST and leap years", () => {
  for (const [arrival, departure, expected] of [
    ["2027-03-01", "2027-03-01", 0.5],
    ["2027-03-01", "2027-03-02", 1],
    ["2027-03-01", "2027-03-04", 3],
    ["2027-03-13", "2027-03-15", 2],
    ["2027-11-06", "2027-11-08", 2],
    ["2028-02-28", "2028-03-01", 2],
    ["2027-02-28", "2027-03-01", 1],
    ["2027-12-31", "2028-01-01", 1],
    ["0099-12-31", "0100-01-01", 1],
  ]) assert.equal(budgetDays(arrival, departure), expected, `${arrival} to ${departure}`);
  for (const [arrival, departure] of [
    [null, "2027-03-01"], ["2027-03-01", null], [null, null],
    ["2027-03-02", "2027-03-01"], ["2027-02-29", "2027-03-01"],
    ["2027-04-31", "2027-05-01"], ["0000-01-01", "0001-01-01"],
    ["2027-3-1", "2027-03-04"], ["2027-03-01T00:00:00Z", "2027-03-04"],
    ["4 nights", "2027-03-04"], ["", ""],
  ]) assert.equal(budgetDays(arrival, departure), null, `${arrival} to ${departure} is unknown or invalid`);
});

test("miscellaneous totals round half minor units up once per destination in every currency", () => {
  assert.deepEqual(calculation(), { days: 0.5, dailyMinor: 101, currency: "USD", subtotalMinor: 51 });
  assert.equal(calculation({ miscDailyMinor: 1 }).subtotalMinor, 1);
  assert.equal(calculation({ miscDailyMinor: 100 }).subtotalMinor, 50);
  assert.equal(calculation({ miscCurrency: "JPY" }).subtotalMinor, 51);
  assert.equal(calculation({ miscDailyMinor: 1001, miscCurrency: "KWD" }).subtotalMinor, 501);
  assert.equal(calculation({ departureDate: "2027-03-02" }).subtotalMinor, 101);
  assert.equal(calculation({ departureDate: "2027-03-04" }).subtotalMinor, 303);
  assert.equal(calculation({ miscDailyMinor: 0 }).subtotalMinor, 0);
});

test("missing amount, currency, or duration never creates a calculated zero", () => {
  for (const fields of [
    { miscDailyMinor: null }, { miscCurrency: null }, { arrivalDate: null }, { departureDate: null },
    { miscDailyMinor: 0, arrivalDate: null }, { miscDailyMinor: 0, miscCurrency: null },
    { miscDailyMinor: null, miscCurrency: null, arrivalDate: null, departureDate: null },
  ]) assert.equal(calculation(fields).subtotalMinor, null);
  assert.equal(calculation({ miscDailyMinor: null }).days, 0.5, "known dates remain visible before entering an amount");
  assert.equal(calculation({ departureDate: null }).dailyMinor, 101, "an entered daily rate remains visible without a duration");
});

test("destination and trip budgets add miscellaneous spending once, keep currencies separate, and include only selected ideas", (t) => {
  const { store, tripId } = setup(t);
  const a = store.applyMutation(destinationInput(tripId)).id;
  const b = store.applyMutation(destinationInput(tripId, { city: "Rome", departureDate: "2027-03-01", miscDailyAmount: "2.05", miscCurrency: "EUR" })).id;
  const c = store.applyMutation(destinationInput(tripId, { city: "Tokyo", departureDate: "2027-03-01", miscDailyAmount: "101", miscCurrency: "JPY" })).id;
  const d = store.applyMutation(destinationInput(tripId, { city: "Kuwait City", departureDate: "2027-03-01", miscDailyAmount: "1.001", miscCurrency: "KWD" })).id;
  const e = store.applyMutation(destinationInput(tripId, { city: "New York", departureDate: "2027-03-01", miscDailyAmount: ".01" })).id;
  store.applyMutation(candidateInput(a, { price: "200.33" }));
  store.applyMutation(candidateInput(a, { name: "Unselected alternative", price: "9999", included: false }));
  store.applyMutation(candidateInput(a, { category: "activities", name: "Park", price: "0" }));
  store.applyMutation(candidateInput(a, { category: "restaurants", name: "Lunch", price: "40.01" }));
  store.applyMutation(candidateInput(a, { category: "activities", name: "Unselected activity", price: "", included: false }));
  for (const id of [b, c, d, e]) store.applyMutation(candidateInput(id));
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "1.01", departure: "", arrival: "", url: "", notes: "" });
  store.applyMutation({ type: "homeItem.save", tripId, name: "Pet care", price: "2.02", notes: "", completed: false });
  const otherTrip = store.applyMutation(tripInput({ name: "Other trip" })).id;
  const otherDestination = store.applyMutation(destinationInput(otherTrip, { miscDailyAmount: "9999", miscCurrency: "JPY" })).id;
  store.applyMutation(candidateInput(otherDestination, { price: "9999" }));

  const snapshot = store.getSnapshot();
  assert.deepEqual(calculateDestinationBudget(snapshot, a), { totalsByCurrency: { USD: 27037 }, knownCount: 4, missingCount: 0, complete: true });
  assert.deepEqual(calculateDestinationBudget(snapshot, b), { totalsByCurrency: { USD: 0, EUR: 103 }, knownCount: 2, missingCount: 0, complete: true });
  const budget = calculateBudget(snapshot, tripId);
  assert.deepEqual(budget.miscellaneousByCurrency, { USD: 3004, EUR: 103, JPY: 51, KWD: 501 });
  assert.deepEqual(budget.totalsByCurrency, { USD: 27846, EUR: 103, JPY: 51, KWD: 501 });
  assert.equal(budget.totalCents, 27846, "the compatibility total remains USD only");
  assert.equal(budget.hotelsCents, 20033);
  assert.equal(budget.activitiesCents, 0);
  assert.equal(budget.restaurantsCents, 4001);
  assert.equal(budget.travelCents, 606);
  assert.equal(budget.homeCents, 202);
  assert.equal(budget.knownCount, 19);
  assert.equal(budget.missingCount, 0);
  assert.equal(budget.miscMissingCount, 0);
  assert.equal(budget.complete, true);
});

test("amount and date edits recalculate budgets while traveler count and free-text stay do not", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { departureDate: "2027-03-02", miscDailyAmount: "10" })).id;
  const assertTotal = (expected) => {
    assert.equal(calculateMiscellaneous(destination(store, id)).subtotalMinor, expected);
    assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), id).totalsByCurrency, { USD: expected });
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).totalsByCurrency, { USD: expected });
  };
  assertTotal(1000);
  store.applyMutation(destinationInput(tripId, { id, departureDate: "2027-03-02", miscDailyAmount: "20" }));
  assertTotal(2000);
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "20" }));
  assertTotal(6000);
  const before = calculateBudget(store.getSnapshot(), tripId);
  store.applyMutation(tripInput({ id: tripId, travelers: 12 }));
  store.applyMutation({ type: "destination.save", id, tripId, city: "Paris", stay: "A month or two", notes: "" });
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), before);
  assertTotal(6000);
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "20", miscCurrency: "EUR" }));
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).totalsByCurrency, { EUR: 6000 });
  assert.equal(calculateBudget(store.getSnapshot(), tripId).totalCents, 0, "a non-USD subtotal is not relabeled as USD");
});

test("zero remains known, clearing an amount or duration makes the miscellaneous estimate incomplete", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { miscDailyAmount: "0", miscCurrency: "JPY" })).id;
  let budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.miscellaneousByCurrency, { JPY: 0 });
  assert.deepEqual(budget.totalsByCurrency, { JPY: 0 });
  assert.equal(budget.miscMissingCount, 0);
  assert.equal(budget.knownCount, 1);
  assert.equal(budget.missingCount, 3, "only the hotel and two travel legs are unknown");
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "0", miscCurrency: "JPY", departureDate: null }));
  budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.totalsByCurrency, {});
  assert.deepEqual(budget.miscellaneousByCurrency, {});
  assert.equal(budget.miscMissingCount, 1);
  assert.equal(budget.missingCount, 4);
  assert.equal(budget.knownCount, 0);
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "", miscCurrency: null, arrivalDate: null, departureDate: null }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 4, "a destination with several missing misc fields counts once");
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), id), { totalsByCurrency: {}, knownCount: 0, missingCount: 2, complete: false });
});

test("partial miscellaneous estimates retain known totals and identify the unknown destination", (t) => {
  const { store, tripId } = setup(t);
  store.applyMutation(destinationInput(tripId));
  const unknown = store.applyMutation(destinationInput(tripId, { city: "Undecided", miscDailyAmount: "", arrivalDate: null, departureDate: null })).id;
  const budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.miscellaneousByCurrency, { USD: 3003 });
  assert.deepEqual(budget.totalsByCurrency, { USD: 3003 });
  assert.equal(budget.miscMissingCount, 1);
  assert.equal(budget.missingCount, 6, "three travel legs, two hotels, and one miscellaneous estimate are unknown");
  assert.equal(budget.complete, false);
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), unknown), { totalsByCurrency: {}, knownCount: 0, missingCount: 2, complete: false });
  assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), "missing"), { totalsByCurrency: {}, knownCount: 0, missingCount: 1, complete: false });
  assert.equal(calculateBudget(store.getSnapshot(), "missing").complete, false);
});
