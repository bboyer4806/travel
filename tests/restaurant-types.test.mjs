import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget } from "../src/lib/budget.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { RESTAURANT_TYPES } from "../src/lib/types.ts";
import { aiSetup, NOW } from "./ai-fixtures.mjs";
import { addDestination, candidateInput, fileDatabase, setup, stop, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore } from "./owned-store.mjs";

/** A restaurant's save as its editor sends it, adding a new one unless `overrides` names a saved one by `id` (TRA-36). */
const restaurant = (destinationId, overrides = {}) => candidateInput(destinationId, "restaurants", { name: "Café Central", price: "45.50", included: false, ...overrides });
const idea = (store, id) => store.getSnapshot().candidates.find((item) => item.id === id);
const typesOf = (store, id) => idea(store, id).restaurantTypes;
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
const UNSUPPORTED = "Choose restaurant types from breakfast, lunch, dinner, snack and drinks.";
const REPEATED = "Choose each restaurant type once.";
const NOT_RESTAURANT = "Restaurant types are available for restaurants only.";

test("a restaurant saves no type, one, or several together, in Travel's order (TRA-36)", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const save = (overrides) => store.applyMutation(restaurant(id, overrides)).id;
  assert.deepEqual(typesOf(store, save({})), [], "a restaurant needs no types");
  assert.deepEqual(typesOf(store, save({ restaurantTypes: [] })), []);
  assert.deepEqual(typesOf(store, save({ restaurantTypes: ["lunch"] })), ["lunch"]);
  assert.deepEqual(typesOf(store, save({ restaurantTypes: ["drinks", "lunch"] })), ["lunch", "drinks"], "choosing one keeps the other, and they list in Travel's order");
  assert.deepEqual(typesOf(store, save({ restaurantTypes: ["drinks", "snack", "dinner", "lunch", "breakfast"] })), [...RESTAURANT_TYPES]);
  assert.deepEqual(RESTAURANT_TYPES, ["breakfast", "lunch", "dinner", "snack", "drinks"]);
});

test("editing a restaurant adds, changes and clears its types, a save without them keeps them, and reopening keeps them", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
    const created = restaurant(id, { restaurantTypes: ["breakfast"] });
    const restaurantId = store.applyMutation(created).id;
    // The same save sent again after its response is lost changes that restaurant instead of adding another.
    store.applyMutation({ ...created, restaurantTypes: ["breakfast", "dinner"] });
    assert.equal(store.getSnapshot().candidates.length, 1);
    assert.deepEqual(typesOf(store, restaurantId), ["breakfast", "dinner"]);
    const edit = (overrides) => store.applyMutation(restaurant(id, { id: restaurantId, ...overrides }));
    edit({ restaurantTypes: ["snack"] });
    assert.deepEqual(typesOf(store, restaurantId), ["snack"]);
    // A page opened before restaurant types sends none, which keeps them.
    edit({ name: "Café Central, renamed" });
    assert.deepEqual([idea(store, restaurantId).name, typesOf(store, restaurantId)], ["Café Central, renamed", ["snack"]]);
    edit({ restaurantTypes: ["lunch", "drinks"] });
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(typesOf(store, restaurantId), ["lunch", "drinks"], "reopening keeps them");
    edit({ restaurantTypes: [] });
    assert.deepEqual(typesOf(store, restaurantId), [], "unchecking every type clears them");
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(typesOf(store, restaurantId), []);
  } finally { store?.close(); }
});

test("only Travel's five restaurant types can be saved, each once, and a refused save changes nothing", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const restaurantId = store.applyMutation(restaurant(id, { restaurantTypes: ["dinner"] })).id;
  const before = store.getSnapshot();
  for (const [restaurantTypes, message] of [
    [["brunch"], UNSUPPORTED], [["Lunch"], UNSUPPORTED], [["lunch", ""], UNSUPPORTED], [[null], UNSUPPORTED], [[1], UNSUPPORTED],
    ["lunch", UNSUPPORTED], [{ 0: "lunch" }, UNSUPPORTED], [null, UNSUPPORTED], [["lunch", "lunch"], REPEATED],
  ]) {
    for (const input of [restaurant(id, { restaurantTypes }), restaurant(id, { id: restaurantId, restaurantTypes })]) {
      assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(restaurantTypes));
    }
  }
  assert.deepEqual(store.getSnapshot(), before);
});

