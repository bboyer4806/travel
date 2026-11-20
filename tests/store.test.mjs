import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fstatSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";
import { addCity, fileDatabase, newItem, prepared, setup, destinationEdit, stopEdit } from "./budget-fixtures.mjs";
import { aiSetup, OWNER } from "./ai-fixtures.mjs";
import { calculateBudget, calculateDestinationBudget } from "../src/lib/budget.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { formatCurrency } from "../src/lib/money.ts";
import { PLANNER_UPDATED } from "../src/lib/planner-updated.ts";
import { MONTHS } from "../src/lib/typical-weather.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Japan in spring", dateLabel: "Spring 2027", homeCity: "New York", travelers: 2, notes: "An idea worth exploring.", ...overrides, ...newItem(overrides) });
const addDestination = (store, tripId, { city = "Tokyo", ...overrides } = {}) => addCity((input) => store.applyMutation(input).id, tripId, city, { stay: "4 nights", notes: "", ...overrides });
const candidateInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "hotels", name: "A lovely hotel", price: "200.33", address: "", url: "https://example.com", notes: "", included: true, ...overrides, ...newItem(overrides) });
const legInput = (id, overrides = {}) => ({ type: "leg.save", id, method: "Flight", price: "100.01", departure: "Morning", arrival: "Evening", url: "https://example.com/flights", notes: "Two passengers", ...overrides });
const legsFor = (store, tripId) => store.getSnapshot().legs.filter((leg) => leg.tripId === tripId);
const pair = (leg) => JSON.stringify([leg.fromId, leg.toId]);
const NOT_AVAILABLE = { name: "ValidationError", message: "This item no longer exists or isn't shared with you. Please refresh and try again." };
const photo = () => ({ add: [{ id: randomUUID(), ...prepared(new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])) }], remove: [] });
/** Every kind of research a destination keeps, saved from its own page, as Destinations saves it without a trip. */
function saveResearch(store, destinationId) {
  store.applyMutation(destinationEdit(destinationId, { notes: "Gardens at dawn", hotelNightlyAmount: "180", miscDailyAmount: "40", foodBudgetMode: "daily", foodDailyAmount: "75", shoppingAmount: "120", activitiesBudgetMode: "general", activitiesGeneralAmount: "300", weatherHighF: 70, weatherLowF: 55, weatherPeriod: "April", gallery: photo() }));
  store.applyMutation(candidateInput(destinationId, { gallery: photo() }));
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "A temple walk", mustDo: true }));
  store.applyMutation(candidateInput(destinationId, { category: "restaurants", name: "A market lunch", included: false }));
  store.applyMutation({ type: "church.save", ...newItem(), destinationId, name: "A cathedral", address: "", denomination: "Catholic", url: "", massTimes: [{ id: randomUUID(), day: "Sunday", time: "9:00" }], gallery: photo() });
  store.applyMutation({ type: "destination.entryRequirements", id: destinationId, requirements: { passportNationality: "United States", travelPurpose: "Tourism", travelerCircumstances: "", visaRequirements: "None for short stays", passportValidity: "", requiredDocuments: "", transitRequirements: "", notes: "", sources: [], lastCheckedDate: "2026-11-12" } });
  store.applyMutation({ type: "destination.healthSafety", id: destinationId, healthSafety: { advisoryLevel: "Level 1", advisoryWarnings: "", healthPrecautions: "", localSafety: "", emergencyContacts: [{ id: randomUUID(), name: "Emergency services", phone: "110", notes: "" }], sources: [], lastCheckedDate: "2026-11-12" } });
  // Monthly climate averages (TRA-135), each month by name (TRA-158).
  store.applyMutation({ type: "destination.climate", id: destinationId, climate: { months: MONTHS.map((month, index) => ({ month, highF: 50 + index, lowF: 40 + index, precipitationIn: 2 })), source: "Test normals", firstYear: 1991, lastYear: 2020 } });
}

test("complete create, edit, clear, and delete flows preserve the trip relationships", (t) => {
  const { store, tripId } = setup(t, tripInput());
  assert.deepEqual(store.getSnapshot().legs, []);
  const destinationId = addDestination(store, tripId);
  const route = legsFor(store, tripId);
  assert.equal(route.length, 2);
  assert.deepEqual(route.map((leg) => [leg.fromId, leg.toId]), [[null, destinationId], [destinationId, null]]);
  store.applyMutation(legInput(route[0].id));
  assert.equal(legsFor(store, tripId)[0].priceCents, 10001);
  store.applyMutation({ type: "leg.clear", id: route[0].id });
  assert.equal(legsFor(store, tripId)[0].priceCents, null);
  assert.equal(legsFor(store, tripId)[0].method, "");
  const { id: hotelId } = store.applyMutation(candidateInput(destinationId));
  const { id: activityId } = store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Museum", price: "0" }));
  const { id: restaurantId } = store.applyMutation(candidateInput(destinationId, { category: "restaurants", name: "Dinner", price: "90" }));
  store.applyMutation(candidateInput(destinationId, { id: hotelId, name: "Updated hotel", price: "250.95", notes: "Breakfast included" }));
  store.applyMutation(candidateInput(destinationId, { id: activityId, category: "activities", name: "Museum tour", price: "25" }));
  store.applyMutation(candidateInput(destinationId, { id: restaurantId, category: "restaurants", name: "Dinner", price: "95" }));
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === hotelId).priceCents, 25095);
  store.applyMutation({ type: "candidate.delete", id: activityId });
  assert.equal(store.getSnapshot().candidates.length, 2);
  store.applyMutation(stopEdit(destinationId, { stay: "5 nights", notes: "Stay downtown" }));
  store.applyMutation(tripInput({ id: tripId, name: "Japan 2027", travelers: 3 }));
  assert.equal(store.getSnapshot().trips[0].name, "Japan 2027");
  assert.equal(store.getSnapshot().stops[0].stay, "5 nights");
  const { destinations, candidates } = store.getSnapshot();
  store.applyMutation({ type: "trip.delete", id: tripId });
  // The destination and its ideas stay in Destinations; only the trip's own parts go.
  assert.deepEqual(store.getSnapshot(), { trips: [], stops: [], destinations, legs: [], candidates, homeItems: [], churches: [], tags: [] });
});

