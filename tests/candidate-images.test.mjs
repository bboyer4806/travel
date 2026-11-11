import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { createOwnedStore } from "./owned-store.mjs";
import { fileDatabase } from "./budget-fixtures.mjs";
import { calculateBudget } from "../src/lib/budget.ts";

const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const replacement = new Uint8Array(webp);
replacement[replacement.length - 1] = 1;
const categories = ["hotels", "activities", "restaurants"];
const tripInput = { type: "trip.save", name: "Ideas with images", dateLabel: "Next spring", homeCity: "Boston", returnCity: "New York", travelers: 2, notes: "Shared research" };
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Vienna", stay: "4 nights", notes: "Stay downtown", ...overrides });
const candidateInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "hotels", name: "An idea", price: "200.33", address: "City center", url: "https://example.com/booking", notes: "Worth considering", included: true, ...overrides });
const linksInput = () => [{ id: randomUUID(), url: "https://example.com/booking", description: "Booking options" }, { id: randomUUID(), url: "https://example.com/review", description: "Research notes" }];
const photo = (data = webp) => ({ id: randomUUID(), data });
const gallery = (...photos) => ({ add: photos, remove: [] });
function planConnections(store) {
  for (const leg of store.getSnapshot().legs) {
    store.applyMutation({
      type: "leg.save", id: leg.id, method: "Flight", price: "650.50", departure: "Morning", arrival: "Evening", url: "", notes: "A connection",
      itinerary: [{ id: randomUUID(), kind: "layover", place: "London Heathrow", arrival: "10:00", departure: "12:30", notes: "Change terminals" }],
      links: [{ id: randomUUID(), url: "https://example.com/flights", description: "Flight options" }],
    });
  }
}
function withoutPhotos(candidate) {
  const copy = { ...candidate };
  delete copy.images;
  delete copy.mainImageId;
  return copy;
}

for (const category of categories) {
  test(`${category} images create, persist, replace, and remove without changing planning details`, (t) => {
    const path = fileDatabase(t);
    let store = createOwnedStore(path);
    try {
      const tripId = store.applyMutation(tripInput).id;
      const destinationId = store.applyMutation(destinationInput(tripId, { image: replacement })).id;
      planConnections(store);
      const links = linksInput();
      const input = candidateInput(destinationId, { category, links });
      const alternativeId = store.applyMutation(candidateInput(destinationId, { category, name: "Another idea", included: false })).id;
      const first = photo(webp);
      const candidateId = store.applyMutation({ ...input, gallery: gallery(first) }).id;
      const saved = () => store.getSnapshot().candidates.find((candidate) => candidate.id === candidateId);
      const initialImage = store.getCandidatePhoto(candidateId, first.id);
      assert.ok(initialImage.data instanceof Uint8Array);
      assert.deepEqual(initialImage.data, webp);
      assert.match(initialImage.version, /^[0-9a-f-]{36}$/);
      assert.deepEqual(saved().images, [{ id: first.id, version: initialImage.version }]);
      assert.equal(saved().mainImageId, first.id);
      assert.equal("image" in saved(), false);
      assert.equal("data" in saved(), false);
      assert.equal(store.getCandidatePhoto(randomUUID(), first.id), undefined);
      assert.deepEqual(store.getSnapshot().candidates.find((candidate) => candidate.id === alternativeId).images, []);
      const destinationImage = store.getDestinationImage(destinationId);
      const legs = store.getSnapshot().legs;
      const budget = calculateBudget(store.getSnapshot(), tripId);
      store.applyMutation({ ...input, id: candidateId, links: undefined, notes: "An older client updated notes" });
      assert.deepEqual(store.getCandidatePhoto(candidateId, first.id), initialImage, "omitting photo changes preserves bytes and version");
      assert.deepEqual(saved().links, links, "omitting links preserves every research link");
      const candidateBeforeImageEdit = withoutPhotos(saved());
      const second = photo(replacement);
      store.applyMutation({ ...input, id: candidateId, notes: candidateBeforeImageEdit.notes, gallery: { add: [second], remove: [first.id], mainImageId: second.id } });
      const updatedImage = store.getCandidatePhoto(candidateId, second.id);
      assert.notEqual(updatedImage.version, initialImage.version);
      assert.deepEqual(updatedImage.data, replacement);
      assert.equal(store.getCandidatePhoto(candidateId, first.id), undefined);
      assert.deepEqual(withoutPhotos(saved()), candidateBeforeImageEdit, "photo-only edit preserves all candidate fields");
      assert.deepEqual(store.getSnapshot().legs, legs);
      assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
      assert.equal(store.getSnapshot().candidates.find((candidate) => candidate.id === alternativeId).included, false);
      assert.deepEqual(store.getDestinationImage(destinationId), destinationImage);
      updatedImage.data.fill(0);
      assert.deepEqual(store.getCandidatePhoto(candidateId, second.id).data, replacement, "retrieved bytes cannot mutate stored images");
      const before = store.getSnapshot();
      const beforeImage = store.getCandidatePhoto(candidateId, second.id);
      store.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), before);
      assert.deepEqual(store.getCandidatePhoto(candidateId, second.id), beforeImage);
      store.applyMutation({ ...input, id: candidateId, notes: candidateBeforeImageEdit.notes, gallery: { add: [], remove: [second.id] } });
      assert.equal(store.getCandidatePhoto(candidateId, second.id), undefined);
      assert.equal(saved().mainImageId, null);
      assert.deepEqual(withoutPhotos(saved()), candidateBeforeImageEdit);
      assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
      const third = photo(webp);
      store.applyMutation({ ...input, id: candidateId, gallery: gallery(third) });
      store.applyMutation({ type: "candidate.delete", id: candidateId });
      assert.equal(store.getCandidatePhoto(candidateId, third.id), undefined);
      assert.equal(saved(), undefined);
    } finally {
      store.close();
    }
  });
}

