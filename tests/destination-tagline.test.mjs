import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget } from "../src/lib/budget.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { aiSetup, OWNER } from "./ai-fixtures.mjs";
import { addDestination, destination, destinationEdit, fileDatabase, setup, stopEdit, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

/** A tagline as someone types it, capitals and all, which its page shows in capitals (TRA-125). */
const TAGLINE = "Where the Danube meets the Old Town";
const TOO_LONG = "tagline must be 120 characters or fewer.";
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
const tagline = (store, id) => destination(store, id).tagline;
/** A snapshot with every destination's tagline left out, to compare everything else. */
const withoutTaglines = (snapshot) => ({ ...snapshot, destinations: snapshot.destinations.map((item) => ({ ...item, tagline: null })) });

test("a destination starts without a tagline, saves one as typed, and clearing it restores the default (TRA-125)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
    const created = store.applyMutation({ type: "destination.create", city: "Graz" }).id;
    assert.deepEqual([tagline(store, id), tagline(store, created)], ["", ""], "new destinations show the default heading");
    store.applyMutation(destinationEdit(id, { tagline: `  ${TAGLINE} ` }));
    assert.equal(tagline(store, id), TAGLINE, "saved with its capitalization, without the spaces around it");
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.equal(tagline(store, id), TAGLINE, "reopening keeps it");
    for (const cleared of ["", "   ", "\t\n"]) {
      store.applyMutation(destinationEdit(id, { tagline: TAGLINE }));
      store.applyMutation(destinationEdit(id, { tagline: cleared }));
      assert.equal(tagline(store, id), "", `clearing it with ${JSON.stringify(cleared)} restores the default`);
    }
    assert.equal(tagline(store, created), "", "another destination's tagline is its own");
  } finally { store?.close(); }
});

test("a destination's tagline is the same in every trip that visits it, and changing it from any of them changes it everywhere", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Lisbon", nights: 3 });
  const otherTrip = store.applyMutation(tripInput({ name: "Second visit" })).id;
  const otherStop = store.applyMutation({ type: "stop.add", tripId: otherTrip, city: "Lisbon" }).id;
  const taglineIn = (trip) => store.getTripSnapshot(trip).data.destinations.find((item) => item.id === id).tagline;
  const everywhere = () => [taglineIn(tripId), taglineIn(otherTrip), store.getDestinationSnapshot(id).data.destinations[0].tagline,
    store.getDestinationsOverview().data.destinations.find((item) => item.id === id).tagline];
  store.applyMutation(destinationEdit(id, { tagline: TAGLINE }));
  assert.deepEqual(everywhere(), [TAGLINE, TAGLINE, TAGLINE, TAGLINE]);
  // The destination's editor on the other trip's page saves that trip's stay with it.
  store.applyMutation({ type: "destination.save", id, stopId: otherStop, tagline: "Seven hills, one tram", stay: "", nights: 2 });
  assert.deepEqual(everywhere(), Array(4).fill("Seven hills, one tram"));
});

test("someone a trip is shared with sees the owner's tagline for its destination and can change it", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  const id = store.applyMutation(owner, { type: "stop.add", tripId, city: "Vienna" }).id;
  store.applyMutation(owner, destinationEdit(id, { tagline: TAGLINE }));
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const friend = store.authorizeAccount("friend@example.test").id;
  const shown = (account) => store.getDestinationSnapshot(account, id).data.destinations[0].tagline;
  assert.deepEqual([shown(owner), shown(friend)], [TAGLINE, TAGLINE]);
  store.applyMutation(friend, destinationEdit(id, { tagline: "Coffee, cake and the opera" }));
  assert.deepEqual([shown(owner), shown(friend)], ["Coffee, cake and the opera", "Coffee, cake and the opera"]);
});

test("a tagline has at most 120 characters, and a refused save changes nothing", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const longest = "Ä".repeat(120);
  store.applyMutation(destinationEdit(id, { tagline: ` ${longest} ` }));
  assert.equal(tagline(store, id), longest, "spaces around it don't count");
  const before = store.getSnapshot();
  for (const [value, message] of [["Ä".repeat(121), TOO_LONG], [`${"word ".repeat(24)}x`, TOO_LONG], [42, "tagline must be text."], [null, "tagline must be text."]]) {
    for (const input of [destinationEdit(id, { tagline: value }), stopEdit(id, { tagline: value, nights: 4 })]) {
      assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input));
    }
  }
  assert.deepEqual(store.getSnapshot(), before);
});