test("route changes retain only unchanged connections, and removing a destination from the trip keeps its ideas", (t) => {
  const { store, tripId } = setup(t, tripInput());
  const a = addDestination(store, tripId, { city: "Tokyo" });
  const homeToA = legsFor(store, tripId)[0];
  store.applyMutation(legInput(homeToA.id));
  const b = addDestination(store, tripId, { city: "Kyoto" });
  const c = addDestination(store, tripId, { city: "Osaka" });
  assert.equal(legsFor(store, tripId)[0].id, homeToA.id);
  assert.equal(legsFor(store, tripId)[0].priceCents, 10001);
  const oldLegs = legsFor(store, tripId);
  for (const leg of oldLegs) store.applyMutation(legInput(leg.id));
  store.applyMutation({ type: "stop.move", id: c, direction: "up" });
  const reordered = legsFor(store, tripId);
  assert.deepEqual(reordered.map((leg) => [leg.fromId, leg.toId]), [[null, a], [a, c], [c, b], [b, null]]);
  assert.equal(reordered[0].id, homeToA.id);
  assert.equal(reordered[0].priceCents, 10001);
  assert.ok(reordered.slice(1).every((leg) => leg.priceCents === null && !oldLegs.some((old) => old.id === leg.id)));
  const stable = store.getSnapshot();
  store.applyMutation({ type: "stop.move", id: a, direction: "up" });
  assert.deepEqual(store.getSnapshot(), stable, "moving beyond a route boundary is a no-op");
  store.applyMutation(candidateInput(c));
  store.applyMutation({ type: "stop.remove", id: c });
  assert.deepEqual(legsFor(store, tripId).map((leg) => [leg.fromId, leg.toId]), [[null, a], [a, b], [b, null]]);
  assert.equal(store.getSnapshot().candidates.length, 1);
  assert.deepEqual(store.getSnapshot().stops.map((item) => item.position), [0, 1]);
  store.applyMutation({ type: "stop.remove", id: a });
  store.applyMutation({ type: "stop.remove", id: b });
  assert.equal(legsFor(store, tripId).length, 0);
  assert.deepEqual(store.getSnapshot().destinations.map((item) => item.city).sort(), ["Kyoto", "Osaka", "Tokyo"]);
});

test("home and city changes clear affected transport details; notes edits preserve them", (t) => {
  const { store, tripId } = setup(t, tripInput());
  const a = addDestination(store, tripId);
  const b = addDestination(store, tripId, { city: "Kyoto" });
  const c = addDestination(store, tripId, { city: "Osaka" });
  for (const leg of legsFor(store, tripId)) store.applyMutation(legInput(leg.id));
  store.applyMutation(tripInput({ id: tripId, notes: "New notes" }));
  assert.ok(legsFor(store, tripId).every((leg) => leg.priceCents === 10001));
  store.applyMutation(tripInput({ id: tripId, homeCity: "Boston" }));
  assert.deepEqual(legsFor(store, tripId).map((leg) => leg.priceCents), [null, 10001, 10001, null]);
  for (const leg of legsFor(store, tripId)) store.applyMutation(legInput(leg.id));
  store.applyMutation(destinationEdit(b, { city: "Nara" }));
  assert.deepEqual(legsFor(store, tripId).map((leg) => leg.priceCents), [10001, null, null, 10001]);
  assert.deepEqual(legsFor(store, tripId).map(pair), [[null, a], [a, b], [b, c], [c, null]].map((route) => JSON.stringify(route)));
});

test("budget totals use selected ideas, exact cents, and whole-party transport costs", (t) => {
  const { store, tripId } = setup(t, tripInput());
  const destinationId = addDestination(store, tripId);
  const route = legsFor(store, tripId);
  store.applyMutation(legInput(route[0].id));
  store.applyMutation(legInput(route[1].id, { price: "20.25" }));
  const hotelId = store.applyMutation(candidateInput(destinationId)).id;
  const alternativeId = store.applyMutation(candidateInput(destinationId, { name: "Alternative", price: "9999", included: false })).id;
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Park", price: "0" }));
  store.applyMutation(candidateInput(destinationId, { category: "restaurants", name: "Lunch", price: "40.01" }));
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Maybe later", price: "", included: false }));
  const budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget, { travelCents: 12026, transitMiscCents: null, homeCents: 0, totalsByCurrency: { USD: 36060 }, miscellaneousByCurrency: {}, shoppingByCurrency: {}, hotelsByCurrency: { USD: 20033 }, hotelMissingCount: 0, activitiesByCurrency: { USD: 0 }, activitiesMissingCount: 0, foodByCurrency: { USD: 4001 }, foodMissingCount: 0, travelMissingCount: 0, miscMissingCount: 1, knownCount: 5, missingCount: 1, complete: false });
  store.applyMutation({ type: "candidate.include", id: alternativeId, included: true });
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === hotelId).included, false);
  assert.equal(store.getSnapshot().candidates.filter((item) => item.category === "hotels" && item.included).length, 1);
  assert.deepEqual(calculateBudget(store.getSnapshot(), tripId).hotelsByCurrency, { USD: 999900 });
  store.applyMutation(candidateInput(destinationId, { id: hotelId, included: true }));
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === alternativeId).included, false);
  assert.equal(formatCurrency(36060, "USD"), "$360.60");
  assert.equal(formatCurrency(0, "USD"), "$0");
});

test("incomplete budgets distinguish unknown values from a known zero", (t) => {
  const { store, tripId } = setup(t, tripInput());
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 1);
  const destinationId = addDestination(store, tripId);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 4);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).knownCount, 0);
  const hotelId = store.applyMutation(candidateInput(destinationId, { price: "" })).id;
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Unknown tour", price: "" }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 5);
  store.applyMutation(candidateInput(destinationId, { id: hotelId, price: "0" }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 4);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).knownCount, 1);
  store.applyMutation(tripInput({ id: tripId, homeCity: "" }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 4, "a blank departing city is not a missing estimate (TRA-85)");
  assert.equal(calculateBudget(store.getSnapshot(), tripId).complete, false);
});

