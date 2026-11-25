import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as packing from "../src/lib/packing.ts";
import { pageHelp } from "../src/lib/help.ts";
import { PLANNER_UPDATED } from "../src/lib/planner-updated.ts";
import { createStore, SCHEMA_VERSION } from "../src/lib/store.ts";
import { aiSetup, GUEST } from "./ai-fixtures.mjs";
import { addCity, fileDatabase, newItem, setup, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

// TRA-18: each trip's packing list, one for everyone who can open the trip, and the recommendations Travel works out from
// the trip on request, which people review before any is added.
const { MAX_PACKING_ADD, PACKING_CATEGORIES, chosenItems, packingProgress, packingReview, recommendPacking } = packing;
const NOT_AVAILABLE = "This item no longer exists or isn't shared with you. Please refresh and try again.";
const OTHER_TRIP = "This packing item belongs to a different trip.";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A packing item's save, as its editor sends it: a new item's with its new ID and `create`, or a saved one's by `id`. */
const itemInput = (tripId, overrides = {}) => ({ type: "packingItem.save", tripId, name: "Socks", category: "clothing", quantity: 7, ...overrides, ...newItem(overrides) });
/** An item a review adds, with its new ID. */
const added = (overrides = {}) => ({ id: randomUUID(), name: "Passport", category: "documents", quantity: 2, ...overrides });
/** A trip's packing items, as everything saved holds them. */
const listOf = (store, tripId) => store.getSnapshot().packingItems.filter((item) => item.tripId === tripId);
/** A city added to a trip by its owner, with `details` for its stay and destination. Returns its ID, which its stay shares. */
const city = (store, tripId, name, details = {}) => addCity((input) => store.applyMutation(input).id, tripId, name, details);
/** Monthly averages with each month's [high, low, precipitation], or the same for every month. */
const climate = (months) => ({ months: MONTHS.map((month, index) => ({ month, highF: months[index][0], lowF: months[index][1], precipitationIn: months[index][2] })), source: "Test normals", firstYear: 1991, lastYear: 2020 });
const everyMonth = (highF, lowF, precipitationIn) => climate(MONTHS.map(() => [highF, lowF, precipitationIn]));
const idea = (destinationId, category, name, overrides = {}) => ({ type: "candidate.save", ...newItem(), destinationId, category, name, price: "", address: "", url: "", notes: "", included: false, ...overrides });
/** Travel's recommendations for a trip, from what its page loads. */
const recommend = (store, tripId) => recommendPacking(store.getTripSnapshot(tripId).data, tripId);
const recommended = (result, name) => result.items.find((item) => item.name === name);
const names = (result) => result.items.map((item) => item.name);

test("a trip's packing list adds, renames, recategorizes, recounts, packs and deletes items, alphabetically (TRA-18)", (t) => {
  const { store, tripId } = setup(t);
  assert.deepEqual(listOf(store, tripId), [], "a trip starts without a packing list");
  const socks = store.applyMutation(itemInput(tripId, { name: "  Socks  " })).id;
  const charger = store.applyMutation(itemInput(tripId, { name: "phone charger", category: "electronics", quantity: 2 })).id;
  assert.deepEqual(listOf(store, tripId), [
    { id: charger, tripId, category: "electronics", name: "phone charger", quantity: 2, packed: false },
    { id: socks, tripId, category: "clothing", name: "Socks", quantity: 7, packed: false },
  ], "names are trimmed, new items aren't packed, and items are in alphabetical order whatever their capitals");

  store.applyMutation({ type: "packingItem.pack", id: socks, tripId, packed: true });
  store.applyMutation(itemInput(tripId, { id: socks, name: "Wool socks", category: "activity-gear", quantity: 4 }));
  assert.deepEqual(listOf(store, tripId).find((item) => item.id === socks), { id: socks, tripId, category: "activity-gear", name: "Wool socks", quantity: 4, packed: true }, "an edit keeps it packed");
  store.applyMutation({ type: "packingItem.pack", id: socks, tripId, packed: false });
  assert.equal(listOf(store, tripId).find((item) => item.id === socks).packed, false, "and unchecking it unpacks it");
  store.applyMutation({ type: "packingItem.delete", id: charger, tripId });
  assert.deepEqual(listOf(store, tripId).map((item) => item.name), ["Wool socks"]);
});

test("packing lists, with their quantities, categories and packed statuses, are saved and opened again, each trip's apart (TRA-18)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const otherTrip = store.applyMutation(tripInput({ name: "Other trip" })).id;
    const socks = store.applyMutation(itemInput(tripId)).id;
    store.applyMutation({ type: "packingList.add", tripId, items: [added(), added({ name: "Sunscreen", category: "health-safety", quantity: 1 })] });
    store.applyMutation({ type: "packingItem.pack", id: socks, tripId, packed: true });
    store.applyMutation(itemInput(otherTrip, { name: "Hiking boots", category: "activity-gear", quantity: 3 }));
    const saved = store.getSnapshot();
    // Clearing `store` after each close means the finally block never closes a closed store.
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved, "everything is as it was saved");
    assert.deepEqual(store.getTripSnapshot(tripId).data.packingItems.map((item) => [item.name, item.quantity, item.packed]), [["Passport", 2, false], ["Socks", 7, true], ["Sunscreen", 1, false]], "a trip's page loads only its own list");
    assert.deepEqual(store.getTripSnapshot(otherTrip).data.packingItems.map((item) => item.name), ["Hiking boots"]);
    // Other pages carry no packing list.
    assert.deepEqual(store.getHomeOverview().data.packingItems, []);
    assert.deepEqual(store.getDestinationsOverview().data.packingItems, []);
  } finally { store?.close(); }
});

