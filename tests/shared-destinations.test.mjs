import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget, calculateDestinationBudget, tripVisits } from "../src/lib/budget.ts";
import { createStore, SCHEMA_VERSION } from "../src/lib/store.ts";
import { churchDateEligible } from "../src/lib/trip-dates.ts";
import { addCity, fileDatabase, newItem } from "./budget-fixtures.mjs";
import { OWNER_EMAIL, UNDO_SCHEMA_21 } from "./owned-store.mjs";

const NOT_AVAILABLE = { name: "ValidationError", message: "This item no longer exists or isn't shared with you. Please refresh and try again." };
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const photo = () => ({ id: randomUUID(), data: webp });
const requirements = (visaRequirements) => ({ passportNationality: "United States", travelPurpose: "Tourism", travelerCircumstances: "", visaRequirements, passportValidity: "", requiredDocuments: "", transitRequirements: "", notes: "", sources: [{ id: randomUUID(), url: "https://example.gov/entry", description: "Official" }], lastCheckedDate: "2026-11-01" });
const sorted = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));

/**
 * A schema 20 database: written by this build, then undone to schema 20, where each destination belonged to one
 * trip. The owner planned Lisbon in two trips, spelled differently, and Rome twice in one trip; someone else
 * planned their own Lisbon. Reopening it upgrades it.
 */
function legacyPlans(t) {
  const path = fileDatabase(t);
  const store = createStore(path, OWNER_EMAIL);
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const other = store.authorizeAccount("other@example.com").id;
  const as = (account) => (input) => store.applyMutation(account, input).id;
  const m = as(owner);
  const trip = (name, startDate, save = m) => save({ type: "trip.save", ...newItem(), name, startDate, dateLabel: "", homeCity: "Boston", travelers: 2, notes: "" });
  const add = (tripId, city, fields = {}, save = m) => addCity(save, tripId, city, fields);
  const idea = (destinationId, category, name, fields = {}) => m({ type: "candidate.save", destinationId, category, name, price: "10", address: "", url: "", notes: "", included: false, ...fields, ...newItem(fields) });
  const church = (destinationId, name, fields = {}) => m({ type: "church.save", destinationId, name, address: "", denomination: "", url: "", massTimes: [], ...fields, ...newItem(fields) });
  // May 2, 2027 is a Sunday and October 4, 2027 a Monday.
  const ids = { spring: trip("Spring", "2027-05-02"), autumn: trip("Autumn", "2027-10-04"), loop: trip("Loop", null), theirs: trip("Theirs", null, as(other)) };
  Object.assign(ids, {
    springLisbon: add(ids.spring, "Lisbon, Lisbon, Portugal", { stay: "Spring stay", notes: "Tram 28 early", nights: 3, hotelNightlyAmount: "150", miscDailyAmount: "40", shoppingAmount: "100", activitiesBudgetMode: "general", activitiesGeneralAmount: "200", foodBudgetMode: "daily", foodDailyAmount: "90", weatherHighF: 70, weatherLowF: 55, weatherPeriod: "May", gallery: { add: [photo(), photo()], remove: [] } }),
    franceParis: add(ids.spring, "Paris, Ile-de-France, France", { nights: 2 }),
    autumnLisbon: add(ids.autumn, "Lisbon, renamed below", { stay: "Autumn stay", notes: "Tram 28 early", nights: 4, hotelNightlyAmount: "180", miscDailyAmount: "40", foodBudgetMode: "daily", weatherHighF: 75, weatherLowF: 60, weatherPeriod: "October", gallery: { add: [photo()], remove: [] } }),
    texasParis: add(ids.autumn, "Paris, Texas, United States", { nights: 1 }),
    firstRome: add(ids.loop, "Rome", { nights: 2 }),
    florence: add(ids.loop, "Florence", { nights: 2 }),
    secondRome: add(ids.loop, "Rome, renamed below", { nights: 1 }),
    theirLisbon: add(ids.theirs, "Lisbon, Lisbon, Portugal", { notes: "Theirs" }, as(other)),
  });
  Object.assign(ids, {
    // Only Spring chose a hotel and a restaurant needs no choice, but both trips included activities.
    hotelA: idea(ids.springLisbon, "hotels", "Hotel A", { price: "500", included: true, gallery: { add: [photo()], remove: [] } }),
    hotelB: idea(ids.autumnLisbon, "hotels", "Hotel B", { price: "600" }),
    belem: idea(ids.springLisbon, "activities", "Belem", { included: true, mustDo: true }),
    sintra: idea(ids.autumnLisbon, "activities", "Sintra", { included: true }),
    cervejaria: idea(ids.autumnLisbon, "restaurants", "Cervejaria", { price: "80", included: true }),
    se: church(ids.springLisbon, "Sé", { gallery: { add: [photo()], remove: [] } }),
    saoRoque: church(ids.autumnLisbon, "São Roque"),
  });
  m({ type: "destination.entryRequirements", id: ids.springLisbon, requirements: requirements("None for 90 days") });
  m({ type: "destination.entryRequirements", id: ids.autumnLisbon, requirements: requirements("ETIAS from 2027") });
  m({ type: "destination.churchVisibility", id: ids.autumnLisbon, enabled: false });
  for (const leg of store.getSnapshot().legs) as(leg.tripId === ids.theirs ? other : owner)({ type: "leg.save", id: leg.id, method: "Train", price: "10", departure: "", arrival: "", url: "", notes: "" });
  const before = store.getSnapshot();
  store.close();
  const db = new DatabaseSync(path);
  db.exec(UNDO_SCHEMA_21);
  // Before schema 21 a city could be saved again in another trip, spelled differently.
  db.prepare("UPDATE destinations SET city = ? WHERE id = ?").run("lisbon,  Lisbon, PORTUGAL", ids.autumnLisbon);
  db.prepare("UPDATE destinations SET city = ? WHERE id = ?").run("rome", ids.secondRome);
  for (const [id, createdAt] of [[ids.theirs, "2026-01-01"], [ids.spring, "2026-02-01"], [ids.autumn, "2026-03-01"], [ids.loop, "2026-04-01"]]) db.prepare("UPDATE trips SET createdAt = ? WHERE id = ?").run(createdAt + "T12:00:00.000Z", id);
  db.close();
  return { path, owner, other, ids, before };
}