test("a trip without a departing city counts the travel from and to it like any other, and is complete once every amount is filled (TRA-85)", (t) => {
  const { store, tripId } = setup(t, tripInput({ homeCity: "" }));
  addDestination(store, tripId, { nights: 2, hotelNightlyAmount: "100", miscDailyAmount: "10" });
  const budget = () => calculateBudget(store.getSnapshot(), tripId);
  assert.equal(budget().travelMissingCount, 2, "the travel from and to the departing city still needs prices");
  assert.equal(budget().missingCount, 2);
  for (const leg of legsFor(store, tripId)) store.applyMutation(legInput(leg.id));
  assert.equal(budget().missingCount, 0);
  assert.equal(budget().complete, true);
  assert.deepEqual(budget().totalsByCurrency, { USD: 42002 });
  assert.deepEqual(store.getHomeOverview().budgets[tripId], budget(), "the trip list shows the same complete estimate");
});

test("the budget counts each travel connection without a price, as the trip page lists them", (t) => {
  const { store, tripId } = setup(t, tripInput());
  const budget = () => calculateBudget(store.getSnapshot(), tripId);
  const unpriced = () => legsFor(store, tripId).filter((leg) => leg.priceCents === null).length;
  assert.equal(budget().travelMissingCount, 0, "a trip without destinations has no connections");
  const first = addDestination(store, tripId);
  addDestination(store, tripId, { city: "Osaka" });
  const route = legsFor(store, tripId);
  assert.equal(budget().travelMissingCount, 3);
  store.applyMutation(legInput(route[0].id, { price: "0" }));
  store.applyMutation(legInput(route[1].id));
  assert.equal(budget().travelMissingCount, 1, "a zero price is known");
  assert.equal(budget().travelCents, 10001);
  store.applyMutation(legInput(route[2].id, { price: "20.25" }));
  assert.equal(budget().travelMissingCount, 0);
  assert.equal(budget().travelCents, 12026);
  store.applyMutation({ type: "leg.clear", id: route[1].id });
  assert.equal(budget().travelMissingCount, unpriced());
  store.applyMutation({ type: "stop.remove", id: first });
  assert.equal(budget().travelMissingCount, 1, "a new, unpriced connection replaces the removed stop's two");
  assert.equal(budget().travelMissingCount, unpriced());
});

test("runtime validation rejects malformed values without modifying saved information", (t) => {
  const { store, tripId } = setup(t, tripInput());
  const destinationId = addDestination(store, tripId);
  store.applyMutation(candidateInput(destinationId));
  const before = store.getSnapshot();
  const invalidInputs = [
    null, [], { type: "unknown" }, { type: "trip.delete", id: "wrong" },
    tripInput({ travelers: 0 }), tripInput({ travelers: 1.5 }), tripInput({ travelers: "2" }),
    tripInput({ name: " " }), tripInput({ name: "a".repeat(121) }),
    candidateInput(destinationId, { included: "true" }), candidateInput(destinationId, { category: "flights" }),
    candidateInput(destinationId, { price: null }),
    ...["-1", "NaN", "Infinity", "1.234", "$1", "1,000", "1e2", "100000000.01"].map((price) => candidateInput(destinationId, { price })),
    ...["javascript:alert(1)", "data:text/html,hello", "ftp://example.com", "https://user:password@example.com"].map((url) => candidateInput(destinationId, { url })),
    candidateInput(destinationId, { notes: "x".repeat(8001) }),
    { type: "leg.save", id: randomUUID(), method: "Flight", price: "20", departure: "", arrival: "", url: "", notes: "" },
    { type: "destination.create" }, { type: "destination.create", city: " " }, { type: "destination.create", city: "a".repeat(121) },
    { type: "destination.delete", id: "wrong" },
  ];
  for (const input of invalidInputs) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  const accepted = store.applyMutation(candidateInput(destinationId, { price: ".50", included: false })).id;
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === accepted).priceCents, 50);
});

test("updates cannot move records into unrelated trips, destinations, or lists", (t) => {
  const { store, tripId } = setup(t, tripInput());
  const otherTripId = store.applyMutation(tripInput({ name: "Europe" })).id;
  const destinationId = addDestination(store, tripId);
  const otherDestinationId = addDestination(store, otherTripId, { city: "Paris" });
  const hotelId = store.applyMutation(candidateInput(destinationId)).id;
  const before = store.getSnapshot();
  for (const input of [
    destinationEdit(destinationId, { stopId: otherDestinationId, notes: "Through another trip's stop" }),
    candidateInput(otherDestinationId, { id: hotelId }),
    candidateInput(destinationId, { id: hotelId, category: "activities" }),
    { type: "stop.add", tripId: randomUUID(), city: "Lyon" },
    candidateInput(randomUUID()),
    { type: "destination.delete", id: randomUUID() },
  ]) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
});

test("saved trips, routes, and selected ideas survive closing and reopening the database", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const destinationId = addDestination(store, tripId);
    store.applyMutation(candidateInput(destinationId));
    store.applyMutation(legInput(legsFor(store, tripId)[0].id));
    const before = store.getSnapshot();
    store.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    store.applyMutation({ type: "trip.delete", id: tripId });
    assert.deepEqual([store.getSnapshot().stops.length, store.getSnapshot().destinations.length, store.getSnapshot().candidates.length], [0, 1, 1], "the destination and its ideas outlive the trip");
  } finally {
    store.close();
  }
});

test("a database failure rolls back hotel deselection and every partial mutation", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  const observer = new DatabaseSync(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const destinationId = addDestination(store, tripId);
    store.applyMutation(candidateInput(destinationId));
    const before = store.getSnapshot();
    observer.exec("CREATE TRIGGER reject_test_hotel BEFORE INSERT ON candidates WHEN NEW.name = 'Fail me' BEGIN SELECT RAISE(ABORT, 'Injected database failure'); END;");
    assert.throws(() => store.applyMutation(candidateInput(destinationId, { name: "Fail me" })), /Injected database failure/);
    assert.deepEqual(store.getSnapshot(), before, "the previously selected hotel stays selected after a failed replacement");
    store.applyMutation(candidateInput(destinationId, { name: "Working replacement" }));
    assert.equal(store.getSnapshot().candidates.filter((item) => item.included).length, 1);
  } finally {
    observer.close();
    store.close();
  }
});

