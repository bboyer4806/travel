import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { createOwnedStore } from "./owned-store.mjs";
import { addCity, fileDatabase, newItem, prepared } from "./budget-fixtures.mjs";
import { calculateBudget } from "../src/lib/budget.ts";

const tripInput = { type: "trip.save", name: "Planning priorities", dateLabel: "", homeCity: "Home", travelers: 2, notes: "" };
const ideaInput = (destinationId, category, name, overrides = {}) => ({ type: "candidate.save", destinationId, category, name, price: "12.34", included: false, address: "Address", url: "https://example.com", notes: "Keep these details", ...overrides, ...newItem(overrides) });
const image = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQtSZVrP+BiOh/AAA=", "base64");
const list = (store, destinationId, category) => store.getSnapshot().candidates.filter(item => item.destinationId === destinationId && item.category === category);
const ids = (store, destinationId, category) => list(store, destinationId, category).map(item => item.id);
function seed(store, city = "Paris") {
  const tripId = store.applyMutation({ ...tripInput, ...newItem() }).id;
  const destinationId = addCity((input) => store.applyMutation(input).id, tripId, city, { nights: 3 });
  return { tripId, destinationId };
}

for (const category of ["hotels", "activities", "restaurants"]) {
  test(`${category}: moves are scoped, preserve details, and append after deletion`, t => {
    const store = createOwnedStore(":memory:");
    t.after(() => store.close());
    const { tripId, destinationId } = seed(store);
    const otherDestination = seed(store, "Lyon").destinationId;
    store.applyMutation(ideaInput(otherDestination, category, "Other trip"));
    for (const other of ["hotels", "activities", "restaurants"].filter(value => value !== category)) {
      store.applyMutation(ideaInput(destinationId, other, "Other category"));
    }
    const photoId = randomUUID();
    const a = store.applyMutation(ideaInput(destinationId, category, "Zulu", { included: true, gallery: { add: [{ id: photoId, ...prepared(image) }], remove: [], mainImageId: photoId } })).id;
    const b = store.applyMutation(ideaInput(destinationId, category, "Alpha")).id;
    const c = store.applyMutation(ideaInput(destinationId, category, "Middle")).id;
    const before = store.getSnapshot();
    const budget = calculateBudget(before, tripId);
    assert.deepEqual(ids(store, destinationId, category), [a, b, c], "creation order, not alphabetical");
    store.applyMutation({ type: "candidate.move", id: a, direction: "up" });
    store.applyMutation({ type: "candidate.move", id: c, direction: "down" });
    assert.deepEqual(store.getSnapshot(), before, "boundary moves are no-ops");
    store.applyMutation({ type: "candidate.move", id: c, direction: "up" });
    assert.deepEqual(ids(store, destinationId, category), [a, c, b]);
    store.applyMutation({ type: "candidate.move", id: a, direction: "down" });
    assert.deepEqual(ids(store, destinationId, category), [c, a, b]);
    const withoutPosition = (item) => { const copy = { ...item }; delete copy.position; return copy; };
    for (const item of before.candidates) {
      assert.deepEqual(withoutPosition(store.getSnapshot().candidates.find(saved => saved.id === item.id)), withoutPosition(item));
    }
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    assert.deepEqual(Buffer.from(store.getCandidatePhoto(a, photoId).data), image);
    assert.deepEqual(store.getSnapshot().legs, before.legs);
    store.applyMutation(ideaInput(destinationId, category, "A renamed idea", { id: a, included: true }));
    assert.deepEqual(ids(store, destinationId, category), [c, a, b], "renaming retains order");
    store.applyMutation({ type: "candidate.delete", id: a });
    const d = store.applyMutation(ideaInput(destinationId, category, "AAAA new idea")).id;
    assert.deepEqual(ids(store, destinationId, category), [c, b, d]);
    store.applyMutation({ type: "candidate.move", id: d, direction: "up" });
    assert.deepEqual(ids(store, destinationId, category), [c, d, b], "gaps after deletion are harmless");
    assert.throws(() => store.applyMutation({ type: "candidate.move", id: d, direction: "left" }), ValidationError);
    assert.throws(() => store.applyMutation({ type: "candidate.move", id: a, direction: "up" }), ValidationError);
  });
}

