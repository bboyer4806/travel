import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget } from "../src/lib/budget.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { createStore, SCHEMA_VERSION } from "../src/lib/store.ts";
import { aiSetup } from "./ai-fixtures.mjs";
import { addDestination, fileDatabase, setup, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

// TRA-45: each layover's plan, saved with its connection's trip, changed only by leg.layoverPlan, and gone with its layover.
const FRA = "f0000000-0000-4000-8000-000000000001";
const HEIDELBERG = "f0000000-0000-4000-8000-000000000002";
const LHR = "f0000000-0000-4000-8000-000000000003";
const OLD_TOWN = "a0000000-0000-4000-8000-000000000001";
const LOUNGE = "a0000000-0000-4000-8000-000000000002";
const layover = (id, place) => ({ id, kind: "layover", place, arrival: "", departure: "", notes: "" });
const sightseeing = (id, place) => ({ id, kind: "stop", place, arrival: "", departure: "", notes: "" });
/** A connection's save as its editor sends it, with the given itinerary. */
const legSave = (id, itinerary, overrides = {}) => ({ type: "leg.save", id, method: "Flight", price: "900", departure: "", arrival: "", url: "", notes: "", itinerary, ...overrides });
/** A plan for Frankfurt: an afternoon in the old town between a morning landing and an afternoon flight. */
const frankfurt = (overrides = {}) => ({
  timeZone: "Europe/Berlin", arrival: "2027-05-10T07:35", departure: "2027-05-10T14:20",
  immigrationMinutes: 45, customsMinutes: 15, securityMinutes: 45, transferMinutes: 15, boardingMinutes: 30, returnMinutes: 30,
  activities: [{ id: OLD_TOWN, name: "Old town", place: "Römerberg", outside: true, minutes: 90, travelMinutes: 30, notes: "S-Bahn to Hauptwache" }],
  ...overrides,
});
const lounge = { id: LOUNGE, name: "Lounge", place: "Terminal 1", outside: false, minutes: 60, travelMinutes: null, notes: "" };
const planning = (legId, layoverId, plan) => ({ type: "leg.layoverPlan", id: legId, layoverId, plan });
const legOf = (snapshot, legId) => snapshot.legs.find((leg) => leg.id === legId);
/** Everything saved but layover plans. */
const withoutPlans = (snapshot) => ({ ...snapshot, legs: snapshot.legs.map((leg) => { const fields = { ...leg }; delete fields.layoverPlans; return fields; }) });
const refusal = (message) => (error) => error?.name === "ValidationError" && error.message === message;
const GONE = "This layover is no longer in the connection's itinerary. Refresh and try again.";
const NOT_AVAILABLE = "This item no longer exists or isn't shared with you. Please refresh and try again.";

/** A trip from Boston to Vienna, or `city`, and back, its flight out laying over in Frankfurt with a stop in Heidelberg, and its flight back in London. */
function viennaTrip(store, tripId, city = "Vienna") {
  addDestination(store, tripId, { city, nights: 4, hotelNightlyAmount: "180" });
  const [outbound, inbound] = store.getTripSnapshot(tripId).data.legs;
  store.applyMutation(legSave(outbound.id, [layover(FRA, "Frankfurt (FRA)"), sightseeing(HEIDELBERG, "Heidelberg")]));
  store.applyMutation(legSave(inbound.id, [layover(LHR, "London Heathrow (LHR)")]));
  return { outbound: outbound.id, inbound: inbound.id };
}

test("a layover's plan saves with its connection, reopens as saved, changes, and is removed, and nothing else changes", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ startDate: "2027-05-09" })).id;
    const { outbound } = viennaTrip(store, tripId);
    const before = store.getSnapshot();
    const budget = calculateBudget(before, tripId);
    assert.deepEqual(before.legs.map((leg) => leg.layoverPlans), [[], []], "connections start without plans");

    assert.deepEqual(store.applyMutation(planning(outbound, FRA, frankfurt())), { id: outbound });
    const saved = store.getSnapshot();
    assert.deepEqual(legOf(saved, outbound).layoverPlans, [{ layoverId: FRA, ...frankfurt() }]);
    assert.deepEqual(store.getTripSnapshot(tripId).data.legs.find((leg) => leg.id === outbound).layoverPlans, legOf(saved, outbound).layoverPlans, "the trip's page reads it");
    assert.deepEqual(withoutPlans(saved), withoutPlans(before), "saving a plan changes no trip, destination, stay, idea or other travel detail");
    assert.deepEqual(calculateBudget(saved, tripId), budget, "a plan has no prices, so the budget is unchanged");

    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved, "a reopened trip has its plan as saved");

    // Saving again replaces the whole plan: one plan per layover.
    const changed = frankfurt({ boardingMinutes: 40, returnMinutes: null, activities: [lounge] });
    store.applyMutation(planning(outbound, FRA, changed));
    assert.deepEqual(legOf(store.getSnapshot(), outbound).layoverPlans, [{ layoverId: FRA, ...changed }]);
    store.applyMutation(planning(outbound, FRA, changed));
    assert.deepEqual(legOf(store.getSnapshot(), outbound).layoverPlans, [{ layoverId: FRA, ...changed }], "the same save again, as after a lost response, changes nothing more");

    store.applyMutation(planning(outbound, FRA, null));
    assert.deepEqual(store.getSnapshot(), before, "removing the plan leaves everything as it was");
    store.applyMutation(planning(outbound, FRA, null));
    assert.deepEqual(store.getSnapshot(), before, "removing it again changes nothing");
  } finally { store?.close(); }
});

