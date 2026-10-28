import assert from "node:assert/strict";
import test from "node:test";
import { calculateAccommodation, calculateBudget, calculateDestinationBudget, calculateHotelEstimate } from "../src/lib/budget.ts";
import { stayNights } from "../src/lib/destination-duration.ts";
import { createStore, ValidationError } from "../src/lib/store.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Hotel budget", dateLabel: "2027", homeCity: "Boston", travelers: 2, notes: "", ...overrides });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Paris", stay: "Dates to confirm", notes: "", ...overrides });
const candidateInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "hotels", name: "Selected hotel", price: "200.33", address: "", url: "", notes: "", included: true, ...overrides });
const dates = { arrivalDate: "2027-03-01", departureDate: "2027-03-04" };
const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  return { store, tripId: store.applyMutation(tripInput()).id };
}
function accommodation(store, id) {
  const snapshot = store.getSnapshot();
  return calculateAccommodation(snapshot, snapshot.destinations.find((item) => item.id === id));
}

test("hotel nights use exact calendar dates, including same-day visits, DST, and leap years", () => {
  for (const [arrival, departure, expected] of [
    ["2027-03-01", "2027-03-01", 0], ["2027-03-01", "2027-03-02", 1],
    ["2027-03-01", "2027-03-04", 3], ["2027-03-13", "2027-03-15", 2],
    ["2027-11-06", "2027-11-08", 2], ["2028-02-28", "2028-03-01", 2],
    ["2027-12-31", "2028-01-01", 1],
  ]) assert.equal(stayNights(arrival, departure), expected, `${arrival} to ${departure}`);
  for (const [arrival, departure] of [
    [null, null], [null, "2027-03-04"], ["2027-03-01", null],
    ["2027-03-04", "2027-03-01"], ["2027-02-29", "2027-03-01"],
    ["4 nights", "2027-03-04"], ["2027-03-01T00:00:00Z", "2027-03-04"],
  ]) assert.equal(stayNights(arrival, departure), null, `${arrival} to ${departure} is unknown or invalid`);
});

test("saved nightly hotel estimates respect the minor units of USD, EUR, JPY, and KWD", (t) => {
  const { store, tripId } = setup(t);
  for (const [currency, amount, nightlyMinor] of [["USD", "10.01", 1001], ["EUR", "2.05", 205], ["JPY", "101", 101], ["KWD", "1.001", 1001]]) {
    const id = store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: amount, hotelCurrency: currency })).id;
    const estimate = calculateHotelEstimate(destination(store, id));
    assert.deepEqual(estimate, { nights: 3, nightlyMinor, currency, subtotalMinor: nightlyMinor * 3 });
    assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), id).totalsByCurrency, { [currency]: nightlyMinor * 3 });
    assert.equal(accommodation(store, id).source, "estimate");
    assert.equal(accommodation(store, id).hotel, null);
  }
  const budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.hotelsByCurrency, { USD: 3003, EUR: 615, JPY: 303, KWD: 3003 });
  assert.deepEqual(budget.totalsByCurrency, budget.hotelsByCurrency);
  assert.equal(budget.hotelsCents, 3003, "legacy hotel cents contain only USD");
  assert.equal(budget.totalCents, 3003, "other currencies are never relabeled as USD");
  assert.equal(budget.hotelMissingCount, 0);
});

test("editing nightly amounts and dates recalculates accommodation while stay notes and party size do not", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: "100.25", hotelCurrency: "EUR" })).id;
  const assertTotal = (expected) => {
    assert.equal(accommodation(store, id).totalMinor, expected);
    assert.deepEqual(calculateDestinationBudget(store.getSnapshot(), id).totalsByCurrency, { EUR: expected });
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).hotelsByCurrency, { EUR: expected });
  };
  assertTotal(30075);
  store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "125.01" }));
  assertTotal(37503);
  store.applyMutation(destinationInput(tripId, { id, departureDate: "2027-03-06" }));
  assertTotal(62505);
  store.applyMutation(destinationInput(tripId, { id, stay: "One month, perhaps" }));
  store.applyMutation(tripInput({ id: tripId, travelers: 8 }));
  assertTotal(62505);
  store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "125.01", hotelCurrency: "USD" }));
  const budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.hotelsByCurrency, { USD: 62505 });
  assert.equal(budget.totalCents, 62505);
});

