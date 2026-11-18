import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { searchLibrary } from "../src/lib/destination-library.ts";
import { createStore } from "../src/lib/store.ts";
import { aiSetup, OWNER } from "./ai-fixtures.mjs";
import { candidateInput, newItem, prepared } from "./budget-fixtures.mjs";
import { OWNER_EMAIL } from "./owned-store.mjs";

// TRA-142: Add destination offers the saved destinations a trip can visit, and adds the one chosen by its ID.

const NOT_AVAILABLE = { name: "ValidationError", message: "This item no longer exists or isn't shared with you. Please refresh and try again." };
const NOT_THE_OWNERS = { name: "ValidationError", message: "A trip can only visit its owner's destinations." };

/** A saved destination as a trip's page gives it to Add destination. */
const saved = (city, cityFromSuggestion = false) => ({ id: randomUUID(), city, cityFromSuggestion });
/** A city suggestion as Open-Meteo's are made. */
const place = (name, region, country, countryCode) => ({ id: String(Math.floor(Math.random() * 1e7)), name, region, country, countryCode, label: [name, region, country].filter(Boolean).join(", ") });
/** What a search offers: the saved destinations' cities, then the suggestions' labels. */
const offered = ({ destinations, suggestions }) => [destinations.map((destination) => destination.city), suggestions.map((suggestion) => suggestion.label)];
const reykjavik = place("Reykjavík", "Capital Region", "Iceland", "IS");
const nuuk = place("Nuuk", "Sermersooq", "Greenland", "GL");

test("a saved destination is found by the name typed, whatever its accents, letter case or punctuation", () => {
  const library = [saved("Reykjavík, Iceland"), saved("Saint-Malo, Brittany, France"), saved("Zürich")];
  for (const typed of ["Reykjavik", "reykjavík", "REYK", "Reykjavik, Capital Region, Iceland"]) {
    assert.deepEqual(offered(searchLibrary(library, typed, [])), [["Reykjavík, Iceland"], []], typed);
  }
  assert.deepEqual(offered(searchLibrary(library, "saint malo", [])), [["Saint-Malo, Brittany, France"], []]);
  assert.deepEqual(offered(searchLibrary(library, "Zur", [])), [["Zürich"], []]);
  assert.deepEqual(offered(searchLibrary(library, "Vik", [])), [[], []], "its name begins with what is typed");
  assert.deepEqual(offered(searchLibrary(library, ", Iceland", [])), [[], []], "a search without a name finds none");
});

test("a suggestion is the saved destination despite accents, a region left out, or a country's code or a US state's abbreviation", () => {
  const cases = [
    [reykjavik, ["Reykjavík, Iceland", "Reykjavik, Iceland", "Reykjavik, Capital Region, Iceland", "reykjavík, IS", "Reykjavík, Capital Region"]],
    [nuuk, ["Nuuk, Greenland", "Nuuk, GL", "Nuuk, Sermersooq, GL", "Nuuk, Sermersooq, Greenland"]],
    [place("Springfield", "Illinois", "United States", "US"), ["Springfield, IL", "Springfield, Illinois", "Springfield, Illinois, USA", "Springfield, IL, United States"]],
    [place("Paris", "Île-de-France", "France", "FR"), ["Paris, Ile-de-France, France", "Paris, France", "Paris, FR"]],
  ];
  for (const [suggestion, cities] of cases) {
    for (const city of cities) {
      // Searched by a misspelling, which Open-Meteo still matched, the destination is offered for its suggestion.
      assert.deepEqual(offered(searchLibrary([saved(city)], suggestion.name.slice(0, 3) + "x", [suggestion])), [[city], []], city);
    }
  }
});

test("same-named places elsewhere, and a city saved without a region or country, stay new places beside it", () => {
  const newportWales = place("Newport", "Wales", "United Kingdom", "GB");
  const newportEngland = place("Newport", "England", "United Kingdom", "GB");
  const library = [saved("Newport, Wales, United Kingdom", true), saved("Paris"), saved("Paris, Texas, United States", true), saved("Springfield, IL")];
  assert.deepEqual(offered(searchLibrary(library, "Newport", [newportWales, newportEngland])), [["Newport, Wales, United Kingdom"], ["Newport, England, United Kingdom"]]);
  // Paris alone could be any Paris, so both suggestions stay, and Paris, Texas is only the one in Texas.
  assert.deepEqual(offered(searchLibrary(library, "Paris", [place("Paris", "Île-de-France", "France", "FR"), place("Paris", "Texas", "United States", "US")])),
    [["Paris", "Paris, Texas, United States"], ["Paris, Île-de-France, France"]]);
  assert.deepEqual(offered(searchLibrary(library, "Springfield", [place("Springfield", "Illinois", "United States", "US"), place("Springfield", "Missouri", "United States", "US")])),
    [["Springfield, IL"], ["Springfield, Missouri, United States"]], "IL is Illinois only for a place in the United States");
  assert.deepEqual(offered(searchLibrary([saved("Springfield, IL")], "Springfield", [place("Springfield", "", "Israel", "IL")])), [["Springfield, IL"], []], "and Israel elsewhere");
});

