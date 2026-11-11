import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ValidationError } from "../src/lib/store.ts";
import { createOwnedStore } from "./owned-store.mjs";

export const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Trip", dateLabel: "Someday", homeCity: "Boston", travelers: 2, notes: "Trip notes", ...overrides });
export const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Paris", stay: "Stay notes", notes: "Destination notes", ...overrides });
export const candidateInput = (destinationId, category, overrides = {}) => ({ type: "candidate.save", destinationId, category, name: "Idea", price: "12.25", included: true, address: "", url: "", notes: "", ...overrides });
export const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
/** An in-memory store, closed after the test, with one trip: the given `trip`, or the shared `tripInput()` by default. */
export function setup(t, trip = tripInput()) { const store = createOwnedStore(":memory:"); t.after(() => store.close()); return { store, tripId: store.applyMutation(trip).id }; }
/** A database path in a temporary folder that is removed after the test. */
export function fileDatabase(t) { const dir = mkdtempSync(join(tmpdir(), "travel-test-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "travel.sqlite"); }

export function validateMoney(t, amount, minor, currency, extra = {}) {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { nights: 3, [amount]: "12.34", ...extra })).id;
  assert.equal(destination(store, id)[minor], 1234);
  assert.equal(destination(store, id)[currency], "USD", "no currency selection required");
  const before = store.getSnapshot();
  for (const value of ["-1", "1.001", "1e2", "NaN", "100000001", 5]) {
    // Creating a destination, then editing the saved one.
    for (const fields of [{ nights: 3, ...extra }, { id }]) {
      assert.throws(() => store.applyMutation(destinationInput(tripId, { ...fields, [amount]: value })), ValidationError);
      assert.deepEqual(store.getSnapshot(), before, "no partial destination or change is saved");
    }
  }
  for (const value of ["EUR", "JPY", "KWD", "XYZ", null, ""]) {
    assert.throws(() => store.applyMutation(destinationInput(tripId, { id, [currency]: value })), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  const otherTrip = store.applyMutation(tripInput({ name: "Other" })).id;
  assert.throws(() => store.applyMutation(destinationInput(otherTrip, { id, [amount]: "5" })), ValidationError);
  store.applyMutation(destinationInput(tripId, { id, notes: "Only notes" }));
  assert.equal(destination(store, id)[minor], 1234);
  store.applyMutation(destinationInput(tripId, { id, [amount]: "0" }));
  assert.equal(destination(store, id)[minor], 0);
  const known = store.getSnapshot();
  store.applyMutation(destinationInput(tripId, { id, [amount]: " \t " }));
  const cleared = { ...known, destinations: known.destinations.map((item) => (item.id === id ? { ...item, [minor]: null } : item)) };
  assert.deepEqual(store.getSnapshot(), cleared, "whitespace clears only this amount");
  store.applyMutation(destinationInput(tripId, { id, [amount]: "", [currency]: null }));
  assert.equal(destination(store, id)[minor], null);
  assert.equal(destination(store, id)[currency], null);
}

export function verifyPersistence(t, amount, minor, currency, version, columns, extra = {}) {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ startDate: "2027-06-01" })).id;
    const id = store.applyMutation(destinationInput(tripId, { nights: 3, [amount]: "81.25", ...extra })).id;
    store.applyMutation(candidateInput(id, "hotels"));
    const saved = store.getSnapshot();
    // Clearing `store` after each close means the finally block never closes a closed store, which would hide the real failure.
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved);
    store.close(); store = null;
    const db = new DatabaseSync(path);
    for (const column of columns) db.exec(`ALTER TABLE destinations DROP COLUMN ${column};`);
    db.exec(`PRAGMA user_version = ${version}`); db.close();
    store = createOwnedStore(path);
    assert.equal(destination(store, id)[minor], null);
    assert.deepEqual(store.getSnapshot().candidates, saved.candidates);
    assert.deepEqual(store.getSnapshot().legs, saved.legs);
    assert.equal(destination(store, id).nights, 3);
    store.applyMutation(destinationInput(tripId, { id, [amount]: "12.34", ...extra }));
    const upgraded = store.getSnapshot();
    store.close(); store = null;
    const replay = new DatabaseSync(path); replay.exec(`PRAGMA user_version = ${version}`); replay.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), upgraded, "migration replay retains later edits");
    assert.equal(destination(store, id)[currency], "USD");
  } finally { store?.close(); }
}
