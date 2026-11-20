import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget } from "../src/lib/budget.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { aiSetup } from "./ai-fixtures.mjs";
import { addCity, addDestination, candidateInput, fileDatabase, newItem, prepared, setup, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

// TRA-150: coordinates for each hotel, activity, restaurant and church, exact or approximate, which place it on its
// destination's map without a lookup.

const SACHER = { latitude: 48.20406, longitude: 16.36949, accuracy: "exact" };
/** A rental whose address is withheld, roughly where it is in Leopoldstadt. */
const RENTAL = { latitude: 48.2167, longitude: 16.3958, accuracy: "approximate" };
/** Melk Abbey, about 80 km from Vienna, beyond the 50 km its lookups search. */
const MELK = { latitude: 48.22842, longitude: 15.33437, accuracy: "exact" };
const saved = (coordinates, review = false) => ({ ...coordinates, review });
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
const churchInput = (destinationId, overrides = {}) => ({ type: "church.save", destinationId, name: "St. Stephen's Cathedral", address: "Stephansplatz 3", denomination: "", url: "", massTimes: [], ...overrides, ...newItem(overrides) });
const ideaOf = (store, id) => store.getSnapshot().candidates.find((item) => item.id === id);
const churchOf = (store, id) => store.getSnapshot().churches.find((item) => item.id === id);
const placed = (store, id) => (ideaOf(store, id) ?? churchOf(store, id)).coordinates;
/** A snapshot with every idea's and church's coordinates left out, to compare everything else. */
const withoutCoordinates = (snapshot) => ({ ...snapshot, candidates: snapshot.candidates.map((item) => ({ ...item, coordinates: null })), churches: snapshot.churches.map((item) => ({ ...item, coordinates: null })) });

test("a hotel's, activity's, restaurant's or church's coordinates save with it, exact or approximate, and removing them removes all of them", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
    const hotel = store.applyMutation(candidateInput(id, "hotels", { name: "Hotel Sacher", address: "Philharmonikerstraße 4", coordinates: SACHER })).id;
    const rental = store.applyMutation(candidateInput(id, "hotels", { name: "Leopoldstadt apartment", address: "Address withheld", included: false, coordinates: RENTAL })).id;
    const abbey = store.applyMutation(candidateInput(id, "activities", { name: "Melk Abbey", coordinates: MELK })).id;
    const plain = store.applyMutation(candidateInput(id, "restaurants", { name: "Figlmüller" })).id;
    const church = store.applyMutation(churchInput(id, { coordinates: { latitude: 48.20857, longitude: 16.37307, accuracy: "exact" } })).id;
    const places = [hotel, rental, abbey, plain, church];
    const expected = [saved(SACHER), saved(RENTAL), saved(MELK), null, saved({ latitude: 48.20857, longitude: 16.37307, accuracy: "exact" })];
    assert.deepEqual(places.map((place) => placed(store, place)), expected, "a place without coordinates has none");
    // The trip's page and the destination's page have them.
    const shown = (data) => places.map((place) => [...data.candidates, ...data.churches].find((item) => item.id === place).coordinates);
    assert.deepEqual(shown(store.getTripSnapshot(tripId).data), expected);
    assert.deepEqual(shown(store.getDestinationSnapshot(id).data), expected);
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(places.map((place) => placed(store, place)), expected, "reopening keeps them");
    // Every latitude and longitude in range, its ends included, and the point where the equator meets Greenwich's meridian.
    for (const coordinates of [{ latitude: -90, longitude: -180, accuracy: "exact" }, { latitude: 90, longitude: 180, accuracy: "approximate" }, { latitude: 0, longitude: 0, accuracy: "exact" }, { latitude: -33.85678, longitude: 151.21529, accuracy: "exact" }]) {
      store.applyMutation(candidateInput(id, "restaurants", { id: plain, name: "Figlmüller", coordinates }));
      assert.deepEqual(placed(store, plain), saved(coordinates));
    }
    store.applyMutation(candidateInput(id, "restaurants", { id: plain, name: "Figlmüller", coordinates: { latitude: -0, longitude: -0, accuracy: "exact" } }));
    assert.ok(Object.is(placed(store, plain).latitude, 0) && Object.is(placed(store, plain).longitude, 0), "-0 is saved as 0");
    store.applyMutation(candidateInput(id, "hotels", { id: hotel, name: "Hotel Sacher", address: "Philharmonikerstraße 4", coordinates: null }));
    store.applyMutation(churchInput(id, { id: church, coordinates: null }));
    assert.deepEqual([placed(store, hotel), placed(store, church)], [null, null]);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual({ ...db.prepare("SELECT latitude, longitude, coordinatesAccuracy, coordinatesReview FROM candidates WHERE id = ?").get(hotel) },
        { latitude: null, longitude: null, coordinatesAccuracy: null, coordinatesReview: 0 }, "removing them leaves none of their columns");
    } finally { db.close(); }
  } finally { store?.close(); }
});