test("hotels and activities have no restaurant types, and save as before", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput()).id;
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  for (const category of ["hotels", "activities"]) {
    const saved = store.applyMutation(candidateInput(id, category, { name: "A " + category })).id;
    assert.deepEqual(typesOf(store, saved), []);
    const before = store.getSnapshot();
    for (const input of [candidateInput(id, category, { restaurantTypes: ["lunch"] }), candidateInput(id, category, { id: saved, restaurantTypes: ["drinks", "snack"] })]) {
      assert.throws(() => store.applyMutation(input), refusal(NOT_RESTAURANT), category);
    }
    assert.deepEqual(store.getSnapshot(), before, "a refused save changes nothing");
    // An empty list is no types, as they already have.
    store.applyMutation(candidateInput(id, category, { id: saved, name: "Renamed", restaurantTypes: [] }));
    assert.deepEqual([idea(store, saved).name, typesOf(store, saved)], ["Renamed", []]);
  }
  // The database itself keeps restaurant types to restaurants.
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  assert.throws(() => db.prepare("UPDATE candidates SET restaurantTypesJson = ? WHERE category = 'hotels'").run('["lunch"]'), /CHECK constraint failed/);
});

test("a restaurant's types are the same in every trip that visits its destination", (t) => {
  const { store, tripId } = setup(t);
  const otherTrip = store.applyMutation(tripInput({ name: "Second visit" })).id;
  const id = addDestination(store, tripId, { city: "Lisbon", nights: 3 });
  const otherStop = store.applyMutation({ type: "stop.add", tripId: otherTrip, city: "Lisbon" }).id;
  assert.equal(stop(store, otherStop).destinationId, id, "both trips visit the owner's one Lisbon");
  const restaurantId = store.applyMutation(restaurant(id, { restaurantTypes: ["lunch", "drinks"] })).id;
  const typesIn = (trip) => store.getTripSnapshot(trip).data.candidates.find((item) => item.id === restaurantId).restaurantTypes;
  assert.deepEqual([typesIn(tripId), typesIn(otherTrip), store.getDestinationSnapshot(id).data.candidates[0].restaurantTypes], [["lunch", "drinks"], ["lunch", "drinks"], ["lunch", "drinks"]]);
  store.applyMutation(restaurant(id, { id: restaurantId, restaurantTypes: ["dinner"] }));
  assert.deepEqual([typesIn(tripId), typesIn(otherTrip)], [["dinner"], ["dinner"]], "changing them from one trip changes them in every trip");
});

test("changing a restaurant's types changes nothing else: its price, budget selection, Must do, order, or any budget", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const links = [{ id: randomUUID(), url: "https://example.com/menu", description: "Menu" }];
  const restaurantId = store.applyMutation(restaurant(id, { price: "80", included: true, mustDo: true, address: "Herrengasse 14", notes: "Book ahead", links })).id;
  store.applyMutation(restaurant(id, { name: "Another", price: "20", included: true }));
  const withoutTypes = (snapshot) => ({ ...snapshot, candidates: snapshot.candidates.map((item) => ({ ...item, restaurantTypes: null })) });
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId);
  for (const restaurantTypes of [["lunch", "drinks"], ["breakfast"], []]) {
    // The editor sends every field as saved, with the types checked.
    store.applyMutation(restaurant(id, { id: restaurantId, price: "80", included: true, mustDo: true, address: "Herrengasse 14", notes: "Book ahead", url: links[0].url, links, restaurantTypes }));
    assert.deepEqual(typesOf(store, restaurantId), restaurantTypes);
    assert.deepEqual(withoutTypes(store.getSnapshot()), withoutTypes(before));
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
  }
});