test("invalid packing items are refused with their messages, and nothing is saved (TRA-18)", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(itemInput(tripId)).id;
  const before = store.getSnapshot();
  const quantity = "Quantity must be a whole number from 1 to 9999.";
  for (const [fields, message] of [
    [{ name: " " }, "Please enter name."],
    [{ name: "x".repeat(161) }, "name must be 160 characters or fewer."],
    [{ category: "shoes" }, "Choose a category for this item."],
    [{ category: undefined }, "Choose a category for this item."],
    [{ quantity: 0 }, quantity], [{ quantity: 10000 }, quantity], [{ quantity: 1.5 }, quantity], [{ quantity: "2" }, quantity], [{ quantity: null }, quantity],
  ]) {
    for (const input of [itemInput(tripId, fields), itemInput(tripId, { id, ...fields }), { type: "packingList.add", tripId, items: [added(fields)] }]) {
      assert.throws(() => store.applyMutation(input), { name: "ValidationError", message }, JSON.stringify(input));
    }
  }
  const item = added();
  for (const [input, message] of [
    [{ type: "packingItem.pack", id, tripId, packed: "yes" }, "packed must be true or false."],
    [{ type: "packingList.add", tripId, items: [] }, "Choose at least one item to add to the packing list."],
    [{ type: "packingList.add", tripId, items: "Socks" }, "Choose at least one item to add to the packing list."],
    [{ type: "packingList.add", tripId, items: Array.from({ length: MAX_PACKING_ADD + 1 }, () => added()) }, `Add up to ${MAX_PACKING_ADD} items to the packing list at once.`],
    [{ type: "packingList.add", tripId, items: [item, { ...item, name: "Again" }] }, "Each packing item must have a unique identifier."],
    [{ type: "packingList.add", tripId, items: [{ ...item, packed: true }] }, "A packing item to add has no field packed."],
    [{ type: "packingList.add", tripId, items: ["Socks"] }, "Give each item to add its id, name, category and quantity."],
    // A save without an ID comes from a page opened before saves named their new items (TRA-75).
    [{ type: "packingItem.save", tripId, name: "Socks", category: "clothing", quantity: 1 }, PLANNER_UPDATED],
  ]) {
    assert.throws(() => store.applyMutation(input), { name: "ValidationError", message }, message);
  }
  assert.deepEqual(store.getSnapshot(), before, "nothing is saved");
});

test("a packing item's changes name its own trip, and gone items stay gone (TRA-18)", (t) => {
  const { store, tripId } = setup(t);
  const otherTrip = store.applyMutation(tripInput({ name: "Other trip" })).id;
  const id = store.applyMutation(itemInput(tripId)).id;
  const otherId = store.applyMutation(itemInput(otherTrip)).id;
  const before = store.getSnapshot();
  for (const [input, message] of [
    [itemInput(otherTrip, { id, name: "Moved" }), OTHER_TRIP],
    [{ type: "packingItem.pack", id, tripId: otherTrip, packed: true }, OTHER_TRIP],
    [{ type: "packingItem.delete", id, tripId: otherTrip }, OTHER_TRIP],
    [{ type: "packingList.add", tripId, items: [added({ id: otherId })] }, OTHER_TRIP],
    [itemInput(tripId, { id: randomUUID() }), NOT_AVAILABLE],
    [{ type: "packingItem.pack", id: randomUUID(), tripId, packed: true }, NOT_AVAILABLE],
    [itemInput(randomUUID()), NOT_AVAILABLE],
    [{ type: "packingList.add", tripId: randomUUID(), items: [added()] }, NOT_AVAILABLE],
  ]) {
    assert.throws(() => store.applyMutation(input), { name: "ValidationError", message }, JSON.stringify(input));
  }
  assert.deepEqual(store.getSnapshot(), before, "nothing changes");
  store.applyMutation({ type: "packingItem.delete", id, tripId });
  const deleted = store.getSnapshot();
  for (const input of [itemInput(tripId, { id }), { type: "packingItem.pack", id, tripId, packed: true }, { type: "packingItem.delete", id, tripId }]) {
    assert.throws(() => store.applyMutation(input), { name: "ValidationError", message: NOT_AVAILABLE });
  }
  assert.deepEqual(store.getSnapshot(), deleted, "a stale change never brings a deleted item back");
});

test("a save or an add sent again after a lost response changes nothing more (TRA-18)", (t) => {
  const { store, tripId } = setup(t);
  const input = itemInput(tripId);
  assert.equal(store.applyMutation(input).id, input.id);
  assert.equal(store.applyMutation({ ...input, quantity: 9 }).id, input.id, "a new item saved again changes it rather than adding another");
  assert.deepEqual(listOf(store, tripId).map((item) => [item.id, item.quantity]), [[input.id, 9]]);
  const add = { type: "packingList.add", tripId, items: [added(), added({ name: "Sunscreen", category: "health-safety", quantity: 1 })] };
  assert.equal(store.applyMutation(add).id, tripId);
  store.applyMutation({ type: "packingItem.pack", id: add.items[0].id, tripId, packed: true });
  store.applyMutation(itemInput(tripId, { id: add.items[1].id, name: "Reef-safe sunscreen", category: "health-safety", quantity: 2 }));
  const after = store.getSnapshot();
  store.applyMutation(add);
  assert.deepEqual(store.getSnapshot(), after, "the same add again adds nothing, and keeps each item as it is now, packed or not");
});

test("a trip's packing list goes with the trip, and stays when a destination leaves it (TRA-18)", (t) => {
  const { store, tripId } = setup(t);
  const lisbon = city(store, tripId, "Lisbon", { nights: 3 });
  store.applyMutation(itemInput(tripId));
  store.applyMutation({ type: "stop.remove", id: lisbon });
  assert.equal(listOf(store, tripId).length, 1, "the list belongs to the trip, not its destinations");
  store.applyMutation({ type: "trip.delete", id: tripId });
  assert.deepEqual(store.getSnapshot().packingItems, []);
});