test("coordinates need a latitude and a longitude in range and an accuracy, and a refused save changes nothing", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const hotel = store.applyMutation(candidateInput(id, "hotels", { name: "Hotel Sacher", coordinates: SACHER })).id;
  const church = store.applyMutation(churchInput(id, { coordinates: SACHER })).id;
  const before = store.getSnapshot();
  const BOTH = "Enter both a latitude and a longitude, or remove the coordinates.";
  const LATITUDE = "Latitude must be a number from -90 to 90.";
  const LONGITUDE = "Longitude must be a number from -180 to 180.";
  const ACCURACY = "Choose whether the coordinates are exact or approximate.";
  const SHAPE = "Enter coordinates as a latitude, a longitude and their accuracy, or remove them.";
  for (const [coordinates, message] of [
    [{ latitude: 48.2, accuracy: "exact" }, BOTH], [{ longitude: 16.4, accuracy: "exact" }, BOTH], [{ latitude: null, longitude: null, accuracy: "exact" }, BOTH], [{ accuracy: "approximate" }, BOTH],
    [{ latitude: 90.000001, longitude: 0, accuracy: "exact" }, LATITUDE], [{ latitude: -91, longitude: 0, accuracy: "exact" }, LATITUDE], [{ latitude: "48.2", longitude: 16.4, accuracy: "exact" }, LATITUDE],
    [{ latitude: Number.NaN, longitude: 16.4, accuracy: "exact" }, LATITUDE], [{ latitude: Infinity, longitude: 16.4, accuracy: "exact" }, LATITUDE],
    [{ latitude: 48.2, longitude: 180.5, accuracy: "exact" }, LONGITUDE], [{ latitude: 48.2, longitude: -181, accuracy: "exact" }, LONGITUDE], [{ latitude: 48.2, longitude: "16.4", accuracy: "exact" }, LONGITUDE],
    [{ latitude: 48.2, longitude: 16.4 }, ACCURACY], [{ latitude: 48.2, longitude: 16.4, accuracy: "rough" }, ACCURACY], [{ latitude: 48.2, longitude: 16.4, accuracy: "Exact" }, ACCURACY],
    ["48.2, 16.4", SHAPE], [[48.2, 16.4], SHAPE], [false, SHAPE],
  ]) {
    // Neither a new place nor a change to a saved one is saved.
    for (const input of [candidateInput(id, "activities", { coordinates }), candidateInput(id, "hotels", { id: hotel, name: "Hotel Sacher", coordinates }), churchInput(id, { coordinates }), churchInput(id, { id: church, coordinates })]) {
      assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input.coordinates));
      assert.deepEqual(store.getSnapshot(), before);
    }
  }
});

