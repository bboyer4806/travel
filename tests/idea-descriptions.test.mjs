import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget } from "../src/lib/budget.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { aiSetup } from "./ai-fixtures.mjs";
import { addCity, addDestination, candidateInput, fileDatabase, setup, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

// TRA-138: what each hotel, activity and restaurant idea is, in a few words, shown below its name on its cards.

/** What a hotel is, as someone types it. */
const HOTEL = "Boutique hotel";
const TOO_LONG = "description must be 120 characters or fewer.";
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
const idea = (store, id) => store.getSnapshot().candidates.find((item) => item.id === id);
const described = (store, id) => idea(store, id).description;
/** A snapshot with what every idea is left out, to compare everything else. */
const withoutDescriptions = (snapshot) => ({ ...snapshot, candidates: snapshot.candidates.map((item) => ({ ...item, description: null })) });

test("an idea starts without what it is unless it is typed, saves it as typed, and clearing it removes it", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
    // A page opened before descriptions, ChatGPT and Claude can add an idea without one.
    const plain = store.applyMutation(candidateInput(id, "hotels", { name: "Plain hotel" })).id;
    const hotel = store.applyMutation(candidateInput(id, "hotels", { name: "Hotel Sacher", included: false, description: `  Grand hotel, home of the Sachertorte ` })).id;
    const activity = store.applyMutation(candidateInput(id, "activities", { name: "St. Stephen's", description: "Historic cathedral" })).id;
    const restaurant = store.applyMutation(candidateInput(id, "restaurants", { name: "Figlmüller", description: "Traditional Viennese restaurant", restaurantTypes: ["lunch"] })).id;
    const blank = store.applyMutation(candidateInput(id, "activities", { name: "Prater", description: "" })).id;
    const all = [plain, hotel, activity, restaurant, blank];
    assert.deepEqual(all.map((item) => described(store, item)), ["", "Grand hotel, home of the Sachertorte", "Historic cathedral", "Traditional Viennese restaurant", ""],
      "saved with its capitalization, without the spaces around it");
    store.applyMutation(candidateInput(id, "hotels", { id: plain, name: "Plain hotel", description: "Business hotel by the station" }));
    assert.equal(described(store, plain), "Business hotel by the station", "editing an idea saves what it is");
    // The trip's page and the destination's page show it.
    const shown = (candidates) => all.map((item) => candidates.find((candidate) => candidate.id === item).description);
    const expected = ["Business hotel by the station", "Grand hotel, home of the Sachertorte", "Historic cathedral", "Traditional Viennese restaurant", ""];
    assert.deepEqual(shown(store.getTripSnapshot(tripId).data.candidates), expected);
    assert.deepEqual(shown(store.getDestinationSnapshot(id).data.candidates), expected);
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(all.map((item) => described(store, item)), expected, "reopening keeps them");
    for (const cleared of ["", "   ", "\t\n"]) {
      store.applyMutation(candidateInput(id, "activities", { id: activity, name: "St. Stephen's", description: "Historic cathedral" }));
      store.applyMutation(candidateInput(id, "activities", { id: activity, name: "St. Stephen's", description: cleared }));
      assert.equal(described(store, activity), "", `clearing it with ${JSON.stringify(cleared)} removes it`);
    }
    assert.equal(described(store, hotel), "Grand hotel, home of the Sachertorte", "another idea's is its own");
  } finally { store?.close(); }
});