test("Must do can be saved, toggled and cleared for hotels, activities and restaurants, independently of budgets and order", t => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const { tripId, destinationId } = seed(store);
  for (const category of ["hotels", "activities", "restaurants"]) {
    const id = store.applyMutation(ideaInput(destinationId, category, "Priority", { mustDo: true, price: "" })).id;
    const otherId = store.applyMutation(ideaInput(destinationId, category, "Alternative")).id;
    assert.equal(list(store, destinationId, category)[0].mustDo, true);
    assert.equal(list(store, destinationId, category)[1].mustDo, false);
    const budget = calculateBudget(store.getSnapshot(), tripId);
    store.applyMutation({ type: "candidate.mustDo", id, mustDo: false });
    store.applyMutation({ type: "candidate.mustDo", id: otherId, mustDo: true });
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget, "priority never includes unknown or known prices");
    assert.deepEqual(ids(store, destinationId, category), [id, otherId]);
    store.applyMutation(ideaInput(destinationId, category, "Renamed", { id: otherId }));
    assert.equal(list(store, destinationId, category)[1].mustDo, true, "older clients preserve omitted priority");
    store.applyMutation({ type: "candidate.include", id: otherId, included: true });
    assert.equal(list(store, destinationId, category)[1].mustDo, true);
    store.applyMutation(ideaInput(destinationId, category, "Renamed", { id: otherId, mustDo: false, included: true }));
    assert.equal(list(store, destinationId, category)[1].mustDo, false);
    store.applyMutation({ type: "destination.save", id: destinationId, stopId: destinationId, city: "Paris", stay: "", notes: "", activitiesBudgetMode: "general", activitiesGeneralAmount: "40", foodBudgetMode: "daily", foodDailyAmount: "30" });
    const generalBudget = calculateBudget(store.getSnapshot(), tripId);
    store.applyMutation({ type: "candidate.mustDo", id, mustDo: true });
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), generalBudget);
    const before = store.getSnapshot();
    for (const mustDo of [null, 1, "true"]) {
      assert.throws(() => store.applyMutation({ type: "candidate.mustDo", id, mustDo }), ValidationError);
      assert.throws(() => store.applyMutation(ideaInput(destinationId, category, "Invalid", { id, mustDo })), ValidationError);
    }
    assert.deepEqual(store.getSnapshot(), before);
  }
  // A Must do hotel isn't chosen, and the chosen one stays chosen, and the only one, whether it is Must do or not (TRA-181).
  const [priority, chosen] = list(store, destinationId, "hotels");
  assert.deepEqual([priority.mustDo, priority.included, chosen.mustDo, chosen.included], [true, false, false, true]);
  const budget = calculateBudget(store.getSnapshot(), tripId);
  store.applyMutation({ type: "candidate.mustDo", id: chosen.id, mustDo: true });
  store.applyMutation({ type: "candidate.mustDo", id: priority.id, mustDo: false });
  assert.deepEqual(list(store, destinationId, "hotels").map(item => [item.id, item.included, item.mustDo]), [[priority.id, false, false], [chosen.id, true, true]]);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget, "the chosen hotel's price still supplies the accommodation");
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation({ type: "candidate.mustDo", id: randomUUID(), mustDo: true }), ValidationError);
  assert.deepEqual(store.getSnapshot(), before);
});

