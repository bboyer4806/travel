import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { destinationKey, formatDestinationLabel, formatSavedDestinationLabel } from "../src/lib/destination-label.ts";
import { isValidationError, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { addCity, destination, destinationEdit, fileDatabase, setup, stopEdit, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

test("US destinations show city and full state; international destinations show city and country", () => {
  assert.equal(formatDestinationLabel({ name: "Wooster", region: "Ohio", country: "United States", countryCode: "US" }), "Wooster, Ohio");
  assert.equal(formatDestinationLabel({ name: "Wooster", region: "OH", country: "United States" }), "Wooster, Ohio");
  assert.equal(formatDestinationLabel({ name: "Seattle", region: "wa", country: "US" }), "Seattle, Washington");
  assert.equal(formatDestinationLabel({ name: "Vienna", region: "Vienna", country: "Austria", countryCode: "AT" }), "Vienna, Austria");
  assert.equal(formatDestinationLabel({ name: "Paris", region: "Ile-de-France", country: "France" }), "Paris, France");
  assert.equal(formatDestinationLabel({ name: "Paris", region: "Ile-de-France", country: "FR" }), "Paris, France");
});

test("destination formatting trims, deduplicates, and handles missing US state information", () => {
  assert.equal(formatDestinationLabel({ name: "  New   York  ", region: "NY", country: "United States" }), "New York, New York");
  assert.equal(formatDestinationLabel({ name: " Singapore ", region: "Central Singapore", country: "singapore" }), "Singapore");
  assert.equal(formatDestinationLabel({ name: "Wooster", region: "", country: "United States", countryCode: "US" }), "Wooster, United States");
  assert.equal(formatDestinationLabel({ name: "Wooster", region: "  ", country: "US" }), "Wooster, United States");
  assert.equal(formatDestinationLabel({ name: "Wooster", region: "", country: "", countryCode: "US" }), "Wooster, United States");
});

test("destination labels stay within 120 characters without clipping place names", () => {
  const name = "A".repeat(115);
  assert.equal(formatDestinationLabel({ name, region: "Ohio", country: "United States" }), name);
  assert.equal(formatDestinationLabel({ name, region: "Somewhere", country: "Austria" }), name);
  assert.equal(formatDestinationLabel({ name: "A".repeat(120), region: "", country: "US" }).length, 120);
  assert.equal(formatDestinationLabel({ name: "A".repeat(121), region: "", country: "US" }), "");
});

const STRUCTURED = [
  ["Wooster, Ohio, United States", "Wooster, Ohio"],
  ["New York, New York, United States", "New York, New York"],
  ["Los Angeles, CA, US", "Los Angeles, California"],
  ["Seattle, Washington, United States of America", "Seattle, Washington"],
  ["Vienna, Vienna, Austria", "Vienna, Austria"],
  ["Paris, Ile-de-France, FR", "Paris, France"],
  ["Kyoto, Kyoto, Japan", "Kyoto, Japan"],
  ["London, England, United Kingdom", "London, United Kingdom"],
  ["  Paris , Ile-de-France , France  ", "Paris, France"],
];

test("a city recorded as a chosen suggestion's label shows shorter without rewriting storage", () => {
  for (const [city, shown] of STRUCTURED) assert.equal(formatSavedDestinationLabel({ city, cityFromSuggestion: true }), shown, city);
});

test("any other city shows exactly as entered, even when it looks like a suggestion's label (TRA-76)", () => {
  for (const city of ["Tokyo, Kyoto, Japan", "Chicago, Cook County, IL", ...STRUCTURED.map(([city]) => city)]) {
    assert.equal(formatSavedDestinationLabel({ city, cityFromSuggestion: false }), city);
  }
});

test("manual and ambiguous destination labels remain exactly as entered", () => {
  for (const city of ["Vienna", "Paris, France", "Wooster, OH", "  My summer adventure  ", "Coast, mountains, perhaps", "Hotel, district, city, France", "City, , France", "Museum, Wing B, AA", "Town, state, The airport", "", "Somewhere, local area"]) {
    for (const cityFromSuggestion of [true, false]) assert.equal(formatSavedDestinationLabel({ city, cityFromSuggestion }), city);
  }
});

test("a destination's city key ignores only case, spacing and Unicode form, so other regions stay distinct", () => {
  assert.equal(destinationKey(" paris ,  ILE-DE-FRANCE,france "), destinationKey("Paris, Ile-de-France, France"));
  assert.equal(destinationKey("Z\u0075\u0308rich, Switzerland"), destinationKey("Z\u00fcrich, Switzerland"), "composed and decomposed letters match");
  for (const [one, other] of [
    ["Paris, Ile-de-France, France", "Paris, Texas, United States"],
    ["Paris", "Paris, France"],
    ["Newport, Wales, United Kingdom", "Newport, England, United Kingdom"],
    ["Wooster, OH", "Wooster, Ohio, United States"],
  ]) assert.notEqual(destinationKey(one), destinationKey(other), `${one} / ${other}`);
});

/** The trip's connections, with their travel details. */
const connections = (store, tripId) => store.getSnapshot().legs.filter((leg) => leg.tripId === tripId).map(({ id, method, notes }) => ({ id, method, notes }));
/** Books every connection of a trip, so a test can see a save keep or clear them. */
function bookConnections(store, tripId) {
  for (const { id } of connections(store, tripId)) store.applyMutation({ type: "leg.save", id, method: "Flight", price: "500", departure: "", arrival: "", url: "", notes: "Booked" });
}
const shown = (store, id) => formatSavedDestinationLabel(destination(store, id));

test("a destination records a city chosen from a suggestion, and shows any other city exactly as entered (TRA-76)", (t) => {
  const { store, tripId } = setup(t);
  const chosen = store.applyMutation({ type: "stop.add", tripId, city: "Wooster, Ohio, United States", cityFromSuggestion: true }).id;
  const typed = store.applyMutation({ type: "stop.add", tripId, city: "Tokyo, Kyoto, Japan" }).id;
  const created = store.applyMutation({ type: "destination.create", city: "Paris, Île-de-France, France", cityFromSuggestion: true }).id;
  const createdTyped = store.applyMutation({ type: "destination.create", city: "Chicago, Cook County, IL" }).id;
  assert.deepEqual([chosen, typed, created, createdTyped].map((id) => [destination(store, id).cityFromSuggestion, shown(store, id)]),
    [[true, "Wooster, Ohio"], [false, "Tokyo, Kyoto, Japan"], [true, "Paris, France"], [false, "Chicago, Cook County, IL"]]);
  // Trip cards on the home page, and page titles, show cities as the trip and Destinations pages do.
  assert.deepEqual(store.getHomeOverview().data.destinations.map((item) => formatSavedDestinationLabel(item)).sort(), ["Tokyo, Kyoto, Japan", "Wooster, Ohio"]);
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  assert.deepEqual([store.getStopName(owner, tripId, chosen), store.getStopName(owner, tripId, typed), store.getDestinationName(owner, createdTyped)], ["Wooster, Ohio", "Tokyo, Kyoto, Japan", "Chicago, Cook County, IL"]);
  // A city the owner already has opens that destination unchanged, however it is chosen this time.
  assert.equal(store.applyMutation({ type: "stop.add", tripId, city: "tokyo, kyoto, japan", cityFromSuggestion: true }).id, typed);
  assert.equal(store.applyMutation({ type: "destination.create", city: "Chicago, Cook County, IL", cityFromSuggestion: true }).id, createdTyped);
  assert.deepEqual([shown(store, typed), shown(store, createdTyped)], ["Tokyo, Kyoto, Japan", "Chicago, Cook County, IL"]);
});

test("editing a destination keeps its city exactly as entered, and its connections, until the city changes (TRA-76)", (t) => {
  const { store, tripId } = setup(t);
  const tokyo = addCity((input) => store.applyMutation(input).id, tripId, "Tokyo, Kyoto, Japan", { nights: 3 });
  bookConnections(store, tripId);
  const booked = connections(store, tripId);
  // The destination editor sends the city as saved with every other field, and the budget editors leave it out.
  store.applyMutation(stopEdit(tokyo, { city: "Tokyo, Kyoto, Japan", notes: "Temples", stay: "Ryokan", nights: 4 }));
  store.applyMutation(destinationEdit(tokyo, { shoppingAmount: "200" }));
  assert.deepEqual([destination(store, tokyo).city, shown(store, tokyo), destination(store, tokyo).notes], ["Tokyo, Kyoto, Japan", "Tokyo, Kyoto, Japan", "Temples"]);
  assert.deepEqual(connections(store, tripId), booked, "its connections keep their travel plans");
  // Choosing a suggestion records it, and a new city clears the connections to and from it, as before.
  store.applyMutation(stopEdit(tokyo, { city: "Tokyo, Tokyo, Japan", cityFromSuggestion: true }));
  assert.equal(shown(store, tokyo), "Tokyo, Japan");
  assert.ok(connections(store, tripId).every((leg) => leg.method === "" && leg.notes === ""));
});

test("a recorded suggestion stays recorded until a new city is entered some other way (TRA-76)", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation({ type: "stop.add", tripId, city: "Wooster, Ohio, United States", cityFromSuggestion: true }).id;
  bookConnections(store, tripId);
  const booked = connections(store, tripId);
  store.applyMutation(destinationEdit(id, { notes: "Notes only" }));
  store.applyMutation(stopEdit(id, { city: "Wooster, Ohio, United States", stay: "Inn" }));
  assert.deepEqual([destination(store, id).cityFromSuggestion, shown(store, id)], [true, "Wooster, Ohio"], "an unchanged city keeps its record");
  store.applyMutation(destinationEdit(id, { city: "Wooster, Ohio, USA" }));
  assert.deepEqual([destination(store, id).cityFromSuggestion, shown(store, id)], [false, "Wooster, Ohio, USA"]);
  // Entering a suggestion's label by hand isn't choosing it, and choosing it again for the same city records it
  // without clearing travel plans.
  store.applyMutation(destinationEdit(id, { city: "Wooster, Ohio, United States" }));
  bookConnections(store, tripId);
  assert.equal(shown(store, id), "Wooster, Ohio, United States");
  store.applyMutation(destinationEdit(id, { city: "Wooster, Ohio, United States", cityFromSuggestion: true }));
  assert.equal(shown(store, id), "Wooster, Ohio");
  assert.deepEqual(connections(store, tripId), booked);
});

test("a suggestion is recorded only as true, with the city it describes", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation({ type: "stop.add", tripId, city: "Lima, Lima, Peru", cityFromSuggestion: true }).id;
  const before = store.getSnapshot();
  for (const cityFromSuggestion of [false, "true", 1, null]) {
    for (const input of [{ type: "stop.add", tripId, city: "Cusco", cityFromSuggestion }, { type: "destination.create", city: "Cusco", cityFromSuggestion }, destinationEdit(id, { city: "Cusco", cityFromSuggestion })]) {
      assert.throws(() => store.applyMutation(input), (error) => isValidationError(error) && error.message === "cityFromSuggestion must be true or left out, and only with a city.", JSON.stringify(input));
    }
  }
  assert.throws(() => store.applyMutation(destinationEdit(id, { notes: "Notes", cityFromSuggestion: true })), ValidationError);
  assert.deepEqual(store.getSnapshot(), before);
});

test("schema 25 shows every saved city exactly as saved, and a replay keeps later records", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const chosen = store.applyMutation({ type: "stop.add", tripId, city: "Wooster, Ohio, United States", cityFromSuggestion: true }).id;
    store.applyMutation({ type: "stop.add", tripId, city: "Tokyo, Kyoto, Japan" });
    bookConnections(store, tripId);
    const saved = store.getSnapshot();
    store.close(); store = null;
    // A schema 24 database records no suggestions.
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE destinations DROP COLUMN cityFromSuggestion; PRAGMA user_version = 24;");
    db.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), { ...saved, destinations: saved.destinations.map((item) => ({ ...item, cityFromSuggestion: false })) }, "only the record changes");
    assert.deepEqual(store.getSnapshot().destinations.map((item) => formatSavedDestinationLabel(item)), ["Tokyo, Kyoto, Japan", "Wooster, Ohio, United States"]);
    store.applyMutation(destinationEdit(chosen, { city: "Wooster, Ohio, United States", cityFromSuggestion: true }));
    const recorded = store.getSnapshot();
    store.close(); store = null;
    const replay = new DatabaseSync(path);
    replay.exec("PRAGMA user_version = 24;");
    replay.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), recorded, "a replay keeps saved records");
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});