test("changing what an idea is changes nothing else, and saving it without one, or changing anything else, keeps it", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const links = [{ id: randomUUID(), url: "https://example.com/menu", description: "Menu" }];
  // Everything the restaurant's editor sends, as saved, except what it is.
  const editor = { name: "Café Central", price: "80", included: true, mustDo: true, address: "Herrengasse 14", notes: "Book ahead", url: links[0].url, links, restaurantTypes: ["lunch", "drinks"] };
  const restaurantId = store.applyMutation(candidateInput(id, "restaurants", editor)).id;
  store.applyMutation(candidateInput(id, "restaurants", { name: "Another", price: "20", included: true }));
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId);
  for (const description of ["Grand coffeehouse", "", "Viennese coffeehouse since 1876"]) {
    store.applyMutation(candidateInput(id, "restaurants", { id: restaurantId, ...editor, description }));
    assert.equal(described(store, restaurantId), description);
    assert.deepEqual(withoutDescriptions(store.getSnapshot()), withoutDescriptions(before), "its name, price, address, links, notes, types, selection, Must do and place in the list are unchanged");
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
  }
  // A page opened before descriptions, ChatGPT and Claude can save an idea without one, which keeps it. So does every other change.
  for (const edit of [
    candidateInput(id, "restaurants", { id: restaurantId, ...editor, notes: "Book a week ahead" }),
    { type: "candidate.move", id: restaurantId, direction: "down" },
    { type: "candidate.mustDo", id: restaurantId, mustDo: false },
    { type: "candidate.include", id: restaurantId, included: false },
  ]) {
    store.applyMutation(edit);
    assert.equal(described(store, restaurantId), "Viennese coffeehouse since 1876", JSON.stringify(edit));
  }
});

test("what an idea is has at most 120 characters, and a refused save keeps the saved one", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const hotelId = store.applyMutation(candidateInput(id, "hotels", { description: HOTEL })).id;
  const longest = "Ä".repeat(120);
  const longestId = store.applyMutation(candidateInput(id, "activities", { description: ` ${longest} ` })).id;
  assert.equal(described(store, longestId), longest, "spaces around it don't count");
  const before = store.getSnapshot();
  for (const [value, message] of [["Ä".repeat(121), TOO_LONG], [`${"word ".repeat(24)}x`, TOO_LONG], [42, "description must be text."], [null, "description must be text."]]) {
    // Neither a new idea nor a change to a saved one is saved.
    for (const input of [candidateInput(id, "hotels", { description: value }), candidateInput(id, "hotels", { id: hotelId, description: value })]) {
      assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input));
      assert.deepEqual(store.getSnapshot(), before);
    }
  }
  // A save refused for any other reason keeps it too, even one refused after the idea's details are written.
  for (const [input, message] of [
    [candidateInput(id, "hotels", { id: hotelId, description: "Not saved", name: " " }), "Please enter name."],
    [candidateInput(id, "hotels", { id: hotelId, description: "Not saved", restaurantTypes: ["dinner"] }), "Restaurant types are available for restaurants only."],
    [candidateInput(id, "hotels", { id: hotelId, description: "Not saved", gallery: { add: [], remove: [randomUUID()] } }), "A photo has changed or no longer exists. Refresh and try again."],
  ]) {
    assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input));
    assert.deepEqual(store.getSnapshot(), before);
  }
});

test("what an idea is shows in every trip that visits its destination, and someone a trip is shared with sees and changes it", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  const otherTrip = store.applyMutation(owner, tripInput({ name: "Second visit" })).id;
  const id = addCity((input) => store.applyMutation(owner, input).id, tripId, "Lisbon", { nights: 3 });
  store.applyMutation(owner, { type: "stop.add", tripId: otherTrip, city: "Lisbon" });
  const hotelId = store.applyMutation(owner, candidateInput(id, "hotels", { description: HOTEL })).id;
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const friend = store.authorizeAccount("friend@example.test").id;
  const hotelIn = (candidates) => candidates.find((item) => item.id === hotelId).description;
  /** What the hotel is on the pages the account can open: each trip that visits Lisbon, then the destination's page. */
  const shown = (account, trips) => [...trips.map((trip) => hotelIn(store.getTripSnapshot(account, trip).data.candidates)), hotelIn(store.getDestinationSnapshot(account, id).data.candidates)];
  assert.deepEqual(shown(owner, [tripId, otherTrip]), [HOTEL, HOTEL, HOTEL]);
  assert.deepEqual(shown(friend, [tripId]), [HOTEL, HOTEL]);
  store.applyMutation(friend, candidateInput(id, "hotels", { id: hotelId, description: "Riverside guesthouse" }));
  assert.deepEqual(shown(owner, [tripId, otherTrip]), Array(3).fill("Riverside guesthouse"), "changing it from one trip changes it everywhere");
  assert.deepEqual(shown(friend, [tripId]), Array(2).fill("Riverside guesthouse"));
});

