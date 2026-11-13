import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ValidationError } from "../src/lib/store.ts";
import { createOwnedStore } from "./owned-store.mjs";
import { fileDatabase, newItem, stop } from "./budget-fixtures.mjs";
import { calculateBudget } from "../src/lib/budget.ts";
import { storedImageResponse } from "../src/lib/stored-image-response.ts";

const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const photo = () => ({ id: randomUUID(), data: new Uint8Array(webp) });
const tripInput = { type: "trip.save", name: "Gallery trip", dateLabel: "Next spring", homeCity: "Boston", travelers: 2, notes: "", startDate: "2027-05-01" };
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Vienna", nights: 4, stay: "Near the station", notes: "Walk the old town", ...overrides, ...newItem(overrides) });
const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
function plan(store) {
  const tripId = store.applyMutation({ ...tripInput, ...newItem() }).id;
  const id = store.applyMutation(destinationInput(tripId)).id;
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Flight", price: "300", departure: "Morning", arrival: "Evening", url: "", notes: "Keep this connection" });
  return { tripId, id };
}

test("destination photo add, primary selection, reorder and fallback persist without altering planning data", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const { tripId, id } = plan(store);
    const before = store.getSnapshot();
    const budget = calculateBudget(before, tripId);
    const photos = [photo(), photo(), photo()];
    store.applyMutation({ type: "destination.save", id, gallery: { add: photos, remove: [], mainImageId: photos[1].id } });
    assert.equal(destination(store, id).mainImageId, photos[1].id);
    assert.deepEqual(destination(store, id).images.map((image) => image.id), photos.map((image) => image.id));
    const versions = destination(store, id).images.map((image) => image.version);
    const order = [photos[2].id, photos[0].id, photos[1].id];
    store.applyMutation({ type: "destination.save", id, gallery: { add: [], remove: [], order } });
    assert.deepEqual(destination(store, id).images.map((image) => image.id), order);
    assert.equal(destination(store, id).mainImageId, photos[1].id, "position and primary choice are independent");
    assert.deepEqual(destination(store, id).images.map((image) => image.version), [versions[2], versions[0], versions[1]]);
    assert.equal(destination(store, id).city, before.destinations[0].city);
    assert.equal(destination(store, id).notes, before.destinations[0].notes);
    assert.equal(stop(store, id).nights, 4);
    assert.deepEqual(store.getSnapshot().legs, before.legs);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    store.applyMutation({ type: "destination.save", id, gallery: { add: [], remove: [photos[1].id] } });
    assert.equal(destination(store, id).mainImageId, photos[2].id, "removing primary chooses first remaining in saved order");
    assert.deepEqual(store.getDestinationImage(id), store.getDestinationPhoto(id, photos[2].id));
    const saved = store.getSnapshot();
    store.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved);
    store.applyMutation({ type: "destination.save", id, gallery: { add: [], remove: [photos[2].id, photos[0].id], mainImageId: null, order: [] } });
    assert.deepEqual(destination(store, id).images, []);
    assert.equal(destination(store, id).mainImageId, null);
    assert.equal(store.getDestinationImage(id), undefined);
  } finally { store.close(); }
});