test("each saved destination is offered once, in the library's order, however many suggestions are it", () => {
  // Two saved Nuuks, as the search made before it recognized them, are each offered; neither is merged away.
  const library = [saved("Nuuk, Greenland"), saved("Nuuk, Sermersooq, GL"), saved("Oslo, Norway")];
  const nuukWithoutRegion = place("Nuuk", "", "Greenland", "GL");
  assert.deepEqual(offered(searchLibrary(library, "Nuuk", [nuuk, nuukWithoutRegion, place("Nuuk", "Nunavut", "Canada", "CA")])),
    [["Nuuk, Greenland", "Nuuk, Sermersooq, GL"], ["Nuuk, Nunavut, Canada"]]);
  assert.deepEqual(offered(searchLibrary(library, "O", [])), [["Oslo, Norway"], []]);
  assert.deepEqual(offered(searchLibrary([], "Nuuk", [nuuk])), [[], ["Nuuk, Sermersooq, Greenland"]], "without saved destinations, suggestions are as they were");
});

/**
 * An owner with two trips, Spring, shared with an editor, and Autumn, and destinations in and out of them; the editor's
 * own destination; and another account's. `change` saves as an account, the owner by default.
 */
function plans(t) {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const editor = store.authorizeAccount("editor@example.com").id;
  const other = store.authorizeAccount("other@example.com").id;
  const change = (input, account = owner) => store.applyMutation(account, input).id;
  const trip = (name, account = owner, startDate = null) => change({ type: "trip.save", ...newItem(), name, startDate, dateLabel: "", homeCity: "Boston", travelers: 2, notes: "" }, account);
  const spring = trip("Spring", owner, "2027-05-01"), autumn = trip("Autumn");
  change({ type: "trip.share", tripId: spring, email: "editor@example.com" });
  const lisbonStop = change({ type: "stop.add", tripId: spring, city: "Lisbon, Lisbon, Portugal", cityFromSuggestion: true });
  change({ type: "destination.save", id: lisbonStop, stopId: lisbonStop, nights: 3 });
  const ids = {
    spring, autumn, lisbon: lisbonStop,
    porto: change({ type: "stop.add", tripId: autumn, city: "Porto" }),
    reykjavik: change({ type: "destination.create", city: "Reykjavík, Iceland" }),
    oslo: change({ type: "destination.create", city: "Oslo, Norway" }, editor),
    bergen: change({ type: "destination.create", city: "Bergen, Norway" }, other),
  };
  return { store, owner, editor, other, change, ids };
}
const library = (store, account, tripId) => store.getTripSnapshot(account, tripId)?.library;

test("a trip's Add destination offers its owner's saved destinations that the account can open, and nobody else's", (t) => {
  const { store, owner, editor, other, change, ids } = plans(t);
  // The owner's, in a trip or not, alphabetically, as they show.
  assert.deepEqual(library(store, owner, ids.spring), [
    { id: ids.lisbon, city: "Lisbon, Lisbon, Portugal", cityFromSuggestion: true },
    { id: ids.porto, city: "Porto", cityFromSuggestion: false },
    { id: ids.reykjavik, city: "Reykjavík, Iceland", cityFromSuggestion: false },
  ]);
  // The editor opens only the owner's destinations a trip shared with them visits, never their own, which Spring can't visit.
  assert.deepEqual(library(store, editor, ids.spring).map((destination) => destination.id), [ids.lisbon]);
  change({ type: "trip.share", tripId: ids.autumn, email: "editor@example.com" });
  assert.deepEqual(library(store, editor, ids.spring).map((destination) => destination.id), [ids.lisbon, ids.porto]);
  // Their own trips offer their own destinations.
  const editorTrip = change({ type: "trip.save", ...newItem(), name: "Editor's", dateLabel: "", homeCity: "", travelers: 1, notes: "" }, editor);
  assert.deepEqual(library(store, editor, editorTrip).map((destination) => destination.id), [ids.oslo]);
  assert.equal(library(store, other, ids.spring), undefined, "a trip the account can't open offers nothing");
});