test("changing a place's coordinates changes nothing else of it, and every other change keeps them", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const links = [{ id: randomUUID(), url: "https://example.com/menu", description: "Menu" }];
  const photo = { id: randomUUID(), ...prepared(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])) };
  // Everything the restaurant's editor sends, as saved, but its coordinates.
  const editor = { name: "Café Central", description: "Grand coffeehouse", price: "80", included: true, mustDo: true, address: "Herrengasse 14", notes: "Book ahead", url: links[0].url, links, restaurantTypes: ["lunch", "drinks"] };
  const cafe = store.applyMutation(candidateInput(id, "restaurants", { ...editor, gallery: { add: [photo], remove: [] } })).id;
  store.applyMutation(candidateInput(id, "restaurants", { name: "Another", price: "20", included: true }));
  const church = store.applyMutation(churchInput(id, { denomination: "Roman Catholic", massTimes: [{ id: randomUUID(), day: "Sunday", time: "10:15 AM" }] })).id;
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId);
  for (const coordinates of [{ latitude: 48.21036, longitude: 16.36564, accuracy: "exact" }, RENTAL, null]) {
    store.applyMutation(candidateInput(id, "restaurants", { id: cafe, ...editor, coordinates }));
    store.applyMutation(churchInput(id, { id: church, denomination: "Roman Catholic", massTimes: churchOf(store, church).massTimes, coordinates }));
    assert.deepEqual([placed(store, cafe), placed(store, church)], [coordinates && saved(coordinates), coordinates && saved(coordinates)]);
    assert.deepEqual(withoutCoordinates(store.getSnapshot()), withoutCoordinates(before), "addresses, descriptions, photos, prices, selections, notes, links, types and order are unchanged");
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
  }
  store.applyMutation(candidateInput(id, "restaurants", { id: cafe, ...editor, coordinates: RENTAL }));
  store.applyMutation(churchInput(id, { id: church, denomination: "Roman Catholic", massTimes: churchOf(store, church).massTimes, coordinates: SACHER }));
  // A page opened before coordinates saves without them, which keeps them. So does every other change.
  for (const edit of [
    candidateInput(id, "restaurants", { id: cafe, ...editor, notes: "Book a week ahead" }),
    { type: "candidate.move", id: cafe, direction: "down" },
    { type: "candidate.mustDo", id: cafe, mustDo: false },
    { type: "candidate.include", id: cafe, included: false },
    churchInput(id, { id: church, denomination: "Catholic", massTimes: [] }),
    { type: "destination.save", id, notes: "New notes", city: "Vienna, Austria" },
  ]) {
    store.applyMutation(edit);
    assert.deepEqual([placed(store, cafe), placed(store, church)], [saved(RENTAL), saved(SACHER)], JSON.stringify(edit));
  }
  // Deleting a place deletes its coordinates with it, and no other place's.
  store.applyMutation({ type: "candidate.delete", id: cafe });
  assert.deepEqual(placed(store, church), saved(SACHER));
});

test("a new address leaves saved coordinates waiting for review, until a save gives them again or removes them", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const restaurant = (overrides) => candidateInput(id, "restaurants", { id: figlmueller, name: "Figlmüller", ...overrides });
  const figlmueller = store.applyMutation(candidateInput(id, "restaurants", { name: "Figlmüller", address: "Wollzeile 5", coordinates: { latitude: 48.20918, longitude: 16.37466, accuracy: "exact" } })).id;
  const at = saved({ latitude: 48.20918, longitude: 16.37466, accuracy: "exact" });
  // The same address, as typed again with spaces around it, keeps them as they are.
  store.applyMutation(restaurant({ address: "  Wollzeile 5 ", notes: "Schnitzel" }));
  assert.deepEqual(placed(store, figlmueller), at);
  store.applyMutation(restaurant({ address: "Bäckerstraße 6" }));
  assert.deepEqual(placed(store, figlmueller), { ...at, review: true }, "kept, but not as right for the new address");
  // Saving again without them, or changing anything else, leaves them waiting.
  store.applyMutation(restaurant({ address: "Bäckerstraße 6", notes: "Moved" }));
  store.applyMutation({ type: "candidate.include", id: figlmueller, included: false });
  assert.deepEqual(placed(store, figlmueller), { ...at, review: true });
  // Giving them again, as the editor does once they are confirmed for the address, is the review.
  store.applyMutation(restaurant({ address: "Bäckerstraße 6", coordinates: { latitude: 48.20918, longitude: 16.37466, accuracy: "exact" } }));
  assert.deepEqual(placed(store, figlmueller), at);
  // New coordinates with the new address are for it.
  store.applyMutation(restaurant({ address: "Wollzeile 5", coordinates: { latitude: 48.20911, longitude: 16.3747, accuracy: "exact" } }));
  assert.deepEqual(placed(store, figlmueller), saved({ latitude: 48.20911, longitude: 16.3747, accuracy: "exact" }));
  store.applyMutation(restaurant({ address: "" }));
  assert.equal(placed(store, figlmueller).review, true, "clearing the address is a new address too");
  store.applyMutation(restaurant({ address: "Wollzeile 5", coordinates: null }));
  assert.equal(placed(store, figlmueller), null, "removing them leaves nothing to review");
  store.applyMutation(restaurant({ address: "Bäckerstraße 6" }));
  assert.equal(placed(store, figlmueller), null, "a place without coordinates has nothing to review");

  // A church's are the same.
  const church = store.applyMutation(churchInput(id, { coordinates: SACHER })).id;
  store.applyMutation(churchInput(id, { id: church, address: "Stephansplatz 1" }));
  assert.deepEqual(placed(store, church), saved(SACHER, true));
  store.applyMutation(churchInput(id, { id: church, address: "Stephansplatz 1", coordinates: SACHER }));
  assert.deepEqual(placed(store, church), saved(SACHER));
});