test("everyone a trip is shared with views and changes one packing list, and nobody else can (TRA-18)", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const editor = store.authorizeAccount("editor@example.test").id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  const socks = store.applyMutation(owner, itemInput(tripId)).id;
  assert.equal(store.getTripSnapshot(editor, tripId), undefined, "before sharing, only its owner opens it");
  assert.throws(() => store.applyMutation(editor, { type: "packingItem.pack", id: socks, tripId, packed: true }), { message: NOT_AVAILABLE });

  store.applyMutation(owner, { type: "trip.share", tripId, email: "editor@example.test" });
  assert.deepEqual(store.getTripSnapshot(editor, tripId).data.packingItems.map((item) => item.name), ["Socks"], "the editor sees the owner's list");
  store.applyMutation(editor, itemInput(tripId, { name: "Phone charger", category: "electronics", quantity: 2 }));
  store.applyMutation(editor, { type: "packingItem.pack", id: socks, tripId, packed: true });
  store.applyMutation(editor, { type: "packingList.add", tripId, items: [added()] });
  const ownerView = store.getTripSnapshot(owner, tripId).data.packingItems;
  assert.deepEqual(ownerView.map((item) => [item.name, item.packed]), [["Passport", false], ["Phone charger", false], ["Socks", true]], "the owner sees the editor's changes");
  assert.deepEqual(store.getTripSnapshot(editor, tripId).data.packingItems, ownerView, "and both see the same list");

  assert.equal(store.getTripSnapshot(outsider, tripId), undefined, "someone it isn't shared with can't open it");
  const before = store.getSnapshot();
  for (const input of [itemInput(tripId), itemInput(tripId, { id: socks }), { type: "packingItem.pack", id: socks, tripId, packed: false }, { type: "packingItem.delete", id: socks, tripId }, { type: "packingList.add", tripId, items: [added()] }]) {
    assert.throws(() => store.applyMutation(outsider, input), { name: "ValidationError", message: NOT_AVAILABLE }, input.type);
  }
  assert.deepEqual(store.getSnapshot(), before, "or change it");

  store.applyMutation(owner, { type: "trip.unshare", tripId, email: "editor@example.test" });
  assert.throws(() => store.applyMutation(editor, { type: "packingItem.pack", id: socks, tripId, packed: false }), { message: NOT_AVAILABLE }, "unsharing ends the editor's access at once");
});

test("schema 47 databases upgrade with every trip's packing list empty, and a replay keeps saved items (TRA-18)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  let db = null;
  try {
    const tripId = store.applyMutation(tripInput()).id;
    store.close(); store = null;
    db = new DatabaseSync(path);
    db.exec("DROP TABLE packing_items; PRAGMA user_version = 47;");
    db.close(); db = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot().packingItems, [], "existing trips start without a packing list");
    assert.equal(store.getSnapshot().trips[0].id, tripId, "and keep everything else");
    store.applyMutation(itemInput(tripId));
    const saved = store.getSnapshot();
    store.close(); store = null;
    db = new DatabaseSync(path);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    // The database keeps categories and quantities to those Travel saves.
    assert.throws(() => db.prepare("INSERT INTO packing_items(id, tripId, category, name, quantity) VALUES(?, ?, 'shoes', 'Boots', 1)").run(randomUUID(), tripId), /CHECK constraint failed/);
    assert.throws(() => db.prepare("INSERT INTO packing_items(id, tripId, category, name, quantity) VALUES(?, ?, 'clothing', 'Boots', 0)").run(randomUUID(), tripId), /CHECK constraint failed/);
    db.exec("PRAGMA user_version = 47;");
    db.close(); db = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved, "a replay keeps saved items");
  } finally { db?.close(); store?.close(); }
});

test("recommended quantities follow the trip's days and travelers, with clothing for a week at most (TRA-18)", (t) => {
  const { store, tripId } = setup(t, tripInput({ travelers: 2, startDate: "2027-06-01" }));
  city(store, tripId, "Rome", { nights: 3 });
  let result = recommend(store, tripId);
  assert.deepEqual([recommended(result, "Underwear"), recommended(result, "Pants or skirts")], [
    { name: "Underwear", category: "clothing", quantity: 8, reasons: ["For 4 days"] },
    { name: "Pants or skirts", category: "clothing", quantity: 4, reasons: ["For 4 days"] },
  ], "3 nights are 4 days, for each of 2 travelers, and a pair of pants or a skirt every 3 days");
  assert.deepEqual([recommended(result, "Toothbrush").quantity, recommended(result, "Toothpaste").quantity, recommended(result, "First-aid kit").quantity], [2, 1, 1], "personal items are one each; shared ones one for the party");
  assert.deepEqual(recommended(result, "Prescription medications").reasons, ["Enough for 4 days, plus extra"]);
  assert.ok(result.assumptions.includes("Quantities are for all 2 travelers together."));

  city(store, tripId, "Naples", { nights: 6 });
  result = recommend(store, tripId);
  assert.deepEqual(recommended(result, "Underwear"), { name: "Underwear", category: "clothing", quantity: 14, reasons: ["For a week"] });
  assert.ok(result.assumptions.includes("Clothing covers a week of this 10-day trip, assuming laundry along the way."));

  city(store, tripId, "Florence");
  result = recommend(store, tripId);
  assert.equal(recommended(result, "Socks").quantity, 14);
  assert.ok(result.assumptions.includes("Florence has no nights set, so quantities assume a week."), "a stay without nights is assumed to make a week");

  const single = store.applyMutation(tripInput({ name: "Day trip", travelers: 1, startDate: "2027-06-01" })).id;
  city(store, single, "Pompeii", { nights: 0 });
  result = recommend(store, single);
  assert.deepEqual(recommended(result, "Underwear"), { name: "Underwear", category: "clothing", quantity: 1, reasons: ["For 1 day"] });
  assert.ok(!result.assumptions.some((assumption) => assumption.startsWith("Quantities are for")), "one traveler needs no note");
});

