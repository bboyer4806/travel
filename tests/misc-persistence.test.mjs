import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createStore, ValidationError } from "../src/lib/store.ts";
import { budgetDays, isValidDate } from "../src/lib/destination-duration.ts";
import { currencyDigits, formatCurrency, minorAmountValue, parseMinorAmount } from "../src/lib/money.ts";

const tripInput = { type: "trip.save", name: "A trip", dateLabel: "", homeCity: "New York", travelers: 2, notes: "" };
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Tokyo", stay: "A few nights", notes: "", ...overrides });
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  return { store, tripId: store.applyMutation(tripInput).id };
}

test("currency helpers preserve minor units and reject unsupported precision or invalid amounts", () => {
  assert.equal(currencyDigits("USD"), 2);
  assert.equal(currencyDigits("JPY"), 0);
  assert.equal(currencyDigits("KWD"), 3);
  assert.equal(parseMinorAmount("12.34", "USD"), 1234);
  assert.equal(parseMinorAmount("1234", "JPY"), 1234);
  assert.equal(parseMinorAmount("12.345", "KWD"), 12345);
  assert.equal(parseMinorAmount(".01", "USD"), 1);
  assert.equal(parseMinorAmount("0", "JPY"), 0);
  assert.equal(parseMinorAmount("", null), null);
  assert.equal(parseMinorAmount("100000000", "KWD"), 100000000000);
  assert.equal(minorAmountValue(12345, "KWD"), "12.345");
  assert.equal(minorAmountValue(0, "JPY"), "0");
  assert.equal(minorAmountValue(null, null), "");
  assert.match(formatCurrency(12345, "KWD"), /KWD\s12\.345/);
  for (const [amount, currency] of [["1", null], ["1", "XYZ"], ["-1", "USD"], ["1e2", "USD"], ["1.001", "USD"], ["1.1", "JPY"], ["1.0001", "KWD"], ["100000000.001", "KWD"], ["NaN", "USD"]]) {
    assert.throws(() => parseMinorAmount(amount, currency));
  }
});

test("date-only helpers validate real dates and remain stable across calendar and DST boundaries", () => {
  assert.equal(isValidDate("2028-02-29"), true);
  for (const date of ["2027-02-29", "2027-04-31", "2027-13-01", "2027-1-01", "0000-01-01", "2027-01-01T00:00:00Z", "tomorrow"]) assert.equal(isValidDate(date), false, date);
  assert.equal(budgetDays("2027-03-13", "2027-03-15"), 2);
  assert.equal(budgetDays("2027-11-06", "2027-11-08"), 2);
  assert.equal(budgetDays("2027-12-31", "2028-01-01"), 1);
  assert.equal(budgetDays(null, "2027-01-01"), null);
  assert.equal(budgetDays("2027-02-29", "2027-03-01"), null);
  assert.equal(budgetDays("2027-03-02", "2027-03-01"), null);
});

test("explicit dates and daily currency amounts persist across reopening and legacy edits", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "travel-misc-test-"));
  const path = join(folder, "travel.sqlite");
  let store = createStore(path);
  t.after(() => { store.close(); rmSync(folder, { recursive: true, force: true }); });
  const tripId = store.applyMutation(tripInput).id;
  const id = store.applyMutation(destinationInput(tripId, { arrivalDate: "2027-05-03", departureDate: "2027-05-06", miscDailyAmount: "12.345", miscCurrency: "KWD" })).id;
  const saved = store.getSnapshot().destinations[0];
  assert.equal(saved.miscDailyMinor, 12345);
  assert.equal(saved.stay, "A few nights");
  store.close();
  store = createStore(path);
  assert.deepEqual(store.getSnapshot().destinations[0], saved);
  store.applyMutation(destinationInput(tripId, { id, notes: "An unrelated legacy edit" }));
  assert.deepEqual(store.getSnapshot().destinations[0], { ...saved, notes: "An unrelated legacy edit" });
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "15.001", departureDate: "2027-05-07" }));
  assert.equal(store.getSnapshot().destinations[0].miscDailyMinor, 15001);
  assert.equal(budgetDays(store.getSnapshot().destinations[0].arrivalDate, store.getSnapshot().destinations[0].departureDate), 4);
});