test("destination galleries validate ownership, ordering, limits and photo data atomically", (t) => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const { tripId, id } = plan(store);
  const own = photo(), foreign = photo(), extra = photo();
  store.applyMutation({ type: "destination.save", id, gallery: { add: [own], remove: [] } });
  const otherId = store.applyMutation(destinationInput(tripId, { city: "Paris", gallery: { add: [foreign], remove: [] } })).id;
  const before = store.getSnapshot();
  assert.equal(store.getDestinationPhoto(id, foreign.id), undefined);
  assert.equal(store.getDestinationPhoto(otherId, own.id), undefined);
  const invalid = [
    { add: [], remove: [foreign.id] }, { add: [], remove: [randomUUID()] },
    { add: [foreign], remove: [] }, { add: [{ ...foreign, id: foreign.id.toUpperCase() }], remove: [] },
    { add: [extra, extra], remove: [] }, { add: [own], remove: [own.id] },
    { add: [], remove: [], mainImageId: foreign.id }, { add: [], remove: [], mainImageId: null },
    { add: [], remove: [own.id], mainImageId: own.id },
    { add: [], remove: [], order: [foreign.id] }, { add: [], remove: [], order: [] },
    { add: [], remove: [], order: [own.id, own.id] }, { add: [], remove: [], order: "bad" },
    { add: [], remove: [], order: ["bad"] }, { add: [photo()], remove: [], order: [own.id] },
    { add: [{ id: randomUUID(), data: new Uint8Array() }], remove: [] },
    { add: Array.from({ length: 11 }, photo), remove: [] },
  ];
  for (const gallery of invalid) {
    assert.throws(() => store.applyMutation({ type: "destination.save", id, city: "Unsaved city", gallery }), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  for (const image of [null, webp]) assert.throws(() => store.applyMutation({ type: "destination.save", id, image, gallery: { add: [], remove: [] } }), ValidationError);
  const more = Array.from({ length: 9 }, photo);
  store.applyMutation({ type: "destination.save", id, gallery: { add: more, remove: [] } });
  assert.throws(() => store.applyMutation({ type: "destination.save", id, gallery: { add: [extra], remove: [] } }), /10 photos/);
  store.applyMutation({ type: "destination.save", id, gallery: { add: [extra], remove: [own.id], mainImageId: extra.id } });
  assert.equal(destination(store, id).images.length, 10);
  assert.equal(destination(store, id).mainImageId, extra.id);
});

test("concurrent adds survive ordinary edits and stale reorder fails without discarding new photos", (t) => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const { id } = plan(store);
  const first = photo(), second = photo(), third = photo();
  store.applyMutation({ type: "destination.save", id, gallery: { add: [first, second], remove: [] } });
  store.applyMutation({ type: "destination.save", id, gallery: { add: [third], remove: [] } });
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation({ type: "destination.save", id, gallery: { add: [], remove: [], order: [second.id, first.id] } }), /Refresh/);
  assert.deepEqual(store.getSnapshot(), before);
  store.applyMutation({ type: "destination.save", id, gallery: { add: [], remove: [first.id], mainImageId: second.id } });
  assert.deepEqual(destination(store, id).images.map((image) => image.id), [second.id, third.id]);
});

test("gallery write failures roll back removals, additions, destination changes and route changes", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  const observer = new DatabaseSync(path);
  try {
    const { id } = plan(store);
    const original = photo(), accepted = photo(), rejected = photo();
    store.applyMutation({ type: "destination.save", id, gallery: { add: [original], remove: [] } });
    const before = store.getSnapshot();
    observer.exec(`CREATE TRIGGER reject_gallery_photo BEFORE INSERT ON destination_images WHEN NEW.id = '${rejected.id}' BEGIN SELECT RAISE(ABORT, 'Injected photo failure'); END;`);
    assert.throws(() => store.applyMutation({ type: "destination.save", id, city: "Unsaved", gallery: { add: [accepted, rejected], remove: [original.id] } }), /Injected photo failure/);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getDestinationPhoto(id, original.id).data, webp);
    assert.equal(store.getDestinationPhoto(id, accepted.id), undefined);
    assert.equal(store.getDestinationPhoto(id, rejected.id), undefined);
  } finally { observer.close(); store.close(); }
});