test("schema 27 databases upgrade with no types on any idea, and a replay keeps the types saved since", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
    const ideas = Object.fromEntries(["hotels", "activities", "restaurants"].map((category) => [category,
      store.applyMutation(candidateInput(id, category, { name: "Saved " + category, mustDo: category !== "hotels" })).id]));
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE candidates DROP COLUMN restaurantTypesJson; PRAGMA user_version = 27;");
    db.close();
    store = createOwnedStore(path);
    assert.ok(store.getSnapshot().candidates.every((item) => item.restaurantTypes.length === 0));
    assert.deepEqual(store.getSnapshot(), saved, "every idea keeps everything saved for it, with no types");
    store.applyMutation(candidateInput(id, "restaurants", { id: ideas.restaurants, name: "Saved restaurants", mustDo: true, restaurantTypes: ["lunch", "drinks"] }));
    const later = store.getSnapshot();
    assert.deepEqual(typesOf(store, ideas.restaurants), ["lunch", "drinks"]);
    // A replay of schema 28, also after the schema 1 build resets the schema version, keeps them.
    for (const version of [27, 1]) {
      store.close(); store = null;
      const replay = new DatabaseSync(path);
      replay.exec(`PRAGMA user_version = ${version};`);
      replay.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps saved types`);
    }
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude propose a restaurant's types, previewed as its tags name them, and approving saves them", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  const destinationId = store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Vienna" }).id;
  const restaurantId = randomUUID();
  const save = (overrides) => ({ type: "candidate.save", id: restaurantId, destinationId, category: "restaurants", name: "Café Central", price: "", address: "", url: "", notes: "", included: false, ...overrides });
  /** The restaurant's Restaurant types field in a proposal's preview, or undefined when the proposal doesn't change them. */
  const previewed = (proposal) => proposal.preview[0].records.find((record) => record.record.endsWith("restaurant “Café Central”"))?.fields.find((field) => field.name === "Restaurant types");
  const typesNow = () => store.getSnapshot().candidates.find((item) => item.id === restaurantId)?.restaurantTypes;

  const added = propose([save({ create: true, restaurantTypes: ["drinks", "lunch"] })]);
  assert.deepEqual(previewed(added), { name: "Restaurant types", before: null, after: "Lunch, Drinks" });
  assert.equal(typesNow(), undefined, "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.deepEqual(typesNow(), ["lunch", "drinks"]);

  const renamed = propose([save({ name: "Café Central", notes: "Cake", mustDo: true })]);
  assert.equal(previewed(renamed), undefined, "a change without types keeps them, so the preview leaves them out");
  assert.equal(decide(renamed, true).status, "applied");
  assert.deepEqual(typesNow(), ["lunch", "drinks"]);

  const cleared = propose([save({ restaurantTypes: [] })]);
  assert.deepEqual(previewed(cleared), { name: "Restaurant types", before: "Lunch, Drinks", after: null });
  assert.equal(decide(cleared, true).status, "applied");
  assert.deepEqual(typesNow(), []);

  const hotelId = randomUUID();
  const proposals = store.aiOverview(owner, NOW).proposals.length;
  const before = store.getSnapshot();
  for (const [changes, message] of [
    [[save({ restaurantTypes: ["brunch"] })], UNSUPPORTED],
    [[save({ restaurantTypes: ["lunch", "lunch"] })], REPEATED],
    [[save({ id: hotelId, create: true, category: "hotels", name: "Hotel Sacher", restaurantTypes: ["lunch"] })], NOT_RESTAURANT],
  ]) {
    assert.throws(() => propose(changes), refusal("Change 1: " + message));
  }
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");
  assert.equal(store.aiOverview(owner, NOW).proposals.length, proposals, "and isn't recorded");

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "candidate.save");
  assert.deepEqual(schema.properties.restaurantTypes.items.enum, RESTAURANT_TYPES, "assistants are told the five types");
  assert.ok(!schema.required.includes("restaurantTypes"), "left out, they are kept");
});