test("a trip without destinations gets a week's essentials, and says so (TRA-18)", (t) => {
  const { store, tripId } = setup(t, tripInput({ travelers: 1 }));
  const result = recommend(store, tripId);
  assert.deepEqual(result.assumptions, ["This trip has no destinations yet, so these are a week's essentials, without weather or activity gear."]);
  assert.deepEqual(names(result), [
    "Underwear", "Socks", "Shirts or tops", "Pants or skirts", "Sleepwear", "Comfortable walking shoes",
    "Toothbrush", "Toothpaste", "Deodorant", "Shampoo and conditioner", "Hairbrush or comb",
    "Phone charger", "Portable battery",
    "Photo ID", "Booking confirmations", "Credit cards and some cash",
    "Prescription medications", "First-aid kit", "Hand sanitizer",
  ], "in the list's order of categories");
  assert.deepEqual(recommended(result, "Underwear").quantity, 7);
});

test("weather comes from monthly averages for the months of each stay, else its typical weather, and says what it assumed (TRA-18)", (t) => {
  const { store, tripId } = setup(t, tripInput({ travelers: 1, startDate: "2027-01-10" }));
  const vienna = city(store, tripId, "Vienna", { nights: 3 });
  // A cold January and a hot, wet July: only the stay's month counts.
  store.applyMutation({ type: "destination.climate", id: vienna, climate: climate(MONTHS.map((_, index) => index === 0 ? [37, 27, 1.5] : index === 6 ? [90, 70, 6] : [60, 45, 1])) });
  let result = recommend(store, tripId);
  const cold = "Lows around 27 °F in Vienna";
  for (const name of ["Light jacket or sweater", "Warm coat", "Thermal base layers", "Warm hat", "Warm gloves", "Scarf"]) assert.deepEqual(recommended(result, name).reasons, [cold], name);
  for (const name of ["Shorts", "Sun hat", "Sunglasses", "Sunscreen", "Rain jacket or umbrella"]) assert.equal(recommended(result, name), undefined, `${name} isn't for January in Vienna`);
  assert.ok(!result.assumptions.some((assumption) => assumption.includes("Vienna")), "monthly averages for the stay's dates need no assumption");

  // A stay across two months takes the warmest high, coldest low and wettest month of both.
  store.applyMutation({ type: "trip.save", ...tripInput({ id: tripId, travelers: 1 }), startDate: "2027-06-29" });
  result = recommend(store, tripId);
  assert.deepEqual(recommended(result, "Sun hat").reasons, ["Highs around 90 °F in Vienna"]);
  assert.deepEqual(recommended(result, "Rain jacket or umbrella").reasons, ["About 6 in of rain a month in Vienna"]);
  assert.deepEqual(recommended(result, "Light jacket or sweater").reasons, ["Lows around 45 °F in Vienna"]);
  assert.equal(recommended(result, "Warm coat"), undefined, "June's 45 °F low is cool, not cold");

  city(store, tripId, "Rome", { nights: 2, weatherHighF: 86, weatherLowF: 65, weatherPeriod: "Summer" });
  city(store, tripId, "Oslo", { nights: 2 });
  result = recommend(store, tripId);
  assert.deepEqual(recommended(result, "Sunscreen").reasons, ["Highs around 90 °F in Vienna"], "the hottest stay explains sun protection once");
  assert.deepEqual(recommended(result, "Light jacket or sweater").reasons, ["Lows around 45 °F in Vienna", "No weather saved for Oslo"]);
  assert.ok(result.assumptions.includes("Weather for Rome is the typical weather saved for it, which may not match your dates."));
  assert.ok(result.assumptions.includes("No weather is saved for Oslo, so a light layer stands in for weather-specific clothing."));

  // Without a start date no stay has dates, so monthly averages can't be matched to it.
  store.applyMutation({ type: "trip.save", ...tripInput({ id: tripId, travelers: 1 }), startDate: null });
  result = recommend(store, tripId);
  assert.ok(result.assumptions.includes("Monthly averages for Vienna weren't used, since its stay has no dates yet. Dates come from the trip's start date and each stay's nights."));
  assert.ok(result.assumptions.includes("No weather is saved for Vienna and Oslo, so a light layer stands in for weather-specific clothing."));
  assert.deepEqual(recommended(result, "Sunscreen").reasons, ["Highs around 86 °F in Rome"]);
});