test("a full disk is reported as SQLite's own error, saves nothing, and saving works again once there is room", (t) => {
  const store = createOwnedStore(fileDatabase(t));
  try {
    const tripId = store.applyMutation(tripInput()).id;
    // The store's own connection, taken from the read below, may not grow the database file, as on a full disk.
    const prepare = t.mock.method(DatabaseSync.prototype, "prepare");
    const before = store.getSnapshot();
    const connection = prepare.mock.calls[0].this;
    prepare.mock.restore();
    const pages = connection.prepare("PRAGMA page_count").get().page_count;
    connection.exec(`PRAGMA max_page_count = ${pages}`);
    // SQLite rolls this save back itself. Rolling back again would replace its error with
    // "cannot rollback - no transaction is active".
    const edit = tripInput({ id: tripId, notes: "A long note. ".repeat(600).trim() });
    assert.throws(() => store.applyMutation(edit), { message: "database or disk is full" });
    assert.deepEqual(store.getSnapshot(), before);
    connection.exec(`PRAGMA max_page_count = ${pages + 100}`);
    store.applyMutation(edit);
    assert.equal(store.getSnapshot().trips[0].notes, edit.notes);
  } finally {
    store.close();
  }
});

/** How many of this process's open file descriptors, listed in /dev/fd, are the file at `path`. */
function openDescriptors(path) {
  const file = statSync(path);
  return readdirSync("/dev/fd").filter((fd) => {
    try {
      const open = fstatSync(Number(fd));
      return open.dev === file.dev && open.ino === file.ino;
    } catch {
      return false; // The descriptor that listed the folder is already closed.
    }
  }).length;
}

test("a file that isn't a database is refused, and no attempt to open it leaves it open", (t) => {
  const path = fileDatabase(t);
  writeFileSync(path, "This is not a database.\n".repeat(100));
  for (let attempt = 0; attempt < 3; attempt++) assert.throws(() => createOwnedStore(path), /file is not a database/);
  assert.equal(openDescriptors(path), 0);
});

test("a destination created outside a trip needs only a city, opens again for the same city, and keeps its research", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const create = (city) => store.applyMutation({ type: "destination.create", city }).id;
    const paris = create("Paris, Ile-de-France, France");
    const { data, access } = store.getDestinationSnapshot(paris);
    assert.deepEqual([data.trips, data.stops, access], [[], [], { role: "owner" }], "it is in no trip, and it is its creator's");
    // It starts as a destination added to a trip with only its city does.
    const tripId = store.applyMutation(tripInput()).id;
    const tokyo = store.applyMutation({ type: "stop.add", tripId, city: "Tokyo" }).id;
    const fresh = (id) => ({ ...store.getSnapshot().destinations.find((item) => item.id === id), id: undefined, city: undefined });
    assert.deepEqual(fresh(paris), fresh(tokyo));

    // Choosing a city again opens its destination, however it is spelled, even one a trip visits, and saves nothing.
    const before = store.getSnapshot();
    assert.equal(create(" paris ,  ILE-DE-FRANCE,france "), paris);
    assert.equal(create("tokyo"), tokyo);
    assert.deepEqual(store.getSnapshot(), before);
    // A same-named city in another region, or a name entered by hand, is a destination of its own.
    const texas = create("Paris, Texas, United States");
    const typed = create("Paris");
    assert.equal(new Set([paris, texas, typed]).size, 3);

    // Research is added and edited from its page, as for a destination in a trip, and appears in no trip.
    saveResearch(store, paris);
    store.applyMutation(destinationEdit(paris, { notes: "Museums first" }));
    const researched = store.getDestinationSnapshot(paris).data;
    assert.deepEqual([researched.destinations[0].notes, researched.destinations[0].hotelNightlyMinor, researched.destinations[0].images.length, researched.candidates.length, researched.churches.length], ["Museums first", 18000, 1, 3, 1]);
    assert.ok(researched.destinations[0].entryRequirements && researched.destinations[0].healthSafety);
    assert.deepEqual(store.getTripSnapshot(tripId).data.destinations.map((item) => item.id), [tokyo]);

    // Everything is there after reopening the database, and Destinations lists it.
    const saved = store.getSnapshot();
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved);
    assert.deepEqual(Object.keys(store.getDestinationsOverview().access).sort(), [paris, texas, typed, tokyo].sort());
  } finally {
    store?.close();
  }
});

test("only a destination no trip visits can be deleted, and everything saved for it goes with it", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); store.close(); });
  const tripId = store.applyMutation(tripInput()).id;
  const tokyo = addDestination(store, tripId);
  const kyoto = store.applyMutation({ type: "destination.create", city: "Kyoto" }).id;
  saveResearch(store, tokyo);
  saveResearch(store, kyoto);
  const tables = ["destinations", "candidates", "candidate_images", "churches", "church_images", "destination_images", "destination_entry_requirements", "destination_health_safety", "destination_climate", "trip_stops", "legs"];
  const counts = () => Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count]));

  // A destination a trip visits keeps everything, for that trip.
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation({ type: "destination.delete", id: tokyo }), { name: "ValidationError", message: "“Tokyo” is in a trip, so it can't be deleted. Remove it from every trip that visits it first." });
  assert.deepEqual(store.getSnapshot(), before);

  // One in no trip goes with its ideas, churches, photos and research, leaving everything else as it was.
  const rows = counts();
  store.applyMutation({ type: "destination.delete", id: kyoto });
  assert.deepEqual(store.getSnapshot(), { ...before, destinations: before.destinations.filter((item) => item.id !== kyoto), candidates: before.candidates.filter((item) => item.destinationId !== kyoto), churches: before.churches.filter((item) => item.destinationId !== kyoto) });
  assert.deepEqual(counts(), { ...rows, destinations: rows.destinations - 1, candidates: rows.candidates - 3, candidate_images: rows.candidate_images - 1, churches: rows.churches - 1, church_images: rows.church_images - 1, destination_images: rows.destination_images - 1, destination_entry_requirements: rows.destination_entry_requirements - 1, destination_health_safety: rows.destination_health_safety - 1, destination_climate: rows.destination_climate - 1 });
  assert.equal(store.getDestinationSnapshot(kyoto), undefined);
  assert.throws(() => store.applyMutation({ type: "destination.delete", id: kyoto }), NOT_AVAILABLE);

  // Removed from its trip, a destination can be deleted too, and its city starts again empty.
  store.applyMutation({ type: "stop.remove", id: tokyo });
  store.applyMutation({ type: "destination.delete", id: tokyo });
  assert.deepEqual(counts(), Object.fromEntries(tables.map((table) => [table, 0])));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const again = store.applyMutation({ type: "destination.create", city: "Kyoto" }).id;
  assert.notEqual(again, kyoto);
  assert.deepEqual(store.getDestinationSnapshot(again).data.candidates, []);
});