test("selecting, replacing, and deselecting hotels uses one accommodation contribution and preserves the saved estimate", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: "100.25", hotelCurrency: "EUR", miscDailyAmount: "2", miscCurrency: "USD" })).id;
  store.applyMutation(candidateInput(id, { category: "activities", name: "Museum", price: "12" }));
  store.applyMutation(candidateInput(id, { category: "restaurants", name: "Lunch", price: "8.50" }));
  const first = store.applyMutation(candidateInput(id, { included: false })).id;
  const second = store.applyMutation(candidateInput(id, { name: "Alternative", price: "400", included: false })).id;
  const assertTotals = (hotels, totals) => {
    const snapshot = store.getSnapshot();
    assert.deepEqual(calculateBudget(snapshot, tripId).hotelsByCurrency, hotels);
    assert.deepEqual(calculateBudget(snapshot, tripId).totalsByCurrency, totals);
    assert.deepEqual(calculateDestinationBudget(snapshot, id).totalsByCurrency, totals);
    assert.equal(destination(store, id).hotelNightlyMinor, 10025);
    assert.equal(destination(store, id).hotelCurrency, "EUR");
  };
  assertTotals({ EUR: 30075 }, { EUR: 30075, USD: 2650 });
  store.applyMutation({ type: "candidate.include", id: first, included: true });
  assert.equal(accommodation(store, id).source, "selectedHotel");
  assert.equal(accommodation(store, id).hotel.id, first);
  assert.equal(accommodation(store, id).estimate.subtotalMinor, 30075);
  assertTotals({ USD: 20033 }, { USD: 22683 });
  store.applyMutation({ type: "candidate.include", id: second, included: true });
  assert.deepEqual(store.getSnapshot().candidates.filter((item) => item.category === "hotels" && item.included).map((item) => item.id), [second]);
  assertTotals({ USD: 40000 }, { USD: 42650 });
  store.applyMutation({ type: "candidate.include", id: first, included: false });
  assertTotals({ USD: 40000 }, { USD: 42650 });
  store.applyMutation({ type: "candidate.include", id: second, included: false });
  assert.equal(accommodation(store, id).source, "estimate");
  assertTotals({ EUR: 30075 }, { EUR: 30075, USD: 2650 });
});

test("an unknown selected hotel price replaces a known estimate, and deleting it restores the current estimate", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: "100", hotelCurrency: "EUR" })).id;
  const first = store.applyMutation(candidateInput(id)).id;
  const second = store.applyMutation(candidateInput(id, { name: "Price to confirm", price: "" })).id;
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === first).included, false, "saving a selected alternative replaces the previous choice");
  assert.equal(accommodation(store, id).source, "selectedHotel");
  assert.equal(accommodation(store, id).totalMinor, null);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).hotelMissingCount, 1);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).hotelsByCurrency, {});
  store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "125", departureDate: "2027-03-06" }));
  assert.equal(accommodation(store, id).estimate.subtotalMinor, 62500);
  assert.equal(accommodation(store, id).totalMinor, null, "editing the saved estimate does not replace the selected hotel's unknown price");
  store.applyMutation(candidateInput(id, { id: second, name: "Complimentary stay", price: "0" }));
  assert.equal(accommodation(store, id).totalMinor, 0);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).hotelsByCurrency, { USD: 0 });
  assert.equal(calculateBudget(store.getSnapshot(), tripId).hotelMissingCount, 0);
  store.applyMutation({ type: "candidate.delete", id: second });
  assert.equal(accommodation(store, id).source, "estimate");
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).hotelsByCurrency, { EUR: 62500 });
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === first).included, false, "deleting a selected hotel does not select an alternative");
});

test("deselecting the last hotel restores the saved rate using dates edited while it was selected", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: "100", hotelCurrency: "EUR" })).id;
  const hotelId = store.applyMutation(candidateInput(id)).id;
  store.applyMutation(destinationInput(tripId, { id, departureDate: "2027-03-08" }));
  assert.equal(accommodation(store, id).totalMinor, 20033);
  assert.equal(accommodation(store, id).estimate.subtotalMinor, 70000);
  store.applyMutation({ type: "candidate.include", id: hotelId, included: false });
  assert.equal(accommodation(store, id).totalMinor, 70000);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).hotelsByCurrency, { EUR: 70000 });
  assert.equal(destination(store, id).hotelNightlyMinor, 10000);
});

