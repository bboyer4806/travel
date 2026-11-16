import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createStore, SCHEMA_VERSION } from "../src/lib/store.ts";
import { aiSetup, OWNER as AI_OWNER } from "./ai-fixtures.mjs";
import { fileDatabase, tripInput } from "./budget-fixtures.mjs";

// TRA-16: each account puts the trips it can open in its own order on All trips.
const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";
const CHANGED = { name: "ValidationError", message: "Your trips have changed. Refresh before rearranging them." };

/** The names of the trips on an account's All trips, in order. */
const names = (store, accountId) => store.getHomeOverview(accountId).data.trips.map((trip) => trip.name);
/** Saves an account's trip order, naming its trips by name. */
function arrange(store, accountId, ...order) {
  const ids = Object.fromEntries(store.getHomeOverview(accountId).data.trips.map((trip) => [trip.name, trip.id]));
  return store.applyMutation(accountId, { type: "trip.order", tripIds: order.map((name) => ids[name]) });
}

/**
 * The designated owner, an editor and an outsider. Time stands still but for `later`, which moves it a minute on, so
 * each trip and share made with `add` and `share` has a time of its own.
 */
function setup(t, path = ":memory:") {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 1) });
  const store = createStore(path, OWNER);
  t.after(() => store.close());
  const [owner, editor, outsider] = [OWNER, EDITOR, "outsider@example.com"].map((email) => store.authorizeAccount(email).id);
  const later = () => t.mock.timers.tick(60_000);
  const add = (accountId, name) => { later(); return store.applyMutation(accountId, tripInput({ name })).id; };
  const share = (accountId, tripId, email) => { later(); store.applyMutation(accountId, { type: "trip.share", tripId, email }); };
  return { store, owner, editor, outsider, later, add, share };
}

test("each account puts the trips it can open in its own order, which no one else's list follows", (t) => {
  const path = fileDatabase(t);
  const { store, owner, editor, add, share } = setup(t, path);
  const lisbon = add(owner, "Lisbon");
  const rome = add(owner, "Rome");
  add(owner, "Oslo");
  add(editor, "Editor's own");
  share(owner, lisbon, EDITOR);
  share(owner, rome, EDITOR);
  assert.deepEqual(names(store, owner), ["Lisbon", "Rome", "Oslo"], "trips never arranged come in the order the account got them");
  assert.deepEqual(names(store, editor), ["Editor's own", "Lisbon", "Rome"]);

  assert.deepEqual(arrange(store, owner, "Oslo", "Lisbon", "Rome"), {}, "an order saves only itself, with no ID to return");
  assert.deepEqual(names(store, owner), ["Oslo", "Lisbon", "Rome"]);
  assert.deepEqual(names(store, editor), ["Editor's own", "Lisbon", "Rome"], "someone the trips are shared with keeps their own order");
  arrange(store, editor, "Rome", "Editor's own", "Lisbon");
  assert.deepEqual(names(store, editor), ["Rome", "Editor's own", "Lisbon"]);
  assert.deepEqual(names(store, owner), ["Oslo", "Lisbon", "Rome"], "and the owner keeps theirs");
  const home = store.getHomeOverview(owner);
  assert.deepEqual(Object.keys(home.budgets), home.data.trips.map((trip) => trip.id), "every trip keeps its estimate");

  // Saved, as after refreshing, navigating away or signing in again: a store opened anew shows the same orders.
  const reopened = createStore(path, OWNER);
  t.after(() => reopened.close());
  assert.deepEqual([names(reopened, owner), names(reopened, editor)], [["Oslo", "Lisbon", "Rome"], ["Rome", "Editor's own", "Lisbon"]]);
});

test("a new trip, or one newly shared, goes after the arranged trips, which keep their order", (t) => {
  const { store, owner, editor, later, add, share } = setup(t);
  const lisbon = add(owner, "Lisbon");
  add(owner, "Rome");
  add(owner, "Oslo");
  // Created before the owner arranges their trips, but shared after Kyoto is created.
  const paris = add(editor, "Editor's Paris");
  arrange(store, owner, "Oslo", "Lisbon", "Rome");
  add(owner, "Kyoto");
  share(editor, paris, OWNER);
  add(owner, "Quebec");
  assert.deepEqual(names(store, owner), ["Oslo", "Lisbon", "Rome", "Kyoto", "Editor's Paris", "Quebec"], "new trips follow, in the order the account got them");
  arrange(store, owner, "Quebec", "Oslo", "Lisbon", "Rome", "Kyoto", "Editor's Paris");
  assert.deepEqual(names(store, owner), ["Quebec", "Oslo", "Lisbon", "Rome", "Kyoto", "Editor's Paris"]);

  // A trip shared again after its access ended is a new share, so it goes last too.
  share(owner, lisbon, EDITOR);
  arrange(store, editor, "Lisbon", "Editor's Paris");
  later();
  store.applyMutation(owner, { type: "trip.unshare", tripId: lisbon, email: EDITOR });
  assert.deepEqual(names(store, editor), ["Editor's Paris"]);
  add(editor, "Editor's Berlin");
  share(owner, lisbon, EDITOR);
  assert.deepEqual(names(store, editor), ["Editor's Paris", "Editor's Berlin", "Lisbon"]);
});