test("the database keeps every place's coordinates whole and in range", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  const tripId = store.applyMutation(tripInput()).id;
  const id = addDestination(store, tripId, { city: "Vienna" });
  const ideaId = store.applyMutation(candidateInput(id, "hotels", { name: "Hotel Sacher" })).id;
  const churchId = store.applyMutation(churchInput(id)).id;
  store.close();
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  for (const [table, rowId] of [["candidates", ideaId], ["churches", churchId]]) {
    for (const set of ["latitude = 48.2", "latitude = 48.2, longitude = 16.4", "longitude = 16.4, coordinatesAccuracy = 'exact'", "coordinatesAccuracy = 'exact'", "coordinatesReview = 1",
      "latitude = 48.2, longitude = 16.4, coordinatesAccuracy = 'rough'", "latitude = 90.5, longitude = 16.4, coordinatesAccuracy = 'exact'", "latitude = 48.2, longitude = -180.5, coordinatesAccuracy = 'exact'",
      "latitude = 48.2, longitude = 16.4, coordinatesAccuracy = 'exact', coordinatesReview = 2"]) {
      assert.throws(() => db.prepare(`UPDATE ${table} SET ${set} WHERE id = ?`).run(rowId), /CHECK constraint failed/, `${table}: ${set}`);
    }
    db.prepare(`UPDATE ${table} SET latitude = 48.2, longitude = 16.4, coordinatesAccuracy = 'approximate', coordinatesReview = 1 WHERE id = ?`).run(rowId);
    db.prepare(`UPDATE ${table} SET latitude = NULL, longitude = NULL, coordinatesAccuracy = NULL, coordinatesReview = 0 WHERE id = ?`).run(rowId);
  }
});

test("coordinates belong to the place in every trip that visits its destination, and someone a trip is shared with sees and changes them", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  const otherTrip = store.applyMutation(owner, tripInput({ name: "Second visit" })).id;
  const id = addCity((input) => store.applyMutation(owner, input).id, tripId, "Vienna", { nights: 3 });
  store.applyMutation(owner, { type: "stop.add", tripId: otherTrip, city: "Vienna" });
  const rental = store.applyMutation(owner, candidateInput(id, "hotels", { name: "Leopoldstadt apartment", coordinates: RENTAL })).id;
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const friend = store.authorizeAccount("friend@example.test").id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  const shown = (account, trips) => [...trips.map((trip) => store.getTripSnapshot(account, trip).data), store.getDestinationSnapshot(account, id).data].map((data) => data.candidates.find((item) => item.id === rental).coordinates);
  assert.deepEqual(shown(owner, [tripId, otherTrip]), Array(3).fill(saved(RENTAL)));
  assert.deepEqual(shown(friend, [tripId]), Array(2).fill(saved(RENTAL)));
  store.applyMutation(friend, candidateInput(id, "hotels", { id: rental, name: "Leopoldstadt apartment", coordinates: SACHER }));
  assert.deepEqual(shown(owner, [tripId, otherTrip]), Array(3).fill(saved(SACHER)), "changing them from one trip changes them everywhere");
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(outsider, candidateInput(id, "hotels", { id: rental, name: "Leopoldstadt apartment", coordinates: RENTAL })), refusal("This item no longer exists or isn't shared with you. Please refresh and try again."));
  assert.deepEqual(store.getSnapshot(), before, "an account the trip isn't shared with changes nothing");
});