test("zero and a known same-day stay are valid, but missing rates, currencies, or nights stay unknown", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: "0", hotelCurrency: "JPY" })).id;
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).hotelsByCurrency, { JPY: 0 });
  assert.equal(calculateBudget(store.getSnapshot(), tripId).hotelMissingCount, 0);
  store.applyMutation(destinationInput(tripId, { id, departureDate: null }));
  assert.equal(accommodation(store, id).totalMinor, null, "zero rate with unknown nights is not a calculated zero");
  assert.equal(calculateBudget(store.getSnapshot(), tripId).hotelMissingCount, 1);
  store.applyMutation(destinationInput(tripId, { id, departureDate: dates.arrivalDate, hotelNightlyAmount: "200" }));
  assert.deepEqual(calculateHotelEstimate(destination(store, id)), { nights: 0, nightlyMinor: 200, currency: "JPY", subtotalMinor: 0 });
  assert.equal(calculateBudget(store.getSnapshot(), tripId).hotelMissingCount, 0);
  store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "" }));
  assert.equal(accommodation(store, id).estimate.nights, 0);
  assert.equal(accommodation(store, id).totalMinor, null, "zero nights with missing rate is still unknown");
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).hotelsByCurrency, {});
  store.applyMutation(destinationInput(tripId, { id, hotelCurrency: null, arrivalDate: null }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).hotelMissingCount, 1, "several missing accommodation inputs count once");
  assert.equal(calculateHotelEstimate({ ...dates, hotelNightlyMinor: 1000, hotelCurrency: null }).subtotalMinor, null);
  const hotelId = store.applyMutation(candidateInput(id, { price: "0" })).id;
  assert.equal(accommodation(store, id).totalMinor, 0, "a selected whole-stay price does not need destination dates");
  store.applyMutation({ type: "candidate.include", id: hotelId, included: false });
  assert.equal(accommodation(store, id).totalMinor, null);
});

test("hotel estimates coexist with other selected costs, optional home prices, and other trips without double-counting", (t) => {
  const { store, tripId } = setup(t);
  const ids = [];
  for (const [currency, amount] of [["USD", "10.01"], ["EUR", "2.05"], ["JPY", "101"], ["KWD", "1.001"]]) {
    ids.push(store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: amount, hotelCurrency: currency, miscDailyAmount: "0", miscCurrency: "USD" })).id);
  }
  store.applyMutation(candidateInput(ids[0], { category: "activities", name: "Museum", price: "1.23" }));
  store.applyMutation(candidateInput(ids[0], { category: "restaurants", name: "Snack", price: "2.34" }));
  store.applyMutation(candidateInput(ids[0], { name: "Unselected alternative", price: "99999", included: false }));
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "1.01", departure: "", arrival: "", url: "", notes: "" });
  for (const [name, price] of [["Pet care", "2.02"], ["Pause mail", ""], ["Free task", "0"]]) {
    store.applyMutation({ type: "homeItem.save", tripId, name, price, notes: "", completed: false });
  }
  const otherTripId = store.applyMutation(tripInput({ name: "Other trip" })).id;
  const otherId = store.applyMutation(destinationInput(otherTripId, { ...dates, hotelNightlyAmount: "9999", hotelCurrency: "EUR" })).id;
  store.applyMutation(candidateInput(otherId, { price: "9999" }));
  const budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget.hotelsByCurrency, { USD: 3003, EUR: 615, JPY: 303, KWD: 3003 });
  assert.deepEqual(budget.totalsByCurrency, { USD: 4067, EUR: 615, JPY: 303, KWD: 3003 });
  assert.equal(budget.totalCents, 4067);
  assert.equal(budget.hotelsCents, 3003);
  assert.equal(budget.travelCents, 505);
  assert.equal(budget.activitiesCents, 123);
  assert.equal(budget.restaurantsCents, 234);
  assert.equal(budget.homeCents, 202);
  assert.equal(budget.knownCount, 17);
  assert.equal(budget.hotelMissingCount, 0);
  assert.equal(budget.missingCount, 0);
  assert.equal(budget.complete, true);
});

test("negative nightly amounts are rejected without altering saved amounts, selections, or totals", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, hotelNightlyAmount: "100", hotelCurrency: "EUR" })).id;
  store.applyMutation(candidateInput(id));
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "-1" })), ValidationError);
  assert.deepEqual(store.getSnapshot(), before);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).hotelsByCurrency, { USD: 20033 });
});