test("an order must name every trip the account can open, each once, and nothing else", (t) => {
  const { store, owner, editor, outsider, add, share } = setup(t);
  const lisbon = add(owner, "Lisbon");
  const rome = add(owner, "Rome");
  const secret = add(outsider, "Outsider's");
  const order = (accountId, tripIds) => store.applyMutation(accountId, { type: "trip.order", tripIds });
  arrange(store, owner, "Rome", "Lisbon");
  const once = { name: "ValidationError", message: "Each trip must appear once in the trip order." };
  const invalid = { name: "ValidationError", message: "The trip order is invalid. Please refresh and try again." };
  for (const [tripIds, refusal] of [
    // As a page opened before a trip was added or shared with the account.
    [[lisbon], CHANGED],
    // Another account's trip and a missing one look the same.
    [[rome, lisbon, secret], CHANGED],
    [[rome, lisbon, randomUUID()], CHANGED],
    [[rome, secret], CHANGED],
    [[rome, lisbon, rome], once],
    [[rome, rome.toUpperCase(), lisbon], once],
    [[rome, "Lisbon"], { name: "ValidationError", message: "This item has an invalid identifier. Please refresh and try again." }],
    ["Rome, Lisbon", invalid],
    [undefined, invalid],
  ]) assert.throws(() => order(owner, tripIds), refusal, JSON.stringify(tripIds));
  assert.deepEqual(names(store, owner), ["Rome", "Lisbon"], "a refused order changes nothing");

  // Each account orders only what it can open, so an editor's order follows what is shared with it.
  assert.throws(() => order(outsider, [secret, lisbon]), CHANGED);
  order(outsider, [secret]);
  order(editor, []);
  share(owner, rome, EDITOR);
  assert.throws(() => order(editor, []), CHANGED, "a list opened before a trip was shared is out of date");
  order(editor, [rome]);
  assert.deepEqual([names(store, owner), names(store, editor), names(store, outsider)], [["Rome", "Lisbon"], ["Rome"], ["Outsider's"]]);
});

test("deleting a trip takes it out of every account's order, and the rest keep theirs", (t) => {
  const path = fileDatabase(t);
  const { store, owner, editor, add, share } = setup(t, path);
  const lisbon = add(owner, "Lisbon");
  const rome = add(owner, "Rome");
  add(owner, "Oslo");
  add(editor, "Editor's own");
  share(owner, rome, EDITOR);
  arrange(store, owner, "Rome", "Oslo", "Lisbon");
  arrange(store, editor, "Rome", "Editor's own");
  store.applyMutation(owner, { type: "trip.delete", id: rome });
  store.applyMutation(owner, { type: "trip.delete", id: lisbon });
  assert.deepEqual([names(store, owner), names(store, editor)], [["Oslo"], ["Editor's own"]]);
  const db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  assert.deepEqual(db.prepare("SELECT tripId FROM trip_order WHERE tripId IN (?, ?)").all(rome, lisbon), [], "no place is left for a deleted trip");
});

test("the upgrade keeps every account's trips in the order All trips showed, newest first, and a replay keeps saved orders", (t) => {
  const path = fileDatabase(t);
  const { store, owner, editor, later, add, share } = setup(t, path);
  const lisbon = add(owner, "Lisbon");
  add(editor, "Editor's own");
  add(owner, "Rome");
  // Two trips made at the same moment showed by ID.
  later();
  for (const name of ["Oslo", "Kyoto"]) store.applyMutation(owner, tripInput({ name }));
  share(owner, lisbon, EDITOR);
  // The order All trips showed before schema 33, newest trip first.
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  const shown = (accountId) => db.prepare("SELECT name FROM trips WHERE id IN (SELECT id FROM trips WHERE ownerId = ? UNION SELECT tripId FROM trip_shares WHERE accountId = ?) ORDER BY createdAt DESC, id")
    .all(accountId, accountId).map((row) => row.name);
  const before = { owner: shown(owner), editor: shown(editor) };
  assert.deepEqual(before.editor, ["Editor's own", "Lisbon"]);
  assert.deepEqual(before.owner.slice(2), ["Rome", "Lisbon"]);
  db.exec("DROP TABLE trip_order; PRAGMA user_version = 32;");

  const upgraded = createStore(path, OWNER);
  t.after(() => upgraded.close());
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.deepEqual({ owner: names(upgraded, owner), editor: names(upgraded, editor) }, before, "no one's list changes");
  assert.deepEqual(db.prepare("SELECT position FROM trip_order WHERE accountId = ? ORDER BY position").all(owner).map((row) => row.position), [0, 1, 2, 3], "each account's trips are numbered from 0");

  arrange(upgraded, owner, "Lisbon", "Kyoto", "Rome", "Oslo");
  db.exec("PRAGMA user_version = 32;");
  const replayed = createStore(path, OWNER);
  t.after(() => replayed.close());
  assert.deepEqual([names(replayed, owner), names(replayed, editor)], [["Lisbon", "Kyoto", "Rome", "Oslo"], before.editor], "a replay keeps saved orders");
});

test("assistants can't propose a trip order, and a trip one deletes leaves its owner's order", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  const second = store.applyMutation(owner, tripInput({ name: "Second" })).id;
  store.applyMutation(owner, { type: "trip.order", tripIds: [second, ownerTrip] });
  assert.throws(() => propose([{ type: "trip.order", tripIds: [ownerTrip, second] }]), { name: "ValidationError", message: "Change 1: Each person puts their own trips in order on All trips, so trip order can't be proposed." });
  assert.deepEqual(names(store, owner), ["Second", "Owner trip"]);

  const proposal = propose([{ type: "trip.delete", id: second }]);
  assert.deepEqual(proposal.preview[0].records.map((record) => `${record.action} ${record.record}`), [`Deletes Trip “Second” (${AI_OWNER})`, `Deletes Trip “Second” (${AI_OWNER}): place in ${AI_OWNER}'s trip order`]);
  assert.equal(decide(proposal, true).status, "applied");
  assert.deepEqual(names(store, owner), ["Owner trip"]);
});
