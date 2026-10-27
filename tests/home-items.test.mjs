import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createStore, ValidationError } from "../src/lib/store.ts";
import { calculateBudget } from "../src/lib/budget.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Spring trip", dateLabel: "Spring 2027", homeCity: "Boston", travelers: 2, notes: "", ...overrides });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Vienna", stay: "3 nights", notes: "", ...overrides });
const candidateInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "hotels", name: "Hotel", price: "200.33", address: "City center", url: "https://example.com", notes: "Research", included: true, ...overrides });
const homeInput = (tripId, overrides = {}) => ({ type: "homeItem.save", tripId, name: "Arrange pet care", price: "", notes: "Leave the spare key", completed: false, ...overrides });
const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const otherWebp = new Uint8Array(webp);
otherWebp[otherWebp.length - 1] = 1;
const item = (store, id) => store.getSnapshot().homeItems.find((entry) => entry.id === id);
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput()).id;
  return { store, tripId };
}
function databasePath(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-home-items-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}
function pricedTrip(store, tripId) {
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  store.applyMutation(candidateInput(destinationId));
  for (const leg of store.getSnapshot().legs.filter((entry) => entry.tripId === tripId)) {
    store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "100.01", departure: "Morning", arrival: "Afternoon", url: "", notes: "" });
  }
  return destinationId;
}

test("home tasks and expenses support creating, editing, completing, reopening, and deleting", (t) => {
  const { store, tripId } = setup(t);
  assert.deepEqual(store.getSnapshot().homeItems, []);
  const taskId = store.applyMutation(homeInput(tripId, { name: "  Stop the mail  ", notes: "  Submit a hold request  " })).id;
  const task = item(store, taskId);
  assert.match(task.id, /^[0-9a-f-]{36}$/);
  assert.equal(task.tripId, tripId);
  assert.equal(task.name, "Stop the mail");
  assert.equal(task.notes, "Submit a hold request");
  assert.equal(task.priceCents, null);
  assert.equal(task.completed, false);
  assert.ok(Number.isFinite(Date.parse(task.createdAt)));
  const expenseId = store.applyMutation(homeInput(tripId, { name: "Pet sitter", price: "125.50" })).id;
  const original = item(store, expenseId);
  assert.equal(original.priceCents, 12550);
  const beforeCompletion = calculateBudget(store.getSnapshot(), tripId);
  store.applyMutation({ type: "homeItem.complete", id: expenseId, tripId, completed: true });
  assert.deepEqual(item(store, expenseId), { ...original, completed: true });
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), beforeCompletion, "completing an expense does not remove its cost");
  store.applyMutation({ type: "homeItem.complete", id: expenseId, tripId, completed: false });
  assert.deepEqual(item(store, expenseId), original);
  store.applyMutation(homeInput(tripId, { id: expenseId, name: "Confirmed pet sitter", price: "140.75", notes: "Paid a deposit", completed: true }));
  assert.deepEqual(item(store, expenseId), { ...original, name: "Confirmed pet sitter", priceCents: 14075, notes: "Paid a deposit", completed: true });
  assert.deepEqual(item(store, taskId), task);
  store.applyMutation({ type: "homeItem.delete", id: expenseId, tripId });
  assert.equal(item(store, expenseId), undefined);
  assert.deepEqual(store.getSnapshot().homeItems, [task]);
  store.applyMutation({ type: "homeItem.delete", id: taskId, tripId });
  assert.deepEqual(store.getSnapshot().homeItems, []);
});