test("adding a researched city to a trip visits its destination, sharing its research, while each trip keeps its own stay", (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-04-01" }));
  const add = (trip, city) => store.applyMutation({ type: "stop.add", tripId: trip, city }).id;
  // Kyoto was researched for an autumn trip, with ideas, selections, photos and budget amounts.
  const autumnId = store.applyMutation(tripInput({ name: "Autumn", startDate: "2027-10-01" })).id;
  const kyoto = add(autumnId, "Kyoto, Kyoto, Japan");
  saveResearch(store, kyoto);
  store.applyMutation(stopEdit(kyoto, { stay: "Autumn leaves", nights: 4 }));
  const autumn = store.getTripSnapshot(autumnId).data;

  // A new city is a new destination, whose first stop shares its ID, added with nights unset.
  const tokyo = add(tripId, "Tokyo, Tokyo, Japan");
  assert.deepEqual(store.getSnapshot().destinations.map((item) => item.id).sort(), [kyoto, tokyo].sort());
  store.applyMutation(stopEdit(tokyo, { nights: 3 }));
  const toTokyo = legsFor(store, tripId)[0];
  store.applyMutation(legInput(toTokyo.id));

  // A saved city, however it is spelled, adds its destination after the last stop, copying nothing.
  const springKyoto = add(tripId, " kyoto,  KYOTO , japan ");
  const spring = store.getTripSnapshot(tripId).data;
  assert.equal(store.getSnapshot().destinations.length, 2, "no destination is added");
  assert.deepEqual(spring.stops.map((item) => [item.id, item.destinationId, item.position, item.stay, item.nights, item.arrivalDate, item.departureDate]),
    [[tokyo, tokyo, 0, "", 3, "2027-04-01", "2027-04-04"], [springKyoto, kyoto, 1, "", null, null, null]]);
  assert.equal(spring.trips[0].endDate, null, "the trip end waits for Kyoto's nights");
  // The route continues through it, keeping the planned connection to Tokyo.
  assert.deepEqual(spring.legs.map((leg) => [leg.fromId, leg.toId]), [[null, tokyo], [tokyo, springKyoto], [springKyoto, null]]);
  assert.deepEqual(spring.legs[0], legsFor(store, tripId).find((leg) => leg.id === toTokyo.id));
  assert.equal(spring.legs[0].method, "Flight");

  // Its notes, photos, research, ideas, selections, churches and budget amounts are the same in both trips.
  const kyotoIn = (data) => ({ destination: data.destinations.find((item) => item.id === kyoto), candidates: data.candidates.filter((item) => item.destinationId === kyoto), churches: data.churches.filter((item) => item.destinationId === kyoto) });
  assert.deepEqual(kyotoIn(spring), kyotoIn(autumn));
  assert.deepEqual(store.getTripSnapshot(autumnId).data, autumn, "the autumn trip is unchanged");
  store.applyMutation({ type: "candidate.include", id: kyotoIn(autumn).candidates.find((item) => item.category === "restaurants").id, included: true });
  assert.deepEqual(kyotoIn(store.getTripSnapshot(autumnId).data), kyotoIn(store.getTripSnapshot(tripId).data), "a selection made in one trip is the other's too");

  // Each trip's nights give it its own dates and estimate.
  store.applyMutation({ type: "destination.save", id: kyoto, stopId: springKyoto, nights: 2 });
  const after = store.getSnapshot();
  const stay = (id) => after.stops.find((item) => item.id === id);
  assert.deepEqual([springKyoto, kyoto].map((id) => [stay(id).arrivalDate, stay(id).departureDate]), [["2027-04-04", "2027-04-06"], ["2027-10-01", "2027-10-05"]]);
  const estimate = (id) => calculateDestinationBudget(after, { ...after.destinations.find((item) => item.id === kyoto), nights: stay(id).nights }).totalsByCurrency.USD;
  // The chosen hotel's whole-stay price, daily food and miscellaneous for each trip's nights, shopping, and the general activities amount.
  assert.deepEqual([estimate(springKyoto), estimate(kyoto)], [20033 + (7500 + 4000) * 2 + 12000 + 30000, 20033 + (7500 + 4000) * 4 + 12000 + 30000]);

  // Removing it from this trip keeps its research and the autumn trip's stay there.
  const researched = kyotoIn(store.getTripSnapshot(autumnId).data);
  store.applyMutation({ type: "stop.remove", id: springKyoto });
  assert.deepEqual(kyotoIn(store.getTripSnapshot(autumnId).data), researched);
  assert.deepEqual(store.getTripSnapshot(autumnId).data.stops, autumn.stops);
  assert.deepEqual(store.getTripSnapshot(tripId).data.legs.map((leg) => [leg.fromId, leg.toId]), [[null, tokyo], [tokyo, null]]);
});

