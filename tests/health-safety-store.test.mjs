import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { calculateBudget } from "../src/lib/budget.ts";
import { fileDatabase, newItem } from "./budget-fixtures.mjs";
import { createOwnedStore } from "./owned-store.mjs";

const details = () => ({
  advisoryLevel: "Level 2: Exercise increased caution", advisoryWarnings: "Demonstrations possible in the capital",
  healthPrecautions: "Routine vaccines; hepatitis A recommended", localSafety: "Pickpockets on trams; taxi scams at the airport",
  emergencyContacts: [{ id: randomUUID(), name: "Emergency services", phone: "112", notes: "Police, fire and ambulance" }, { id: randomUUID(), name: "Embassy", phone: "+1 202 555 0100", notes: "" }],
  sources: [{ id: randomUUID(), url: "https://example.gov/advisory", description: "Government travel advisory" }],
  lastCheckedDate: "2026-11-10",
});
const requirements = () => ({ passportNationality: "United States", travelPurpose: "Tourism", travelerCircumstances: "", visaRequirements: "None for short stays", passportValidity: "", requiredDocuments: "", transitRequirements: "", notes: "", sources: [], lastCheckedDate: "2026-11-03" });
const destination = (snapshot, id) => snapshot.destinations.find((item) => item.id === id);
function seed(store, city = "Destination") {
  const tripId = store.applyMutation({ type: "trip.save", ...newItem(), name: "Health and safety", startDate: "2026-11-01", dateLabel: "", homeCity: "Home", travelers: 2, notes: "" }).id;
  const id = store.applyMutation({ type: "destination.save", ...newItem(), tripId, city, stay: "Keep stay", notes: "Keep notes", nights: 3, hotelNightlyAmount: "150", miscDailyAmount: "20" }).id;
  return { tripId, id };
}

test("health and safety edits are destination-scoped and leave budgets, routes and entry requirements as they were", (t) => {
  const store = createOwnedStore(":memory:"); t.after(() => store.close());
  const { tripId, id } = seed(store); const other = seed(store, "Other destination");
  store.applyMutation({ type: "destination.entryRequirements", id, requirements: requirements() });
  const before = store.getSnapshot(); const budget = calculateBudget(before, tripId);
  assert.equal(destination(before, id).healthSafety, null);
  const healthSafety = details();
  store.applyMutation({ type: "destination.healthSafety", id, healthSafety });
  const after = store.getSnapshot();
  assert.deepEqual(destination(after, id).healthSafety, healthSafety);
  for (const [key, value] of Object.entries(destination(before, id))) if (key !== "healthSafety") assert.deepEqual(destination(after, id)[key], value, key);
  assert.deepEqual(destination(after, other.id), destination(before, other.id));
  assert.deepEqual([after.trips, after.stops, after.legs, after.candidates], [before.trips, before.stops, before.legs, before.candidates]);
  assert.deepEqual(calculateBudget(after, tripId), budget);

  // Schedule changes, a new city name and other edits keep it, including the date it was last checked.
  store.applyMutation({ type: "trip.save", id: tripId, name: "Health and safety", startDate: "2027-01-05", dateLabel: "", homeCity: "Home", travelers: 2, notes: "" });
  store.applyMutation({ type: "destination.save", id, stopId: id, city: "Renamed", nights: 7 });
  store.applyMutation({ type: "destination.save", id, notes: "Changed notes", weatherHighF: 70, shoppingAmount: "40" });
  store.applyMutation({ type: "destination.entryRequirements", id, requirements: null });
  assert.deepEqual(destination(store.getSnapshot(), id).healthSafety, healthSafety);
});