test("candidate deletion removes only its own images, and removing stops or trips keeps them", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  const observer = new DatabaseSync(path);
  try {
    const tripId = store.applyMutation(tripInput).id;
    const firstDestination = store.applyMutation(destinationInput(tripId, { image: webp })).id;
    const secondDestination = store.applyMutation(destinationInput(tripId, { city: "Paris", image: replacement })).id;
    const hotelPhoto = photo(webp), activityPhoto = photo(replacement), restaurantPhoto = photo(webp);
    const hotelId = store.applyMutation(candidateInput(firstDestination, { gallery: gallery(hotelPhoto) })).id;
    const activityId = store.applyMutation(candidateInput(firstDestination, { category: "activities", gallery: gallery(activityPhoto) })).id;
    const restaurantId = store.applyMutation(candidateInput(secondDestination, { category: "restaurants", gallery: gallery(restaurantPhoto) })).id;
    store.applyMutation({ type: "candidate.delete", id: hotelId });
    assert.equal(store.getCandidatePhoto(hotelId, hotelPhoto.id), undefined);
    assert.ok(store.getCandidatePhoto(activityId, activityPhoto.id));
    assert.ok(store.getCandidatePhoto(restaurantId, restaurantPhoto.id));
    assert.equal(observer.prepare("SELECT count(*) AS count FROM candidate_images").get().count, 2);
    store.applyMutation({ type: "stop.remove", id: firstDestination });
    store.applyMutation({ type: "trip.delete", id: tripId });
    assert.ok(store.getCandidatePhoto(activityId, activityPhoto.id));
    assert.ok(store.getCandidatePhoto(restaurantId, restaurantPhoto.id));
    assert.equal(observer.prepare("SELECT count(*) AS count FROM candidate_images").get().count, 2);
    assert.equal(observer.prepare("SELECT count(*) AS count FROM destination_images").get().count, 2);
    assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    observer.close();
    store.close();
  }
});

test("invalid candidate images leave fields, selection, and existing image unchanged", (t) => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput).id;
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  store.applyMutation(candidateInput(destinationId, { name: "Chosen hotel", gallery: gallery(photo(webp)) }));
  const savedPhoto = photo(replacement);
  const candidateId = store.applyMutation(candidateInput(destinationId, { name: "Alternative hotel", included: false, gallery: gallery(savedPhoto) })).id;
  const before = store.getSnapshot();
  const beforeImage = store.getCandidatePhoto(candidateId, savedPhoto.id);
  const wrongRiff = new Uint8Array(webp);
  wrongRiff[0] = 0;
  const wrongWebp = new Uint8Array(webp);
  wrongWebp[8] = 0;
  const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
  oversized.set(webp);
  for (const image of ["https://example.com/image.webp", [...webp], { data: webp }, new Uint16Array(20), new Uint8Array(), webp.subarray(0, 11), wrongRiff, wrongWebp, oversized]) {
    assert.throws(() => store.applyMutation(candidateInput(destinationId, { id: candidateId, name: "Unsaved edit", gallery: gallery(photo(image)) })), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getCandidatePhoto(candidateId, savedPhoto.id), beforeImage);
    assert.throws(() => store.applyMutation(candidateInput(destinationId, { name: "Unsaved new hotel", gallery: gallery(photo(image)) })), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  const otherDestinationId = store.applyMutation(destinationInput(tripId, { city: "Paris" })).id;
  assert.throws(() => store.applyMutation(candidateInput(otherDestinationId, { id: candidateId, gallery: gallery(photo(webp)) })), ValidationError);
  assert.throws(() => store.applyMutation(candidateInput(destinationId, { id: candidateId, category: "activities", gallery: gallery(photo(webp)) })), ValidationError);
  assert.deepEqual(store.getCandidatePhoto(candidateId, savedPhoto.id), beforeImage);
  const boundary = new Uint8Array(2 * 1024 * 1024);
  boundary.set(webp);
  const largest = photo(boundary);
  store.applyMutation(candidateInput(destinationId, { id: candidateId, gallery: gallery(largest) }));
  assert.equal(store.getCandidatePhoto(candidateId, largest.id).data.byteLength, boundary.byteLength);
});