test("zero, missing, and cleared destination budgets stay distinct", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId)).id;
  const unset = store.getSnapshot().destinations[0];
  for (const field of ["arrivalDate", "departureDate", "miscDailyMinor", "miscCurrency"]) assert.equal(unset[field], null);
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "0", miscCurrency: "USD", arrivalDate: "2027-05-03", departureDate: "2027-05-03" }));
  assert.equal(store.getSnapshot().destinations[0].miscDailyMinor, 0);
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "" }));
  assert.equal(store.getSnapshot().destinations[0].miscDailyMinor, null);
  assert.equal(store.getSnapshot().destinations[0].miscCurrency, "USD");
  store.applyMutation(destinationInput(tripId, { id, miscCurrency: null, arrivalDate: "", departureDate: null }));
  for (const field of ["arrivalDate", "departureDate", "miscDailyMinor", "miscCurrency"]) assert.equal(store.getSnapshot().destinations[0][field], null);
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "1.10", miscCurrency: "usd" }));
  assert.equal(store.getSnapshot().destinations[0].miscCurrency, "USD");
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "", miscCurrency: "" }));
  assert.equal(store.getSnapshot().destinations[0].miscCurrency, null);
});

test("invalid dates and currency edits roll back without changing destination or route data", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { arrivalDate: "2027-05-03", departureDate: "2027-05-06", miscDailyAmount: "25", miscCurrency: "USD" })).id;
  const leg = store.getSnapshot().legs[0];
  store.applyMutation({ type: "leg.save", id: leg.id, method: "Flight", price: "200", departure: "", arrival: "", url: "", notes: "" });
  const before = store.getSnapshot();
  const invalid = [
    { arrivalDate: "2027-02-29" }, { departureDate: "2027-05-02" }, { arrivalDate: "2027-05-07" },
    { arrivalDate: 123 }, { miscDailyAmount: "-1" }, { miscDailyAmount: 1 }, { miscCurrency: "XYZ" },
    { miscDailyAmount: "2", miscCurrency: null }, { miscCurrency: null }, { miscCurrency: "JPY" },
    { miscDailyAmount: "1.001" }, { miscDailyAmount: "100000001" },
    { arrivalDate: "0001-01-01", departureDate: "9999-12-31", miscDailyAmount: "100000000", miscCurrency: "KWD" },
  ];
  for (const override of invalid) {
    assert.throws(() => store.applyMutation(destinationInput(tripId, { id, city: "A city change must roll back", ...override })), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  store.applyMutation(destinationInput(tripId, { id, miscDailyAmount: "100", miscCurrency: "JPY" }));
  assert.equal(store.getSnapshot().destinations[0].miscDailyMinor, 100);
  assert.equal(store.getSnapshot().destinations[0].miscCurrency, "JPY");
});

test("schema 7 migrates with unknown dates and budgets and tolerates an already-run migration", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "travel-misc-migration-"));
  const path = join(folder, "travel.sqlite");
  let store = createStore(path);
  t.after(() => { store?.close(); rmSync(folder, { recursive: true, force: true }); });
  const tripId = store.applyMutation(tripInput).id;
  const id = store.applyMutation(destinationInput(tripId)).id;
  const original = store.getSnapshot();
  store.close(); store = null;
  let db = new DatabaseSync(path);
  for (const field of ["arrivalDate", "departureDate", "miscDailyMinor", "miscCurrency"]) db.exec("ALTER TABLE destinations DROP COLUMN " + field);
  db.exec("PRAGMA user_version = 7");
  db.close();
  store = createStore(path);
  assert.deepEqual(store.getSnapshot(), original);
  store.applyMutation(destinationInput(tripId, { id, arrivalDate: "2027-05-03", departureDate: "2027-05-04", miscDailyAmount: "42", miscCurrency: "EUR" }));
  const upgraded = store.getSnapshot();
  store.close(); store = null;
  db = new DatabaseSync(path);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 14);
  db.exec("PRAGMA user_version = 7");
  db.close();
  store = createStore(path);
  assert.deepEqual(store.getSnapshot(), upgraded);
});