test("only a layover in a connection's saved itinerary has a plan, and a refused plan changes nothing", (t) => {
  const { store, tripId } = setup(t);
  const { outbound, inbound } = viennaTrip(store, tripId);
  store.applyMutation(planning(outbound, FRA, frankfurt()));
  const before = store.getSnapshot();
  for (const [change, check] of [
    [planning(outbound, HEIDELBERG, frankfurt()), refusal(GONE)],
    [planning(outbound, LHR, frankfurt()), refusal(GONE)],
    [planning(inbound, FRA, frankfurt()), refusal(GONE)],
    [planning(outbound, "f0000000-0000-4000-8000-00000000000f", null), refusal(GONE)],
    [planning("ffffffff-ffff-4fff-8fff-ffffffffffff", FRA, frankfurt()), refusal(NOT_AVAILABLE)],
    [planning(outbound, "Frankfurt", frankfurt()), refusal("This item has an invalid identifier. Please refresh and try again.")],
    [{ type: "leg.layoverPlan", id: outbound, layoverId: FRA }, refusal("Enter the layover plan, or remove it.")],
    [planning(outbound, FRA, frankfurt({ departure: "2027-05-10T06:00" })), refusal("The connecting flight must depart after the arriving flight lands.")],
    [planning(outbound, FRA, frankfurt({ timeZone: "Frankfurt" })), refusal("Choose the airport's time zone.")],
    [planning(outbound, FRA, frankfurt({ activities: [{ ...frankfurt().activities[0], travelMinutes: null }] })), refusal("Enter how long getting to each activity outside the airport takes, in whole minutes from 0 to 1440.")],
  ]) {
    assert.throws(() => store.applyMutation(change), check, JSON.stringify(change).slice(0, 120));
    assert.deepEqual(store.getSnapshot(), before, "a refused plan changes nothing");
  }
});