test("saved activities, restaurants and churches call for their gear, each item once with every reason (TRA-18)", (t) => {
  const { store, tripId } = setup(t, tripInput({ travelers: 2, startDate: "2027-07-01" }));
  const interlaken = city(store, tripId, "Interlaken", { nights: 3, weatherHighF: 75, weatherLowF: 55 });
  let result = recommend(store, tripId);
  assert.ok(result.assumptions.includes("No activities are saved for this trip's destinations, so no activity gear is recommended."));
  const zermatt = city(store, tripId, "Zermatt", { nights: 4 });
  for (const [destinationId, category, name, description] of [
    [interlaken, "activities", "Harder Kulm hike", ""], [zermatt, "activities", "Glacier walk", "Guided trekking"],
    [interlaken, "activities", "Lake Brienz", "Swimming beach"], [zermatt, "restaurants", "Chez Vrony", "Michelin-starred dinner"],
    // Whole words only: a gondola isn't skiing, and a poolside lunch isn't swimming.
    [zermatt, "activities", "Skyline gondola", ""], [interlaken, "restaurants", "Poolside lunch", ""],
    // Formal occasions count for restaurants; the rest only for activities.
    [interlaken, "restaurants", "Hiking hut", "Mountain hike stop"],
  ]) store.applyMutation(idea(destinationId, category, name, { description }));
  result = recommend(store, tripId);
  assert.deepEqual(recommended(result, "Hiking boots"), { name: "Hiking boots", category: "activity-gear", quantity: 2, reasons: ["For Harder Kulm hike in Interlaken and Glacier walk in Zermatt"] }, "one item for every hike, in every destination");
  assert.deepEqual(recommended(result, "Insect repellent").reasons, ["For Harder Kulm hike in Interlaken and Glacier walk in Zermatt"]);
  assert.deepEqual(recommended(result, "Swimsuit").reasons, ["For Lake Brienz in Interlaken"]);
  assert.deepEqual(recommended(result, "Sunscreen"), { name: "Sunscreen", category: "health-safety", quantity: 1, reasons: ["Highs around 75 °F in Interlaken", "For Lake Brienz in Interlaken"] }, "the weather and an activity call for one sunscreen");
  assert.deepEqual(recommended(result, "Dressy outfit").reasons, ["For Chez Vrony in Zermatt"]);
  assert.equal(recommended(result, "Ski goggles"), undefined);
  assert.equal(new Set(names(result)).size, result.items.length, "every item once");
  assert.ok(!result.assumptions.some((assumption) => assumption.includes("activities")));

  // Mass at a church saved for a stay with a Sunday, while Church shows.
  store.applyMutation({ type: "church.save", ...newItem(), destinationId: zermatt, name: "St. Mauritius", address: "", denomination: "Catholic", url: "", massTimes: [] });
  result = recommend(store, tripId);
  assert.deepEqual(recommended(result, "Outfit for Mass"), { name: "Outfit for Mass", category: "clothing", quantity: 2, reasons: ["For Mass in Zermatt"] });
  store.applyMutation({ type: "destination.churchVisibility", id: zermatt, enabled: false });
  assert.equal(recommended(recommend(store, tripId), "Outfit for Mass"), undefined, "hidden Church plans no Mass");
});

test("travel and entry requirements decide the documents and electronics recommended (TRA-18)", (t) => {
  const { store, tripId } = setup(t, tripInput({ travelers: 3 }));
  const lisbon = city(store, tripId, "Lisbon", { nights: 2 });
  const porto = city(store, tripId, "Porto", { nights: 2 });
  let result = recommend(store, tripId);
  assert.deepEqual([recommended(result, "Photo ID")?.quantity, recommended(result, "Passport"), recommended(result, "Power adapter")], [3, undefined, undefined]);
  assert.ok(result.assumptions.includes("No destination has entry requirements saved, so a photo ID stands in for a passport, and no power adapter is recommended."));
  assert.equal(recommended(result, "Headphones"), undefined);

  const legs = store.getTripSnapshot(tripId).data.legs;
  const leg = (from, to) => legs.find((item) => item.fromId === from && item.toId === to);
  store.applyMutation({ type: "leg.save", id: leg(null, lisbon).id, method: "Flight", price: "", departure: "", arrival: "", url: "", notes: "" });
  store.applyMutation({ type: "leg.save", id: leg(lisbon, porto).id, method: "Rental car", price: "", departure: "", arrival: "", url: "", notes: "" });
  store.applyMutation({ type: "destination.entryRequirements", id: lisbon, requirements: { passportNationality: "United States" } });
  store.applyMutation({ type: "destination.entryRequirements", id: porto, requirements: { passportNationality: "United States" } });
  result = recommend(store, tripId);
  assert.deepEqual(recommended(result, "Headphones"), { name: "Headphones", category: "electronics", quantity: 3, reasons: ["For flights"] });
  assert.deepEqual(recommended(result, "Driver's license"), { name: "Driver's license", category: "documents", quantity: 1, reasons: ["For travel by car"] });
  assert.deepEqual(recommended(result, "Passport"), { name: "Passport", category: "documents", quantity: 3, reasons: ["Entry requirements are saved for Lisbon and Porto"] });
  assert.deepEqual(recommended(result, "Power adapter"), { name: "Power adapter", category: "electronics", quantity: 1, reasons: ["Outlets may differ in Lisbon and Porto"] });
  assert.equal(recommended(result, "Photo ID"), undefined);
  assert.ok(!result.assumptions.some((assumption) => assumption.includes("entry requirements")));
});

test("recommendations are the same each time, in valid categories, and fit in one add, however much a trip calls for (TRA-18)", (t) => {
  const { store, tripId } = setup(t, tripInput({ travelers: 999, startDate: "2027-01-03" }));
  const hot = city(store, tripId, "Cairo", { nights: 40, weatherHighF: 99, weatherLowF: 10 });
  const cold = city(store, tripId, "Tromsø", { nights: 4 });
  store.applyMutation({ type: "destination.climate", id: cold, climate: everyMonth(20, -10, 5) });
  store.applyMutation({ type: "destination.entryRequirements", id: hot, requirements: { passportNationality: "United States" } });
  for (const name of ["Desert hike", "Pool day", "Skiing", "Opera night"]) store.applyMutation(idea(hot, "activities", name));
  store.applyMutation({ type: "church.save", ...newItem(), destinationId: hot, name: "Cathedral", address: "", denomination: "", url: "", massTimes: [] });
  const legs = store.getTripSnapshot(tripId).data.legs;
  store.applyMutation({ type: "leg.save", id: legs[0].id, method: "Flight and rental car", price: "", departure: "", arrival: "", url: "", notes: "" });
  const result = recommend(store, tripId);
  assert.deepEqual(recommend(store, tripId), result, "the same trip, the same recommendations");
  assert.ok(result.items.length <= MAX_PACKING_ADD, `${result.items.length} items fit in one add`);
  assert.equal(result.items.length, 44, "every item Travel recommends, but a photo ID, which a passport replaces");
  assert.ok(result.items.every((item) => PACKING_CATEGORIES.includes(item.category) && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 9999));
  assert.deepEqual(result.items.map((item) => item.category), [...result.items.map((item) => item.category)].sort((a, b) => PACKING_CATEGORIES.indexOf(a) - PACKING_CATEGORIES.indexOf(b)), "in the list's order of categories");
  assert.equal(recommended(result, "Underwear").quantity, 6993, "a week's for each of 999 travelers");
  // They can all be added at once.
  const review = packingReview(result, [], randomUUID);
  store.applyMutation({ type: "packingList.add", tripId, items: chosenItems(review, review.items.map((item) => item.id)) });
  assert.equal(listOf(store, tripId).length, result.items.length);
});

