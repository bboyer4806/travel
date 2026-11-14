import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DATA_TABLES, PREVIEW_COLUMNS, UNREAD_COLUMNS } from "../src/lib/ai-preview.ts";
import { createStore, ValidationError } from "../src/lib/store.ts";
import { aiSetup, DAY, GUEST, NOW, OWNER } from "./ai-fixtures.mjs";
import { fileDatabase, newItem } from "./budget-fixtures.mjs";

const tripOf = (store, id) => store.getSnapshot().trips.find((trip) => trip.id === id);
/** A trip.save that changes only what `overrides` names, as trip.save saves every field. */
const tripEdit = (store, id, overrides) => {
  const { name, dateLabel, homeCity, travelers, notes } = tripOf(store, id);
  return { type: "trip.save", id, name, dateLabel, homeCity, travelers, notes, ...overrides };
};
const emails = (store) => store.aiAccounts().map((account) => account.email);

test("a proposal previews every record each change makes, and changes nothing until the owner approves it", (t) => {
  const { store, guestTrip, ownerTrip, propose, decide } = aiSetup(t);
  const before = store.getSnapshot();
  const itemId = randomUUID();
  const proposal = propose([
    tripEdit(store, guestTrip, { name: "Guest trip, renamed" }),
    { type: "trip.share", tripId: ownerTrip, email: "new@example.test" },
    { type: "homeItem.save", id: itemId, create: true, tripId: guestTrip, name: "House sitting", price: "125.50", notes: "", completed: false },
  ]);
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.expiresAt, NOW + DAY, "a proposal waits a day");
  assert.deepEqual(store.getSnapshot(), before, "proposing changes no trip");
  assert.ok(!emails(store).includes("new@example.test"), "proposing a share authorizes nobody");
  assert.deepEqual(proposal.preview, [
    { operation: "Change the trip “Guest trip, renamed”", records: [{ action: "Changes", record: `Trip “Guest trip, renamed” (${GUEST})`, fields: [{ name: "Name", before: "Guest trip", after: "Guest trip, renamed" }] }] },
    { operation: "Share a trip with new@example.test", records: [
      { action: "Adds", record: `Trip “Owner trip” (${OWNER}): shared with new@example.test`, fields: [] },
      { action: "Adds", record: "Account new@example.test", fields: [{ name: "Email", before: null, after: "new@example.test" }] },
    ] },
    { operation: "Add the At home item “House sitting”", records: [{ action: "Adds", record: `Trip “Guest trip, renamed” (${GUEST}): At home item “House sitting”`, fields: [{ name: "Name", before: null, after: "House sitting" }, { name: "Price", before: null, after: "$125.50" }, { name: "Done", before: null, after: "No" }] }] },
  ]);

  assert.equal(decide(proposal, true).status, "applied");
  const after = store.getSnapshot();
  assert.equal(tripOf(store, guestTrip).name, "Guest trip, renamed");
  assert.deepEqual(after.homeItems.find((item) => item.id === itemId), { id: itemId, tripId: guestTrip, name: "House sitting", notes: "", priceCents: 12550, completed: false, createdAt: new Date(NOW).toISOString() });
  assert.ok(emails(store).includes("new@example.test"), "approving the share authorizes the email");
  assert.deepEqual(store.aiTrips().find((trip) => trip.id === ownerTrip).sharedWith, [{ email: "new@example.test", name: null }]);
  assert.deepEqual(store.aiTrips().find((trip) => trip.id === guestTrip).owner, { email: GUEST, name: null }, "a change to another account's trip keeps its owner");
  // Each approval executes once.
  assert.throws(() => decide(proposal, true), /already been decided/);
  assert.throws(() => decide(proposal, false), /already been decided/);
  assert.deepEqual(store.getSnapshot(), after);
});

test("approving makes exactly the rows previewed, or nothing when Travel has changed them since", (t) => {
  const { store, guest, guestTrip, propose, decide } = aiSetup(t);
  // trip.save saves every field, so a later edit to its notes would be undone: the proposal fails, and nothing changes.
  const rename = propose([tripEdit(store, guestTrip, { name: "Renamed" })]);
  store.applyMutation(guest, tripEdit(store, guestTrip, { notes: "Edited meanwhile" }));
  const edited = store.getSnapshot();
  const failed = decide(rename, true);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /Travel has changed since this was proposed/);
  assert.deepEqual(store.getSnapshot(), edited, "a failed approval changes nothing");
  assert.throws(() => decide(rename, true), /already been decided/, "a failed proposal can't be approved again");

  // A destination change sends only its notes, so an edit to its city since leaves the same rows to change.
  const destinationId = store.applyMutation(guest, { type: "stop.add", tripId: guestTrip, city: "Paris" }).id;
  const notes = propose([{ type: "destination.save", id: destinationId, notes: "Museums" }]);
  store.applyMutation(guest, { type: "destination.save", id: destinationId, city: "Paris, France" });
  assert.equal(decide(notes, true).status, "applied");
  const destination = store.aiDestination(destinationId).destination;
  assert.deepEqual([destination.city, destination.notes], ["Paris, France", "Museums"]);
});