test("schema 15 upgrade retains alphabetical lists; replay, reopen and online backup retain new choices", t => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  const { tripId, destinationId } = seed(store);
  const photoId = randomUUID();
  for (const category of ["hotels", "activities", "restaurants"]) {
    for (const name of ["Zulu", "alpha", "Alpha", "Middle"]) {
      store.applyMutation(ideaInput(destinationId, category, name));
    }
  }
  const photoOwner = list(store, destinationId, "activities")[0].id;
  store.applyMutation(ideaInput(destinationId, "activities", "Zulu", { id: photoOwner, gallery: { add: [{ id: photoId, ...prepared(image) }], remove: [], mainImageId: photoId } }));
  store.close();
  const legacy = new DatabaseSync(path);
  legacy.exec("DROP INDEX candidate_order; ALTER TABLE candidates DROP COLUMN position; ALTER TABLE candidates DROP COLUMN mustDo; PRAGMA user_version = 15;");
  const expected = legacy.prepare("SELECT id FROM candidates ORDER BY destinationId, category, name COLLATE NOCASE, id").all().map(row => row.id);
  legacy.close();
  store = createOwnedStore(path);
  assert.deepEqual(store.getSnapshot().candidates.map(item => item.id), expected);
  assert.ok(store.getSnapshot().candidates.every(item => item.mustDo === false));
  for (const category of ["hotels", "activities", "restaurants"]) {
    assert.deepEqual(list(store, destinationId, category).map(item => item.position), [0, 1, 2, 3]);
    store.applyMutation({ type: "candidate.move", id: list(store, destinationId, category)[3].id, direction: "up" });
  }
  store.applyMutation({ type: "candidate.mustDo", id: photoOwner, mustDo: true });
  const saved = store.getSnapshot();
  const budget = calculateBudget(saved, tripId);
  store.close();
  const reset = new DatabaseSync(path);
  reset.exec("PRAGMA user_version = 15;");
  reset.close();
  store = createOwnedStore(path);
  assert.deepEqual(store.getSnapshot(), saved, "migration replay preserves saved order, priority and all other fields");
  store.close();
  store = createOwnedStore(path);
  assert.deepEqual(store.getSnapshot(), saved, "normal restart preserves choices");
  const backupPath = join(path, "..", "backup.sqlite");
  const result = spawnSync(process.execPath, ["scripts/backup.mjs", backupPath], { env: { ...process.env, TRAVEL_DATABASE_PATH: path }, encoding: "utf8" });
  store.close();
  assert.equal(result.status, 0, result.stderr);
  const restored = createOwnedStore(backupPath);
  try {
    assert.deepEqual(restored.getSnapshot(), saved);
    assert.deepEqual(calculateBudget(restored.getSnapshot(), tripId), budget);
    assert.deepEqual(Buffer.from(restored.getCandidatePhoto(photoOwner, photoId).data), image);
  } finally { restored.close(); }
  const observer = new DatabaseSync(backupPath);
  assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
  observer.close();
});