test("schema 37 databases upgrade without coordinates, and a replay keeps those saved since", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
    const ideas = Object.fromEntries(["hotels", "activities", "restaurants"].map((category) => [category, store.applyMutation(candidateInput(id, category, {
      name: "Saved " + category, description: "What it is", address: "Address of " + category, notes: "Notes about " + category, ...(category === "restaurants" && { restaurantTypes: ["dinner"] }),
    })).id]));
    const church = store.applyMutation(churchInput(id, { massTimes: [{ id: randomUUID(), day: "Sunday", time: "9:00 AM" }] })).id;
    const before = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    // Each column is dropped after the columns whose checks name it.
    db.exec(["candidates", "churches"].map((table) => ["coordinatesReview", "coordinatesAccuracy", "longitude", "latitude"].map((column) => `ALTER TABLE ${table} DROP COLUMN ${column};`).join(" ")).join(" ") + " PRAGMA user_version = 37;");
    db.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), before, "every place keeps everything saved for it, without coordinates");
    store.applyMutation(candidateInput(id, "activities", { id: ideas.activities, name: "Saved activities", description: "What it is", address: "Address of activities", notes: "Notes about activities", coordinates: MELK }));
    store.applyMutation(churchInput(id, { id: church, massTimes: churchOf(store, church).massTimes, coordinates: RENTAL }));
    store.applyMutation(candidateInput(id, "hotels", { id: ideas.hotels, name: "Saved hotels", description: "What it is", address: "Address of hotels", notes: "Notes about hotels", coordinates: SACHER }));
    store.applyMutation(candidateInput(id, "hotels", { id: ideas.hotels, name: "Saved hotels", description: "What it is", address: "New address", notes: "Notes about hotels" }));
    const later = store.getSnapshot();
    assert.deepEqual([placed(store, ideas.activities), placed(store, church), placed(store, ideas.hotels)], [saved(MELK), saved(RENTAL), saved(SACHER, true)]);
    // A replay of schema 38, also after the schema 1 build resets the schema version, keeps them.
    for (const version of [37, 1]) {
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
      for (const table of ["candidates", "churches"]) {
        const columns = observer.prepare(`PRAGMA table_info(${table})`).all().filter((info) => ["latitude", "longitude", "coordinatesAccuracy", "coordinatesReview"].includes(info.name));
        assert.deepEqual(columns.map(({ name, type, notnull, dflt_value }) => ({ name, type, notnull, dflt_value })), [
          { name: "latitude", type: "REAL", notnull: 0, dflt_value: null }, { name: "longitude", type: "REAL", notnull: 0, dflt_value: null },
          { name: "coordinatesAccuracy", type: "TEXT", notnull: 0, dflt_value: null }, { name: "coordinatesReview", type: "INTEGER", notnull: 1, dflt_value: "0" },
        ], table);
      }
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});

/** The owner's trip visiting Vienna with a hotel, a rental, Melk Abbey and a church, none with coordinates. */
function aiVienna(t) {
  const ai = aiSetup(t);
  const { store, owner, ownerTrip } = ai;
  const destinationId = store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Vienna" }).id;
  const add = (input) => store.applyMutation(owner, input).id;
  const ids = {
    hotel: add(candidateInput(destinationId, "hotels", { name: "Hotel Sacher", address: "Philharmonikerstraße 4", price: "900", included: true })),
    rental: add(candidateInput(destinationId, "hotels", { name: "Leopoldstadt apartment", address: "Address withheld", included: false })),
    abbey: add(candidateInput(destinationId, "activities", { name: "Melk Abbey", notes: "Day trip" })),
    church: add(churchInput(destinationId)),
  };
  return { ...ai, destinationId, ids };
}
/** Each change's title, and each record's fields as "name: before → after". */
const previewed = (proposal) => proposal.preview.map((change) => [change.operation, ...change.records.map((record) => record.record + " | " + record.fields.map((field) => `${field.name}: ${field.before ?? "None"} → ${field.after ?? "None"}`).join("; "))]);