test("schema 36 databases upgrade without what any idea is, and a replay keeps what was saved since", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
    const ideas = Object.fromEntries(["hotels", "activities", "restaurants"].map((category) => [category, store.applyMutation(candidateInput(id, category, {
      name: "Saved " + category, mustDo: category !== "hotels", notes: "Notes about " + category, ...(category === "restaurants" && { restaurantTypes: ["dinner"] }),
    })).id]));
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE candidates DROP COLUMN description; PRAGMA user_version = 36;");
    db.close();
    store = createOwnedStore(path);
    assert.ok(store.getSnapshot().candidates.every((item) => item.description === ""), "no card shows a line below its name");
    assert.deepEqual(store.getSnapshot(), saved, "every idea keeps everything saved for it");
    store.applyMutation(candidateInput(id, "activities", { id: ideas.activities, name: "Saved activities", mustDo: true, notes: "Notes about activities", description: "Historic cathedral" }));
    const later = store.getSnapshot();
    assert.equal(described(store, ideas.activities), "Historic cathedral");
    // A replay of schema 37, also after the schema 1 build resets the schema version, keeps it.
    for (const version of [36, 1]) {
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
      const column = observer.prepare("PRAGMA table_info(candidates)").all().find((info) => info.name === "description");
      assert.deepEqual({ type: column.type, notnull: column.notnull, dflt_value: column.dflt_value }, { type: "TEXT", notnull: 1, dflt_value: "''" });
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude read what an idea is and propose it, previewed as What it is, and approving saves it", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  const destinationId = store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Vienna" }).id;
  const hotelId = randomUUID();
  const save = (overrides) => ({ type: "candidate.save", id: hotelId, destinationId, category: "hotels", name: "Hotel Sacher", price: "", address: "", url: "", notes: "", included: false, ...overrides });
  /** The hotel's What it is field in a proposal's preview, or undefined when the proposal doesn't change it. */
  const previewed = (proposal) => proposal.preview[0].records.find((record) => record.record.endsWith("hotel “Hotel Sacher”"))?.fields.find((field) => field.name === "What it is");
  const describedNow = () => store.aiDestination(destinationId).ideas.find((item) => item.id === hotelId)?.description;

  const added = propose([save({ create: true, description: HOTEL })]);
  assert.deepEqual(previewed(added), { name: "What it is", before: null, after: HOTEL });
  assert.equal(describedNow(), undefined, "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.equal(describedNow(), HOTEL, "assistants read it with the idea's other details");
  assert.equal(store.aiTrip(ownerTrip).ideas.find((item) => item.id === hotelId).description, HOTEL);

  const noted = propose([save({ notes: "Ask for a courtyard room" })]);
  assert.equal(previewed(noted), undefined, "a change without it keeps it, so the preview leaves it out");
  assert.equal(decide(noted, true).status, "applied");
  assert.equal(describedNow(), HOTEL);

  const cleared = propose([save({ description: "" })]);
  assert.deepEqual(previewed(cleared), { name: "What it is", before: HOTEL, after: null });
  assert.equal(decide(cleared, true).status, "applied");
  assert.equal(describedNow(), "");

  const before = store.getSnapshot();
  assert.throws(() => propose([save({ description: "A".repeat(121) })]), refusal(`Change 1: ${TOO_LONG}`));
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "candidate.save");
  assert.equal(schema.properties.description.maxLength, 120, "assistants are told the limit");
  assert.ok(!schema.required.includes("description"), "left out, it is kept");
});
