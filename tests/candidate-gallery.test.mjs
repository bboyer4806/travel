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
const alternative = new Uint8Array(webp);
alternative[alternative.length - 1] = 1;
const photo = (data = webp) => ({ id: randomUUID(), data });
const tripInput = { type: "trip.save", name: "Photo research", dateLabel: "Spring", homeCity: "Boston", travelers: 2, notes: "" };
const destinationInput = (tripId, city = "Vienna") => ({ type: "destination.save", tripId, city, stay: "3 nights", notes: "" });
const ideaInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "hotels", name: "An idea", price: "275.50", address: "City center", url: "https://example.com", notes: "Keep these details", included: true, ...overrides });
function databasePath(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-gallery-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}
function seed(store) {
  const tripId = store.applyMutation(tripInput).id;
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  return { tripId, destinationId };
}
function candidate(store, id) { return store.getSnapshot().candidates.find((item) => item.id === id); }
function planningFields(item) {
  const fields = { ...item };
  delete fields.imageVersion;
  delete fields.images;
  delete fields.mainImageId;
  return fields;
}

for (const category of ["hotels", "activities", "restaurants"]) {
  test(`${category} galleries persist multiple photos and main selection without changing planning details`, (t) => {
    const path = databasePath(t);
    let store = createStore(path);
    try {
      const { tripId, destinationId } = seed(store);
      const first = photo();
      const second = photo(alternative);
      const input = ideaInput(destinationId, { category, links: [{ id: randomUUID(), url: "https://example.com", description: "Research" }] });
      const id = store.applyMutation({ ...input, gallery: { add: [first, second], remove: [], mainImageId: second.id } }).id;
      const saved = candidate(store, id);
      assert.deepEqual(saved.images.map((item) => item.id), [first.id, second.id]);
      assert.equal(saved.mainImageId, second.id);
      assert.equal(saved.imageVersion, saved.images[1].version);
      assert.deepEqual(store.getCandidateImage(id), store.getCandidatePhoto(id, second.id));
      assert.deepEqual(store.getCandidatePhoto(id, first.id).data, first.data);
      assert.deepEqual(store.getCandidatePhoto(id, second.id).data, second.data);
      assert.ok(saved.images.every((item) => Object.keys(item).sort().join(",") === "id,version"), "snapshots contain metadata, never photo bytes");
      const budget = calculateBudget(store.getSnapshot(), tripId);
      const originalPhotos = saved.images.map((item) => store.getCandidatePhoto(id, item.id));
      store.applyMutation({ ...input, id, gallery: { add: [], remove: [], mainImageId: first.id } });
      const switched = candidate(store, id);
      assert.equal(switched.mainImageId, first.id);
      assert.equal(switched.imageVersion, switched.images[0].version);
      assert.deepEqual(switched.images, saved.images, "main selection does not regenerate photo versions");
      assert.deepEqual(switched.images.map((item) => store.getCandidatePhoto(id, item.id)), originalPhotos);
      assert.deepEqual(planningFields(switched), planningFields(saved));
      assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
      store.applyMutation({ ...input, id, notes: "Updated notes" });
      assert.deepEqual(candidate(store, id).images, saved.images, "a notes-only save preserves the gallery");
      const before = store.getSnapshot();
      store.close();
      store = createStore(path);
      assert.deepEqual(store.getSnapshot(), before);
      assert.deepEqual(before.candidates.find((item) => item.id === id).images.map((item) => store.getCandidatePhoto(id, item.id)), originalPhotos);
      const copy = store.getCandidatePhoto(id, second.id);
      copy.data.fill(0);
      assert.deepEqual(store.getCandidatePhoto(id, second.id).data, alternative, "returned buffers cannot mutate persisted photos");
    } finally { store.close(); }
  });
}

test("incremental gallery edits retain concurrently added photos and choose a fallback main", (t) => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const { destinationId } = seed(store);
  const first = photo(), second = photo(), third = photo(alternative), fourth = photo();
  const input = ideaInput(destinationId);
  const id = store.applyMutation({ ...input, gallery: { add: [first, second], remove: [], mainImageId: second.id } }).id;
  // A separate editor adds a photo after the first editor opened its draft.
  store.applyMutation({ ...input, id, gallery: { add: [third], remove: [] } });
  store.applyMutation({ ...input, id, gallery: { add: [fourth], remove: [first.id], mainImageId: second.id } });
  assert.deepEqual(candidate(store, id).images.map((item) => item.id), [second.id, third.id, fourth.id]);
  assert.equal(candidate(store, id).mainImageId, second.id);
  store.applyMutation({ ...input, id, gallery: { add: [], remove: [second.id] } });
  assert.equal(candidate(store, id).mainImageId, third.id);
  assert.deepEqual(store.getCandidateImage(id).data, alternative);
  assert.equal(store.getCandidatePhoto(id, first.id), undefined);
  assert.equal(store.getCandidatePhoto(id, second.id), undefined);
  store.applyMutation({ ...input, id, gallery: { add: [], remove: [third.id, fourth.id], mainImageId: null } });
  assert.deepEqual(candidate(store, id).images, []);
  assert.equal(candidate(store, id).mainImageId, null);
  assert.equal(candidate(store, id).imageVersion, null);
  assert.equal(store.getCandidateImage(id), undefined);
});

