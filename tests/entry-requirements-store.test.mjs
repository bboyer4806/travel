import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createStore, ValidationError } from "../src/lib/store.ts";
import { calculateBudget } from "../src/lib/budget.ts";

const details = () => ({ passportNationality: "United States", travelPurpose: "Tourism", travelerCircumstances: "Two adult travelers", visaRequirements: "Check authorization before departure", passportValidity: "Check validity rules", requiredDocuments: "Return ticket; check health documents", transitRequirements: "Check transit country separately", notes: "Manually researched", sources: [{ id: randomUUID(), url: "https://example.gov/entry", description: "Government entry guidance" }], lastCheckedDate: "2026-11-03" });
function seed(store) {
  const tripId = store.applyMutation({ type: "trip.save", name: "Requirements", startDate: "2026-11-01", dateLabel: "", homeCity: "Home", travelers: 2, notes: "" }).id;
  const id = store.applyMutation({ type: "destination.save", tripId, city: "Destination", stay: "Keep stay", notes: "Keep notes", nights: 3 }).id;
  return { tripId, id };
}

test("requirements edits are destination-scoped, preserve budgets/routes, and survive schedule changes", t => {
  const store = createStore(":memory:"); t.after(() => store.close());
  const { tripId, id } = seed(store); const other = seed(store);
  const before = store.getSnapshot(); const budget = calculateBudget(before, tripId);
  assert.equal(before.destinations.find(d => d.id === id).entryRequirements, null);
  const requirements = details();
  store.applyMutation({ type: "destination.entryRequirements", id, tripId, requirements });
  const after = store.getSnapshot();
  assert.deepEqual(after.destinations.find(d => d.id === id).entryRequirements, requirements);
  assert.deepEqual(after.destinations.find(d => d.id === other.id), before.destinations.find(d => d.id === other.id));
  assert.deepEqual(after.legs, before.legs);
  assert.deepEqual(calculateBudget(after, tripId), budget);
  for (const [key, value] of Object.entries(before.destinations.find(d => d.id === id))) if (key !== "entryRequirements") assert.deepEqual(after.destinations.find(d => d.id === id)[key], value);
  store.applyMutation({ type: "destination.save", id, tripId, city: "Renamed", nights: 7 });
  assert.deepEqual(store.getSnapshot().destinations.find(d => d.id === id).entryRequirements, requirements);
  assert.throws(() => store.applyMutation({ type: "destination.entryRequirements", id, tripId: other.tripId, requirements: null }), ValidationError);
  assert.throws(() => store.applyMutation({ type: "destination.entryRequirements", id: randomUUID(), tripId, requirements }), ValidationError);
  assert.throws(() => store.applyMutation({ type: "destination.entryRequirements", id, tripId, requirements: { ...requirements, lastCheckedDate: "2026-02-30" } }), ValidationError);
  store.applyMutation({ type: "destination.entryRequirements", id, tripId, requirements: { ...requirements, notes: "Updated" } });
  assert.equal(store.getSnapshot().destinations.find(d => d.id === id).entryRequirements.notes, "Updated");
  store.applyMutation({ type: "destination.entryRequirements", id, tripId, requirements: null });
  assert.equal(store.getSnapshot().destinations.find(d => d.id === id).entryRequirements, null);
});

test("schema 18 upgrade, replay, reopen, online backup and cascade preserve requirements correctly", t => {
  const folder = mkdtempSync(join(tmpdir(), "travel-entry-requirements-"));
  t.after(() => { const target = resolve(folder); assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith("travel-entry-requirements-")); rmSync(target, { recursive: true, force: true }); });
  const path = join(folder, "travel.sqlite");
  let store = createStore(path); const { tripId, id } = seed(store); const before = store.getSnapshot(); store.close();
  let db = new DatabaseSync(path); db.exec("DROP TABLE destination_entry_requirements; PRAGMA user_version = 17;"); db.close();
  store = createStore(path); assert.deepEqual(store.getSnapshot(), before);
  const requirements = details(); store.applyMutation({ type: "destination.entryRequirements", id, tripId, requirements });
  const saved = store.getSnapshot(); store.close();
  db = new DatabaseSync(path); db.exec("PRAGMA user_version = 17;"); db.close();
  store = createStore(path); assert.deepEqual(store.getSnapshot(), saved); store.close();
  store = createStore(path); assert.deepEqual(store.getSnapshot(), saved); store.close();
  const backup = join(folder, "backup.sqlite");
  const result = spawnSync(process.execPath, ["scripts/backup.mjs", backup], { env: { ...process.env, TRAVEL_DATABASE_PATH: path }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  store = createStore(backup); assert.deepEqual(store.getSnapshot(), saved);
  store.applyMutation({ type: "destination.delete", id }); store.close();
  db = new DatabaseSync(backup); assert.equal(db.prepare("SELECT count(*) AS n FROM destination_entry_requirements").get().n, 0);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); db.close();
});