test("a failure partway through a batch rolls back every change and the approval", (t) => {
  const path = fileDatabase(t);
  const { store, owner, guestTrip, ownerTrip, propose, decide } = aiSetup(t, path);
  const itemId = store.applyMutation(owner, { type: "homeItem.save", ...newItem(), tripId: ownerTrip, name: "Pause mail", price: "", notes: "", completed: false }).id;
  // The planner refuses the second change when it is approved: everything rolls back, and the proposal fails for good.
  const refused = propose([tripEdit(store, guestTrip, { name: "Renamed" }), { type: "homeItem.delete", id: itemId, tripId: ownerTrip }]);
  store.applyMutation(owner, { type: "homeItem.delete", id: itemId, tripId: ownerTrip });
  const before = store.getSnapshot();
  const failed = decide(refused, true);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "Change 2: This item doesn't exist. Read Travel again for current IDs.");
  assert.deepEqual(store.getSnapshot(), before, "the first change rolled back with the second");

  // The database fails partway through: everything rolls back, the approval included, so it can be approved again.
  const batch = propose([tripEdit(store, guestTrip, { name: "Renamed again" }), { type: "homeItem.save", ...newItem(), tripId: ownerTrip, name: "Water plants", price: "", notes: "", completed: false }]);
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec("CREATE TRIGGER fail_items BEFORE INSERT ON home_items BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END;");
  assert.throws(() => decide(batch, true), /database or disk is full/);
  assert.deepEqual(store.getSnapshot(), before, "no record changed");
  assert.equal(store.getAiProposal(owner, batch.id, NOW).status, "pending", "the approval rolled back too");
  db.exec("DROP TRIGGER fail_items;");
  assert.equal(decide(batch, true).status, "applied");
  assert.equal(tripOf(store, guestTrip).name, "Renamed again");
  assert.ok(store.getSnapshot().homeItems.some((item) => item.name === "Water plants"));
});

