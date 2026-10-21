import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { budgetDays, stayNights } from "../src/lib/destination-duration.ts";
import { parseMinorAmount } from "../src/lib/money.ts";
import { createStore, ValidationError } from "../src/lib/store.ts";

const tripInput = { type: "trip.save", name: "Hotel planning", dateLabel: "2027", homeCity: "Boston", travelers: 2, notes: "" };
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Paris", stay: "Dates to confirm", notes: "", ...overrides });
const hotelInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "hotels", name: "Chosen hotel", price: "500", address: "", url: "", notes: "", included: true, ...overrides });
const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  return { store, tripId: store.applyMutation(tripInput).id };
}
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-hotel-budget-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}

test("hotel nights use calendar dates while miscellaneous keeps its same-day allowance", () => {
  for (const [arrival, departure, expected] of [
    ["2027-03-01", "2027-03-01", 0], ["2027-03-01", "2027-03-04", 3],
    ["2027-03-13", "2027-03-15", 2], ["2027-11-06", "2027-11-08", 2],
    ["2028-02-28", "2028-03-01", 2], ["2027-02-28", "2027-03-01", 1],
    ["0099-12-31", "0100-01-01", 1],
  ]) assert.equal(stayNights(arrival, departure), expected);
  assert.equal(budgetDays("2027-03-01", "2027-03-01"), 0.5);
  for (const [arrival, departure] of [
    [null, null], [undefined, "2027-03-01"], ["2027-03-01", ""],
    ["2027-03-02", "2027-03-01"], ["2027-02-29", "2027-03-01"],
    ["4 nights", "2027-03-04"], ["0000-01-01", "0001-01-01"],
  ]) assert.equal(stayNights(arrival, departure), null);
});

test("nightly amounts use currency precision, retain zero, and allow unknown amount and dates", (t) => {
  const { store, tripId } = setup(t);
  for (const [amount, currency, expected] of [["120.05", "eur", 12005], ["101", "JPY", 101], ["1.001", "KWD", 1001], ["0", "USD", 0]]) {
    const id = store.applyMutation(destinationInput(tripId, { hotelNightlyAmount: amount, hotelCurrency: currency })).id;
    const saved = destination(store, id);
    assert.equal(saved.hotelNightlyMinor, expected);
    assert.equal(saved.hotelCurrency, currency.toUpperCase());
    assert.equal(saved.arrivalDate, null);
    assert.equal(saved.departureDate, null);
  }
  const id = store.applyMutation(destinationInput(tripId)).id;
  assert.equal(destination(store, id).hotelNightlyMinor, null);
  assert.equal(destination(store, id).hotelCurrency, null);
  store.applyMutation(destinationInput(tripId, { id, hotelCurrency: "EUR" }));
  assert.equal(destination(store, id).hotelNightlyMinor, null);
  assert.equal(destination(store, id).hotelCurrency, "EUR");
});

test("legacy saves preserve estimates and currency changes require re-entering or clearing the amount", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { arrivalDate: "2027-03-01", departureDate: "2027-03-04", hotelNightlyAmount: "120.05", hotelCurrency: "EUR", miscDailyAmount: "10", miscCurrency: "USD" })).id;
  const original = destination(store, id);
  store.applyMutation(destinationInput(tripId, { id, notes: "An older client changed this note", image: null }));
  assert.deepEqual(destination(store, id), { ...original, notes: "An older client changed this note" });
  const before = store.getSnapshot();
  for (const currency of ["JPY", null, ""]) {
    assert.throws(() => store.applyMutation(destinationInput(tripId, { id, hotelCurrency: currency })), /Re-enter or clear the nightly hotel amount/);
    assert.deepEqual(store.getSnapshot(), before);
  }
  store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "120", hotelCurrency: "JPY" }));
  assert.equal(destination(store, id).hotelNightlyMinor, 120);
  assert.equal(destination(store, id).hotelCurrency, "JPY");
  store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "" }));
  assert.equal(destination(store, id).hotelNightlyMinor, null);
  assert.equal(destination(store, id).hotelCurrency, "JPY", "clearing the amount alone preserves its chosen currency");
  store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "", hotelCurrency: null }));
  assert.equal(destination(store, id).hotelCurrency, null);
  assert.equal(destination(store, id).miscDailyMinor, 1000);
  assert.equal(destination(store, id).miscCurrency, "USD");
});