test("a city already in the trip opens its stop instead of adding another, and a removed one comes back as a new stay", (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-04-01" }));
  const add = (city) => store.applyMutation({ type: "stop.add", tripId, city }).id;
  const tokyo = add("Tokyo, Tokyo, Japan");
  store.applyMutation(stopEdit(tokyo, { stay: "Cherry blossoms", nights: 3 }));
  const kyoto = add("Kyoto, Kyoto, Japan");
  for (const leg of legsFor(store, tripId)) store.applyMutation(legInput(leg.id));
  const before = store.getSnapshot();
  // However the city is spelled, and when Add destination is saved again after a lost response.
  assert.equal(add("tokyo,  TOKYO, japan"), tokyo);
  assert.equal(add("Kyoto, Kyoto, Japan"), kyoto);
  assert.deepEqual(store.getSnapshot(), before, "nothing is added or changed");

  // Removed, its city adds the same destination again, with everything saved for it, as a new stay at the end.
  saveResearch(store, tokyo);
  const researched = store.getSnapshot().destinations.find((item) => item.id === tokyo);
  store.applyMutation({ type: "stop.remove", id: tokyo });
  const again = add("Tokyo, Tokyo, Japan");
  const after = store.getSnapshot();
  assert.notEqual(again, tokyo);
  assert.deepEqual(after.stops.map((item) => [item.id, item.destinationId, item.stay, item.nights]), [[kyoto, kyoto, "", null], [again, tokyo, "", null]]);
  assert.deepEqual(after.destinations.find((item) => item.id === tokyo), researched);
  assert.deepEqual(after.legs.map((leg) => [leg.fromId, leg.toId]), [[null, kyoto], [kyoto, again], [again, null]]);
});

test("adding a city needs a city and a trip the account can open, and a failed add saves nothing", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  const observer = new DatabaseSync(path);
  t.after(() => { observer.close(); store.close(); });
  const tripId = store.applyMutation(tripInput()).id;
  store.applyMutation({ type: "stop.add", tripId, city: "Tokyo" });
  const before = store.getSnapshot();
  for (const [input, error] of [
    [{ type: "stop.add", tripId, city: "   " }, { name: "ValidationError", message: "Please enter city." }],
    [{ type: "stop.add", tripId }, { name: "ValidationError", message: "city must be text." }],
    [{ type: "stop.add", tripId, city: "K".repeat(121) }, { name: "ValidationError", message: "city must be 120 characters or fewer." }],
    [{ type: "stop.add", tripId: "kyoto", city: "Kyoto" }, { name: "ValidationError", message: "This item has an invalid identifier. Please refresh and try again." }],
    [{ type: "stop.add", tripId: randomUUID(), city: "Kyoto" }, NOT_AVAILABLE],
    // A page opened before this change adds a destination with the destination editor's save, and is asked to reload.
    [{ type: "destination.save", ...newItem(), tripId, city: "Kyoto", stay: "", notes: "", nights: 2 }, { name: "ValidationError", message: PLANNER_UPDATED }],
  ]) {
    assert.throws(() => store.applyMutation(input), error);
    assert.deepEqual(store.getSnapshot(), before);
  }
  // A failure partway through adding a new city leaves no destination, stop or connection behind.
  observer.exec("CREATE TRIGGER reject_leg BEFORE INSERT ON legs BEGIN SELECT RAISE(ABORT, 'Injected connection failure'); END;");
  assert.throws(() => store.applyMutation({ type: "stop.add", tripId, city: "Kyoto" }), /Injected connection failure/);
  assert.deepEqual(store.getSnapshot(), before);
});

test("a trip's tags are added and removed one at a time, keep one spelling each, and are kept after reopening", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const japan = store.applyMutation(tripInput()).id;
    const italy = store.applyMutation(tripInput({ name: "Italy" })).id;
    const tag = (tripId, name) => store.applyMutation({ type: "trip.tag", tripId, name });
    const untag = (tripId, name) => store.applyMutation({ type: "trip.untag", tripId, name });
    const tagsOf = (tripId) => store.getTripSnapshot(tripId).data.trips[0].tags;
    // Trips start without tags.
    assert.deepEqual(store.getHomeOverview().data.trips.map((trip) => trip.tags), [[], []]);
    assert.deepEqual(store.getHomeOverview().data.tags, []);

    assert.deepEqual(tag(japan, "  Family \t vacation "), { id: japan });
    tag(japan, "Food");
    // The same tag on another trip keeps the spelling it already has.
    tag(italy, "family VACATION");
    tag(italy, "food");
    tag(italy, "Europe");
    assert.deepEqual(tagsOf(japan), ["Family vacation", "Food"]);
    assert.deepEqual(tagsOf(italy), ["Europe", "Family vacation", "Food"]);
    // A trip's page can reuse the tags of every trip, and the trip list filters by them.
    assert.deepEqual(store.getTripSnapshot(japan).data.tags, ["Europe", "Family vacation", "Food"]);
    assert.deepEqual(store.getHomeOverview().data.tags, ["Europe", "Family vacation", "Food"]);
    assert.deepEqual(Object.fromEntries(store.getHomeOverview().data.trips.map((trip) => [trip.id, trip.tags])), { [japan]: tagsOf(japan), [italy]: tagsOf(italy) });

    // Each tag is on a trip once, a tag needs a name of up to 40 characters, and only a tag the trip has can be removed.
    const before = store.getSnapshot();
    for (const [input, message] of [
      [{ type: "trip.tag", tripId: japan, name: "FOOD" }, "This trip is already tagged “Food”."],
      [{ type: "trip.tag", tripId: japan, name: " \t " }, "Please enter a tag."],
      [{ type: "trip.tag", tripId: japan, name: "x".repeat(41) }, "A tag must be 40 characters or fewer."],
      [{ type: "trip.tag", tripId: japan, name: 5 }, "A tag must be text."],
      [{ type: "trip.untag", tripId: japan, name: "Europe" }, "This trip isn't tagged “Europe”. Refresh to see its tags."],
    ]) {
      assert.throws(() => store.applyMutation(input), { name: "ValidationError", message });
    }
    assert.deepEqual(store.getSnapshot(), before, "nothing is saved from a refused change");
    // Spaces a name loses don't count toward its length.
    tag(japan, "a".repeat(20) + "   " + "b".repeat(19));
    assert.ok(tagsOf(japan).includes("a".repeat(20) + " " + "b".repeat(19)));
    untag(japan, "a".repeat(20) + " " + "b".repeat(19));

    // Removing a tag from one trip leaves the trip and every other trip's tags.
    assert.deepEqual(untag(japan, " FOOD "), { id: japan });
    assert.deepEqual(tagsOf(japan), ["Family vacation"]);
    assert.deepEqual(tagsOf(italy), ["Europe", "Family vacation", "Food"]);
    assert.ok(store.getTripSnapshot(japan));
    // Editing the trip keeps its tags.
    store.applyMutation(tripInput({ id: japan, name: "Japan in autumn" }));
    assert.deepEqual(tagsOf(japan), ["Family vacation"]);

    const saved = store.getSnapshot();
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved, "tags are kept after reopening");

    // Deleting a trip deletes its tags, never another trip's.
    store.applyMutation({ type: "trip.delete", id: italy });
    assert.deepEqual(tagsOf(japan), ["Family vacation"]);
    assert.deepEqual(store.getHomeOverview().data.tags, ["Family vacation"]);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual(db.prepare("SELECT tripId, tagKey, name FROM trip_tags").all().map((row) => ({ ...row })), [{ tripId: japan, tagKey: "family vacation", name: "Family vacation" }]);
    } finally { db.close(); }
  } finally {
    store?.close();
  }
});