test("adding a saved destination visits it by its ID, with everything saved for it, unchanged", (t) => {
  const { store, change, ids } = plans(t);
  const photo = () => ({ id: randomUUID(), ...prepared(new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])) });
  const months = Array.from({ length: 12 }, (_, index) => ({ highF: 40 + index, lowF: 30 + index, precipitationIn: 1 + index / 10 }));
  change({ type: "destination.save", id: ids.reykjavik, tagline: "Land of fire and ice", notes: "Blue Lagoon early", hotelNightlyAmount: "250", miscDailyAmount: "40", shoppingAmount: "100", activitiesBudgetMode: "general", activitiesGeneralAmount: "300", foodBudgetMode: "daily", foodDailyAmount: "120", weatherHighF: 55, weatherLowF: 45, weatherPeriod: "June", weatherRainfall: "Showers", weatherSource: "Met Office", gallery: { add: [photo(), photo()], remove: [] } });
  change({ type: "destination.entryRequirements", id: ids.reykjavik, requirements: { passportNationality: "United States", travelPurpose: "Tourism", travelerCircumstances: "", visaRequirements: "None for 90 days", passportValidity: "", requiredDocuments: "", transitRequirements: "", notes: "", sources: [], lastCheckedDate: "2026-11-01" } });
  change({ type: "destination.healthSafety", id: ids.reykjavik, healthSafety: { advisoryLevel: "Level 1", advisoryWarnings: "", healthPrecautions: "", localSafety: "Weather changes fast", emergencyContacts: [{ id: randomUUID(), name: "Emergency", phone: "112", notes: "" }], sources: [], lastCheckedDate: null } });
  change({ type: "destination.climate", id: ids.reykjavik, climate: { months, source: "Icelandic Met Office", firstYear: 1991, lastYear: 2020 } });
  for (const category of ["hotels", "activities", "restaurants"]) change(candidateInput(ids.reykjavik, category, { name: "A " + category.slice(0, -1), gallery: { add: [photo()], remove: [] } }));
  change({ type: "church.save", ...newItem(), destinationId: ids.reykjavik, name: "Hallgrímskirkja", address: "", denomination: "", url: "", massTimes: [], gallery: { add: [photo()], remove: [] } });
  const research = (snapshot) => [snapshot.destinations.find((item) => item.id === ids.reykjavik), snapshot.candidates.filter((item) => item.destinationId === ids.reykjavik), snapshot.churches];
  const before = store.getSnapshot();

  const stopId = change({ type: "stop.visit", tripId: ids.spring, destinationId: ids.reykjavik });
  const after = store.getSnapshot();
  assert.deepEqual(after.destinations.map((item) => item.id), before.destinations.map((item) => item.id), "no destination is added");
  assert.deepEqual(research(after), research(before), "its photos, ideas, churches, notes, research, weather and budget amounts are as they were");
  // It is the trip's last stop, without stay notes or nights, so its dates wait for its nights.
  const stops = after.stops.filter((item) => item.tripId === ids.spring);
  assert.deepEqual(stops.map(({ id, destinationId, position, stay, nights, arrivalDate }) => ({ id, destinationId, position, stay, nights, arrivalDate })), [
    { id: ids.lisbon, destinationId: ids.lisbon, position: 0, stay: "", nights: 3, arrivalDate: "2027-05-01" },
    { id: stopId, destinationId: ids.reykjavik, position: 1, stay: "", nights: null, arrivalDate: null },
  ]);
  const { data } = store.getTripSnapshot(store.authorizeAccount(OWNER_EMAIL).id, ids.spring);
  assert.equal(data.destinations.find((item) => item.id === ids.reykjavik).notes, "Blue Lagoon early", "the trip's page shows what was saved for it");
  assert.equal(data.legs.length, 3, "travel from Boston, between the stops and back");

  // Each trip keeps its own stay there: nights here set only this trip's, and its dates follow Lisbon's three nights.
  const autumnStop = change({ type: "stop.visit", tripId: ids.autumn, destinationId: ids.reykjavik });
  change({ type: "destination.save", id: ids.reykjavik, stopId, nights: 4, stay: "Downtown" });
  const nights = store.getSnapshot();
  assert.deepEqual([stopId, autumnStop].map((id) => nights.stops.find((item) => item.id === id)).map(({ nights, stay, arrivalDate, departureDate }) => [nights, stay, arrivalDate, departureDate]),
    [[4, "Downtown", "2027-05-04", "2027-05-08"], [null, "", null, null]]);
  assert.deepEqual(research(nights), research(before), "and leave its shared research as it was");
});

test("a destination already in a trip isn't added again, however it is added", (t) => {
  const { store, change, ids } = plans(t);
  const visit = { type: "stop.visit", tripId: ids.spring, destinationId: ids.reykjavik };
  const stopId = change(visit);
  const once = store.getSnapshot();
  assert.equal(change(visit), stopId, "adding it again, as after a lost response, opens its stop");
  assert.equal(change({ type: "stop.add", tripId: ids.spring, city: "reykjavík,  iceland" }), stopId);
  assert.equal(change({ type: "stop.visit", tripId: ids.spring, destinationId: ids.lisbon }), ids.lisbon, "as does a destination added by its city");
  assert.deepEqual(store.getSnapshot(), once);
});