test("a plan goes with its layover: removing it, making it a stop, clearing the connection or removing it removes the plan, and other saves keep it", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput()).id;
  const vienna = addDestination(store, tripId, { city: "Vienna", nights: 4 });
  const legs = () => store.getTripSnapshot(tripId).data.legs;
  const [{ id: outbound }, { id: inbound }] = legs();
  const plans = (legId) => legs().find((leg) => leg.id === legId)?.layoverPlans;
  const plan = () => store.applyMutation(planning(outbound, FRA, frankfurt()));
  const rows = () => { const db = new DatabaseSync(path, { readOnly: true }); try { return db.prepare("SELECT legId, layoverId FROM layover_plans ORDER BY legId, layoverId").all().map((row) => ({ ...row })); } finally { db.close(); } };
  const itinerary = [layover(FRA, "Frankfurt (FRA)"), sightseeing(HEIDELBERG, "Heidelberg")];
  store.applyMutation(legSave(outbound, itinerary));
  plan();
  const kept = [{ layoverId: FRA, ...frankfurt() }];

  // Saves that keep the layover keep its plan: new details, a renamed or reordered layover, and a save without the itinerary.
  store.applyMutation(legSave(outbound, [sightseeing(HEIDELBERG, "Heidelberg"), { ...layover(FRA, "Frankfurt Airport (FRA)"), notes: "Terminal 1" }], { price: "950", notes: "Booked" }));
  assert.deepEqual(plans(outbound), kept);
  store.applyMutation({ type: "leg.save", id: outbound, method: "Flight", price: "950", departure: "", arrival: "", url: "", notes: "Booked" });
  assert.deepEqual(plans(outbound), kept, "a save that leaves out the itinerary keeps it, and its layovers' plans");

  // Making the layover another kind of stop, or removing it, removes its plan.
  store.applyMutation(legSave(outbound, [sightseeing(FRA, "Frankfurt"), sightseeing(HEIDELBERG, "Heidelberg")]));
  assert.deepEqual([plans(outbound), rows()], [[], []]);
  store.applyMutation(legSave(outbound, itinerary));
  assert.deepEqual(plans(outbound), [], "a layover again is a layover without a plan");
  plan();
  store.applyMutation(legSave(outbound, [sightseeing(HEIDELBERG, "Heidelberg")]));
  assert.deepEqual([plans(outbound), rows()], [[], []]);

  // Clearing the connection, by Clear or by a new departing city, removes its layovers and their plans.
  store.applyMutation(legSave(outbound, itinerary)); plan();
  store.applyMutation({ type: "leg.clear", id: outbound });
  assert.deepEqual([legs().find((leg) => leg.id === outbound).itinerary, plans(outbound), rows()], [[], [], []]);
  store.applyMutation(legSave(outbound, itinerary)); plan();
  store.applyMutation(tripInput({ id: tripId, homeCity: "New York" }));
  assert.deepEqual([plans(outbound), rows()], [[], []]);

  // A connection the route no longer has goes with its plans, and the other connection's plan stays.
  store.applyMutation(legSave(outbound, itinerary)); plan();
  store.applyMutation(legSave(inbound, [layover(LHR, "London Heathrow (LHR)")]));
  store.applyMutation(planning(inbound, LHR, frankfurt({ timeZone: "Europe/London" })));
  const salzburg = addDestination(store, tripId, { city: "Salzburg", nights: 2 });
  assert.equal(plans(inbound), undefined, "adding Salzburg after Vienna replaces the connection back from Vienna");
  assert.deepEqual(rows(), [{ legId: outbound, layoverId: FRA }]);
  assert.deepEqual(plans(outbound), kept, "the connection out to Vienna keeps its plan");
  store.applyMutation({ type: "stop.remove", id: vienna });
  assert.deepEqual(rows(), [], "removing Vienna removes the connection to it, with its plan");
  assert.ok(legs().every((leg) => leg.layoverPlans.length === 0));
  store.applyMutation({ type: "stop.remove", id: salzburg });

  // Deleting the trip deletes its connections' plans.
  const { outbound: again } = viennaTrip(store, tripId, "Graz");
  store.applyMutation(planning(again, FRA, frankfurt()));
  assert.equal(rows().length, 1);
  store.applyMutation({ type: "trip.delete", id: tripId });
  assert.deepEqual(rows(), []);
});

test("everyone who can open the trip plans its layovers, and no one else can read or change them", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  const as = (account) => ({ ...store, applyMutation: (input) => store.applyMutation(account, input), getTripSnapshot: (trip) => store.getTripSnapshot(account, trip) });
  const { outbound } = viennaTrip(as(owner), tripId);
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const friend = store.authorizeAccount("friend@example.test").id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  const plansSeen = (account) => store.getTripSnapshot(account, tripId)?.data.legs.find((leg) => leg.id === outbound).layoverPlans;

  store.applyMutation(friend, planning(outbound, FRA, frankfurt()));
  assert.deepEqual(plansSeen(owner), [{ layoverId: FRA, ...frankfurt() }], "a plan someone the trip is shared with saves is the trip's");
  store.applyMutation(owner, planning(outbound, FRA, frankfurt({ boardingMinutes: 45 })));
  assert.deepEqual(plansSeen(friend), [{ layoverId: FRA, ...frankfurt({ boardingMinutes: 45 }) }]);

  const before = store.getSnapshot();
  for (const plan of [frankfurt(), null]) assert.throws(() => store.applyMutation(outsider, planning(outbound, FRA, plan)), refusal(NOT_AVAILABLE));
  assert.deepEqual(store.getSnapshot(), before, "an account the trip isn't shared with changes nothing");
  assert.equal(plansSeen(outsider), undefined, "nor can it read the trip or its plans");

  store.applyMutation(owner, { type: "trip.unshare", tripId, email: "friend@example.test" });
  assert.throws(() => store.applyMutation(friend, planning(outbound, FRA, null)), refusal(NOT_AVAILABLE), "access ends with the share");
  store.applyMutation(owner, planning(outbound, FRA, null));
  assert.deepEqual(plansSeen(owner), []);
});