test("schema 23 adds trip tags to an existing database without changing it, and replaying the upgrade keeps them", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  const tripId = store.applyMutation(tripInput()).id;
  addDestination(store, tripId);
  const before = store.getSnapshot();
  store.close();
  // A schema 22 database, from before tags.
  let db = new DatabaseSync(path); db.exec("DROP TABLE trip_tags; PRAGMA user_version = 22;"); db.close();
  store = createOwnedStore(path);
  assert.deepEqual(store.getSnapshot(), before, "existing trips upgrade without tags, and nothing else changes");
  store.applyMutation({ type: "trip.tag", tripId, name: "Asia" });
  const tagged = store.getSnapshot();
  store.close();
  db = new DatabaseSync(path); db.exec("PRAGMA user_version = 22;"); db.close();
  store = createOwnedStore(path);
  assert.deepEqual(store.getSnapshot(), tagged, "replaying the upgrade keeps saved tags");
  store.close();
  db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    // The database keeps each tag on a trip once.
    assert.throws(() => db.prepare("INSERT INTO trip_tags(tripId, tagKey, name) VALUES(?, 'asia', 'ASIA')").run(tripId), /UNIQUE/);
  } finally { db.close(); }
});

/** A tagline as someone types it, capitals and all, which the trip's page shows in capitals (TRA-134). */
const TRIP_TAGLINE = "Cherry blossoms and late trains";
const TAGLINE_TOO_LONG = "tagline must be 120 characters or fewer.";
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
const tagline = (store, tripId) => store.getSnapshot().trips.find((trip) => trip.id === tripId).tagline;
/** A snapshot with every trip's tagline left out, to compare everything else. */
const withoutTaglines = (snapshot) => ({ ...snapshot, trips: snapshot.trips.map((trip) => ({ ...trip, tagline: null })) });

test("a trip starts without a tagline unless one is typed, saves it as typed, and clearing it restores the default (TRA-134)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    // A page opened before taglines, ChatGPT and Claude can add a trip without one.
    const plain = store.applyMutation(tripInput()).id;
    const typed = store.applyMutation(tripInput({ tagline: `  ${TRIP_TAGLINE} ` })).id;
    const blank = store.applyMutation(tripInput({ tagline: "" })).id;
    assert.deepEqual([tagline(store, plain), tagline(store, typed), tagline(store, blank)], ["", TRIP_TAGLINE, ""], "saved with its capitalization, without the spaces around it");
    store.applyMutation(tripInput({ id: plain, tagline: "Ramen, temples and one long train ride" }));
    assert.equal(tagline(store, plain), "Ramen, temples and one long train ride", "editing a trip saves its tagline");
    // The trip's page shows it, and All trips, whose cards open the trip's editor, has it to edit.
    assert.equal(store.getTripSnapshot(typed).data.trips[0].tagline, TRIP_TAGLINE);
    assert.deepEqual(Object.fromEntries(store.getHomeOverview().data.trips.map((trip) => [trip.id, trip.tagline])), { [plain]: "Ramen, temples and one long train ride", [typed]: TRIP_TAGLINE, [blank]: "" });
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual([tagline(store, plain), tagline(store, typed)], ["Ramen, temples and one long train ride", TRIP_TAGLINE], "reopening keeps them");
    for (const cleared of ["", "   ", "\t\n"]) {
      store.applyMutation(tripInput({ id: typed, tagline: TRIP_TAGLINE }));
      store.applyMutation(tripInput({ id: typed, tagline: cleared }));
      assert.equal(tagline(store, typed), "", `clearing it with ${JSON.stringify(cleared)} restores the default`);
    }
    assert.equal(tagline(store, plain), "Ramen, temples and one long train ride", "another trip's tagline is its own");
  } finally { store?.close(); }
});

test("saving a trip without a tagline, or changing anything else, keeps its tagline, and changing it changes nothing else", (t) => {
  const { store, tripId } = setup(t, tripInput({ tagline: TRIP_TAGLINE }));
  const destinationId = addDestination(store, tripId, { nights: 4 });
  for (const leg of legsFor(store, tripId)) store.applyMutation(legInput(leg.id));
  store.applyMutation(candidateInput(destinationId));
  // A page opened before taglines, ChatGPT and Claude can save a trip without one, which keeps it. So does every other change.
  for (const edit of [
    tripInput({ id: tripId, name: "Japan 2027", travelers: 3, startDate: "2027-04-01" }),
    { type: "trip.tag", tripId, name: "Asia" },
    { type: "trip.untag", tripId, name: "Asia" },
    stopEdit(destinationId, { nights: 5 }),
    { type: "homeItem.save", ...newItem(), tripId, name: "House sitting", price: "120", notes: "", completed: false },
  ]) {
    store.applyMutation(edit);
    assert.equal(tagline(store, tripId), TRIP_TAGLINE, JSON.stringify(edit));
  }
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId);
  const saved = before.trips[0];
  for (const value of ["Ramen, temples and one long train ride", "", TRIP_TAGLINE]) {
    // The trip's editor sends every detail as saved, with the tagline typed.
    store.applyMutation({ type: "trip.save", id: tripId, name: saved.name, tagline: value, startDate: saved.startDate, dateLabel: saved.dateLabel, homeCity: saved.homeCity, returnCity: saved.returnCity, travelers: saved.travelers, notes: saved.notes });
    assert.equal(tagline(store, tripId), value);
    assert.deepEqual(withoutTaglines(store.getSnapshot()), withoutTaglines(before), "the trip's name, dates, cities, notes, stays, connections and ideas are unchanged");
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
  }
});