test("legacy single-photo edits replace or remove only the main photo", (t) => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const { destinationId } = seed(store);
  const first = photo(), second = photo();
  const input = ideaInput(destinationId);
  const id = store.applyMutation({ ...input, gallery: { add: [first, second], remove: [], mainImageId: second.id } }).id;
  const beforeFirst = store.getCandidatePhoto(id, first.id);
  const beforeMain = store.getCandidatePhoto(id, second.id);
  store.applyMutation({ ...input, id, image: alternative });
  assert.deepEqual(candidate(store, id).images.map((item) => item.id), [first.id, second.id]);
  assert.deepEqual(store.getCandidatePhoto(id, first.id), beforeFirst);
  assert.notEqual(store.getCandidatePhoto(id, second.id).version, beforeMain.version);
  assert.deepEqual(store.getCandidatePhoto(id, second.id).data, alternative);
  store.applyMutation({ ...input, id, image: null });
  assert.deepEqual(candidate(store, id).images, [{ id: first.id, version: beforeFirst.version }]);
  assert.equal(candidate(store, id).mainImageId, first.id);
  assert.deepEqual(store.getCandidateImage(id), beforeFirst);
});

test("gallery ownership, stale edits, duplicate IDs, and main-photo checks fail atomically", (t) => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const { destinationId } = seed(store);
  const own = photo(), foreign = photo(), extra = photo();
  const chosenId = store.applyMutation(ideaInput(destinationId, { name: "Chosen hotel", gallery: { add: [foreign], remove: [] } })).id;
  const input = ideaInput(destinationId, { included: false });
  const id = store.applyMutation({ ...input, gallery: { add: [own], remove: [] } }).id;
  assert.equal(store.getCandidatePhoto(id, foreign.id), undefined);
  assert.equal(store.getCandidatePhoto(chosenId, own.id), undefined);
  assert.equal(store.getCandidatePhoto(randomUUID(), own.id), undefined);
  const before = store.getSnapshot();
  const galleries = [
    { add: [], remove: [foreign.id] },
    { add: [], remove: [randomUUID()] },
    { add: [], remove: [], mainImageId: foreign.id },
    { add: [], remove: [], mainImageId: randomUUID() },
    { add: [], remove: [own.id], mainImageId: own.id },
    { add: [], remove: [], mainImageId: null },
    { add: [foreign], remove: [] },
    { add: [{ ...foreign, id: foreign.id.toUpperCase() }], remove: [] },
    { add: [own], remove: [own.id] },
    { add: [extra, extra], remove: [] },
    { add: [extra, { ...extra, id: extra.id.toUpperCase() }], remove: [] },
    { add: [], remove: [own.id, own.id] },
    { add: [{ id: randomUUID(), data: null }], remove: [] },
    { add: [{ id: randomUUID(), data: "not bytes" }], remove: [] },
    { add: [{ id: "not-an-id", data: webp }], remove: [] },
    { add: [], remove: [], mainImageId: "bad-id" },
  ];
  for (const gallery of galleries) {
    assert.throws(() => store.applyMutation({ ...input, id, name: "Unsaved", included: true, gallery }), ValidationError);
    assert.deepEqual(store.getSnapshot(), before, "failed photo edits also roll back hotel selection and fields");
    assert.deepEqual(store.getCandidatePhoto(id, own.id).data, webp);
  }
  for (const image of [null, webp]) {
    assert.throws(() => store.applyMutation({ ...input, id, image, gallery: { add: [], remove: [] } }), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
});

test("the ten-photo limit counts retained photos and permits removal plus replacement", (t) => {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const { destinationId } = seed(store);
  const input = ideaInput(destinationId);
  const photos = Array.from({ length: 10 }, () => photo());
  const id = store.applyMutation({ ...input, gallery: { add: photos, remove: [] } }).id;
  assert.equal(candidate(store, id).images.length, 10);
  assert.equal(candidate(store, id).mainImageId, photos[0].id);
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation({ ...input, id, gallery: { add: [photo()], remove: [] } }), /10 photos/);
  assert.deepEqual(store.getSnapshot(), before);
  assert.throws(() => store.applyMutation({ ...input, gallery: { add: Array.from({ length: 11 }, () => photo()), remove: [] } }), /10 photos/);
  assert.deepEqual(store.getSnapshot(), before);
  const replacement = photo(alternative);
  store.applyMutation({ ...input, id, gallery: { add: [replacement], remove: [photos[0].id], mainImageId: replacement.id } });
  assert.equal(candidate(store, id).images.length, 10);
  assert.equal(candidate(store, id).mainImageId, replacement.id);
  assert.deepEqual(candidate(store, id).images.map((item) => item.id), [...photos.slice(1).map((item) => item.id), replacement.id]);
});