/** The upgraded store, with the owner's and the other account's reads and changes. */
function upgraded(t, plans) {
  const store = createStore(plans.path, OWNER_EMAIL);
  t.after(() => store.close());
  return { store, change: (input, account = plans.owner) => store.applyMutation(account, input) };
}
const visitOf = (snapshot, stopId) => {
  const stop = snapshot.stops.find((item) => item.id === stopId);
  return { ...snapshot.destinations.find((item) => item.id === stop.destinationId), nights: stop.nights };
};

test("schema 21 merges each owner's same-city destinations into one, keeping research and every trip's own stay", (t) => {
  const plans = legacyPlans(t);
  const { ids, before } = plans;
  const store = createStore(plans.path, OWNER_EMAIL);
  let open = true;
  t.after(() => { if (open) store.close(); });
  const after = store.getSnapshot();
  const lisbon = after.destinations.find((item) => item.id === ids.springLisbon);
  const oldLisbon = before.destinations.find((item) => item.id === ids.springLisbon);

  // One Lisbon for the owner, under the oldest trip's destination and spelling. Same-named cities elsewhere stay apart.
  assert.deepEqual(after.destinations.map((item) => item.id).sort(), [ids.springLisbon, ids.franceParis, ids.texasParis, ids.firstRome, ids.florence, ids.theirLisbon].sort());
  assert.equal(lisbon.city, "Lisbon, Lisbon, Portugal");
  assert.equal(after.destinations.find((item) => item.id === ids.theirLisbon).notes, "Theirs", "another account's Lisbon stays theirs");
  assert.deepEqual(Object.keys(store.getDestinationsOverview(plans.other).access), [ids.theirLisbon]);

  // Each old destination is now its trip's stop, with the same ID, order, stay notes, nights and dates.
  const stop = (id) => after.stops.find((item) => item.id === id);
  assert.deepEqual(stop(ids.springLisbon), { id: ids.springLisbon, tripId: ids.spring, destinationId: ids.springLisbon, position: 0, stay: "Spring stay", nights: 3, arrivalDate: "2027-05-02", departureDate: "2027-05-05", legacyArrivalDate: null, legacyDepartureDate: null });
  assert.deepEqual(stop(ids.autumnLisbon), { id: ids.autumnLisbon, tripId: ids.autumn, destinationId: ids.springLisbon, position: 0, stay: "Autumn stay", nights: 4, arrivalDate: "2027-10-04", departureDate: "2027-10-08", legacyArrivalDate: null, legacyDepartureDate: null });
  assert.deepEqual(tripVisits(after, ids.loop).map(({ stop: item, visit }) => [item.id, visit.id, item.nights]), [[ids.firstRome, ids.firstRome, 2], [ids.florence, ids.florence, 2], [ids.secondRome, ids.firstRome, 1]], "a city visited twice in one trip keeps both stays");
  assert.deepEqual(sorted(after.legs), sorted(before.legs), "every travel connection keeps its stops and details");

  // Agreed values, and values only one trip set, are kept; values the trips set differently are cleared for re-entry.
  assert.deepEqual({ misc: lisbon.miscDailyMinor, shopping: lisbon.shoppingMinor, hotel: lisbon.hotelNightlyMinor, activities: [lisbon.activitiesBudgetMode, lisbon.activitiesGeneralMinor], food: [lisbon.foodBudgetMode, lisbon.foodDailyMinor], church: lisbon.churchEnabled },
    { misc: 4000, shopping: 10000, hotel: null, activities: ["itemized", 20000], food: ["daily", 9000], church: true });
  const ideas = (category) => after.candidates.filter((item) => item.destinationId === ids.springLisbon && item.category === category).map(({ id, position, included, mustDo }) => ({ id, position, included, mustDo }));
  assert.deepEqual(ideas("hotels"), [{ id: ids.hotelA, position: 0, included: true, mustDo: false }, { id: ids.hotelB, position: 1, included: false, mustDo: false }]);
  assert.deepEqual(ideas("activities"), [{ id: ids.belem, position: 0, included: false, mustDo: true }, { id: ids.sintra, position: 1, included: false, mustDo: false }], "both trips included activities, so those selections are cleared; Must do stays");
  assert.deepEqual(ideas("restaurants"), [{ id: ids.cervejaria, position: 0, included: true, mustDo: false }]);
  assert.equal(after.candidates.find((item) => item.id === ids.hotelA).images.length, 1);

  // Nothing researched is lost: photos, churches and notes join, and the second weather and entry requirements are kept as notes.
  assert.equal(lisbon.images.length, 3);
  assert.equal(lisbon.mainImageId, oldLisbon.mainImageId);
  assert.deepEqual(after.churches.filter((item) => item.destinationId === ids.springLisbon).map((item) => item.id).sort(), [ids.se, ids.saoRoque].sort());
  assert.deepEqual(lisbon.entryRequirements, oldLisbon.entryRequirements);
  assert.deepEqual([lisbon.weatherHighF, lisbon.weatherLowF, lisbon.weatherPeriod], [70, 55, "May"]);
  assert.equal(lisbon.notes, [
    "Tram 28 early",
    "Typical weather recorded in “Autumn”:\nHigh: 75 °F\nLow: 60 °F\nPeriod: October",
    "Entry requirements recorded in “Autumn”:\nPassport nationality: United States\nPurpose of travel: Tourism\nVisa / electronic authorization requirements: ETIAS from 2027\nSource: https://example.gov/entry (Official)\nLast checked: 2026-11-01",
  ].join("\n\n"));
  for (const image of lisbon.images) assert.ok(store.getDestinationPhoto(plans.owner, ids.springLisbon, image.id), "every merged photo is served under the shared destination");

  // Each trip's estimate uses the shared amounts with its own nights.
  assert.deepEqual(calculateDestinationBudget(after, visitOf(after, ids.springLisbon)).totalsByCurrency, { USD: 50000 + 9000 * 3 + 10000 + 4000 * 3 });
  assert.deepEqual(calculateDestinationBudget(after, visitOf(after, ids.autumnLisbon)).totalsByCurrency, { USD: 50000 + 9000 * 4 + 10000 + 4000 * 4 });

  // Replaying any earlier upgrade changes nothing, and the database stays consistent.
  store.close();
  open = false;
  for (const version of [20, 14, 2]) {
    const db = new DatabaseSync(plans.path);
    db.exec(`PRAGMA user_version = ${version}`);
    db.close();
    const replayed = createStore(plans.path, OWNER_EMAIL);
    assert.deepEqual(replayed.getSnapshot(), after, `replay from schema ${version}`);
    replayed.close();
  }
  const db = new DatabaseSync(plans.path, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("a shared destination's edits and selections appear in every trip; nights, dates, Sundays and connections stay each trip's", (t) => {
  const plans = legacyPlans(t);
  const { ids } = plans;
  const { store, change } = upgraded(t, plans);
  const trip = (id) => store.getTripSnapshot(plans.owner, id).data;
  const lisbonIn = (tripId) => trip(tripId).destinations.find((item) => item.id === ids.springLisbon);
  const stayIn = (tripId, stopId) => trip(tripId).stops.find((item) => item.id === stopId);

  // An edit from the Destinations area, with no trip, reaches both trips.
  change({ type: "destination.save", id: ids.springLisbon, notes: "Shared note", hotelNightlyAmount: "200" });
  assert.deepEqual([lisbonIn(ids.spring).notes, lisbonIn(ids.autumn).notes], ["Shared note", "Shared note"]);
  // The selected hotel is shared; unselecting it in one trip returns both to the nightly rate times their own nights.
  const accommodation = () => [ids.spring, ids.autumn].map((tripId) => calculateBudget(trip(tripId), tripId).hotelsByCurrency.USD);
  assert.deepEqual(accommodation(), [50000, 50000], "Hotel A in both trips");
  change({ type: "candidate.include", id: ids.hotelA, included: false });
  assert.deepEqual(accommodation(), [20000 * 3, 20000 * 4]);
  change({ type: "candidate.mustDo", id: ids.sintra, mustDo: true });
  assert.equal(trip(ids.spring).candidates.find((item) => item.id === ids.sintra).mustDo, true);

  // One trip's nights change its own dates, Sundays and end, never another trip's.
  const springBefore = trip(ids.spring);
  assert.deepEqual([churchDateEligible(stayIn(ids.spring, ids.springLisbon)), churchDateEligible(stayIn(ids.autumn, ids.autumnLisbon))], [true, false], "Spring's stay has a Sunday; Autumn's Monday to Friday does not");
  change({ type: "destination.save", id: ids.springLisbon, stopId: ids.autumnLisbon, stay: "Longer", nights: 6 });
  assert.deepEqual(stayIn(ids.autumn, ids.autumnLisbon), { ...stayIn(ids.autumn, ids.autumnLisbon), stay: "Longer", nights: 6, arrivalDate: "2027-10-04", departureDate: "2027-10-10" });
  assert.equal(churchDateEligible(stayIn(ids.autumn, ids.autumnLisbon)), true, "now through Sunday, October 10");
  assert.equal(trip(ids.autumn).trips[0].endDate, "2027-10-11");
  assert.deepEqual({ ...trip(ids.spring), destinations: [] }, { ...springBefore, destinations: [] }, "Spring's stops, dates, connections and ideas are unchanged");

  // Amounts are checked against every trip's nights, even when edited outside a trip.
  change({ type: "destination.save", id: ids.springLisbon, stopId: ids.autumnLisbon, nights: 900_720 });
  assert.throws(() => change({ type: "destination.save", id: ids.springLisbon, miscDailyAmount: "100000000" }), /miscellaneous subtotal is too large/);

  // Renaming the city changes its connections in every trip that visits it.
  change({ type: "destination.save", id: ids.springLisbon, city: "Lisboa, Lisbon, Portugal" });
  for (const [tripId, stopId] of [[ids.spring, ids.springLisbon], [ids.autumn, ids.autumnLisbon]]) {
    const legs = trip(tripId).legs;
    assert.ok(legs.filter((leg) => leg.fromId === stopId || leg.toId === stopId).every((leg) => leg.priceCents === null));
    assert.ok(legs.filter((leg) => leg.fromId !== stopId && leg.toId !== stopId).every((leg) => leg.priceCents === 1000));
  }
});

test("removing a destination from a trip, or deleting the trip, keeps it and its research for other trips and Destinations", (t) => {
  const plans = legacyPlans(t);
  const { ids } = plans;
  const { store, change } = upgraded(t, plans);
  const springBefore = store.getTripSnapshot(plans.owner, ids.spring).data;
  const lisbon = () => store.getDestinationSnapshot(plans.owner, ids.springLisbon).data;
  const research = (data) => ({ destinations: data.destinations, candidates: data.candidates, churches: data.churches });
  const saved = research(lisbon());

  change({ type: "stop.remove", id: ids.autumnLisbon });
  assert.deepEqual(store.getTripSnapshot(plans.owner, ids.autumn).data.stops.map((item) => item.id), [ids.texasParis]);
  assert.deepEqual(store.getTripSnapshot(plans.owner, ids.autumn).data.legs.map((leg) => [leg.fromId, leg.toId]), [[null, ids.texasParis], [ids.texasParis, null]], "the remaining route reconnects");
  assert.deepEqual(store.getTripSnapshot(plans.owner, ids.spring).data, springBefore, "another trip keeps the destination as it was");
  assert.deepEqual(research(lisbon()), saved);

  change({ type: "trip.delete", id: ids.spring });
  assert.deepEqual(research(lisbon()), saved, "a destination outlives every trip that visited it");
  assert.deepEqual([lisbon().trips, lisbon().stops], [[], []]);
  assert.ok(store.getDestinationsOverview(plans.owner).data.destinations.some((item) => item.id === ids.springLisbon), "Destinations lists it without a trip");
  const [image] = saved.destinations[0].images;
  assert.ok(store.getDestinationPhoto(plans.owner, ids.springLisbon, image.id));
  assert.ok(store.getCandidatePhoto(plans.owner, ids.hotelA, saved.candidates.find((item) => item.id === ids.hotelA).images[0].id));
  // Its research stays editable from Destinations.
  change({ type: "destination.save", id: ids.springLisbon, notes: "Still planning" });
  assert.equal(lisbon().destinations[0].notes, "Still planning");
});

test("each account has one destination per city, and same-named cities in different regions stay distinct", (t) => {
  const path = fileDatabase(t);
  const store = createStore(path, OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const other = store.authorizeAccount("other@example.com").id;
  const change = (input, account = owner) => store.applyMutation(account, input).id;
  const trip = (account = owner) => change({ type: "trip.save", ...newItem(), name: "Trip", dateLabel: "", homeCity: "Boston", travelers: 2, notes: "" }, account);
  const add = (tripId, city, account = owner) => change({ type: "stop.add", tripId, city }, account);
  const first = trip(), second = trip();
  const paris = add(first, "Paris, Ile-de-France, France");
  // A spelling that differs only in case or spacing is the same city, so another trip visits the same destination.
  const secondParis = add(second, " paris ,  ILE-DE-FRANCE,france ");
  assert.equal(add(second, "Paris, Ile-de-France, France"), secondParis, "once");
  assert.deepEqual(store.getSnapshot().stops.map((item) => item.destinationId), [paris, paris]);
  assert.deepEqual(store.getSnapshot().destinations.map((item) => item.id), [paris]);
  // A different region, or a manually entered name, is a different destination.
  const texas = add(second, "Paris, Texas, United States");
  add(second, "Paris");
  assert.throws(() => change({ type: "destination.save", id: texas, city: "PARIS, Ile-de-France, France" }), { name: "ValidationError", message: "“Paris, Ile-de-France, France” is already a saved destination. Choose a different city, or keep this one's name." });
  // Changing only the spelling of a destination's own city is allowed.
  change({ type: "destination.save", id: paris, city: "Paris, Île-de-France, France" });
  // Another account keeps its own destination for the same city.
  const theirs = add(trip(other), "Paris, Ile-de-France, France", other);
  assert.notEqual(theirs, paris);

  const db = new DatabaseSync(path);
  try {
    const key = db.prepare("SELECT cityKey FROM destinations WHERE id = ?").get(texas).cityKey;
    assert.throws(() => db.prepare("INSERT INTO destinations(id, ownerId, city, cityKey) VALUES(?, ?, 'Copy', ?)").run(randomUUID(), owner, key), /UNIQUE/);
    // A trip can only visit its own owner's destinations, whatever writes the stop.
    assert.throws(() => db.prepare("INSERT INTO trip_stops(id, tripId, destinationId, position) VALUES(?, ?, ?, 9)").run(randomUUID(), first, theirs), /A trip can only visit its owner's destinations/);
    // A destination a trip visits can't be deleted from under it.
    assert.throws(() => db.prepare("DELETE FROM destinations WHERE id = ?").run(paris), /FOREIGN KEY/);
  } finally {
    db.close();
  }
});

test("people a trip is shared with work on its destinations, which stay the owner's, and see none of the owner's others", (t) => {
  const plans = legacyPlans(t);
  const { ids } = plans;
  const { store, change } = upgraded(t, plans);
  const editor = store.authorizeAccount("editor@example.com").id;
  change({ type: "trip.share", tripId: ids.spring, email: "editor@example.com" });

  // Spring's destinations, as their owner's, and only through Spring: never Autumn, the Loop, or their stays.
  const overview = store.getDestinationsOverview(editor);
  assert.deepEqual(Object.keys(overview.access).sort(), [ids.springLisbon, ids.franceParis].sort());
  assert.deepEqual(overview.access[ids.springLisbon], { role: "editor", owner: { email: OWNER_EMAIL, name: null } });
  assert.deepEqual([overview.data.trips.map((item) => item.id), overview.data.stops.map((item) => item.tripId)], [[ids.spring], [ids.spring, ids.spring]]);
  const lisbon = store.getDestinationSnapshot(editor, ids.springLisbon);
  assert.deepEqual([lisbon.data.trips.map((item) => item.id), lisbon.data.stops.map((item) => item.id)], [[ids.spring], [ids.springLisbon]]);
  for (const hidden of [ids.texasParis, ids.firstRome, ids.theirLisbon]) assert.equal(store.getDestinationSnapshot(editor, hidden), undefined);
  assert.deepEqual(store.getDestinationsOverview(plans.owner).access[ids.springLisbon], { role: "owner" });

  // They edit it like the owner, and what they add to the trip is the owner's.
  change({ type: "destination.save", id: ids.springLisbon, notes: "From the editor" }, editor);
  assert.equal(store.getDestinationSnapshot(plans.owner, ids.springLisbon).data.destinations[0].notes, "From the editor");
  const coimbra = change({ type: "stop.add", tripId: ids.spring, city: "Coimbra" }, editor).id;
  assert.deepEqual(store.getDestinationsOverview(plans.owner).access[coimbra], { role: "owner" });
  // Not through a stay in a trip they can't open.
  assert.throws(() => change({ type: "destination.save", id: ids.springLisbon, stopId: ids.autumnLisbon, nights: 1 }, editor), NOT_AVAILABLE);
  assert.throws(() => change({ type: "stop.remove", id: ids.autumnLisbon }, editor), NOT_AVAILABLE);

  // Removing their access to the trip removes it to its destinations.
  change({ type: "trip.unshare", tripId: ids.spring, email: "editor@example.com" });
  assert.equal(store.getDestinationSnapshot(editor, ids.springLisbon), undefined);
  assert.equal(store.getDestinationName(editor, ids.springLisbon), undefined);
  assert.deepEqual(store.getDestinationsOverview(editor).access, {});
  assert.throws(() => change({ type: "destination.save", id: ids.springLisbon, notes: "Too late" }, editor), NOT_AVAILABLE);
  assert.throws(() => change({ type: "candidate.include", id: ids.hotelA, included: false }, editor), NOT_AVAILABLE);
  const [image] = store.getSnapshot().destinations.find((item) => item.id === ids.springLisbon).images;
  assert.equal(store.getDestinationPhoto(editor, ids.springLisbon, image.id), undefined);
  assert.equal(store.getDestinationImage(editor, ids.springLisbon), undefined);
});

test("a destination created outside a trip is its creator's, and only its owner deletes one, when no trip visits it", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const editor = store.authorizeAccount("editor@example.com").id;
  const other = store.authorizeAccount("other@example.com").id;
  const change = (input, account = owner) => store.applyMutation(account, input).id;
  const tripId = change({ type: "trip.save", ...newItem(), name: "Trip", dateLabel: "", homeCity: "Boston", travelers: 2, notes: "" });
  const lisbon = change({ type: "stop.add", tripId, city: "Lisbon, Lisbon, Portugal" });
  change({ type: "trip.share", tripId, email: "editor@example.com" });
  const porto = change({ type: "destination.create", city: "Porto, Porto, Portugal" });

  // Choosing a city another account has never opens theirs, even one a trip shared with them visits.
  const editorLisbon = change({ type: "destination.create", city: "Lisbon, Lisbon, Portugal" }, editor);
  const otherPorto = change({ type: "destination.create", city: "Porto, Porto, Portugal" }, other);
  assert.equal(new Set([lisbon, porto, editorLisbon, otherPorto]).size, 4);
  assert.deepEqual(store.getDestinationSnapshot(editor, editorLisbon).access, { role: "owner" });
  for (const account of [editor, other]) assert.equal(store.getDestinationSnapshot(account, porto), undefined, "the owner's stays theirs alone");

  // Nobody else deletes a destination; one they can't open is no different from one that doesn't exist.
  const before = store.getSnapshot();
  for (const account of [editor, other]) assert.throws(() => change({ type: "destination.delete", id: porto }, account), NOT_AVAILABLE);
  assert.throws(() => change({ type: "destination.delete", id: lisbon }, editor), { name: "ValidationError", message: "Only the destination's owner can delete it." });
  assert.deepEqual(store.getSnapshot(), before);
  change({ type: "destination.delete", id: porto });
  change({ type: "destination.delete", id: otherPorto }, other);
  assert.deepEqual(store.getSnapshot().destinations.map((item) => item.id).sort(), [lisbon, editorLisbon].sort());
});

test("a city added to a trip is its owner's destination, with what the owner saved for it, whoever on the trip adds it", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const editor = store.authorizeAccount("editor@example.com").id;
  const other = store.authorizeAccount("other@example.com").id;
  const change = (input, account = owner) => store.applyMutation(account, input).id;
  const trip = (account = owner) => change({ type: "trip.save", ...newItem(), name: "Trip", dateLabel: "", homeCity: "Boston", travelers: 2, notes: "" }, account);
  const tripId = trip();
  change({ type: "trip.share", tripId, email: "editor@example.com" });
  // The owner researched Lisbon in Destinations, and the editor has a Lisbon of their own.
  const lisbon = change({ type: "destination.create", city: "Lisbon, Lisbon, Portugal" });
  change({ type: "destination.save", id: lisbon, notes: "The owner's research", hotelNightlyAmount: "150" });
  const editorLisbon = change({ type: "destination.create", city: "Lisbon, Lisbon, Portugal" }, editor);
  assert.equal(store.getDestinationSnapshot(editor, lisbon), undefined);

  // Added by the editor, the trip visits the owner's Lisbon, with the owner's research, never the editor's own.
  const stop = change({ type: "stop.add", tripId, city: "lisbon, LISBON, portugal" }, editor);
  const { data } = store.getTripSnapshot(editor, tripId);
  assert.deepEqual(data.stops.map((item) => [item.id, item.destinationId, item.nights]), [[stop, lisbon, null]]);
  assert.deepEqual([data.destinations[0].notes, data.destinations[0].hotelNightlyMinor], ["The owner's research", 15000]);
  assert.deepEqual(store.getDestinationSnapshot(editor, lisbon).access, { role: "editor", owner: { email: OWNER_EMAIL, name: null } });
  assert.deepEqual(store.getDestinationSnapshot(editor, editorLisbon).data.stops, [], "the editor's own Lisbon is in no trip");
  // A city new to the owner is a new destination of the owner's.
  const porto = change({ type: "stop.add", tripId, city: "Porto, Porto, Portugal" }, editor);
  assert.deepEqual(store.getDestinationsOverview(owner).access[porto], { role: "owner" });

  // Someone the trip isn't shared with can't add to it, and their own trips never visit the owner's destinations.
  const before = store.getSnapshot();
  assert.throws(() => change({ type: "stop.add", tripId, city: "Sintra" }, other), NOT_AVAILABLE);
  assert.deepEqual(store.getSnapshot(), before);
  const theirLisbon = change({ type: "stop.add", tripId: trip(other), city: "Lisbon, Lisbon, Portugal" }, other);
  assert.equal(new Set([lisbon, editorLisbon, theirLisbon]).size, 3);
  assert.equal(store.getDestinationSnapshot(other, lisbon), undefined);
});

test("adding a city an upgraded trip visits twice opens its first stay there", (t) => {
  const plans = legacyPlans(t);
  const { store, change } = upgraded(t, plans);
  const before = store.getSnapshot();
  assert.equal(change({ type: "stop.add", tripId: plans.ids.loop, city: "ROME" }).id, plans.ids.firstRome);
  assert.deepEqual(store.getSnapshot(), before);
});

test("an upgrade that would leave saved items without their parents is refused, changing nothing", (t) => {
  const plans = legacyPlans(t);
  const db = new DatabaseSync(plans.path);
  try {
    // Written while references weren't enforced, as nothing in Travel does.
    db.exec("PRAGMA foreign_keys = OFF;");
    db.prepare("INSERT INTO candidates(id, destinationId, category, name) VALUES(?, ?, 'hotels', 'Orphan')").run(randomUUID(), randomUUID());
    const tables = () => db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all().map((row) => ({ ...row }));
    const schema = tables();
    assert.throws(() => createStore(plans.path, OWNER_EMAIL), /would leave saved items without the trip or destination they belong to/);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 20);
    assert.deepEqual(tables(), schema, "every table is as it was");
  } finally {
    db.close();
  }
});