test("a review leaves out what is on the list, by name, and adds only the chosen items, under the IDs it gave them (TRA-18)", () => {
  const recommendations = {
    items: [
      { name: "Socks", category: "clothing", quantity: 14, reasons: ["For a week"] },
      { name: "Passport", category: "documents", quantity: 2, reasons: ["Entry requirements are saved for Lisbon"] },
      { name: "Sunscreen", category: "health-safety", quantity: 1, reasons: [] },
    ],
    assumptions: ["Quantities are for all 2 travelers together."],
  };
  let count = 0;
  const review = packingReview(recommendations, [{ name: "  SOCKS  " }, { name: "Hat" }], () => `id-${++count}`);
  assert.deepEqual(review.items.map((item) => [item.id, item.name]), [["id-1", "Passport"], ["id-2", "Sunscreen"]], "each new one gets its ID once");
  assert.deepEqual(review.onList.map((item) => item.name), ["Socks"], "names match whatever their capitals and spaces");
  assert.deepEqual(review.assumptions, recommendations.assumptions);
  assert.deepEqual(chosenItems(review, ["id-2", "id-9"]), [{ id: "id-2", name: "Sunscreen", category: "health-safety", quantity: 1 }]);
  assert.deepEqual(chosenItems(review, ["id-2", "id-1"]).map((item) => item.id), ["id-1", "id-2"], "in the review's order");
  assert.deepEqual(chosenItems(review, []), []);
});

test("recommending again after the itinerary changes adds only new items, and keeps every saved item and packed status (TRA-18)", (t) => {
  const { store, tripId } = setup(t, tripInput({ travelers: 2 }));
  const lisbon = city(store, tripId, "Lisbon", { nights: 3 });
  const list = () => store.getTripSnapshot(tripId).data.packingItems;
  let review = packingReview(recommend(store, tripId), list(), randomUUID);
  // Everything checked but the shampoo, as the review starts with all of them checked.
  const first = chosenItems(review, review.items.filter((item) => item.name !== "Shampoo and conditioner").map((item) => item.id));
  store.applyMutation({ type: "packingList.add", tripId, items: first });
  assert.equal(list().length, review.items.length - 1);
  const socks = list().find((item) => item.name === "Socks");
  store.applyMutation({ type: "packingItem.pack", id: socks.id, tripId, packed: true });
  const toothbrush = list().find((item) => item.name === "Toothbrush");
  store.applyMutation(itemInput(tripId, { id: toothbrush.id, name: "Electric toothbrush", category: "toiletries", quantity: 1 }));
  const saved = list();

  // The trip gets longer and gains a hike: recommending again offers only what isn't on the list.
  store.applyMutation({ type: "destination.save", id: lisbon, stopId: lisbon, nights: 9 });
  store.applyMutation(idea(lisbon, "activities", "Sintra hike"));
  review = packingReview(recommend(store, tripId), list(), randomUUID);
  assert.deepEqual(review.items.map((item) => item.name).sort(), ["Daypack", "Hiking boots", "Insect repellent", "Reusable water bottle", "Shampoo and conditioner", "Toothbrush"].sort(), "the renamed toothbrush and the shampoo left out are offered again");
  assert.ok(review.onList.some((item) => item.name === "Socks" && item.quantity === 14), "Socks would be 14 now, but stay as saved");
  store.applyMutation({ type: "packingList.add", tripId, items: chosenItems(review, review.items.map((item) => item.id)) });
  const after = list();
  for (const item of saved) assert.deepEqual(after.find((entry) => entry.id === item.id), item, `${item.name} is unchanged, packed or not`);
  assert.equal(after.length, saved.length + review.items.length);
});

test("progress counts packed items against the total, rounding down so 100% means everything is packed (TRA-18)", () => {
  const items = (packed, total) => Array.from({ length: total }, (_, index) => ({ packed: index < packed }));
  assert.deepEqual(packingProgress([]), { packed: 0, total: 0, percent: 0 });
  assert.deepEqual(packingProgress(items(1, 3)), { packed: 1, total: 3, percent: 33 });
  assert.deepEqual(packingProgress(items(2, 3)), { packed: 2, total: 3, percent: 66 });
  assert.deepEqual(packingProgress(items(199, 200)), { packed: 199, total: 200, percent: 99 });
  assert.deepEqual(packingProgress(items(4, 4)), { packed: 4, total: 4, percent: 100 });
});