test("the database keeps every plan's minutes whole and in range, and each plan with an existing connection", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  const tripId = store.applyMutation(tripInput()).id;
  const { outbound } = viennaTrip(store, tripId);
  store.applyMutation(planning(outbound, FRA, frankfurt()));
  store.close();
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys = ON;");
  const columns = ["immigrationMinutes", "customsMinutes", "securityMinutes", "transferMinutes", "boardingMinutes", "returnMinutes"];
  for (const column of columns) {
    for (const value of [-1, 1441, 2.5]) {
      assert.throws(() => db.prepare(`UPDATE layover_plans SET ${column} = ? WHERE legId = ?`).run(value, outbound), /CHECK constraint failed|cannot store REAL value/, `${column} ${value}`);
    }
  }
  for (const column of columns.slice(0, 5)) assert.throws(() => db.prepare(`UPDATE layover_plans SET ${column} = NULL WHERE legId = ?`).run(outbound), /NOT NULL constraint failed/);
  db.prepare("UPDATE layover_plans SET returnMinutes = NULL WHERE legId = ?").run(outbound);
  assert.throws(() => db.prepare("INSERT INTO layover_plans SELECT 'ffffffff-ffff-4fff-8fff-ffffffffffff', layoverId, timeZone, arrival, departure, immigrationMinutes, customsMinutes, securityMinutes, transferMinutes, boardingMinutes, returnMinutes, activitiesJson FROM layover_plans").run(), /FOREIGN KEY constraint failed/);
});