test("ChatGPT and Claude read coordinates and propose them for many places at once, previewed with their accuracy, and only approval saves them", (t) => {
  const { store, propose, decide, destinationId, ids } = aiVienna(t);
  /** Each place's coordinates by its name, as assistants read them. */
  const coordinatesNow = () => { const destination = store.aiDestination(destinationId); return Object.fromEntries([...destination.ideas, ...destination.churches].map((item) => [item.name, item.coordinates])); };
  assert.deepEqual(coordinatesNow(), { "Hotel Sacher": null, "Leopoldstadt apartment": null, "Melk Abbey": null, "St. Stephen's Cathedral": null }, "assistants read each place's coordinates");
  const before = store.getSnapshot();
  const proposal = propose([
    { type: "candidate.coordinates", id: ids.hotel, coordinates: SACHER },
    { type: "candidate.coordinates", id: ids.rental, coordinates: RENTAL },
    { type: "candidate.coordinates", id: ids.abbey, coordinates: MELK },
    { type: "church.coordinates", id: ids.church, coordinates: { latitude: 48.20857, longitude: 16.37307, accuracy: "exact" } },
  ], "Place Vienna's ideas on its map");
  const destination = "Destination “Vienna” (owner@example.test)";
  assert.deepEqual(previewed(proposal), [
    ["Set an idea's exact coordinates", `${destination}: hotel “Hotel Sacher” | Latitude: None → 48.20406; Longitude: None → 16.36949; Coordinates accuracy: None → Exact`],
    ["Set an idea's approximate coordinates", `${destination}: hotel “Leopoldstadt apartment” | Latitude: None → 48.2167; Longitude: None → 16.3958; Coordinates accuracy: None → Approximate`],
    ["Set an idea's exact coordinates", `${destination}: activity “Melk Abbey” | Latitude: None → 48.22842; Longitude: None → 15.33437; Coordinates accuracy: None → Exact`],
    ["Set a church's exact coordinates", `${destination}: church “St. Stephen's Cathedral” | Latitude: None → 48.20857; Longitude: None → 16.37307; Coordinates accuracy: None → Exact`],
  ], "each change shows the coordinates it sets and their accuracy, and nothing else");
  assert.deepEqual(store.getSnapshot(), before, "proposing changes nothing");
  assert.equal(decide(proposal, true).status, "applied");
  assert.deepEqual(coordinatesNow(), { "Hotel Sacher": saved(SACHER), "Leopoldstadt apartment": saved(RENTAL), "Melk Abbey": saved(MELK), "St. Stephen's Cathedral": saved({ latitude: 48.20857, longitude: 16.37307, accuracy: "exact" }) });
  assert.deepEqual(withoutCoordinates(store.getSnapshot()), withoutCoordinates(before), "approving changes nothing else");

  // A rejected proposal changes nothing; an approved removal removes them.
  const removal = propose([{ type: "candidate.coordinates", id: ids.rental, coordinates: null }]);
  assert.deepEqual(previewed(removal), [["Remove an idea's coordinates", `${destination}: hotel “Leopoldstadt apartment” | Latitude: 48.2167 → None; Longitude: 16.3958 → None; Coordinates accuracy: Approximate → None`]]);
  const placedNow = store.getSnapshot();
  assert.equal(decide(removal, false).status, "rejected");
  assert.deepEqual(store.getSnapshot(), placedNow);
  assert.equal(decide(propose([{ type: "candidate.coordinates", id: ids.rental, coordinates: null }]), true).status, "applied");
  assert.equal(placed(store, ids.rental), null);
});

