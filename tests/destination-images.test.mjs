import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createStore, ValidationError } from "../src/lib/store.ts";
import { calculateBudget } from "../src/lib/budget.ts";

const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const replacement = new Uint8Array(webp);
replacement[replacement.length - 1] = 1;
const tripInput = { type: "trip.save", name: "Image test", dateLabel: "Next spring", homeCity: "Boston", travelers: 2, notes: "" };
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Vienna", stay: "4 nights", notes: "", ...overrides });
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-image-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}
function planConnections(store) {
  for (const leg of store.getSnapshot().legs) {
    store.applyMutation({
      type: "leg.save", id: leg.id, method: "Flight", price: "600", departure: "Morning", arrival: "Evening", url: "", notes: "Booked aisle seats",
      itinerary: [{ id: randomUUID(), kind: "layover", place: "London Heathrow", arrival: "10:00", departure: "12:30", notes: "Terminal transfer" }],
      links: [{ id: randomUUID(), url: "https://example.com/flights", description: "Flight option" }],
    });
  }
}

test("destination images persist, replace with new versions, and preserve routes during image-only edits", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput).id;
    const destinationId = store.applyMutation(destinationInput(tripId, { image: webp })).id;
    const initialImage = store.getDestinationImage(destinationId);
    assert.ok(initialImage.data instanceof Uint8Array);
    assert.deepEqual(initialImage.data, webp);
    assert.match(initialImage.version, /^[0-9a-f-]{36}$/);
    assert.equal(store.getSnapshot().destinations[0].imageVersion, initialImage.version);
    assert.equal("data" in store.getSnapshot().destinations[0], false);
    assert.equal("image" in store.getSnapshot().destinations[0], false);
    assert.equal(store.getDestinationImage(randomUUID()), undefined);
    planConnections(store);
    const legs = store.getSnapshot().legs;
    const budget = calculateBudget(store.getSnapshot(), tripId);
    store.applyMutation(destinationInput(tripId, { id: destinationId, notes: "A note added by an older client" }));
    assert.deepEqual(store.getDestinationImage(destinationId), initialImage, "omitting image preserves bytes and version");
    assert.deepEqual(store.getSnapshot().legs, legs);
    store.applyMutation(destinationInput(tripId, { id: destinationId, image: replacement }));
    const updatedImage = store.getDestinationImage(destinationId);
    assert.notEqual(updatedImage.version, initialImage.version);
    assert.deepEqual(updatedImage.data, replacement);
    assert.deepEqual(store.getSnapshot().legs, legs);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    updatedImage.data.fill(0);
    assert.deepEqual(store.getDestinationImage(destinationId).data, replacement, "callers cannot mutate stored bytes through retrieval");
    const before = store.getSnapshot();
    const beforeImage = store.getDestinationImage(destinationId);
    store.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getDestinationImage(destinationId), beforeImage);
    store.applyMutation(destinationInput(tripId, { id: destinationId, image: null }));
    assert.equal(store.getDestinationImage(destinationId), undefined);
    assert.equal(store.getSnapshot().destinations[0].imageVersion, null);
    assert.deepEqual(store.getSnapshot().legs, legs, "removing an image also leaves every connection unchanged");
  } finally {
    store.close();
  }
});

test("destination and trip deletion cascade to uploaded images", (t) => {
  const path = fileDatabase(t);
  const store = createStore(path);
  const observer = new DatabaseSync(path);
  try {
    const tripId = store.applyMutation(tripInput).id;
    const first = store.applyMutation(destinationInput(tripId, { image: webp })).id;
    const second = store.applyMutation(destinationInput(tripId, { city: "Paris", image: replacement })).id;
    store.applyMutation({ type: "destination.delete", id: first });
    assert.equal(store.getDestinationImage(first), undefined);
    assert.ok(store.getDestinationImage(second));
    assert.equal(observer.prepare("SELECT count(*) AS count FROM destination_images").get().count, 1);
    store.applyMutation({ type: "trip.delete", id: tripId });
    assert.equal(store.getDestinationImage(second), undefined);
    assert.equal(observer.prepare("SELECT count(*) AS count FROM destination_images").get().count, 0);
    assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    observer.close();
    store.close();
  }
});

test("invalid destination image bytes are rejected before any trip or route data changes", (t) => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput).id;
  const destinationId = store.applyMutation(destinationInput(tripId, { image: webp })).id;
  planConnections(store);
  const before = store.getSnapshot();
  const beforeImage = store.getDestinationImage(destinationId);
  const wrongRiff = new Uint8Array(webp);
  wrongRiff[0] = 0;
  const wrongWebp = new Uint8Array(webp);
  wrongWebp[8] = 0;
  const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
  oversized.set(webp);
  for (const image of ["https://example.com/image.webp", [...webp], { data: webp }, new Uint16Array(20), new Uint8Array(), webp.subarray(0, 11), wrongRiff, wrongWebp, oversized]) {
    assert.throws(() => store.applyMutation(destinationInput(tripId, { id: destinationId, city: "Berlin", notes: "Should not be saved", image })), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getDestinationImage(destinationId), beforeImage);
  }
  const boundary = new Uint8Array(2 * 1024 * 1024);
  boundary.set(webp);
  store.applyMutation(destinationInput(tripId, { id: destinationId, image: boundary }));
  assert.equal(store.getDestinationImage(destinationId).data.byteLength, boundary.byteLength);
  assert.deepEqual(store.getSnapshot().legs, before.legs);
});

test("a failed image write rolls back destination edits and all connection changes", (t) => {
  const path = fileDatabase(t);
  const store = createStore(path);
  const observer = new DatabaseSync(path);
  try {
    const tripId = store.applyMutation(tripInput).id;
    const destinationId = store.applyMutation(destinationInput(tripId, { image: webp })).id;
    planConnections(store);
    const before = store.getSnapshot();
    const beforeImage = store.getDestinationImage(destinationId);
    observer.exec("CREATE TRIGGER reject_image BEFORE INSERT ON destination_images BEGIN SELECT RAISE(ABORT, 'Injected image failure'); END;");
    assert.throws(() => store.applyMutation(destinationInput(tripId, { id: destinationId, city: "Paris", notes: "Unsaved", image: replacement })), /Injected image failure/);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getDestinationImage(destinationId), beforeImage);
    const destinationCount = before.destinations.length;
    assert.throws(() => store.applyMutation(destinationInput(tripId, { city: "Paris", image: replacement })), /Injected image failure/);
    assert.equal(store.getSnapshot().destinations.length, destinationCount);
    assert.deepEqual(store.getSnapshot(), before);
  } finally {
    observer.close();
    store.close();
  }
});

test("schema 3 upgrades add image storage without changing destinations, and repeated migration preserves images", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput).id;
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
    assert.equal(store.getSnapshot().destinations[0].imageVersion, null);
    planConnections(store);
    const before = store.getSnapshot();
    store.close();
    let legacy = new DatabaseSync(path);
    legacy.exec("DROP TABLE destination_images; PRAGMA user_version = 3;");
    legacy.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.equal(store.getDestinationImage(destinationId), undefined);
    store.applyMutation(destinationInput(tripId, { id: destinationId, image: webp }));
    const withImage = store.getSnapshot();
    const image = store.getDestinationImage(destinationId);
    store.close();
    legacy = new DatabaseSync(path);
    legacy.exec("PRAGMA user_version = 3;");
    legacy.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), withImage);
    assert.deepEqual(store.getDestinationImage(destinationId), image);
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 4);
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      observer.close();
    }
  } finally {
    store.close();
  }
});
