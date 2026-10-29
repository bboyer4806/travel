import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore, ValidationError } from "../src/lib/store.ts";

export const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Trip", dateLabel: "Someday", homeCity: "Boston", travelers: 2, notes: "Trip notes", ...overrides });
export const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Paris", stay: "Stay notes", notes: "Destination notes", ...overrides });
export const candidateInput = (destinationId, category, overrides = {}) => ({ type: "candidate.save", destinationId, category, name: "Idea", price: "12.25", included: true, address: "", url: "", notes: "", ...overrides });
export const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
export function setup(t) { const store = createStore(":memory:"); t.after(() => store.close()); return { store, tripId: store.applyMutation(tripInput()).id }; }
export function fileDatabase(t) { const dir = mkdtempSync(join(tmpdir(), "travel-12-test-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "travel.sqlite"); }

export function validateMoney(t, amount, minor, currency, extra = {}) {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { nights: 3, [amount]: "12.34", ...extra })).id;
  assert.equal(destination(store, id)[minor], 1234);
  assert.equal(destination(store, id)[currency], "USD", "no currency selection required");
  const before = store.getSnapshot();
  for (const value of ["-1", "1.001", "1e2", "NaN", "100000001", 5]) {
    assert.throws(() => store.applyMutation(destinationInput(tripId, { id, [amount]: value })), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
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
  store.applyMutation(destinationInput(tripId, { id, [amount]: "", [currency]: null }));
  assert.equal(destination(store, id)[minor], null);
  assert.equal(destination(store, id)[currency], null);
}

export function verifyPersistence(t, amount, minor, currency, version, columns, extra = {}) {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ startDate: "2027-06-01" })).id;
    const id = store.applyMutation(destinationInput(tripId, { nights: 3, [amount]: "81.25", ...extra })).id;
    store.applyMutation(candidateInput(id, "hotels"));
    const saved = store.getSnapshot();
    store.close(); store = createStore(path);
    assert.deepEqual(store.getSnapshot(), saved);
    store.close();
    const db = new DatabaseSync(path);
    for (const column of columns) db.exec(`ALTER TABLE destinations DROP COLUMN ${column};`);
    db.exec(`PRAGMA user_version = ${version}`); db.close();
    store = createStore(path);
    assert.equal(destination(store, id)[minor], null);
    assert.deepEqual(store.getSnapshot().candidates, saved.candidates);
    assert.deepEqual(store.getSnapshot().legs, saved.legs);
    assert.equal(destination(store, id).nights, 3);
    store.applyMutation(destinationInput(tripId, { id, [amount]: "12.34", ...extra }));
    const upgraded = store.getSnapshot();
    store.close();
    const replay = new DatabaseSync(path); replay.exec(`PRAGMA user_version = ${version}`); replay.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), upgraded, "migration replay retains later edits");
    assert.equal(destination(store, id)[currency], "USD");
  } finally { store.close(); }
}