test("schema 50 databases upgrade keeping every idea's Must do and hotels unmarked; replay, reopen and online backup keep a hotel marked since (TRA-181)", t => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  const { tripId, destinationId } = seed(store);
  const photoId = randomUUID();
  const ideas = {
    chosen: store.applyMutation(ideaInput(destinationId, "hotels", "Chosen stay", { included: true, gallery: { add: [{ id: photoId, ...prepared(image) }], remove: [], mainImageId: photoId }, coordinates: { latitude: 48.20849, longitude: 16.37208, accuracy: "exact" } })).id,
    other: store.applyMutation(ideaInput(destinationId, "hotels", "Other stay")).id,
    tour: store.applyMutation(ideaInput(destinationId, "activities", "Tour", { mustDo: true })).id,
    museum: store.applyMutation(ideaInput(destinationId, "activities", "Museum")).id,
    bistro: store.applyMutation(ideaInput(destinationId, "restaurants", "Bistro", { mustDo: true, restaurantTypes: ["dinner"] })).id,
  };
  store.applyMutation({ type: "candidate.move", id: ideas.museum, direction: "up" });
  store.applyMutation({ type: "candidate.like", id: ideas.other, liked: true });
  const saved = store.getSnapshot();
  const budget = calculateBudget(saved, tripId);
  store.close();
  // Schema 50 refused Must do for hotels with a check on the column.
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    ALTER TABLE candidates RENAME COLUMN mustDo TO laterMustDo;
    ALTER TABLE candidates ADD COLUMN mustDo INTEGER NOT NULL DEFAULT 0 CHECK(mustDo IN (0,1) AND (category != 'hotels' OR mustDo = 0));
    UPDATE candidates SET mustDo = laterMustDo;
    ALTER TABLE candidates DROP COLUMN laterMustDo;
    PRAGMA user_version = 50;
  `);
  assert.throws(() => legacy.exec("UPDATE candidates SET mustDo = 1 WHERE category = 'hotels'"), /CHECK constraint failed/);
  legacy.close();

  store = createOwnedStore(path);
  assert.deepEqual(store.getSnapshot(), saved, "every idea keeps its Must do, order, selection, price, photos, links and coordinates");
  assert.deepEqual(list(store, destinationId, "hotels").map(item => item.mustDo), [false, false], "every hotel starts unmarked");
  assert.deepEqual(store.getTripSnapshot(tripId).data.likes.candidate[ideas.other], { count: 1, liked: true }, "and keeps its likes");
  assert.deepEqual(Buffer.from(store.getCandidatePhoto(ideas.chosen, photoId).data), image);
  // A hotel can be Must do now, from its star or its editor, and the chosen hotel stays chosen.
  store.applyMutation({ type: "candidate.mustDo", id: ideas.other, mustDo: true });
  store.applyMutation(ideaInput(destinationId, "hotels", "Chosen stay", { id: ideas.chosen, included: true, mustDo: true }));
  assert.deepEqual(list(store, destinationId, "hotels").map(item => [item.name, item.included, item.mustDo]), [["Chosen stay", true, true], ["Other stay", false, true]]);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
  const later = store.getSnapshot();
  // A replay of schema 51, also after the schema 1 build resets the schema version, keeps it, as a restart does.
  for (const version of [50, 1, SCHEMA_VERSION]) {
    store.close();
    const replay = new DatabaseSync(path);
    replay.exec(`PRAGMA user_version = ${version};`);
    replay.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), later, `opening at schema ${version} keeps what was saved`);
  }
  const backupPath = join(path, "..", "backup.sqlite");
  const result = spawnSync(process.execPath, ["scripts/backup.mjs", backupPath], { env: { ...process.env, TRAVEL_DATABASE_PATH: path }, encoding: "utf8" });
  store.close();
  assert.equal(result.status, 0, result.stderr);
  const restored = createOwnedStore(backupPath);
  try {
    assert.deepEqual(restored.getSnapshot(), later);
    assert.deepEqual(Buffer.from(restored.getCandidatePhoto(ideas.chosen, photoId).data), image);
  } finally { restored.close(); }
  const observer = new DatabaseSync(path);
  try {
    assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    // One Must do column, still only 0 or 1, and the table's indexes.
    const columns = observer.prepare("PRAGMA table_info(candidates)").all().filter(info => /mustdo/i.test(info.name));
    assert.deepEqual(columns.map(({ name, type, notnull, dflt_value }) => ({ name, type, notnull, dflt_value })), [{ name: "mustDo", type: "INTEGER", notnull: 1, dflt_value: "0" }]);
    observer.exec("BEGIN");
    assert.throws(() => observer.prepare("UPDATE candidates SET mustDo = 2 WHERE id = ?").run(ideas.tour), /CHECK constraint failed/);
    observer.exec("ROLLBACK");
    assert.deepEqual(observer.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'candidates' AND sql IS NOT NULL ORDER BY name").all().map(row => row.name), ["candidate_order", "candidates_destination", "selected_hotel"]);
    assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { observer.close(); }
});