test("image write or removal failures roll back candidate edits and chosen hotel changes", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  const observer = new DatabaseSync(path);
  try {
    const tripId = store.applyMutation(tripInput).id;
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
    store.applyMutation(candidateInput(destinationId, { name: "Chosen hotel", gallery: gallery(photo(webp)) }));
    const savedPhoto = photo(replacement);
    const candidateId = store.applyMutation(candidateInput(destinationId, { name: "Alternative hotel", included: false, gallery: gallery(savedPhoto) })).id;
    const before = store.getSnapshot();
    const beforeImage = store.getCandidatePhoto(candidateId, savedPhoto.id);
    const budget = calculateBudget(before, tripId);
    observer.exec("CREATE TRIGGER reject_candidate_image BEFORE INSERT ON candidate_images BEGIN SELECT RAISE(ABORT, 'Injected candidate image failure'); END;");
    for (const input of [
      candidateInput(destinationId, { id: candidateId, name: "Edited hotel", gallery: gallery(photo(webp)) }),
      candidateInput(destinationId, { name: "New hotel", gallery: gallery(photo(webp)) }),
    ]) {
      assert.throws(() => store.applyMutation(input), /Injected candidate image failure/);
      assert.deepEqual(store.getSnapshot(), before);
      assert.deepEqual(store.getCandidatePhoto(candidateId, savedPhoto.id), beforeImage);
      assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    }
    observer.exec("CREATE TRIGGER reject_candidate_image_removal BEFORE DELETE ON candidate_images BEGIN SELECT RAISE(ABORT, 'Injected candidate image removal failure'); END;");
    assert.throws(() => store.applyMutation(candidateInput(destinationId, { id: candidateId, name: "Edited hotel", gallery: { add: [], remove: [savedPhoto.id] } })), /Injected candidate image removal failure/);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getCandidatePhoto(candidateId, savedPhoto.id), beforeImage);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    observer.close();
    store.close();
  }
});

test("schema 4 upgrade preserves destination images and every record, and schema 8 reopens unchanged", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput).id;
    const destinationId = store.applyMutation(destinationInput(tripId, { image: webp })).id;
    planConnections(store);
    const candidateIds = categories.map((category) => store.applyMutation(candidateInput(destinationId, { category, name: category + " idea", links: linksInput() })).id);
    const before = store.getSnapshot();
    const destinationImage = store.getDestinationImage(destinationId);
    store.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP TABLE candidate_images; PRAGMA user_version = 4;");
    legacy.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getDestinationImage(destinationId), destinationImage);
    const candidateId = candidateIds[0];
    const candidate = before.candidates.find((item) => item.id === candidateId);
    const added = photo(replacement);
    store.applyMutation(candidateInput(destinationId, { id: candidateId, name: candidate.name, links: candidate.links, gallery: gallery(added) }));
    const withImage = store.getSnapshot();
    const candidateImage = store.getCandidatePhoto(candidateId, added.id);
    store.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), withImage);
    assert.deepEqual(store.getDestinationImage(destinationId), destinationImage);
    assert.deepEqual(store.getCandidatePhoto(candidateId, added.id), candidateImage);
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(observer.prepare("PRAGMA table_list").all().find((table) => table.name === "candidate_images").strict, 1);
    } finally {
      observer.close();
    }
    store.close();
    const resetVersion = new DatabaseSync(path);
    resetVersion.exec("PRAGMA user_version = 4");
    resetVersion.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), withImage, "rerunning a migration never replaces existing image metadata");
    assert.deepEqual(store.getCandidatePhoto(candidateId, added.id), candidateImage);
    assert.deepEqual(store.getDestinationImage(destinationId), destinationImage);
  } finally {
    store.close();
  }
});