test("home budget totals distinguish optional tasks, known zero, and exact cents without depending on completion", (t) => {
  const { store, tripId } = setup(t);
  pricedTrip(store, tripId);
  const baseline = calculateBudget(store.getSnapshot(), tripId);
  assert.equal(baseline.complete, false, "miscellaneous spending still needs an estimate");
  assert.equal(baseline.homeCents, 0);
  assert.equal(baseline.totalCents, 40035);
  const taskId = store.applyMutation(homeInput(tripId, { name: "Water plants", price: "  " })).id;
  assert.equal(item(store, taskId).priceCents, null);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), baseline, "a task without an expense does not create a missing estimate");
  const freeId = store.applyMutation(homeInput(tripId, { name: "Mail hold", price: "0" })).id;
  const sitterId = store.applyMutation(homeInput(tripId, { name: "Pet care", price: "125.50" })).id;
  const extraId = store.applyMutation(homeInput(tripId, { name: "Small expense", price: ".10", completed: true })).id;
  const expected = { ...baseline, homeCents: 12560, totalCents: baseline.totalCents + 12560, totalsByCurrency: { USD: baseline.totalCents + 12560 }, knownCount: baseline.knownCount + 3 };
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), expected);
  for (const id of [taskId, freeId, sitterId]) store.applyMutation({ type: "homeItem.complete", id, tripId, completed: true });
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), expected);
  const otherTripId = store.applyMutation(tripInput({ name: "Another trip" })).id;
  store.applyMutation(homeInput(otherTripId, { price: "9999" }));
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), expected, "another trip's costs stay separate");
  store.applyMutation(homeInput(tripId, { id: sitterId, name: "Pet care", price: "", completed: true }));
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), { ...baseline, homeCents: 10, totalCents: baseline.totalCents + 10, totalsByCurrency: { USD: baseline.totalCents + 10 }, knownCount: baseline.knownCount + 2 });
  store.applyMutation({ type: "homeItem.delete", id: extraId, tripId });
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), { ...baseline, knownCount: baseline.knownCount + 1 });
});

test("home expenses count before destinations are planned without hiding missing travel estimates", (t) => {
  const { store, tripId } = setup(t);
  const baseline = calculateBudget(store.getSnapshot(), tripId);
  store.applyMutation(homeInput(tripId, { price: "50.25" }));
  store.applyMutation(homeInput(tripId, { name: "Lock the windows" }));
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), { ...baseline, homeCents: 5025, totalCents: 5025, totalsByCurrency: { USD: 5025 }, knownCount: baseline.knownCount + 1 });
  assert.equal(calculateBudget(store.getSnapshot(), tripId).complete, false);
});

test("every home-item mutation verifies trip ownership and rejects stale or nonexistent records", (t) => {
  const { store, tripId } = setup(t);
  const otherTripId = store.applyMutation(tripInput({ name: "Other trip" })).id;
  const id = store.applyMutation(homeInput(tripId, { price: "50" })).id;
  const otherId = store.applyMutation(homeInput(otherTripId, { name: "Arrange garden care", completed: true })).id;
  const before = store.getSnapshot();
  const missingTripId = randomUUID();
  const missingId = randomUUID();
  const inputs = [
    homeInput(otherTripId, { id, name: "Moved item" }),
    homeInput(tripId, { id: otherId, name: "Moved other item" }),
    homeInput(missingTripId), homeInput(missingTripId, { id }), homeInput(tripId, { id: missingId }),
    ...["homeItem.delete", "homeItem.complete"].flatMap((type) => [
      { type, id, tripId: otherTripId, completed: true },
      { type, id: otherId, tripId, completed: false },
      { type, id, tripId: missingTripId, completed: true },
      { type, id: missingId, tripId, completed: true },
    ]),
  ];
  for (const input of inputs) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  store.applyMutation({ type: "homeItem.delete", id, tripId });
  const afterDelete = store.getSnapshot();
  for (const input of [homeInput(tripId, { id }), { type: "homeItem.complete", id, tripId, completed: true }, { type: "homeItem.delete", id, tripId }]) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), afterDelete, "a stale edit does not recreate a deleted task");
  }
});