test("only the designated owner decides, only the proposal shown, before it expires; proposals can't be changed", (t) => {
  const path = fileDatabase(t);
  const { store, owner, guest, guestTrip, propose, decide } = aiSetup(t, path);
  const proposal = propose([tripEdit(store, guestTrip, { name: "Renamed" })]);
  const before = store.getSnapshot();
  // Anyone else finds no proposal, as for one that doesn't exist.
  assert.equal(store.getAiProposal(guest, proposal.id, NOW), undefined);
  assert.equal(store.aiOverview(guest, NOW), undefined);
  assert.throws(() => store.decideAiProposal(guest, proposal.id, proposal.digest, true, NOW), /doesn't exist/);
  assert.throws(() => store.decideAiProposal(owner, randomUUID(), proposal.digest, true, NOW), /doesn't exist/);
  // An approval names the proposal exactly as shown.
  assert.throws(() => store.decideAiProposal(owner, proposal.id, "tampered", true, NOW), /isn't the proposal you were shown/);
  // A day later it has expired, and can't be approved or rejected.
  assert.equal(store.getAiProposal(owner, proposal.id, NOW + DAY).status, "expired");
  assert.throws(() => decide(proposal, true, NOW + DAY), /expired/);
  assert.deepEqual(store.getSnapshot(), before);

  const db = new DatabaseSync(path);
  t.after(() => db.close());
  assert.throws(() => db.prepare("UPDATE ai_proposals SET summary = 'Something else' WHERE id = ?").run(proposal.id), /can't be changed once it is made/);
  assert.throws(() => db.prepare("UPDATE ai_proposals SET changesJson = '[]' WHERE id = ?").run(proposal.id), /can't be changed once it is made/);
  const rejected = propose([tripEdit(store, guestTrip, { name: "Rejected" })]);
  assert.equal(decide(rejected, false).status, "rejected");
  assert.deepEqual(store.getSnapshot(), before, "rejecting changes nothing");
  assert.throws(() => db.prepare("UPDATE ai_proposals SET status = 'pending', decidedAt = NULL WHERE id = ?").run(rejected.id), /decided once/);
  assert.deepEqual(store.aiOverview(owner, NOW).proposals.map(({ id, status }) => ({ id, status })), [{ id: proposal.id, status: "pending" }, { id: rejected.id, status: "rejected" }].sort((a, b) => (a.id < b.id ? -1 : 1)));
});

test("AI changes reach every account's trips and sharing, while each account keeps only its own access", (t) => {
  const { store, owner, guest, guestTrip, ownerTrip, propose, decide } = aiSetup(t);
  store.applyMutation(guest, { type: "trip.share", tripId: guestTrip, email: "friend@example.test" });
  // Signed in, the owner can't touch a trip nobody shared with them, and the guest can't touch the owner's.
  assert.throws(() => store.applyMutation(owner, { type: "trip.delete", id: guestTrip }), /isn't shared with you/);
  assert.throws(() => store.applyMutation(guest, tripEdit(store, ownerTrip, { name: "Mine now" })), /isn't shared with you/);
  const proposal = propose([
    { type: "trip.unshare", tripId: guestTrip, email: "friend@example.test" },
    { type: "trip.share", tripId: guestTrip, email: OWNER },
    { type: "trip.delete", id: ownerTrip },
  ]);
  assert.equal(proposal.preview[2].records[0].action, "Deletes");
  assert.equal(decide(proposal, true).status, "applied");
  assert.deepEqual(store.aiTrips().map((trip) => [trip.name, trip.sharedWith.map((member) => member.email)]), [["Guest trip", [OWNER]]]);
  // Ordinary access is unchanged: the guest still can't change sharing it doesn't own, and nobody gains roles.
  assert.throws(() => store.applyMutation(owner, { type: "trip.delete", id: guestTrip }), /Only the trip's owner can delete it/);
  assert.equal(store.getHomeOverview(guest).access[guestTrip].role, "owner");
});

test("a proposal can add items and change them in the same batch, and refuses what the planner refuses", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  const tripId = randomUUID();
  const itemId = randomUUID();
  const proposal = propose([
    { type: "trip.save", id: tripId, create: true, name: "Lisbon", dateLabel: "Spring", homeCity: "Boston", travelers: 2, notes: "", startDate: "2027-04-01" },
    { type: "homeItem.save", id: itemId, create: true, tripId, name: "Pet sitter", price: "40", notes: "", completed: false },
    { type: "homeItem.complete", id: itemId, tripId, completed: true },
    { type: "trip.tag", tripId, name: "Europe" },
  ]);
  assert.deepEqual(proposal.preview.map((change) => change.operation), ["Add the trip “Lisbon”", "Add the At home item “Pet sitter”", "Mark an At home item done", "Tag a trip “Europe”"]);
  assert.equal(decide(proposal, true).status, "applied");
  const lisbon = store.aiTrip(tripId);
  assert.deepEqual([lisbon.trip.name, lisbon.trip.startDate, lisbon.trip.tags, lisbon.owner.email], ["Lisbon", "2027-04-01", ["Europe"], OWNER], "a new trip belongs to the designated owner");
  assert.deepEqual(lisbon.atHome.map((item) => [item.name, item.completed]), [["Pet sitter", true]]);

  const refusals = [
    [[{ type: "trip.save", id: ownerTrip, create: true, name: "Overwrite", dateLabel: "", homeCity: "", travelers: 1, notes: "" }], /^Change 1: This id is already a saved item's/],
    [[{ type: "trip.tag", tripId: randomUUID(), name: "Nowhere" }], /^Change 1: This item doesn't exist/],
    [[{ type: "destination.save", id: randomUUID(), image: null }], /^Change 1: Change photos with destination.photos, candidate.photos or church.photos/],
    [[{ type: "trip.save", name: "No id", dateLabel: "", homeCity: "", travelers: 1, notes: "" }], /^Change 1: Give the id/],
    [[{ type: "stop.add", tripId: ownerTrip, city: "Rome" }, { type: "trip.save", ...newItem(), name: "", dateLabel: "", homeCity: "", travelers: 1, notes: "" }], /^Change 2: Please enter name/],
    [[{ type: "sql.run", sql: "DROP TABLE trips" }], /^Change 1: This action is not supported/],
    [[], /Propose from 1 to 50 changes/],
    [Array.from({ length: 51 }, () => ({ type: "trip.tag", tripId: ownerTrip, name: "Too many" })), /Propose from 1 to 50 changes/],
  ];
  const before = store.getSnapshot();
  for (const [changes, message] of refusals) assert.throws(() => propose(changes), (error) => error instanceof ValidationError && message.test(error.message), String(message));
  assert.throws(() => propose([{ type: "trip.tag", tripId: ownerTrip, name: "Fine" }], " "), /Please enter summary/);
  assert.throws(() => propose([{ type: "trip.tag", tripId: ownerTrip, name: "Fine" }], "x".repeat(201)), /summary must be 200 characters or fewer/);
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");
  assert.equal(store.aiOverview(owner, NOW).proposals.length, 1, "and isn't recorded");
});

test("approving makes the same new rows the preview showed, IDs included", (t) => {
  const { store, ownerTrip, propose, decide } = aiSetup(t);
  const proposal = propose([{ type: "stop.add", tripId: ownerTrip, city: "Rome" }, { type: "destination.create", city: "Kyoto" }]);
  // Records list by table, and within one by ID.
  assert.deepEqual(proposal.preview[0].records.map((record) => `${record.action} ${record.record}`).toSorted(), [
    `Adds Destination “Rome” (${OWNER})`,
    `Adds Trip “Owner trip” (${OWNER}): stay in Rome`,
    `Adds Trip “Owner trip” (${OWNER}): travel from Rome to the return city (Boston)`,
    `Adds Trip “Owner trip” (${OWNER}): travel from the departing city (Boston) to Rome`,
  ]);
  const rows = (snapshot) => [snapshot.stops, snapshot.legs, snapshot.destinations].map((list) => list.map((item) => item.id).sort());
  const before = rows(store.getSnapshot());
  assert.equal(decide(proposal, true).status, "applied");
  const after = rows(store.getSnapshot());
  assert.deepEqual(after.map((ids, index) => ids.filter((id) => !before[index].includes(id)).length), [1, 2, 2], "one stay, two connections and two destinations are new");
  assert.deepEqual(store.aiDestinations().map((destination) => [destination.city, destination.owner.email]), [["Kyoto", OWNER], ["Rome", OWNER]]);
});

test("AI reads every account's trips and destinations, but never credentials", (t) => {
  const path = fileDatabase(t);
  const { store, guest, guestTrip, ownerTrip, propose } = aiSetup(t, path);
  store.authorizeGoogleSignIn({ subject: "google-subject-of-guest", email: GUEST, emailVerified: true, name: "Guest" });
  const session = store.createSession(guest, NOW);
  const destinationId = store.applyMutation(guest, { type: "stop.add", tripId: guestTrip, city: "Oslo" }).id;
  store.applyMutation(guest, { type: "candidate.save", ...newItem(), destinationId, category: "hotels", name: "Fjord Hotel", price: "300", address: "", url: "", notes: "", included: true });
  propose([tripEdit(store, ownerTrip, { name: "Pending" })]);

  assert.deepEqual(store.aiTrips().map((trip) => [trip.name, trip.owner.email, trip.stops.map((stop) => stop.city)]).toSorted(), [["Guest trip", GUEST, ["Oslo"]], ["Owner trip", OWNER, []]]);
  const guestPlan = store.aiTrip(guestTrip);
  assert.deepEqual([guestPlan.trip.name, guestPlan.ideas.map((idea) => idea.name), guestPlan.budget.hotelsByCurrency], ["Guest trip", ["Fjord Hotel"], { USD: 30000 }]);
  assert.equal(store.aiTrip(randomUUID()), undefined);
  assert.deepEqual(store.aiDestinations().map(({ city, owner: { email }, hotels, visits }) => ({ city, email, hotels, trips: visits.map((visit) => visit.tripName) })), [{ city: "Oslo", email: GUEST, hotels: 1, trips: ["Guest trip"] }]);
  assert.equal(store.aiDestination(destinationId).ideas[0].name, "Fjord Hotel");
  assert.deepEqual(store.aiAccounts(), [
    { email: GUEST, name: "Guest", hasSignedIn: true, designatedOwner: false },
    { email: OWNER, name: null, hasSignedIn: false, designatedOwner: true },
  ]);

  // Every read together holds no Google subject, session token or hash, or AI credential hash.
  const db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  const secrets = [session, "google-subject-of-guest", ...db.prepare("SELECT tokenHash FROM sessions").all().map((row) => row.tokenHash),
    ...db.prepare("SELECT accessTokenHash, refreshTokenHash FROM ai_connections").all().flatMap((row) => [row.accessTokenHash, row.refreshTokenHash])];
  const everything = JSON.stringify([store.aiTrips(), store.aiTrip(guestTrip), store.aiTrip(ownerTrip), store.aiDestinations(), store.aiDestination(destinationId), store.aiAccounts()]);
  for (const secret of secrets) assert.ok(!everything.includes(secret), "no credential is read");
});

test("every column of Travel's data has a preview label, and every other table is sessions or the AI integration's", (t) => {
  const path = fileDatabase(t);
  createStore(path, OWNER).close();
  const db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables.filter((table) => !DATA_TABLES.includes(table)), ["ai_authorization_codes", "ai_clients", "ai_connections", "ai_proposal_photos", "ai_proposals", "sessions"], "every other table is Travel's data, listed for previews");
  for (const table of DATA_TABLES) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name).filter((column) => !UNREAD_COLUMNS[table].includes(column));
    assert.deepEqual(columns.toSorted(), Object.keys(PREVIEW_COLUMNS[table]).toSorted(), `${table} columns each have a preview label or are hidden`);
  }
});