test("a failure after the first gallery write rolls back additions, removals, and planning changes", (t) => {
  const path = databasePath(t);
  const store = createStore(path);
  const observer = new DatabaseSync(path);
  try {
    const { tripId, destinationId } = seed(store);
    store.applyMutation(ideaInput(destinationId, { name: "Chosen hotel" }));
    const existingPhoto = photo();
    const input = ideaInput(destinationId, { included: false });
    const id = store.applyMutation({ ...input, gallery: { add: [existingPhoto], remove: [] } }).id;
    const first = photo(), rejected = photo();
    const before = store.getSnapshot();
    const original = store.getCandidateImage(id);
    const budget = calculateBudget(before, tripId);
    observer.exec(`CREATE TRIGGER reject_second_gallery_photo BEFORE INSERT ON candidate_images WHEN NEW.id = '${rejected.id}' BEGIN SELECT RAISE(ABORT, 'Injected gallery failure'); END;`);
    assert.throws(() => store.applyMutation({ ...input, id, name: "Unsaved", included: true, gallery: { add: [first, rejected], remove: [existingPhoto.id], mainImageId: rejected.id } }), /Injected gallery failure/);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getCandidateImage(id), original);
    assert.equal(store.getCandidatePhoto(id, first.id), undefined);
    assert.equal(store.getCandidatePhoto(id, rejected.id), undefined);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    assert.equal(observer.prepare("SELECT count(*) AS count FROM candidate_images").get().count, 1);
    assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { observer.close(); store.close(); }
});

test("schema 5 photos migrate with their exact bytes and versions, and repeated migration preserves galleries", (t) => {
  const path = databasePath(t);
  let store = createStore(path);
  try {
    const { tripId, destinationId } = seed(store);
    const input = ideaInput(destinationId);
    const id = store.applyMutation({ ...input, image: alternative }).id;
    store.applyMutation({ ...destinationInput(tripId), id: destinationId, image: webp });
    const before = store.getSnapshot();
    const original = store.getCandidateImage(id);
    const destinationPhoto = store.getDestinationImage(destinationId);
    store.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP TABLE candidate_images; CREATE TABLE candidate_images(candidateId TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE, version TEXT NOT NULL, data BLOB NOT NULL) STRICT; PRAGMA user_version=5;");
    legacy.prepare("INSERT INTO candidate_images(candidateId,version,data) VALUES(?,?,?)").run(id, original.version, original.data);
    legacy.close();
    store = createStore(path);
    assert.deepEqual(store.getCandidateImage(id), original);
    assert.deepEqual(store.getCandidatePhoto(id, id), original);
    assert.deepEqual(candidate(store, id).images, [{ id, version: original.version }]);
    assert.equal(candidate(store, id).mainImageId, id);
    assert.deepEqual(planningFields(candidate(store, id)), planningFields(before.candidates[0]));
    assert.deepEqual(store.getDestinationImage(destinationId), destinationPhoto);
    assert.deepEqual(store.getSnapshot().trips, before.trips);
    assert.deepEqual(store.getSnapshot().legs, before.legs);
    const extra = photo();
    store.applyMutation({ ...input, id, gallery: { add: [extra], remove: [], mainImageId: extra.id } });
    const upgraded = store.getSnapshot();
    const extraImage = store.getCandidatePhoto(id, extra.id);
    store.close();
    const reset = new DatabaseSync(path);
    assert.equal(reset.prepare("PRAGMA user_version").get().user_version, 15);
    reset.exec("PRAGMA user_version=5");
    reset.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), upgraded);
    assert.deepEqual(store.getCandidatePhoto(id, id), original);
    assert.deepEqual(store.getCandidatePhoto(id, extra.id), extraImage);
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 15);
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(observer.prepare("SELECT count(*) AS count FROM candidate_images WHERE candidateId=? AND isMain=1").get(id).count, 1);
    } finally { observer.close(); }
  } finally { store.close(); }
});

test("deleting an idea, destination, or trip removes every owned gallery photo only", (t) => {
  const path = databasePath(t);
  const store = createStore(path);
  const observer = new DatabaseSync(path);
  try {
    const { tripId, destinationId } = seed(store);
    const otherDestinationId = store.applyMutation(destinationInput(tripId, "Paris")).id;
    const ids = [destinationId, destinationId, otherDestinationId].map((owner, index) => store.applyMutation(ideaInput(owner, { category: ["hotels", "activities", "restaurants"][index], gallery: { add: [photo(), photo()], remove: [] } })).id);
    const count = () => observer.prepare("SELECT count(*) AS count FROM candidate_images").get().count;
    assert.equal(count(), 6);
    store.applyMutation({ type: "candidate.delete", id: ids[0] });
    assert.equal(count(), 4);
    assert.equal(store.getCandidateImage(ids[0]), undefined);
    assert.ok(store.getCandidateImage(ids[1]));
    store.applyMutation({ type: "destination.delete", id: destinationId });
    assert.equal(count(), 2);
    assert.equal(store.getCandidateImage(ids[1]), undefined);
    assert.ok(store.getCandidateImage(ids[2]));
    store.applyMutation({ type: "trip.delete", id: tripId });
    assert.equal(count(), 0);
    assert.equal(store.getCandidateImage(ids[2]), undefined);
    assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { observer.close(); store.close(); }
});