test("assistants change coordinates only with candidate.coordinates and church.coordinates, and an address they change leaves saved ones for review", (t) => {
  const { store, owner, propose, decide, destinationId, ids } = aiVienna(t);
  const save = (overrides) => ({ type: "candidate.save", id: ids.abbey, destinationId, category: "activities", name: "Melk Abbey", price: "12.25", address: "", url: "", notes: "Day trip", included: true, ...overrides });
  const before = store.getSnapshot();
  for (const [change, message] of [
    [save({ coordinates: MELK }), "Change 1: Change coordinates with candidate.coordinates or church.coordinates."],
    [{ ...churchInput(destinationId, { id: ids.church }), coordinates: MELK }, "Change 1: Change coordinates with candidate.coordinates or church.coordinates."],
    [{ type: "candidate.coordinates", id: ids.abbey }, "Change 1: Give the coordinates, or null to remove them."],
    [{ type: "church.coordinates", id: ids.church, coordinates: { latitude: 95, longitude: 15, accuracy: "exact" } }, "Change 1: Latitude must be a number from -90 to 90."],
    [{ type: "candidate.coordinates", id: ids.abbey, coordinates: { latitude: 48.2, longitude: 15.3 } }, "Change 1: Choose whether the coordinates are exact or approximate."],
    [{ type: "candidate.coordinates", id: ids.church, coordinates: MELK }, "Change 1: This item doesn't exist. Read Travel again for current IDs."],
    [{ type: "church.coordinates", id: randomUUID(), coordinates: MELK }, "Change 1: This item doesn't exist. Read Travel again for current IDs."],
  ]) {
    assert.throws(() => propose([change]), refusal(message), JSON.stringify(change));
  }
  // People change coordinates with each place's save, never with these.
  for (const change of [{ type: "candidate.coordinates", id: ids.abbey, coordinates: MELK }, { type: "church.coordinates", id: ids.church, coordinates: MELK }]) {
    assert.throws(() => store.applyMutation(owner, change), refusal("This action is not supported. Please refresh and try again."));
  }
  assert.deepEqual(store.getSnapshot(), before, "nothing refused changed anything");

  assert.equal(decide(propose([{ type: "candidate.coordinates", id: ids.abbey, coordinates: MELK }]), true).status, "applied");
  // A new address leaves them waiting for review, which the owner sees before approving.
  const moved = propose([save({ address: "Abt-Berthold-Dietmayr-Straße 1, Melk" })]);
  assert.deepEqual(previewed(moved), [["Change the activity “Melk Abbey”", "Destination “Vienna” (owner@example.test): activity “Melk Abbey” | Address: None → Abt-Berthold-Dietmayr-Straße 1, Melk; Coordinates to review: None → Yes"]]);
  assert.equal(decide(moved, true).status, "applied");
  assert.deepEqual(placed(store, ids.abbey), saved(MELK, true));
  // Giving them again confirms them for the new address.
  const confirmed = propose([{ type: "candidate.coordinates", id: ids.abbey, coordinates: MELK }]);
  assert.deepEqual(previewed(confirmed), [["Set an idea's exact coordinates", "Destination “Vienna” (owner@example.test): activity “Melk Abbey” | Coordinates to review: Yes → None"]]);
  assert.equal(decide(confirmed, true).status, "applied");
  assert.deepEqual(placed(store, ids.abbey), saved(MELK));
  // An idea added with coordinates in the same proposal shows no review, and its coordinates as it adds them.
  const added = randomUUID();
  const addition = propose([save({ id: added, create: true, name: "Dürnstein", address: "" }), { type: "candidate.coordinates", id: added, coordinates: { latitude: 48.39538, longitude: 15.52014, accuracy: "approximate" } }]);
  assert.ok(!previewed(addition)[0].join().includes("Coordinates"), "a new idea's preview has no coordinates fields until they are set");
  assert.equal(decide(addition, true).status, "applied");
  assert.deepEqual(placed(store, added), saved({ latitude: 48.39538, longitude: 15.52014, accuracy: "approximate" }));
});

test("assistants are told how to give coordinates, and that only candidate.coordinates and church.coordinates change them", () => {
  const changes = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf;
  for (const type of ["candidate.coordinates", "church.coordinates"]) {
    const schema = changes.find((change) => change.title === type);
    assert.deepEqual(schema.required, ["type", "id", "coordinates"]);
    const { coordinates } = schema.properties;
    assert.deepEqual(coordinates.type, ["object", "null"], "null removes them");
    assert.deepEqual(coordinates.required, ["latitude", "longitude", "accuracy"]);
    assert.deepEqual([coordinates.properties.latitude.minimum, coordinates.properties.latitude.maximum, coordinates.properties.longitude.minimum, coordinates.properties.longitude.maximum], [-90, 90, -180, 180]);
    assert.deepEqual(coordinates.properties.accuracy.enum, ["exact", "approximate"]);
  }
  for (const type of ["candidate.save", "church.save"]) assert.ok(!("coordinates" in changes.find((change) => change.title === type).properties), type);
});