test("invalid home-item values leave existing tasks, trip details, and budgets unchanged", (t) => {
  const { store, tripId } = setup(t);
  pricedTrip(store, tripId);
  const id = store.applyMutation(homeInput(tripId, { price: "75.25" })).id;
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId);
  const invalidFields = [
    { name: " " }, { name: null }, { name: "x".repeat(161) }, { notes: 4 }, { notes: "x".repeat(8001) },
    { price: null }, { price: 5 }, { completed: "true" }, { completed: 1 }, { completed: null },
    { tripId: "bad-id" }, { id: "bad-id" },
    ...["-1", "NaN", "Infinity", "1.234", "$1", "1,000", "1e2", "100000000.01"].map((price) => ({ price })),
  ];
  for (const fields of invalidFields) {
    for (const originalId of [undefined, id]) {
      assert.throws(() => store.applyMutation(homeInput(tripId, { id: originalId, ...fields })), ValidationError);
      assert.deepEqual(store.getSnapshot(), before);
      assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    }
  }
  for (const input of [
    { type: "homeItem.complete", id, tripId, completed: "false" },
    { type: "homeItem.complete", id, tripId },
    { type: "homeItem.complete", id: "bad-id", tripId, completed: true },
    { type: "homeItem.delete", id, tripId: "bad-id" },
    { type: "homeItem.delete", id },
  ]) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  const boundaryId = store.applyMutation(homeInput(tripId, { name: "x".repeat(160), notes: "x".repeat(8000), price: "100000000" })).id;
  assert.equal(item(store, boundaryId).priceCents, 10_000_000_000);
});

test("home items survive database reopening with their exact amounts, notes, and completion state", (t) => {
  const path = databasePath(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const taskId = store.applyMutation(homeInput(tripId)).id;
    const expenseId = store.applyMutation(homeInput(tripId, { name: "House sitter", price: "305.29", completed: true, notes: "Arrives Friday\nEmergency contact has a key" })).id;
    const before = store.getSnapshot();
    const budget = calculateBudget(before, tripId);
    store.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    assert.equal(item(store, taskId).completed, false);
    assert.equal(item(store, taskId).priceCents, null);
    assert.equal(item(store, expenseId).completed, true);
    assert.equal(item(store, expenseId).priceCents, 30529);
    store.applyMutation({ type: "homeItem.complete", id: expenseId, tripId, completed: false });
    const reopened = store.getSnapshot();
    store.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), reopened);
    assert.equal(item(store, expenseId).completed, false);
  } finally { store.close(); }
});

test("deleting a trip cascades only its home items, while destination changes preserve them", (t) => {
  const path = databasePath(t);
  const store = createStore(path);
  const observer = new DatabaseSync(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const otherTripId = store.applyMutation(tripInput({ name: "Another trip" })).id;
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
    const ownedIds = [store.applyMutation(homeInput(tripId)).id, store.applyMutation(homeInput(tripId, { price: "90", completed: true })).id];
    const otherId = store.applyMutation(homeInput(otherTripId, { price: "27.01" })).id;
    const otherItem = item(store, otherId);
    const otherBudget = calculateBudget(store.getSnapshot(), otherTripId);
    store.applyMutation({ type: "destination.delete", id: destinationId });
    assert.ok(ownedIds.every((id) => item(store, id)), "home tasks belong to the trip, not a destination");
    store.applyMutation(tripInput({ id: tripId, homeCity: "New York", name: "Revised trip" }));
    assert.ok(ownedIds.every((id) => item(store, id)));
    store.applyMutation({ type: "trip.delete", id: tripId });
    assert.deepEqual(store.getSnapshot().homeItems, [otherItem]);
    assert.deepEqual(calculateBudget(store.getSnapshot(), otherTripId), otherBudget);
    assert.equal(observer.prepare("SELECT count(*) AS count FROM home_items").get().count, 1);
    assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    store.applyMutation({ type: "trip.delete", id: otherTripId });
    assert.equal(observer.prepare("SELECT count(*) AS count FROM home_items").get().count, 0);
  } finally { observer.close(); store.close(); }
});