test("schema 16 single images migrate unchanged and replay preserves galleries and primary choice", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const { id } = plan(store);
    store.applyMutation({ type: "destination.save", id, image: webp });
    const original = store.getDestinationImage(id);
    const planning = store.getSnapshot();
    store.close();
    const old = new DatabaseSync(path);
    old.exec("DROP TABLE destination_images; CREATE TABLE destination_images(destinationId TEXT PRIMARY KEY REFERENCES destinations(id) ON DELETE CASCADE, version TEXT NOT NULL, data BLOB NOT NULL) STRICT; PRAGMA user_version=16;");
    old.prepare("INSERT INTO destination_images(destinationId,version,data) VALUES(?,?,?)").run(id, original.version, original.data);
    old.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getDestinationImage(id), original);
    assert.deepEqual(store.getDestinationPhoto(id, id), original);
    assert.deepEqual(destination(store, id).images, [{ id, version: original.version }]);
    assert.equal(destination(store, id).mainImageId, id);
    assert.deepEqual(store.getSnapshot().legs, planning.legs);
    const extra = photo();
    store.applyMutation({ type: "destination.save", id, gallery: { add: [extra], remove: [], mainImageId: extra.id, order: [extra.id, id] } });
    const snapshot = store.getSnapshot();
    store.close();
    const reset = new DatabaseSync(path);
    reset.exec("PRAGMA user_version=16");
    reset.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), snapshot);
    assert.deepEqual(store.getDestinationPhoto(id, id), original);
    const observer = new DatabaseSync(path);
    try { assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []); }
    finally { observer.close(); }
  } finally { store.close(); }
});

test("legacy image changes affect only primary, and a destination keeps its gallery after its trips go", (t) => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const { tripId, id } = plan(store);
  const photos = [photo(), photo()];
  store.applyMutation({ type: "destination.save", id, gallery: { add: photos, remove: [], mainImageId: photos[1].id } });
  const candidatePhoto = photo();
  const candidateId = store.applyMutation({ type: "candidate.save", ...newItem(), destinationId: id, category: "hotels", name: "Hotel", price: "", address: "", url: "", notes: "", included: false, gallery: { add: [candidatePhoto], remove: [] } }).id;
  const candidate = store.getSnapshot().candidates[0];
  const first = store.getDestinationPhoto(id, photos[0].id);
  const originalMain = store.getDestinationImage(id);
  store.applyMutation({ type: "destination.save", id, image: webp });
  assert.notEqual(store.getDestinationImage(id).version, originalMain.version);
  assert.deepEqual(store.getDestinationPhoto(id, photos[0].id), first);
  store.applyMutation({ type: "destination.save", id, image: null });
  assert.deepEqual(store.getDestinationImage(id), first);
  assert.deepEqual(store.getSnapshot().candidates[0], candidate);
  const otherPhoto = photo();
  const otherId = store.applyMutation(destinationInput(tripId, { city: "Paris", gallery: { add: [otherPhoto], remove: [] } })).id;
  store.applyMutation({ type: "stop.remove", id });
  assert.deepEqual(store.getDestinationPhoto(id, photos[0].id), first);
  assert.ok(store.getCandidatePhoto(candidateId, candidatePhoto.id));
  store.applyMutation({ type: "trip.delete", id: tripId });
  assert.ok(store.getDestinationPhoto(otherId, otherPhoto.id));
});

test("individual destination photo reads enforce owner, version and cache semantics", async (t) => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const { id } = plan(store);
  const image = photo();
  store.applyMutation({ type: "destination.save", id, gallery: { add: [image], remove: [] } });
  const version = store.getDestinationPhoto(id, image.id).version;
  const read = (owner) => store.getDestinationPhoto(owner, image.id);
  const request = (suffix = "", headers) => new Request(`https://example.test/api/destination-images/${id}/${image.id}${suffix}`, { headers });
  const response = storedImageResponse(request(`?v=${version}`), id, read);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), webp);
  assert.equal(storedImageResponse(request(`?v=${version}`, { "if-none-match": `"${version}"` }), id, read).status, 304);
  assert.equal(storedImageResponse(request("?v=stale"), id, read).status, 404);
  assert.equal(storedImageResponse(request(), randomUUID(), read).status, 404);
  assert.equal(storedImageResponse(request(), id, read).headers.get("cache-control"), "no-cache");
});