test("schema 38 databases upgrade without layover plans, and a replay keeps plans saved since", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const { outbound, inbound } = viennaTrip(store, tripId);
    const before = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("DROP TABLE layover_plans; PRAGMA user_version = 38;");
    db.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), before, "every trip keeps everything saved for it, and no layover has a plan");
    store.applyMutation(planning(outbound, FRA, frankfurt()));
    store.applyMutation(planning(inbound, LHR, frankfurt({ timeZone: "Europe/London", returnMinutes: null, activities: [lounge] })));
    const later = store.getSnapshot();
    // A replay of schema 39, also after the schema 1 build resets the schema version, keeps them.
    for (const version of [38, 1]) {
      store.close(); store = null;
      const replay = new DatabaseSync(path);
      replay.exec(`PRAGMA user_version = ${version};`);
      replay.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps what was saved`);
    }
    store.close(); store = null;
    const observer = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      assert.deepEqual(observer.prepare("PRAGMA table_info(layover_plans)").all().map(({ name, type, notnull, pk }) => [name, type, notnull, pk]), [
        ["legId", "TEXT", 1, 1], ["layoverId", "TEXT", 1, 2], ["timeZone", "TEXT", 1, 0], ["arrival", "TEXT", 1, 0], ["departure", "TEXT", 1, 0],
        ["immigrationMinutes", "INTEGER", 1, 0], ["customsMinutes", "INTEGER", 1, 0], ["securityMinutes", "INTEGER", 1, 0], ["transferMinutes", "INTEGER", 1, 0], ["boardingMinutes", "INTEGER", 1, 0],
        ["returnMinutes", "INTEGER", 0, 0], ["activitiesJson", "TEXT", 1, 0],
      ]);
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});

/** Each change's title, and each record's fields as "name: before → after". */
const previewed = (proposal) => proposal.preview.map((change) => [change.operation, ...change.records.map((record) => `${record.action} ${record.record} | ` + record.fields.map((field) => `${field.name}: ${field.before ?? "None"} → ${field.after ?? "None"}`).join("; "))]);

test("ChatGPT and Claude read layover plans and propose them, previewed field by field, and only approval saves or removes them", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Vienna" });
  const [outbound] = store.getTripSnapshot(owner, ownerTrip).data.legs;
  store.applyMutation(owner, legSave(outbound.id, [layover(FRA, "Frankfurt (FRA)")]));
  const travel = "Trip “Owner trip” (owner@example.test): travel from the departing city (Boston) to Vienna";
  const before = store.getSnapshot();

  const proposal = propose([planning(outbound.id, FRA, frankfurt({ activities: [frankfurt().activities[0], lounge] }))], "Plan the Frankfurt layover");
  assert.deepEqual(previewed(proposal), [["Save a layover plan", `Adds ${travel}: plan for the layover in Frankfurt (FRA) | Time zone: None → Europe/Berlin; Arriving flight lands: None → 2027-05-10T07:35; Connecting flight departs: None → 2027-05-10T14:20; `
    + "Immigration (minutes): None → 45; Customs (minutes): None → 15; Security (minutes): None → 45; Terminal transfer (minutes): None → 15; Boarding (minutes): None → 30; Travel back to the airport (minutes): None → 30; "
    + "Activities: None → name: Old town, place: Römerberg, outside: true, minutes: 90, travelMinutes: 30, notes: S-Bahn to Hauptwache; name: Lounge, place: Terminal 1, outside: false, minutes: 60"]]);
  assert.deepEqual(store.getSnapshot(), before, "proposing changes nothing");
  assert.equal(decide(proposal, true).status, "applied");
  const saved = store.aiTrip(ownerTrip).travel.find((leg) => leg.id === outbound.id).layoverPlans;
  assert.deepEqual(saved, [{ layoverId: FRA, ...frankfurt({ activities: [frankfurt().activities[0], lounge] }) }], "assistants read each connection's layover plans");
  assert.deepEqual(withoutPlans(store.getSnapshot()), withoutPlans(before), "approving it changes nothing else");

  // A rejected removal keeps the plan, and an approved one removes it.
  const removal = propose([planning(outbound.id, FRA, null)]);
  assert.equal(previewed(removal)[0][0], "Remove a layover plan");
  assert.ok(previewed(removal)[0][1].startsWith(`Deletes ${travel}: plan for the layover in Frankfurt (FRA) | Time zone: Europe/Berlin → None;`), previewed(removal)[0][1]);
  assert.equal(decide(removal, false).status, "rejected");
  assert.deepEqual(store.aiTrip(ownerTrip).travel.find((leg) => leg.id === outbound.id).layoverPlans, saved);

  // A connection's change that drops the layover shows the plan it removes, named by the layover it was for.
  const dropped = propose([legSave(outbound.id, [])]);
  assert.deepEqual(previewed(dropped)[0].slice(0, 1), ["Change travel between stops"]);
  assert.ok(previewed(dropped)[0].some((record) => record.startsWith(`Deletes ${travel}: plan for the layover in Frankfurt (FRA) |`)));
  assert.equal(decide(dropped, true).status, "applied");
  assert.deepEqual(store.aiTrip(ownerTrip).travel.find((leg) => leg.id === outbound.id).layoverPlans, []);
});

test("assistants are told how to plan a layover, and that a layover's plan goes with it", () => {
  const changes = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf;
  const schema = changes.find((change) => change.title === "leg.layoverPlan");
  assert.deepEqual(schema.required, ["type", "id", "layoverId", "plan"]);
  assert.deepEqual(schema.properties.plan.type, ["object", "null"]);
  assert.deepEqual(schema.properties.plan.required, ["timeZone", "arrival", "departure", "immigrationMinutes", "customsMinutes", "securityMinutes", "transferMinutes", "boardingMinutes", "returnMinutes", "activities"]);
  assert.match(schema.description, /estimates, never guarantees/);
  const pattern = new RegExp(schema.properties.plan.properties.arrival.pattern);
  assert.deepEqual(["2027-05-10T07:35", "2027-05-10 07:35", "2027-05-10T24:00", "2027-05-10T07:35:00"].map((value) => pattern.test(value)), [true, false, false, false]);
  assert.deepEqual(schema.properties.plan.properties.activities.items.required, ["id", "name", "outside", "minutes", "travelMinutes"]);
  const itinerary = changes.find((change) => change.title === "leg.save").properties.itinerary.description;
  assert.match(itinerary, /loses its plan/);
  assert.match(TOOLS.find((tool) => tool.name === "get_trip").description, /layoverPlans/);
});
