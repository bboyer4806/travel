import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { createOwnedStore } from "./owned-store.mjs";
import { fileDatabase, newItem, setup, destinationEdit, stopEdit } from "./budget-fixtures.mjs";
import { calculateBudget } from "../src/lib/budget.ts";
import { formatCurrency } from "../src/lib/money.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Japan in spring", dateLabel: "Spring 2027", homeCity: "New York", travelers: 2, notes: "An idea worth exploring.", ...overrides, ...newItem(overrides) });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Tokyo", stay: "4 nights", notes: "", ...overrides, ...newItem(overrides) });
const candidateInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "hotels", name: "A lovely hotel", price: "200.33", address: "", url: "https://example.com", notes: "", included: true, ...overrides, ...newItem(overrides) });
const legInput = (id, overrides = {}) => ({ type: "leg.save", id, method: "Flight", price: "100.01", departure: "Morning", arrival: "Evening", url: "https://example.com/flights", notes: "Two passengers", ...overrides });
const legsFor = (store, tripId) => store.getSnapshot().legs.filter((leg) => leg.tripId === tripId);
const pair = (leg) => JSON.stringify([leg.fromId, leg.toId]);
const NOT_AVAILABLE = { name: "ValidationError", message: "This item no longer exists or isn't shared with you. Please refresh and try again." };
const photo = () => ({ add: [{ id: randomUUID(), data: new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]) }], remove: [] });
/** Every kind of research a destination keeps, saved from its own page, as Destinations saves it without a trip. */
function saveResearch(store, destinationId) {
  store.applyMutation(destinationEdit(destinationId, { notes: "Gardens at dawn", hotelNightlyAmount: "180", miscDailyAmount: "40", foodBudgetMode: "daily", foodDailyAmount: "75", shoppingAmount: "120", activitiesBudgetMode: "general", activitiesGeneralAmount: "300", weatherHighF: 70, weatherLowF: 55, weatherPeriod: "April", gallery: photo() }));
  store.applyMutation(candidateInput(destinationId, { gallery: photo() }));
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "A temple walk", mustDo: true }));
  store.applyMutation(candidateInput(destinationId, { category: "restaurants", name: "A market lunch", included: false }));
  store.applyMutation({ type: "church.save", ...newItem(), destinationId, name: "A cathedral", address: "", denomination: "Catholic", url: "", massTimes: [{ id: randomUUID(), day: "Sunday", time: "9:00" }], gallery: photo() });
  store.applyMutation({ type: "destination.entryRequirements", id: destinationId, requirements: { passportNationality: "United States", travelPurpose: "Tourism", travelerCircumstances: "", visaRequirements: "None for short stays", passportValidity: "", requiredDocuments: "", transitRequirements: "", notes: "", sources: [], lastCheckedDate: "2026-11-12" } });
  store.applyMutation({ type: "destination.healthSafety", id: destinationId, healthSafety: { advisoryLevel: "Level 1", advisoryWarnings: "", healthPrecautions: "", localSafety: "", emergencyContacts: [{ id: randomUUID(), name: "Emergency services", phone: "110", notes: "" }], sources: [], lastCheckedDate: "2026-11-12" } });
}