test("editing anything else keeps a destination's tagline, and changing it changes nothing else", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3, notes: "Walk the Ring", hotelNightlyAmount: "150", miscDailyAmount: "40" });
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "40", departure: "", arrival: "", url: "", notes: "Keep this connection" });
  store.applyMutation(destinationEdit(id, { tagline: TAGLINE }));
  // Each section's own editor, and a page opened before taglines, sends none, which keeps it. So does a new city.
  for (const edit of [
    destinationEdit(id, { notes: "Only notes" }),
    destinationEdit(id, { weatherHighF: 80, weatherLowF: 60, weatherPeriod: "July", weatherRainfall: "Light", weatherSource: "" }),
    destinationEdit(id, { shoppingAmount: "200" }),
    stopEdit(id, { nights: 4, hotelNightlyAmount: "160" }),
    { type: "destination.churchVisibility", id, enabled: false },
    destinationEdit(id, { city: "Vienna, State of Vienna, Austria", cityFromSuggestion: true }),
  ]) {
    store.applyMutation(edit);
    assert.equal(tagline(store, id), TAGLINE, JSON.stringify(edit));
  }
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "40", departure: "", arrival: "", url: "", notes: "Keep this connection" });
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId);
  const saved = destination(store, id);
  for (const value of ["Coffee, cake and the opera", "", TAGLINE]) {
    // The destination's editor sends its city and notes as saved, with the tagline typed.
    store.applyMutation(stopEdit(id, { city: saved.city, notes: saved.notes, stay: "Stay notes", nights: 4, tagline: value }));
    assert.equal(tagline(store, id), value);
    assert.deepEqual(withoutTaglines(store.getSnapshot()), withoutTaglines(before), "the city, its suggestion record, notes, stay, connections and photos are unchanged");
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
  }
});

test("schema 30 databases upgrade without a tagline on any destination, and a replay keeps the taglines saved since", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const vienna = addDestination(store, tripId, { city: "Vienna", nights: 3, notes: "Walk the Ring" });
    store.applyMutation({ type: "destination.create", city: "Graz" });
    for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "40", departure: "", arrival: "", url: "", notes: "" });
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE destinations DROP COLUMN tagline; PRAGMA user_version = 30;");
    db.close();
    store = createOwnedStore(path);
    assert.ok(store.getSnapshot().destinations.every((item) => item.tagline === ""));
    assert.deepEqual(store.getSnapshot(), saved, "every destination keeps everything saved for it, and shows the default heading");
    store.applyMutation(destinationEdit(vienna, { tagline: TAGLINE }));
    const later = store.getSnapshot();
    // A replay of schema 31, also after the schema 1 build resets the schema version, keeps it.
    for (const version of [30, 1]) {
      store.close(); store = null;
      const replay = new DatabaseSync(path);
      replay.exec(`PRAGMA user_version = ${version};`);
      replay.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps saved taglines`);
    }
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude propose a destination's tagline, previewed as typed, and approving saves it", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  const id = store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Vienna" }).id;
  /** The destination's Tagline field in a proposal's preview, or undefined when the proposal doesn't change it. */
  const previewed = (proposal) => proposal.preview[0].records.find((record) => record.record === `Destination “Vienna” (${OWNER})`)?.fields.find((field) => field.name === "Tagline");
  const taglineNow = () => store.getSnapshot().destinations.find((item) => item.id === id).tagline;

  const added = propose([{ type: "destination.save", id, tagline: TAGLINE }]);
  assert.deepEqual(previewed(added), { name: "Tagline", before: null, after: TAGLINE });
  assert.equal(taglineNow(), "", "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.equal(taglineNow(), TAGLINE);

  const noted = propose([{ type: "destination.save", id, notes: "Book the opera early" }]);
  assert.equal(previewed(noted), undefined, "a change without a tagline keeps it, so the preview leaves it out");
  assert.equal(decide(noted, true).status, "applied");
  assert.equal(taglineNow(), TAGLINE);

  const cleared = propose([{ type: "destination.save", id, tagline: "" }]);
  assert.deepEqual(previewed(cleared), { name: "Tagline", before: TAGLINE, after: null });
  assert.equal(decide(cleared, true).status, "applied");
  assert.equal(taglineNow(), "");

  const before = store.getSnapshot();
  assert.throws(() => propose([{ type: "destination.save", id, tagline: "A".repeat(121) }]), refusal(`Change 1: ${TOO_LONG}`));
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "destination.save");
  assert.equal(schema.properties.tagline.maxLength, 120, "assistants are told the limit");
  assert.ok(!schema.required.includes("tagline"), "left out, it is kept");
});
