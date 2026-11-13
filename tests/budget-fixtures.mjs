import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ValidationError } from "../src/lib/store.ts";
import { createOwnedStore } from "./owned-store.mjs";

/**
 * The ID and `create` an editor adding an item sends, or nothing when `overrides` names a saved item by `id`. Each
 * new item gets its own ID, as each editor that adds one does. Spread it after `overrides`, so an `id` left undefined
 * still means a new item.
 */
export const newItem = (overrides = {}) => (overrides.id === undefined ? { id: randomUUID(), create: true } : {});
export const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Trip", dateLabel: "Someday", homeCity: "Boston", travelers: 2, notes: "Trip notes", ...overrides, ...newItem(overrides) });
/** A change to a saved destination, shared by every trip that visits it. */
export const destinationEdit = (id, overrides = {}) => ({ type: "destination.save", id, ...overrides });
/** A change to a destination and to its stay in the trip it was added to, whose stop shares its ID. */
export const stopEdit = (id, overrides = {}) => ({ type: "destination.save", id, stopId: id, ...overrides });
/**
 * Adds a new city to a trip, as the trip's Add destination does, then saves `details` for the destination and the
 * trip's stay there, as its editor does. `save` applies a change as an account and returns its ID. The returned ID is
 * the new destination's, which its stop shares.
 */
export function addCity(save, tripId, city, details = {}) {
  const id = save({ type: "stop.add", tripId, city });
  save(stopEdit(id, details));
  return id;
}
/** Paris, or the city in `overrides`, added to a trip by its owner, with stay notes, notes and any other `overrides`. */
export const addDestination = (store, tripId, { city = "Paris", ...overrides } = {}) => addCity((input) => store.applyMutation(input).id, tripId, city, { stay: "Stay notes", notes: "Destination notes", ...overrides });
export const candidateInput = (destinationId, category, overrides = {}) => ({ type: "candidate.save", destinationId, category, name: "Idea", price: "12.25", included: true, address: "", url: "", notes: "", ...overrides, ...newItem(overrides) });
export const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
/** A trip's stop: one trip's stay at a destination. */
export const stop = (store, id) => store.getSnapshot().stops.find((item) => item.id === id);
/** A destination added to a trip, with its nights there, as that trip's budget uses it. */
export const visit = (store, id) => ({ ...destination(store, id), nights: stop(store, id).nights });
/** An in-memory store, closed after the test, with one trip: the given `trip`, or the shared `tripInput()` by default. */
export function setup(t, trip = tripInput()) { const store = createOwnedStore(":memory:"); t.after(() => store.close()); return { store, tripId: store.applyMutation(trip).id }; }
/** A database path in a temporary folder that is removed after the test. */
export function fileDatabase(t) { const dir = mkdtempSync(join(tmpdir(), "travel-test-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, "travel.sqlite"); }

export function validateMoney(t, amount, minor, currency, extra = {}) {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { nights: 3, [amount]: "12.34", ...extra });
  assert.equal(destination(store, id)[minor], 1234);
  assert.equal(destination(store, id)[currency], "USD", "no currency selection required");
  const before = store.getSnapshot();
  for (const value of ["-1", "1.001", "1e2", "NaN", "100000001", 5]) {
    // Editing the destination with its stay in the trip, then on its own.
    for (const input of [stopEdit(id, { nights: 4, ...extra, [amount]: value }), destinationEdit(id, { [amount]: value })]) {
      assert.throws(() => store.applyMutation(input), ValidationError);
      assert.deepEqual(store.getSnapshot(), before, "no partial destination or change is saved");
    }
  }
  // Currency is not an input: one an older client still sends never changes an amount or labels it non-USD.
  for (const value of ["EUR", "JPY", "KWD", "XYZ", null, ""]) {
    store.applyMutation(destinationEdit(id, { [currency]: value }));
    assert.deepEqual(store.getSnapshot(), before);
  }
  // Another trip's stop can't carry this destination's changes.
  const otherTrip = store.applyMutation(tripInput({ name: "Other" })).id;
  const otherStop = addDestination(store, otherTrip, { city: "Other city" });
  assert.throws(() => store.applyMutation(destinationEdit(id, { stopId: otherStop, [amount]: "5" })), ValidationError);
  store.applyMutation(destinationEdit(id, { notes: "Only notes" }));
  assert.equal(destination(store, id)[minor], 1234);
  store.applyMutation(destinationEdit(id, { [amount]: "0" }));
  assert.equal(destination(store, id)[minor], 0);
  const known = store.getSnapshot();
  store.applyMutation(destinationEdit(id, { [amount]: " \t " }));
  const cleared = { ...known, destinations: known.destinations.map((item) => (item.id === id ? { ...item, [minor]: null } : item)) };
  assert.deepEqual(store.getSnapshot(), cleared, "whitespace clears only this amount");
  store.applyMutation(destinationEdit(id, { [amount]: "" }));
  assert.equal(destination(store, id)[minor], null);
  assert.equal(destination(store, id)[currency], "USD", "a cleared amount keeps the USD label the editor has always saved with it");
}

export function verifyPersistence(t, amount, minor, currency, version, columns, extra = {}) {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ startDate: "2027-06-01" })).id;
    const id = addDestination(store, tripId, { nights: 3, [amount]: "81.25", ...extra });
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
    assert.equal(stop(store, id).nights, 3);
    store.applyMutation(destinationEdit(id, { [amount]: "12.34", ...extra }));
    const upgraded = store.getSnapshot();
    store.close(); store = null;
    const replay = new DatabaseSync(path); replay.exec(`PRAGMA user_version = ${version}`); replay.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), upgraded, "migration replay retains later edits");
    assert.equal(destination(store, id)[currency], "USD");
  } finally { store?.close(); }
}