test("ChatGPT and Claude read a trip's packing list and propose changes to it, which the owner approves as previewed (TRA-18)", (t) => {
  const { store, guest, guestTrip, propose, decide } = aiSetup(t);
  const socks = store.applyMutation(guest, itemInput(guestTrip)).id;
  assert.deepEqual(store.aiTrip(guestTrip).packing, [{ id: socks, tripId: guestTrip, category: "clothing", name: "Socks", quantity: 7, packed: false }]);
  const passport = randomUUID();
  const sunscreen = randomUUID();
  const proposal = propose([
    { type: "packingList.add", tripId: guestTrip, items: [{ id: passport, name: "Passport", category: "documents", quantity: 2 }] },
    { type: "packingItem.pack", id: socks, tripId: guestTrip, packed: true },
    { type: "packingItem.save", id: sunscreen, create: true, tripId: guestTrip, name: "Sunscreen", category: "health-safety", quantity: 1 },
    { type: "packingItem.save", id: socks, tripId: guestTrip, name: "Wool socks", category: "clothing", quantity: 6 },
    { type: "packingItem.delete", id: sunscreen, tripId: guestTrip },
  ], "Pack for the trip");
  const record = (name) => `Trip “Guest trip” (${GUEST}): packing item “${name}”`;
  assert.deepEqual(proposal.preview, [
    { operation: "Add 1 item to a packing list", records: [{ action: "Adds", record: record("Passport"), fields: [{ name: "Category", before: null, after: "documents" }, { name: "Name", before: null, after: "Passport" }, { name: "Quantity", before: null, after: "2" }, { name: "Packed", before: null, after: "No" }] }] },
    { operation: "Mark a packing item packed", records: [{ action: "Changes", record: record("Socks"), fields: [{ name: "Packed", before: "No", after: "Yes" }] }] },
    { operation: "Add the packing item “Sunscreen”", records: [{ action: "Adds", record: record("Sunscreen"), fields: [{ name: "Category", before: null, after: "health-safety" }, { name: "Name", before: null, after: "Sunscreen" }, { name: "Quantity", before: null, after: "1" }, { name: "Packed", before: null, after: "No" }] }] },
    { operation: "Change the packing item “Wool socks”", records: [{ action: "Changes", record: record("Wool socks"), fields: [{ name: "Name", before: "Socks", after: "Wool socks" }, { name: "Quantity", before: "7", after: "6" }] }] },
    { operation: "Delete a packing item", records: [{ action: "Deletes", record: record("Sunscreen"), fields: [{ name: "Category", before: "health-safety", after: null }, { name: "Name", before: "Sunscreen", after: null }, { name: "Quantity", before: "1", after: null }, { name: "Packed", before: "No", after: null }] }] },
  ]);
  assert.deepEqual(store.aiTrip(guestTrip).packing.map((item) => item.name), ["Socks"], "nothing changes until it is approved");
  assert.equal(decide(proposal, true).status, "applied");
  assert.deepEqual(store.aiTrip(guestTrip).packing.map((item) => [item.id, item.name, item.quantity, item.packed]), [[passport, "Passport", 2, false], [socks, "Wool socks", 6, true]]);

  const before = store.getSnapshot();
  for (const [change, message] of [
    [{ type: "packingList.add", tripId: guestTrip, items: [{ id: passport, name: "Passport", category: "documents", quantity: 2 }] }, "A new packing item's id is already a saved item's. Give each new item a new UUID."],
    [{ type: "packingItem.save", id: socks, create: true, tripId: guestTrip, name: "Socks", category: "clothing", quantity: 1 }, "This id is already a saved item's. Leave out create to change it, or give the new item a new UUID."],
    [{ type: "packingItem.save", tripId: guestTrip, name: "Socks", category: "clothing", quantity: 1 }, "Give the id of the item to change, or a new UUID with create: true to add a trip, idea, church, At home item or packing item."],
    [{ type: "packingItem.pack", id: socks, tripId: guestTrip, packed: false, name: "Socks" }, "packingItem.pack has no field name."],
    [{ type: "packingItem.save", id: socks, tripId: guestTrip, name: "Socks", category: "clothing", quantity: 1, packed: false }, "packingItem.save has no field packed."],
  ]) {
    assert.throws(() => propose([change]), { name: "ValidationError", message: `Change 1: ${message}` }, message);
  }
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");
});

test("the trip page's Help explains the packing list (TRA-18)", () => {
  assert.ok(pageHelp("/trips/t1").points.some((point) => point.startsWith("Packing list: Recommend items")));
});

// The packing list and its review as the trip page renders them: components rendered in place down to host elements and
// text, with stand-ins for icons and styles. No browser or server is involved.
function load(file, modules) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { if (!(name in modules)) throw new Error("Unexpected component import: " + name); return modules[name]; } });
  return exports;
}
const element = (type, props) => ({ type, props });
const components = load("../src/components/packing-list.tsx", {
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "lucide-react": new Proxy({}, { get: (_, name) => () => element("svg", { "data-icon": String(name) }) }),
  "@/lib/packing": packing,
  "./packing-list.module.css": { default: new Proxy({}, { get: (_, name) => String(name) }) },
});
/** An element as the browser has it. Its arrays are this file's, not the components' context's, so they compare as any other. */
function render(node) {
  if (Array.isArray(node)) return [...node].flatMap(render);
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node !== "object") return [String(node)];
  if (typeof node.type === "function") return render(node.type(node.props));
  if (node.type === "fragment") return render(node.props.children);
  return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
}
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");
const clean = (value) => value.replace(/\s+/g, " ").trim();