test("invalid hotel estimates reject the whole save with hotel-specific errors", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { hotelNightlyAmount: "100", hotelCurrency: "USD" })).id;
  const before = store.getSnapshot();
  for (const fields of [
    ...["-1", "NaN", "Infinity", "1e2", "1.234", "100000000.01"].map((hotelNightlyAmount) => ({ hotelNightlyAmount, hotelCurrency: "USD" })),
    { hotelNightlyAmount: "1.1", hotelCurrency: "JPY" }, { hotelNightlyAmount: "1.0001", hotelCurrency: "KWD" },
    { hotelNightlyAmount: "1", hotelCurrency: null }, { hotelNightlyAmount: "0", hotelCurrency: "" },
    { hotelNightlyAmount: null }, { hotelNightlyAmount: 1 }, { hotelCurrency: "XYZ" }, { hotelCurrency: 1 },
    { hotelNightlyAmount: "100000000", hotelCurrency: "KWD", arrivalDate: "0001-01-01", departureDate: "9999-12-31" },
  ]) {
    assert.throws(() => store.applyMutation(destinationInput(tripId, { id, notes: "Must not save", ...fields })), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  assert.throws(() => store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "-1" })), /Nightly hotel amount must be positive or zero/);
  assert.throws(() => parseMinorAmount("-1", "USD"), /Daily miscellaneous amount must be positive or zero/, "the shared parser retains existing miscellaneous error copy");
  store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "100000000", hotelCurrency: "KWD" }));
  const withoutDates = store.getSnapshot();
  assert.throws(() => store.applyMutation(destinationInput(tripId, { id, arrivalDate: "0001-01-01", departureDate: "9999-12-31" })), /hotel estimate is too large/);
  assert.deepEqual(store.getSnapshot(), withoutDates, "date-only edits also validate the saved rate's product");
});

test("nightly estimate and hotel selection persist independently through replacement, deselection, and reopening", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput).id;
    const id = store.applyMutation(destinationInput(tripId, { arrivalDate: "2027-03-01", departureDate: "2027-03-04", hotelNightlyAmount: "120.05", hotelCurrency: "EUR" })).id;
    const savedEstimate = destination(store, id);
    const first = store.applyMutation(hotelInput(id)).id;
    const second = store.applyMutation(hotelInput(id, { name: "Replacement", price: "", included: false })).id;
    store.applyMutation({ type: "candidate.include", id: second, included: true });
    assert.equal(store.getSnapshot().candidates.find((item) => item.id === first).included, false);
    assert.deepEqual(destination(store, id), savedEstimate);
    const selected = store.getSnapshot();
    store.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), selected);
    store.applyMutation({ type: "candidate.include", id: second, included: false });
    assert.deepEqual(destination(store, id), savedEstimate);
    assert.equal(store.getSnapshot().candidates.some((item) => item.included), false);
    store.applyMutation(hotelInput(id, { id: first }));
    store.applyMutation({ type: "candidate.delete", id: first });
    assert.deepEqual(destination(store, id), savedEstimate);
  } finally { store.close(); }
});

test("schema 8 upgrades preserve destinations and selections; replay retains saved hotel estimates", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  const tripId = store.applyMutation(tripInput).id;
  const id = store.applyMutation(destinationInput(tripId, { arrivalDate: "2027-03-01", departureDate: "2027-03-04", miscDailyAmount: "10.01", miscCurrency: "EUR" })).id;
  store.applyMutation(hotelInput(id));
  const before = store.getSnapshot();
  store.close();
  let observer = new DatabaseSync(path);
  observer.exec("ALTER TABLE destinations DROP COLUMN hotelNightlyMinor; ALTER TABLE destinations DROP COLUMN hotelCurrency; PRAGMA user_version = 8;");
  observer.close();
  store = createStore(path);
  try {
    assert.deepEqual(store.getSnapshot(), before);
    store.applyMutation(destinationInput(tripId, { id, hotelNightlyAmount: "125.25", hotelCurrency: "EUR" }));
    const withEstimate = store.getSnapshot();
    store.close();
    observer = new DatabaseSync(path);
    assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 10);
    observer.exec("PRAGMA user_version = 8;");
    observer.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), withEstimate, "replaying the guarded migration preserves existing hotel columns");
  } finally { store.close(); }
  observer = new DatabaseSync(path);
  try {
    assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 10);
    observer.exec("PRAGMA user_version = 11;");
    assert.throws(() => createStore(path), /newer version/);
    assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 11);
    assert.equal(observer.prepare("SELECT hotelNightlyMinor FROM destinations WHERE id = ?").get(id).hotelNightlyMinor, 12525);
  } finally { observer.close(); }
});