test("complete create, edit, clear, and delete flows preserve the trip relationships", (t) => {
  const { store, tripId } = setup(t, tripInput());
  assert.deepEqual(store.getSnapshot().legs, []);
  const { id: destinationId } = store.applyMutation(destinationInput(tripId));
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
  const a = store.applyMutation(destinationInput(tripId, { city: "Tokyo" })).id;
  const homeToA = legsFor(store, tripId)[0];
  store.applyMutation(legInput(homeToA.id));
  const b = store.applyMutation(destinationInput(tripId, { city: "Kyoto" })).id;
  const c = store.applyMutation(destinationInput(tripId, { city: "Osaka" })).id;
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
  const a = store.applyMutation(destinationInput(tripId)).id;
  const b = store.applyMutation(destinationInput(tripId, { city: "Kyoto" })).id;
  const c = store.applyMutation(destinationInput(tripId, { city: "Osaka" })).id;
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
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  const route = legsFor(store, tripId);
  store.applyMutation(legInput(route[0].id));
  store.applyMutation(legInput(route[1].id, { price: "20.25" }));
  const hotelId = store.applyMutation(candidateInput(destinationId)).id;
  const alternativeId = store.applyMutation(candidateInput(destinationId, { name: "Alternative", price: "9999", included: false })).id;
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Park", price: "0" }));
  store.applyMutation(candidateInput(destinationId, { category: "restaurants", name: "Lunch", price: "40.01" }));
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Maybe later", price: "", included: false }));
  const budget = calculateBudget(store.getSnapshot(), tripId);
  assert.deepEqual(budget, { travelCents: 12026, homeCents: 0, totalsByCurrency: { USD: 36060 }, miscellaneousByCurrency: {}, shoppingByCurrency: {}, hotelsByCurrency: { USD: 20033 }, hotelMissingCount: 0, activitiesByCurrency: { USD: 0 }, activitiesMissingCount: 0, foodByCurrency: { USD: 4001 }, foodMissingCount: 0, travelMissingCount: 0, miscMissingCount: 1, knownCount: 5, missingCount: 1, complete: false });
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
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 4);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).knownCount, 0);
  const hotelId = store.applyMutation(candidateInput(destinationId, { price: "" })).id;
  store.applyMutation(candidateInput(destinationId, { category: "activities", name: "Unknown tour", price: "" }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 5);
  store.applyMutation(candidateInput(destinationId, { id: hotelId, price: "0" }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 4);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).knownCount, 1);
  store.applyMutation(tripInput({ id: tripId, homeCity: "" }));
  assert.equal(calculateBudget(store.getSnapshot(), tripId).missingCount, 5);
  assert.equal(calculateBudget(store.getSnapshot(), tripId).complete, false);
});

test("the budget counts each travel connection without a price, as the trip page lists them", (t) => {
  const { store, tripId } = setup(t, tripInput());
  const budget = () => calculateBudget(store.getSnapshot(), tripId);
  const unpriced = () => legsFor(store, tripId).filter((leg) => leg.priceCents === null).length;
  assert.equal(budget().travelMissingCount, 0, "a trip without destinations has no connections");
  const first = store.applyMutation(destinationInput(tripId)).id;
  store.applyMutation(destinationInput(tripId, { city: "Osaka" }));
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
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
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
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  const otherDestinationId = store.applyMutation(destinationInput(otherTripId, { city: "Paris" })).id;
  const hotelId = store.applyMutation(candidateInput(destinationId)).id;
  const before = store.getSnapshot();
  for (const input of [
    destinationEdit(destinationId, { stopId: otherDestinationId, notes: "Through another trip's stop" }),
    candidateInput(otherDestinationId, { id: hotelId }),
    candidateInput(destinationId, { id: hotelId, category: "activities" }),
    destinationInput(randomUUID()),
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
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
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
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
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
    const tokyo = store.applyMutation(destinationInput(tripId)).id;
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
  const tokyo = store.applyMutation(destinationInput(tripId)).id;
  const kyoto = store.applyMutation({ type: "destination.create", city: "Kyoto" }).id;
  saveResearch(store, tokyo);
  saveResearch(store, kyoto);
  const tables = ["destinations", "candidates", "candidate_images", "churches", "church_images", "destination_images", "destination_entry_requirements", "destination_health_safety", "trip_stops", "legs"];
  const counts = () => Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count]));

  // A destination a trip visits keeps everything, for that trip.
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation({ type: "destination.delete", id: tokyo }), { name: "ValidationError", message: "“Tokyo” is in a trip, so it can't be deleted. Remove it from every trip that visits it first." });
  assert.deepEqual(store.getSnapshot(), before);

  // One in no trip goes with its ideas, churches, photos and research, leaving everything else as it was.
  const rows = counts();
  store.applyMutation({ type: "destination.delete", id: kyoto });
  assert.deepEqual(store.getSnapshot(), { ...before, destinations: before.destinations.filter((item) => item.id !== kyoto), candidates: before.candidates.filter((item) => item.destinationId !== kyoto), churches: before.churches.filter((item) => item.destinationId !== kyoto) });
  assert.deepEqual(counts(), { ...rows, destinations: rows.destinations - 1, candidates: rows.candidates - 3, candidate_images: rows.candidate_images - 1, churches: rows.churches - 1, church_images: rows.church_images - 1, destination_images: rows.destination_images - 1, destination_entry_requirements: rows.destination_entry_requirements - 1, destination_health_safety: rows.destination_health_safety - 1 });
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
  store.applyMutation(destinationInput(tripId));
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