test("the packing list shows its progress, then each category's items with a checkbox that saves at once (TRA-18)", () => {
  const tripId = randomUUID();
  const items = [
    { id: randomUUID(), tripId, category: "documents", name: "Passport", quantity: 2, packed: true },
    { id: randomUUID(), tripId, category: "clothing", name: "Socks", quantity: 14, packed: false },
    { id: randomUUID(), tripId, category: "clothing", name: "Sun hat", quantity: 1, packed: false },
  ];
  const calls = [];
  const [section] = render(components.default({ items, busy: false, onRecommend: () => calls.push("recommend"), onAdd: () => calls.push("add"), onEdit: (item) => calls.push("edit " + item.name), onDelete: (item) => calls.push("delete " + item.name), onPack: (item, control) => calls.push(["pack", item.name, control]) }));
  const all = within(section);
  assert.equal(clean(text(all.find((node) => node.props.id === "packing-progress"))), "1 of 3 packed33%");
  assert.deepEqual(all.filter((node) => node.type === "progress").map((node) => [node.props.value, node.props.max, node.props["aria-labelledby"]]), [[1, 3, "packing-progress"]]);
  assert.deepEqual(all.filter((node) => node.type === "h3").map(text), ["Clothing", "Documents"], "categories in the list's order, without empty ones");
  const rows = all.filter((node) => node.type === "li");
  assert.deepEqual(rows.map((row) => clean(text(within(row).find((node) => node.type === "label")))), ["Socks, quantity × 14", "Sun hat", "Passport, quantity × 2"], "a quantity shows above 1, read as the quantity");
  const boxes = all.filter((node) => node.type === "input" && node.props.type === "checkbox");
  assert.deepEqual(boxes.map((box) => box.props.checked), [false, false, true], "each checkbox shows whether its item is saved as packed");
  const control = { name: "checkbox" };
  boxes[0].props.onChange({ currentTarget: control });
  for (const label of ["Edit Sun hat", "Delete Passport"]) all.find((node) => node.props["aria-label"] === label).props.onClick();
  assert.deepEqual(calls, [["pack", "Socks", control], "edit Sun hat", "delete Passport"]);
  // While a change saves, nothing else can be changed.
  const [busy] = render(components.default({ items, busy: true, onRecommend() {}, onAdd() {}, onEdit() {}, onDelete() {}, onPack() {} }));
  assert.ok(within(busy).filter((node) => node.type === "input" || node.type === "button").every((node) => node.props.disabled));
});

test("a trip without a packing list explains it and offers recommendations or an item of one's own (TRA-18)", () => {
  const calls = [];
  const [section] = render(components.default({ items: [], busy: false, onRecommend: () => calls.push("recommend"), onAdd: () => calls.push("add"), onEdit() {}, onDelete() {}, onPack() {} }));
  const all = within(section);
  assert.equal(all.filter((node) => node.type === "progress").length, 0);
  assert.ok(clean(text(section)).includes("Nothing to pack yet."));
  const buttons = all.filter((node) => node.type === "button");
  assert.deepEqual(buttons.map((button) => clean(text(button))), ["Recommend items", "Add item", "Recommend items", "Add your own item"]);
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(calls, ["recommend", "add", "recommend", "add"]);
});

test("a review shows what was assumed and every new recommendation checked to start, valued by the ID it is added under (TRA-18)", () => {
  const review = {
    items: [
      { id: "id-1", name: "Socks", category: "clothing", quantity: 14, reasons: ["For a week"] },
      { id: "id-2", name: "Hiking boots", category: "activity-gear", quantity: 2, reasons: ["For Sintra hike in Lisbon"] },
      { id: "id-3", name: "Sunscreen", category: "health-safety", quantity: 1, reasons: ["Highs around 85 °F in Lisbon", "For Beach day in Lisbon"] },
    ],
    onList: [{ name: "Passport", category: "documents", quantity: 2, reasons: [] }],
    assumptions: ["Quantities are for all 2 travelers together."],
  };
  const all = render(components.PackingReviewFields({ review, disabled: false })).flatMap(within);
  assert.deepEqual(all.filter((node) => node.type === "li").map(text), review.assumptions);
  assert.deepEqual(all.filter((node) => node.type === "legend").map(text), ["Clothing", "Health and safety", "Activity-specific gear"]);
  const boxes = all.filter((node) => node.type === "input");
  assert.deepEqual(boxes.map((box) => [box.props.name, box.props.value, box.props.defaultChecked]), [["recommended", "id-1", true], ["recommended", "id-3", true], ["recommended", "id-2", true]], "every recommendation starts checked");
  assert.ok(all.some((node) => node.type === "small" && text(node) === "Highs around 85 °F in Lisbon; For Beach day in Lisbon"));
  assert.ok(all.some((node) => node.type === "p" && text(node) === "Already on the list, and left as they are: Passport."));

  const saved = render(components.PackingReviewFields({ review: { items: [], onList: review.items, assumptions: [] }, disabled: false })).flatMap(within);
  assert.equal(saved.filter((node) => node.type === "input").length, 0);
  assert.ok(saved.some((node) => text(node) === "Everything recommended is already on the list."));
});

test("a packing item's editor asks for its name, a category and its quantity for the whole party (TRA-18)", () => {
  const fresh = render(components.PackingItemFields({ disabled: false })).flatMap(within);
  const field = (nodes, name) => nodes.find((node) => node.props.name === name);
  assert.deepEqual([field(fresh, "name").props.required, field(fresh, "name").props.maxLength], [true, 160]);
  assert.deepEqual([field(fresh, "category").props.defaultValue, field(fresh, "category").props.required], ["", true], "a new item chooses its category");
  assert.deepEqual(fresh.filter((node) => node.type === "option").map((node) => node.props.value), ["", ...PACKING_CATEGORIES]);
  assert.deepEqual([field(fresh, "quantity").props.defaultValue, field(fresh, "quantity").props.min, field(fresh, "quantity").props.max], [1, "1", "9999"]);
  const saved = render(components.PackingItemFields({ item: { id: randomUUID(), tripId: randomUUID(), category: "documents", name: "Passport", quantity: 2, packed: true }, disabled: false })).flatMap(within);
  assert.deepEqual([field(saved, "name").props.defaultValue, field(saved, "category").props.defaultValue, field(saved, "quantity").props.defaultValue], ["Passport", "documents", 2]);
});