test("a trip's tagline has at most 120 characters, and a refused save keeps the saved one", (t) => {
  const { store, tripId } = setup(t, tripInput({ tagline: TRIP_TAGLINE }));
  const longest = "Ä".repeat(120);
  const longestTrip = store.applyMutation(tripInput({ tagline: ` ${longest} ` })).id;
  assert.equal(tagline(store, longestTrip), longest, "spaces around it don't count");
  const before = store.getSnapshot();
  for (const [value, message] of [["Ä".repeat(121), TAGLINE_TOO_LONG], [`${"word ".repeat(24)}x`, TAGLINE_TOO_LONG], [42, "tagline must be text."], [null, "tagline must be text."]]) {
    // Neither a new trip nor a change to a saved one is saved.
    for (const input of [tripInput({ tagline: value }), tripInput({ id: tripId, tagline: value })]) {
      assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input));
      assert.deepEqual(store.getSnapshot(), before);
    }
  }
  // A save refused for any other reason keeps the saved tagline too, even one refused after the trip's details are written.
  const uncropped = { focusX: 50, focusY: 50, zoom: 1 };
  for (const [input, message] of [
    [tripInput({ id: tripId, tagline: "Not saved", travelers: 0 }), "Number of travelers must be a whole number between 1 and 999."],
    [tripInput({ id: tripId, tagline: "Not saved", name: " " }), "Please enter name."],
    [tripInput({ id: tripId, tagline: "Not saved", image: { version: randomUUID(), card: uncropped, banner: uncropped } }), "This trip's headline image has changed since you opened the editor. Refresh and try again."],
  ]) {
    assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input));
    assert.deepEqual(store.getSnapshot(), before);
  }
});

test("someone a trip is shared with sees its tagline and can change it", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const tripId = store.applyMutation(owner, tripInput({ tagline: TRIP_TAGLINE })).id;
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const friend = store.authorizeAccount("friend@example.test").id;
  /** The tagline the account sees on the trip's page and on All trips. */
  const shown = (account) => [store.getTripSnapshot(account, tripId).data.trips[0].tagline, store.getHomeOverview(account).data.trips.find((trip) => trip.id === tripId).tagline];
  assert.deepEqual([shown(owner), shown(friend)], [[TRIP_TAGLINE, TRIP_TAGLINE], [TRIP_TAGLINE, TRIP_TAGLINE]]);
  store.applyMutation(friend, tripInput({ id: tripId, tagline: "Ramen, temples and one long train ride" }));
  assert.deepEqual([shown(owner), shown(friend)], Array(2).fill(Array(2).fill("Ramen, temples and one long train ride")));
});

test("schema 34 databases upgrade without a tagline on any trip, and a replay keeps the taglines saved since", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    addDestination(store, tripId);
    store.applyMutation({ type: "trip.tag", tripId, name: "Asia" });
    store.applyMutation(tripInput({ name: "Europe", returnCity: "Boston" }));
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE trips DROP COLUMN tagline; PRAGMA user_version = 34;");
    db.close();
    store = createOwnedStore(path);
    assert.ok(store.getSnapshot().trips.every((trip) => trip.tagline === ""), "every trip shows the default heading");
    assert.deepEqual(store.getSnapshot(), saved, "every trip keeps everything saved for it");
    store.applyMutation(tripInput({ id: tripId, tagline: TRIP_TAGLINE }));
    const later = store.getSnapshot();
    // A replay of schema 35, also after the schema 1 build resets the schema version, keeps it.
    for (const version of [34, 1]) {
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

test("ChatGPT and Claude read a trip's tagline and propose one, previewed as typed, and approving saves it", (t) => {
  const { store, ownerTrip, propose, decide } = aiSetup(t);
  /** The trip's Tagline field in a proposal's preview, or undefined when the proposal doesn't change it. */
  const previewed = (proposal) => proposal.preview[0].records.find((record) => record.record === `Trip “Owner trip” (${OWNER})`)?.fields.find((field) => field.name === "Tagline");
  const taglineNow = () => store.aiTrip(ownerTrip).trip.tagline;
  /** The owner's trip as an assistant changes it, with every detail as saved and `overrides`. */
  const change = (overrides) => {
    const { name, dateLabel, homeCity, travelers, notes } = store.aiTrip(ownerTrip).trip;
    return { type: "trip.save", id: ownerTrip, name, dateLabel, homeCity, travelers, notes, ...overrides };
  };

  const added = propose([change({ tagline: TRIP_TAGLINE })]);
  assert.deepEqual(previewed(added), { name: "Tagline", before: null, after: TRIP_TAGLINE });
  assert.equal(taglineNow(), "", "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.equal(taglineNow(), TRIP_TAGLINE);
  assert.equal(store.aiTrips().find((trip) => trip.id === ownerTrip).tagline, TRIP_TAGLINE, "assistants read it with the trip's other details");

  const noted = propose([change({ notes: "Book the ryokan early" })]);
  assert.equal(previewed(noted), undefined, "a change without a tagline keeps it, so the preview leaves it out");
  assert.equal(decide(noted, true).status, "applied");
  assert.equal(taglineNow(), TRIP_TAGLINE);

  const cleared = propose([change({ tagline: "" })]);
  assert.deepEqual(previewed(cleared), { name: "Tagline", before: TRIP_TAGLINE, after: null });
  assert.equal(decide(cleared, true).status, "applied");
  assert.equal(taglineNow(), "");

  const before = store.getSnapshot();
  assert.throws(() => propose([change({ tagline: "A".repeat(121) })]), refusal(`Change 1: ${TAGLINE_TOO_LONG}`));
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((item) => item.title === "trip.save");
  assert.equal(schema.properties.tagline.maxLength, 120, "assistants are told the limit");
  assert.ok(!schema.required.includes("tagline"), "left out, it is kept");
});