test("storage failures roll back home-item edits, deletions, and trip cascades", (t) => {
  const path = databasePath(t);
  const store = createStore(path);
  const observer = new DatabaseSync(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const destinationId = pricedTrip(store, tripId);
    store.applyMutation(candidateInput(destinationId, { name: "Alternate hotel", included: false, gallery: { add: [{ id: randomUUID(), data: webp }], remove: [] } }));
    const id = store.applyMutation(homeInput(tripId, { price: "98.76" })).id;
    const before = store.getSnapshot();
    const budget = calculateBudget(before, tripId);
    observer.exec("CREATE TRIGGER reject_home_update BEFORE UPDATE ON home_items BEGIN SELECT RAISE(ABORT, 'Injected home-item failure'); END; CREATE TRIGGER reject_home_insert BEFORE INSERT ON home_items BEGIN SELECT RAISE(ABORT, 'Injected home-item failure'); END; CREATE TRIGGER reject_home_delete BEFORE DELETE ON home_items BEGIN SELECT RAISE(ABORT, 'Injected home-item failure'); END;");
    const inputs = [
      homeInput(tripId, { id, name: "Unsaved change", price: "99", completed: true }),
      homeInput(tripId, { name: "Unsaved new item" }),
      { type: "homeItem.complete", id, tripId, completed: true },
      { type: "homeItem.delete", id, tripId },
      { type: "trip.delete", id: tripId },
    ];
    for (const input of inputs) {
      assert.throws(() => store.applyMutation(input), /Injected home-item failure/);
      assert.deepEqual(store.getSnapshot(), before);
      assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
      assert.equal(observer.prepare("SELECT count(*) AS count FROM candidate_images").get().count, 1);
    }
    assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { observer.close(); store.close(); }
});

test("schema 6 migration adds home items while preserving trips, research, itineraries, and photo galleries", (t) => {
  const path = databasePath(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const destinationId = store.applyMutation(destinationInput(tripId, { image: webp })).id;
    const photos = [{ id: randomUUID(), data: webp }, { id: randomUUID(), data: otherWebp }];
    const candidateId = store.applyMutation(candidateInput(destinationId, { links: [{ id: randomUUID(), url: "https://example.com", description: "Booking research" }], gallery: { add: photos, remove: [], mainImageId: photos[1].id } })).id;
    const firstLeg = store.getSnapshot().legs.find((entry) => entry.tripId === tripId);
    store.applyMutation({ type: "leg.save", id: firstLeg.id, method: "Flight", price: "210.10", departure: "Morning", arrival: "Evening", url: "https://example.com/flights", notes: "Keep itinerary", itinerary: [{ id: randomUUID(), kind: "layover", place: "London", arrival: "10:00", departure: "12:00", notes: "Change planes" }], links: [{ id: randomUUID(), url: "https://example.com/flights", description: "Flight research" }] });
    const before = store.getSnapshot();
    const originalPhotos = photos.map((photo) => store.getCandidatePhoto(candidateId, photo.id));
    const destinationPhoto = store.getDestinationImage(destinationId);
    store.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP TABLE home_items; PRAGMA user_version=6;");
    legacy.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getSnapshot().homeItems, []);
    assert.deepEqual(photos.map((photo) => store.getCandidatePhoto(candidateId, photo.id)), originalPhotos);
    assert.deepEqual(store.getCandidateImage(candidateId), originalPhotos[1]);
    assert.deepEqual(store.getDestinationImage(destinationId), destinationPhoto);
    store.applyMutation(homeInput(tripId));
    store.applyMutation(homeInput(tripId, { name: "Confirmed pet care", price: "117.25", completed: true }));
    const upgraded = store.getSnapshot();
    const budget = calculateBudget(upgraded, tripId);
    store.close();
    const reset = new DatabaseSync(path);
    assert.equal(reset.prepare("PRAGMA user_version").get().user_version, 12);
    assert.equal(reset.prepare("PRAGMA table_list").all().find((table) => table.name === "home_items").strict, 1);
    reset.exec("PRAGMA user_version=6");
    reset.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), upgraded, "repeating the additive migration preserves saved home tasks and expenses");
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    assert.deepEqual(photos.map((photo) => store.getCandidatePhoto(candidateId, photo.id)), originalPhotos);
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 12);
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store.close(); }
});