test("only the trip owner's destinations that the account can open are added, by those who can change the trip", (t) => {
  const { store, owner, editor, other, change, ids } = plans(t);
  const visit = (destinationId, account, tripId = ids.spring) => () => change({ type: "stop.visit", tripId, destinationId }, account);
  const before = store.getSnapshot();
  for (const [attempt, refusal] of [
    [visit(ids.reykjavik, editor), NOT_AVAILABLE], // the owner's, which no trip shared with the editor visits
    [visit(ids.porto, editor), NOT_AVAILABLE],
    [visit(ids.oslo, editor), NOT_THE_OWNERS], // the editor's own
    [visit(ids.bergen, owner), NOT_AVAILABLE], // someone else's
    [visit(ids.lisbon, other), NOT_AVAILABLE], // a trip the account can't open
    [visit(ids.bergen, other), NOT_AVAILABLE],
    [visit(randomUUID(), owner), NOT_AVAILABLE],
    [visit(ids.reykjavik, owner, randomUUID()), NOT_AVAILABLE],
    [visit("not an id", owner), { name: "ValidationError", message: "This item has an invalid identifier. Please refresh and try again." }],
  ]) assert.throws(attempt, refusal);
  assert.deepEqual(store.getSnapshot(), before, "a refused addition changes nothing");
  // Once a trip shared with the editor visits Porto, the editor can add it to Spring.
  change({ type: "trip.share", tripId: ids.autumn, email: "editor@example.com" });
  const portoStop = change({ type: "stop.visit", tripId: ids.spring, destinationId: ids.porto }, editor);
  assert.equal(store.getSnapshot().stops.find((item) => item.id === portoStop).destinationId, ids.porto);
});

test("earlier duplicates stay as they are, and a new city is still a new destination", (t) => {
  const { store, change, ids } = plans(t);
  // Nuuk, researched, and an empty Nuuk the search added before it recognized the first.
  const researched = change({ type: "destination.create", city: "Nuuk, Greenland" });
  change({ type: "destination.save", id: researched, notes: "Fjord tour" });
  const empty = change({ type: "destination.create", city: "Nuuk, Sermersooq, GL" });
  const emptyBefore = store.getSnapshot().destinations.find((item) => item.id === empty);
  change({ type: "stop.visit", tripId: ids.spring, destinationId: researched });
  assert.deepEqual(store.getSnapshot().destinations.find((item) => item.id === empty), emptyBefore);
  assert.deepEqual(library(store, store.authorizeAccount(OWNER_EMAIL).id, ids.spring).filter((item) => item.city.startsWith("Nuuk")).map((item) => item.id), [researched, empty]);
  // A city the owner has no destination for becomes one, as before.
  const count = store.getSnapshot().destinations.length;
  const tromso = change({ type: "stop.add", tripId: ids.spring, city: "Tromsø, Troms, Norway", cityFromSuggestion: true });
  assert.deepEqual([store.getSnapshot().destinations.length, store.getSnapshot().destinations.find((item) => item.id === tromso).city], [count + 1, "Tromsø, Troms, Norway"]);
});

test("ChatGPT and Claude can propose adding the owner's saved destination by its ID", (t) => {
  const { store, owner, ownerTrip, guestTrip, propose, decide } = aiSetup(t);
  const kyoto = store.applyMutation(owner, { type: "destination.create", city: "Kyoto, Kyoto, Japan" }).id;
  store.applyMutation(owner, { type: "destination.save", id: kyoto, notes: "Temples at dawn" });
  const proposal = propose([{ type: "stop.visit", tripId: ownerTrip, destinationId: kyoto }]);
  assert.equal(proposal.preview[0].operation, "Add a saved destination to a trip");
  assert.equal(decide(proposal, true).status, "applied");
  const { stops, destinations } = store.aiTrip(ownerTrip);
  assert.deepEqual([stops.map((item) => item.destinationId), destinations.map((item) => item.notes)], [[kyoto], ["Temples at dawn"]]);
  assert.deepEqual(store.aiDestinations().map((item) => [item.city, item.owner.email]), [["Kyoto, Kyoto, Japan", OWNER]], "no destination is added");
  // A guest's trip visits only the guest's destinations.
  assert.throws(() => propose([{ type: "stop.visit", tripId: guestTrip, destinationId: kyoto }]), { name: "ValidationError", message: "Change 1: A trip can only visit its owner's destinations." });
});