test("saving replaces the record as edited, never sets the last checked date, and Clear removes it", (t) => {
  const store = createOwnedStore(":memory:"); t.after(() => store.close());
  const { id } = seed(store); const other = seed(store, "Other destination");
  const healthSafety = details();
  store.applyMutation({ type: "destination.healthSafety", id, healthSafety });
  const saved = () => destination(store.getSnapshot(), id).healthSafety;

  // Contacts are added, edited and removed with the rest of the record.
  const [, embassy] = healthSafety.emergencyContacts;
  const insurer = { id: randomUUID(), name: "Travel insurer", phone: "+44 20 7946 0000", notes: "Policy number in the trip folder" };
  const edited = { ...healthSafety, localSafety: "Updated after checking", emergencyContacts: [{ ...embassy, phone: "+1 202 555 0199" }, insurer] };
  store.applyMutation({ type: "destination.healthSafety", id, healthSafety: edited });
  assert.deepEqual(saved(), edited);
  assert.equal(saved().lastCheckedDate, "2026-11-10", "saving an edit keeps the recorded date");
  store.applyMutation({ type: "destination.healthSafety", id, healthSafety: { ...edited, lastCheckedDate: null } });
  assert.equal(saved().lastCheckedDate, null, "saving without a date never fills one in");
  store.applyMutation({ type: "destination.healthSafety", id, healthSafety: { ...edited, emergencyContacts: [], sources: [], lastCheckedDate: null } });
  assert.deepEqual([saved().emergencyContacts, saved().sources, saved().localSafety], [[], [], "Updated after checking"]);

  // Invalid changes, and changes to a destination that doesn't exist, are refused and change nothing.
  const before = store.getSnapshot();
  for (const invalid of [undefined, "advisory", [], { ...edited, lastCheckedDate: "2026-02-30" }, { ...edited, emergencyContacts: [{ id: randomUUID(), name: "", phone: "112" }] },
    { ...edited, emergencyContacts: [{ id: randomUUID(), name: "Front desk", phone: "ask at reception" }] }, { ...edited, sources: [{ id: randomUUID(), url: "javascript:alert(1)" }] }]) {
    assert.throws(() => store.applyMutation({ type: "destination.healthSafety", id, healthSafety: invalid }), ValidationError);
  }
  assert.throws(() => store.applyMutation({ type: "destination.healthSafety", id: randomUUID(), healthSafety }), ValidationError);
  assert.throws(() => store.applyMutation({ type: "destination.healthSafety", id: "not-an-id", healthSafety }), ValidationError);
  assert.deepEqual(store.getSnapshot(), before);

  store.applyMutation({ type: "destination.healthSafety", id, healthSafety: null });
  assert.equal(saved(), null);
  assert.equal(destination(store.getSnapshot(), other.id).healthSafety, null);
});

test("schema 22 upgrade, replay, reopen and online backup keep health and safety, which outlives its trips and goes with its destination", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path); const { tripId, id } = seed(store); const before = store.getSnapshot(); store.close();
  // A schema 21 database, from before health and safety research.
  let db = new DatabaseSync(path); db.exec("DROP TABLE destination_health_safety; PRAGMA user_version = 21;"); db.close();
  store = createOwnedStore(path); assert.deepEqual(store.getSnapshot(), before, "the upgrade changes nothing saved");
  const healthSafety = details(); store.applyMutation({ type: "destination.healthSafety", id, healthSafety });
  const saved = store.getSnapshot(); store.close();
  db = new DatabaseSync(path); db.exec("PRAGMA user_version = 21;"); db.close();
  store = createOwnedStore(path); assert.deepEqual(store.getSnapshot(), saved, "replaying the upgrade keeps saved research"); store.close();
  store = createOwnedStore(path); assert.deepEqual(store.getSnapshot(), saved); store.close();

  const backup = join(path, "..", "backup.sqlite");
  const result = spawnSync(process.execPath, ["scripts/backup.mjs", backup], { env: { ...process.env, TRAVEL_DATABASE_PATH: path }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  store = createOwnedStore(backup); assert.deepEqual(store.getSnapshot(), saved, "the backup restores it");
  store.applyMutation({ type: "stop.remove", id }); store.applyMutation({ type: "trip.delete", id: tripId });
  assert.deepEqual(destination(store.getSnapshot(), id).healthSafety, healthSafety, "removing the stop and deleting the trip keep the destination's research");
  store.close();
  db = new DatabaseSync(backup);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    // Travel never deletes a destination, but if one is deleted its research goes with it.
    const records = () => db.prepare("SELECT count(*) AS n FROM destination_health_safety").get().n;
    assert.equal(records(), 1);
    db.exec("PRAGMA foreign_keys = ON;");
    db.prepare("DELETE FROM destinations WHERE id = ?").run(id);
    assert.equal(records(), 0);
  } finally { db.close(); }
});
