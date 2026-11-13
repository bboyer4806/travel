import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget } from "../src/lib/budget.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { UNDO_SCHEMA_20, UNDO_SCHEMA_21 } from "./owned-store.mjs";
import { addCity, fileDatabase, newItem } from "./budget-fixtures.mjs";

const OWNER = "owner@example.com";
const NOT_AVAILABLE = { name: "ValidationError", message: "This item no longer exists or isn't shared with you. Please refresh and try again." };
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const photo = () => ({ id: randomUUID(), data: webp });
const google = (subject, email, name = null) => ({ subject, email, emailVerified: true, name });
const requirements = () => ({ passportNationality: "United States", travelPurpose: "Tourism", travelerCircumstances: "Two adults", visaRequirements: "None for short stays", passportValidity: "Three months", requiredDocuments: "Return ticket", transitRequirements: "None", notes: "Checked", sources: [{ id: randomUUID(), url: "https://example.gov/entry", description: "Entry guidance" }], lastCheckedDate: "2026-11-03" });
const healthSafety = () => ({ advisoryLevel: "Level 1", advisoryWarnings: "", healthPrecautions: "Routine vaccines", localSafety: "Watch for pickpockets", emergencyContacts: [{ id: randomUUID(), name: "Emergency services", phone: "112", notes: "" }], sources: [{ id: randomUUID(), url: "https://example.gov/advisory", description: "Travel advisory" }], lastCheckedDate: "2026-11-10" });

/** The designated owner, someone a trip will be shared with, and someone it never is. */
function setup(t, path = ":memory:") {
  const store = createStore(path, OWNER);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER).id;
  const editor = store.authorizeAccount("editor@example.com").id;
  const outsider = store.authorizeAccount("outsider@example.com").id;
  return { store, owner, editor, outsider };
}

/**
 * A trip with something in every part: dates, two destinations and their connections, ideas, a church, entry
 * requirements, health and safety, an At home item and photos. Each account has one destination per city, so one account's trips need different cities.
 */
function plannedTrip(store, accountId, name = "Portugal", [firstCity, secondCity] = ["Lisbon", "Porto"]) {
  const change = (input) => store.applyMutation(accountId, input).id;
  const tripId = change({ type: "trip.save", ...newItem(), name, startDate: "2027-05-02", dateLabel: "Spring", homeCity: "Boston", travelers: 2, notes: "Trip notes" });
  const lisbon = addCity(change, tripId, firstCity, { nights: 3, hotelNightlyAmount: "150", gallery: { add: [photo(), photo()], remove: [] } });
  const porto = addCity(change, tripId, secondCity, { nights: 2 });
  const hotel = change({ type: "candidate.save", ...newItem(), destinationId: lisbon, category: "hotels", name: "Hotel", price: "400", address: "", url: "", notes: "", included: true, gallery: { add: [photo()], remove: [] } });
  const activity = change({ type: "candidate.save", ...newItem(), destinationId: lisbon, category: "activities", name: "Tram 28", price: "20", address: "", url: "", notes: "", included: true });
  const church = change({ type: "church.save", ...newItem(), destinationId: lisbon, name: "Sé", address: "", denomination: "", url: "", massTimes: [], gallery: { add: [photo()], remove: [] } });
  const homeItem = change({ type: "homeItem.save", ...newItem(), tripId, name: "House sitting", price: "100", notes: "", completed: false });
  change({ type: "destination.entryRequirements", id: lisbon, requirements: requirements() });
  change({ type: "destination.healthSafety", id: lisbon, healthSafety: healthSafety() });
  const snapshot = store.getTripSnapshot(accountId, tripId).data;
  const legs = snapshot.legs.map((leg) => leg.id);
  change({ type: "leg.save", id: legs[0], method: "Flight", price: "900", departure: "", arrival: "", url: "", notes: "" });
  const photos = {
    destination: snapshot.destinations.find((item) => item.id === lisbon).images[0].id,
    candidate: snapshot.candidates.find((item) => item.id === hotel).images[0].id,
    church: snapshot.churches.find((item) => item.id === church).images[0].id,
  };
  return { tripId, lisbon, porto, hotel, activity, church, homeItem, legs, photos };
}

/** Every way the store hands out a trip's information, as the account sees it. */
function readsAs(store, accountId, trip) {
  return {
    home: store.getHomeOverview(accountId).data.trips.some((item) => item.id === trip.tripId),
    page: store.getTripSnapshot(accountId, trip.tripId) !== undefined,
    category: store.getTripSnapshot(accountId, trip.tripId, trip.lisbon) !== undefined,
    tripName: store.getTripName(accountId, trip.tripId) !== undefined,
    stopName: store.getStopName(accountId, trip.tripId, trip.lisbon) !== undefined,
    destinationList: store.getDestinationsOverview(accountId).data.destinations.some((item) => item.id === trip.lisbon),
    destinationPage: store.getDestinationSnapshot(accountId, trip.lisbon) !== undefined,
    destinationName: store.getDestinationName(accountId, trip.lisbon) !== undefined,
    destinationImage: store.getDestinationImage(accountId, trip.lisbon) !== undefined,
    destinationPhoto: store.getDestinationPhoto(accountId, trip.lisbon, trip.photos.destination) !== undefined,
    candidatePhoto: store.getCandidatePhoto(accountId, trip.hotel, trip.photos.candidate) !== undefined,
    churchPhoto: store.getChurchPhoto(accountId, trip.church, trip.photos.church) !== undefined,
  };
}
const everything = (value) => ({ home: value, page: value, category: value, tripName: value, stopName: value, destinationList: value, destinationPage: value, destinationName: value, destinationImage: value, destinationPhoto: value, candidatePhoto: value, churchPhoto: value });

test("a new trip belongs to whoever creates it, and only its owner can open it until it is shared", (t) => {
  const { store, owner, editor, outsider } = setup(t);
  const trip = plannedTrip(store, owner);
  const ownTrip = store.applyMutation(editor, { type: "trip.save", ...newItem(), name: "Editor's own trip", dateLabel: "", homeCity: "", travelers: 1, notes: "" }).id;

  assert.deepEqual(readsAs(store, owner, trip), everything(true));
  assert.deepEqual(readsAs(store, editor, trip), everything(false));
  assert.deepEqual(readsAs(store, outsider, trip), everything(false));

  const home = store.getHomeOverview(owner);
  assert.deepEqual(home.data.trips.map((item) => item.id), [trip.tripId]);
  assert.deepEqual(home.access, { [trip.tripId]: { role: "owner", owner: { email: OWNER, name: null }, sharedWith: [] } });
  assert.deepEqual(home.budgets[trip.tripId], calculateBudget(store.getSnapshot(), trip.tripId));
  const editorHome = store.getHomeOverview(editor);
  assert.deepEqual(editorHome.data.trips.map((item) => item.id), [ownTrip]);
  assert.deepEqual(Object.keys(editorHome.budgets), [ownTrip]);
  assert.ok(editorHome.data.stops.every((stop) => stop.tripId === ownTrip), "The home page sends no other trip's cities");
  assert.equal(editorHome.access[ownTrip].role, "owner");
  assert.deepEqual(store.getHomeOverview(outsider), { data: { trips: [], stops: [], destinations: [], legs: [], candidates: [], homeItems: [], churches: [], tags: [] }, budgets: {}, access: {} });
  assert.deepEqual(store.getDestinationsOverview(outsider), { data: { trips: [], stops: [], destinations: [], legs: [], candidates: [], homeItems: [], churches: [], tags: [] }, access: {} });
  // The owner's account ID stays on the server.
  assert.ok(store.getSnapshot().trips.every((item) => !("ownerId" in item)));
});

test("owners share by Google email, even with someone who has never signed in, who then finds the trip in their list", (t) => {
  const { store, owner } = setup(t);
  const trip = plannedTrip(store, owner);
  const contentBefore = store.getSnapshot();
  // Nothing is sent: sharing makes no network request at all.
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Sharing must not contact anyone."); };
  try {
    assert.deepEqual(store.applyMutation(owner, { type: "trip.share", tripId: trip.tripId, email: "  New.Person@Example.com " }), { id: trip.tripId });
  } finally {
    globalThis.fetch = fetchBefore;
  }
  assert.deepEqual(store.getSnapshot(), contentBefore, "Sharing changes nothing in the trip");

  // A first-time recipient's verified sign-in binds the authorization sharing created.
  const recipient = store.authorizeGoogleSignIn(google("new-subject", "new.person@example.com", "New Person"));
  assert.equal(recipient.email, "new.person@example.com");
  const home = store.getHomeOverview(recipient.id);
  assert.deepEqual(home.data.trips.map((item) => item.id), [trip.tripId]);
  assert.deepEqual(home.access[trip.tripId], { role: "editor", owner: { email: OWNER, name: null } });
  assert.deepEqual(home.budgets[trip.tripId], calculateBudget(store.getSnapshot(), trip.tripId));
  assert.deepEqual(readsAs(store, recipient.id, trip), everything(true));
  assert.deepEqual(store.getTripSnapshot(owner, trip.tripId).access.sharedWith, [{ email: "new.person@example.com", name: "New Person" }]);

  // One invitation per email, however it is typed. The owner already has access, and an email must be an email.
  assert.throws(() => store.applyMutation(owner, { type: "trip.share", tripId: trip.tripId, email: "NEW.PERSON@example.com" }), { name: "ValidationError", message: "This trip is already shared with new.person@example.com." });
  assert.throws(() => store.applyMutation(owner, { type: "trip.share", tripId: trip.tripId, email: OWNER }), { name: "ValidationError", message: "You own this trip, so you already have access." });
  for (const email of ["", "not an email", "a@b"]) {
    assert.throws(() => store.applyMutation(owner, { type: "trip.share", tripId: trip.tripId, email }), ValidationError);
  }
  assert.deepEqual(store.getTripSnapshot(owner, trip.tripId).access.sharedWith.map((item) => item.email), ["new.person@example.com"]);
});

test("people a trip is shared with change everything in it, but only its owner deletes it or decides who has it", (t) => {
  const { store, owner, editor } = setup(t);
  const trip = plannedTrip(store, owner);
  store.applyMutation(owner, { type: "trip.share", tripId: trip.tripId, email: "editor@example.com" });
  const change = (input) => store.applyMutation(editor, input).id;
  const { tripId, lisbon, porto, hotel, activity, church, homeItem, legs } = trip;
  const portoPhoto = photo();

  change({ type: "trip.save", id: tripId, name: "Portugal together", startDate: "2027-05-03", dateLabel: "Spring", homeCity: "Boston", travelers: 3, notes: "Edited together" });
  change({ type: "trip.tag", tripId, name: "Together" });
  change({ type: "leg.save", id: legs[0], method: "Train", price: "45", departure: "", arrival: "", url: "", notes: "" });
  change({ type: "leg.clear", id: legs[1] });
  change({ type: "candidate.save", ...newItem(), destinationId: porto, category: "restaurants", name: "Cantinho", price: "60", address: "", url: "", notes: "", included: true });
  change({ type: "candidate.save", id: hotel, destinationId: lisbon, category: "hotels", name: "Better hotel", price: "450", address: "", url: "", notes: "", included: true });
  change({ type: "candidate.mustDo", id: activity, mustDo: true });
  change({ type: "candidate.include", id: activity, included: false });
  change({ type: "candidate.move", id: activity, direction: "down" });
  change({ type: "church.save", id: church, destinationId: lisbon, name: "Sé de Lisboa", address: "", denomination: "Catholic", url: "", massTimes: [] });
  change({ type: "destination.churchVisibility", id: lisbon, enabled: false });
  change({ type: "destination.entryRequirements", id: porto, requirements: requirements() });
  change({ type: "destination.healthSafety", id: porto, healthSafety: healthSafety() });
  change({ type: "destination.save", id: porto, notes: "Port wine", gallery: { add: [portoPhoto], remove: [] } });
  change({ type: "destination.save", id: porto, stopId: porto, stay: "By the river", nights: 4 });
  change({ type: "homeItem.save", ...newItem(), tripId, name: "Pet care", price: "50", notes: "", completed: false });
  change({ type: "homeItem.complete", id: homeItem, tripId, completed: true });
  const sintra = addCity(change, tripId, "Sintra", { nights: 1 });
  change({ type: "stop.move", id: sintra, direction: "up" });
  change({ type: "candidate.delete", id: activity });
  change({ type: "church.delete", id: church, destinationId: lisbon });
  change({ type: "homeItem.delete", id: homeItem, tripId });
  change({ type: "stop.remove", id: sintra });

  // Both work with the same saved trip, so each sees the other's changes on their next page load.
  const asOwner = store.getTripSnapshot(owner, tripId);
  assert.deepEqual(store.getTripSnapshot(editor, tripId).data, asOwner.data);
  assert.equal(asOwner.data.trips[0].name, "Portugal together");
  assert.deepEqual(asOwner.data.trips[0].tags, ["Together"]);
  assert.equal(asOwner.data.destinations.find((item) => item.id === porto).notes, "Port wine");
  assert.equal(asOwner.data.destinations.find((item) => item.id === porto).healthSafety.localSafety, "Watch for pickpockets");
  assert.deepEqual(store.getDestinationPhoto(owner, porto, portoPhoto.id).data, webp);
  store.applyMutation(owner, { type: "destination.save", id: porto, notes: "Back to the owner" });
  assert.equal(store.getTripSnapshot(editor, tripId).data.destinations.find((item) => item.id === porto).notes, "Back to the owner");

  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(editor, { type: "trip.delete", id: tripId }), { name: "ValidationError", message: "Only the trip's owner can delete it." });
  assert.throws(() => store.applyMutation(editor, { type: "trip.share", tripId, email: "friend@example.com" }), { name: "ValidationError", message: "Only the trip's owner can share it." });
  for (const email of ["editor@example.com", OWNER]) {
    assert.throws(() => store.applyMutation(editor, { type: "trip.unshare", tripId, email }), { name: "ValidationError", message: "Only the trip's owner can remove someone's access." });
  }
  assert.deepEqual(store.getSnapshot(), before);
  assert.equal(store.authorizeGoogleSignIn(google("friend-subject", "friend@example.com")), undefined, "A refused share authorizes nobody");
  assert.equal(store.getTripSnapshot(owner, tripId).access.sharedWith.length, 1);

  // Deleting a shared trip removes it for everyone.
  store.applyMutation(owner, { type: "trip.delete", id: tripId });
  assert.equal(store.getTripSnapshot(editor, tripId), undefined);
  assert.equal(store.getHomeOverview(editor).data.trips.length, 0);
});

test("an account a trip isn't shared with can neither read nor change any part of it, whatever IDs it sends", (t) => {
  const { store, owner, outsider } = setup(t);
  const trip = plannedTrip(store, owner);
  const own = plannedTrip(store, outsider, "Outsider's trip");
  const { tripId, lisbon, hotel, activity, church, homeItem, legs, photos } = trip;
  const before = store.getSnapshot();
  const idea = { address: "", url: "", notes: "", price: "1", included: true };

  // Changes naming only the other trip's items are refused as if the items didn't exist.
  for (const input of [
    { type: "trip.save", id: tripId, name: "Mine now", dateLabel: "", homeCity: "", travelers: 1, notes: "" },
    { type: "trip.delete", id: tripId },
    { type: "trip.share", tripId, email: "outsider@example.com" },
    { type: "trip.unshare", tripId, email: "editor@example.com" },
    { type: "trip.tag", tripId, name: "Mine" },
    { type: "trip.untag", tripId, name: "Mine" },
    { type: "homeItem.save", ...newItem(), tripId, name: "Mine", price: "", notes: "", completed: false },
    { type: "homeItem.save", id: homeItem, tripId, name: "Mine", price: "", notes: "", completed: false },
    { type: "homeItem.complete", id: homeItem, tripId, completed: true },
    { type: "homeItem.delete", id: homeItem, tripId },
    { type: "stop.add", tripId, city: "Mine" },
    { type: "destination.save", id: lisbon, notes: "Mine" },
    { type: "destination.save", id: lisbon, stopId: lisbon, nights: 9 },
    { type: "stop.remove", id: lisbon },
    { type: "stop.move", id: lisbon, direction: "down" },
    { type: "destination.churchVisibility", id: lisbon, enabled: false },
    { type: "destination.entryRequirements", id: lisbon, requirements: null },
    { type: "destination.healthSafety", id: lisbon, healthSafety: null },
    { type: "destination.healthSafety", id: lisbon, healthSafety: healthSafety() },
    { type: "church.save", ...newItem(), destinationId: lisbon, name: "Mine", address: "", denomination: "", url: "", massTimes: [] },
    { type: "church.save", id: church, destinationId: lisbon, name: "Mine", address: "", denomination: "", url: "", massTimes: [] },
    { type: "church.delete", id: church, destinationId: lisbon },
    { type: "leg.save", id: legs[0], method: "Mine", price: "", departure: "", arrival: "", url: "", notes: "" },
    { type: "leg.clear", id: legs[0] },
    { type: "candidate.save", ...newItem(), destinationId: lisbon, category: "activities", name: "Mine", ...idea },
    { type: "candidate.save", id: hotel, destinationId: lisbon, category: "hotels", name: "Mine", ...idea },
    { type: "candidate.move", id: activity, direction: "up" },
    { type: "candidate.mustDo", id: activity, mustDo: false },
    { type: "candidate.include", id: activity, included: false },
    { type: "candidate.delete", id: hotel },
    // Its own IDs don't open the other trip either, in whichever field they appear.
    { type: "homeItem.save", id: homeItem, tripId: own.tripId, name: "Mine", price: "", notes: "", completed: false },
    { type: "homeItem.delete", id: homeItem, tripId: own.tripId },
    { type: "church.save", id: church, destinationId: own.lisbon, name: "Mine", address: "", denomination: "", url: "", massTimes: [] },
    { type: "church.delete", id: church, destinationId: own.lisbon },
    { type: "candidate.save", id: hotel, destinationId: own.lisbon, category: "hotels", name: "Mine", ...idea },
    // Nor as the IDs of new items, which would save over the other trip's.
    { type: "trip.save", id: tripId, create: true, name: "Mine now", dateLabel: "", homeCity: "", travelers: 1, notes: "" },
    { type: "homeItem.save", id: homeItem, create: true, tripId: own.tripId, name: "Mine", price: "", notes: "", completed: false },
    { type: "church.save", id: church, create: true, destinationId: own.lisbon, name: "Mine", address: "", denomination: "", url: "", massTimes: [] },
    { type: "candidate.save", id: hotel, create: true, destinationId: own.lisbon, category: "hotels", name: "Mine", ...idea },
  ]) {
    assert.throws(() => store.applyMutation(outsider, input), NOT_AVAILABLE, input.type);
  }
  // Nor can it pull the other trip's items into its own, or put its own into the other trip.
  for (const input of [
    { type: "homeItem.save", id: own.homeItem, tripId, name: "Moved", price: "", notes: "", completed: false },
    { type: "destination.save", id: own.lisbon, stopId: lisbon, notes: "Moved" },
    { type: "destination.save", id: lisbon, stopId: own.lisbon, notes: "Moved" },
    { type: "church.save", id: own.church, destinationId: lisbon, name: "Moved", address: "", denomination: "", url: "", massTimes: [] },
    { type: "church.delete", id: own.church, destinationId: lisbon },
    { type: "candidate.save", id: own.hotel, destinationId: lisbon, category: "hotels", name: "Moved", ...idea },
  ]) {
    assert.throws(() => store.applyMutation(outsider, input), ValidationError, input.type);
  }
  assert.deepEqual(store.getSnapshot(), before, "Nothing changed in either trip");

  // Reads that mix its own IDs with the other trip's find nothing of the other trip.
  const mixed = store.getTripSnapshot(outsider, own.tripId, lisbon);
  assert.ok(mixed.data.trips.every((item) => item.id === own.tripId));
  assert.ok(mixed.data.stops.every((item) => item.tripId === own.tripId));
  assert.deepEqual([mixed.data.destinations, mixed.data.candidates, mixed.data.churches], [[], [], []]);
  assert.equal(store.getStopName(outsider, own.tripId, lisbon), undefined);
  assert.ok(store.getDestinationsOverview(outsider).data.destinations.every((item) => item.id !== lisbon && item.id !== trip.porto));
  assert.equal(store.getDestinationPhoto(outsider, own.lisbon, photos.destination), undefined);
  assert.equal(store.getCandidatePhoto(outsider, own.hotel, photos.candidate), undefined);
  assert.equal(store.getChurchPhoto(outsider, own.church, photos.church), undefined);
  assert.deepEqual(readsAs(store, outsider, trip), everything(false));
  assert.deepEqual(readsAs(store, owner, own), everything(false), "Isolation works both ways");
});

test("everyone with a trip sees and changes its tags, and a tag only on trips an account can't open stays hidden from it", (t) => {
  const { store, owner, editor, outsider } = setup(t);
  const trip = plannedTrip(store, owner);
  const ownersOther = plannedTrip(store, owner, "Owner's other trip", ["Faro", "Braga"]);
  const editorsTrip = plannedTrip(store, editor, "Editor's own trip");
  const tag = (accountId, tripId, name) => store.applyMutation(accountId, { type: "trip.tag", tripId, name });
  const untag = (accountId, tripId, name) => store.applyMutation(accountId, { type: "trip.untag", tripId, name });
  const homeTags = (accountId) => store.getHomeOverview(accountId).data.tags;
  const tagsOf = (accountId, tripId) => store.getTripSnapshot(accountId, tripId).data.trips[0].tags;
  tag(owner, trip.tripId, "Europe");
  tag(owner, ownersOther.tripId, "Surprise party");
  tag(editor, editorsTrip.tripId, "Work");
  assert.deepEqual(homeTags(owner), ["Europe", "Surprise party"]);
  assert.deepEqual(homeTags(editor), ["Work"]);

  // Shared, the trip's tags appear in the editor's list and can be reused on the editor's own trip. The owner's other trip's can't.
  store.applyMutation(owner, { type: "trip.share", tripId: trip.tripId, email: "editor@example.com" });
  assert.deepEqual(homeTags(editor), ["Europe", "Work"]);
  assert.deepEqual(store.getHomeOverview(editor).data.trips.find((item) => item.id === trip.tripId).tags, ["Europe"]);
  assert.deepEqual(store.getTripSnapshot(editor, editorsTrip.tripId).data.tags, ["Europe", "Work"]);
  assert.deepEqual(store.getTripSnapshot(editor, trip.tripId).data.tags, ["Europe", "Work"]);
  assert.deepEqual(store.getTripSnapshot(owner, trip.tripId).data.tags, ["Europe", "Surprise party"]);

  // The editor changes the shared trip's tags, and the owner sees the change.
  tag(editor, trip.tripId, "work");
  untag(editor, trip.tripId, "Europe");
  assert.deepEqual(tagsOf(owner, trip.tripId), ["Work"], "the editor's spelling is reused");
  assert.deepEqual(homeTags(owner), ["Surprise party", "Work"]);
  // A spelling on a trip the editor can't open is never used, so it reveals nothing.
  tag(editor, editorsTrip.tripId, "SURPRISE PARTY");
  assert.deepEqual(tagsOf(editor, editorsTrip.tripId), ["SURPRISE PARTY", "Work"]);
  assert.deepEqual(homeTags(owner), ["Surprise party", "Work"], "nor are the editor's own trip's tags shown to the owner");

  // An account without the trip can neither change its tags nor see them.
  const before = store.getSnapshot();
  for (const input of [{ type: "trip.tag", tripId: trip.tripId, name: "Mine" }, { type: "trip.untag", tripId: trip.tripId, name: "Work" }, { type: "trip.tag", tripId: randomUUID(), name: "Mine" }]) {
    assert.throws(() => store.applyMutation(outsider, input), NOT_AVAILABLE, input.type);
  }
  assert.deepEqual(store.getSnapshot(), before);
  assert.deepEqual(homeTags(outsider), []);

  // Once access is removed, the trip's tags are hidden from the editor again and can't be changed.
  store.applyMutation(owner, { type: "trip.unshare", tripId: trip.tripId, email: "editor@example.com" });
  tag(owner, trip.tripId, "Owner only");
  assert.throws(() => untag(editor, trip.tripId, "Work"), NOT_AVAILABLE);
  assert.deepEqual(homeTags(editor), ["SURPRISE PARTY", "Work"]);
  assert.deepEqual(store.getTripSnapshot(editor, editorsTrip.tripId).data.tags, ["SURPRISE PARTY", "Work"]);

  // Deleting the trip deletes its tags, never another trip's.
  store.applyMutation(owner, { type: "trip.delete", id: trip.tripId });
  assert.deepEqual(homeTags(owner), ["Surprise party"]);
  assert.deepEqual(tagsOf(editor, editorsTrip.tripId), ["SURPRISE PARTY", "Work"]);
});

test("removing someone's access ends it at once and changes nothing in the trip", (t) => {
  const { store, owner, editor } = setup(t);
  const trip = plannedTrip(store, owner);
  const editorsTrip = store.applyMutation(editor, { type: "trip.save", ...newItem(), name: "Editor's own trip", dateLabel: "", homeCity: "", travelers: 1, notes: "" }).id;
  store.applyMutation(owner, { type: "trip.share", tripId: trip.tripId, email: "editor@example.com" });
  assert.deepEqual(readsAs(store, editor, trip), everything(true));
  const before = store.getSnapshot();

  assert.deepEqual(store.applyMutation(owner, { type: "trip.unshare", tripId: trip.tripId, email: "Editor@Example.com" }), { id: trip.tripId });
  assert.deepEqual(store.getSnapshot(), before, "Revoking keeps every part of the trip");
  assert.deepEqual(readsAs(store, editor, trip), everything(false));
  assert.throws(() => store.applyMutation(editor, { type: "destination.save", id: trip.lisbon, notes: "Too late" }), NOT_AVAILABLE);
  assert.deepEqual(store.getTripSnapshot(owner, trip.tripId).access.sharedWith, []);
  assert.throws(() => store.applyMutation(owner, { type: "trip.unshare", tripId: trip.tripId, email: "editor@example.com" }), { name: "ValidationError", message: "This trip isn't shared with editor@example.com. Refresh to see who has access." });

  // Their authorization, and their own trips, are untouched.
  assert.equal(store.authorizeGoogleSignIn(google("editor-subject", "editor@example.com")).id, editor);
  assert.deepEqual(store.getHomeOverview(editor).data.trips.map((item) => item.id), [editorsTrip]);
  // Sharing again restores access to the same trip.
  store.applyMutation(owner, { type: "trip.share", tripId: trip.tripId, email: "editor@example.com" });
  assert.deepEqual(readsAs(store, editor, trip), everything(true));
});

test("the database itself keeps every trip owned and every invitation unique", (t) => {
  const path = fileDatabase(t);
  const { store, owner, editor } = setup(t, path);
  const { tripId } = plannedTrip(store, owner);
  store.applyMutation(owner, { type: "trip.share", tripId, email: "editor@example.com" });
  const db = new DatabaseSync(path);
  try {
    assert.throws(() => db.prepare("INSERT INTO trips(id,name,travelers,createdAt) VALUES(?, 'Unowned', 1, 'now')").run(randomUUID()), /Every trip needs an owner/);
    assert.throws(() => db.prepare("UPDATE trips SET ownerId = NULL WHERE id = ?").run(tripId), /Every trip needs an owner/);
    assert.throws(() => db.prepare("INSERT INTO trip_shares(tripId, accountId, sharedAt) VALUES(?, ?, 'now')").run(tripId, editor), /UNIQUE/);
    assert.throws(() => db.prepare("INSERT INTO trips(id,name,travelers,createdAt,ownerId) VALUES(?, 'Nobody', 1, 'now', 'no-such-account')").run(randomUUID()), /FOREIGN KEY/);
  } finally {
    db.close();
  }
});

test("schema 20 gives every existing trip to the designated owner, never to whoever signed in first, keeps all their data, and replays safely", (t) => {
  const path = fileDatabase(t);
  const backup = join(path, "..", "before-sharing.sqlite");
  let store = createStore(path, OWNER);
  // Someone else was authorized and signed in before the designated owner ever did.
  const early = store.authorizeAccount("early@example.com").id;
  store.authorizeGoogleSignIn(google("early-subject", "early@example.com", "Early"));
  store.createSession(early, Date.now());
  const first = plannedTrip(store, early, "First");
  const second = plannedTrip(store, early, "Second", ["Faro", "Braga"]);
  const content = store.getSnapshot();
  store.close();
  let db = new DatabaseSync(path);
  db.exec(UNDO_SCHEMA_21 + UNDO_SCHEMA_20);
  db.close();

  // The pre-upgrade backup is the rollback point.
  const result = spawnSync(process.execPath, ["scripts/backup.mjs", backup], { cwd: process.cwd(), env: { ...process.env, TRAVEL_DATABASE_PATH: path }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);

  store = createStore(path, OWNER);
  const owner = store.authorizeAccount(OWNER).id;
  assert.deepEqual(store.getSnapshot(), content, "Every trip, destination, connection, idea, church, budget input and photo is kept");
  const home = store.getHomeOverview(owner);
  assert.deepEqual(home.data.trips.map((item) => item.name).sort(), ["First", "Second"]);
  assert.ok(Object.values(home.access).every((access) => access.role === "owner" && access.sharedWith.length === 0));
  for (const trip of [first, second]) {
    assert.deepEqual(home.budgets[trip.tripId], calculateBudget(content, trip.tripId));
    assert.deepEqual(readsAs(store, owner, trip), everything(true));
    assert.deepEqual(store.getCandidatePhoto(owner, trip.hotel, trip.photos.candidate).data, webp);
  }
  assert.deepEqual(store.getHomeOverview(early).data.trips, [], "Signing in first gave no ownership");

  // Replays find every trip owned and change nothing, even with a different designated owner configured.
  store.applyMutation(owner, { type: "trip.share", tripId: first.tripId, email: "editor@example.com" });
  const shared = store.getSnapshot();
  store.close();
  for (const designated of [OWNER, "new-owner@example.com"]) {
    db = new DatabaseSync(path);
    db.exec("PRAGMA user_version = 19;");
    db.close();
    store = createStore(path, designated);
    assert.deepEqual(store.getSnapshot(), shared);
    assert.equal(store.getHomeOverview(owner).data.trips.length, 2, designated);
    assert.deepEqual(store.getTripSnapshot(owner, first.tripId).access.sharedWith.map((item) => item.email), ["editor@example.com"]);
    assert.deepEqual(store.getHomeOverview(store.authorizeAccount(designated).id).data.trips.length, designated === OWNER ? 2 : 0, "Ownership never moves");
    store.close();
  }
  db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual(db.prepare("SELECT DISTINCT ownerId FROM trips").all().map((row) => row.ownerId), [owner]);
    assert.deepEqual(db.prepare("SELECT DISTINCT ownerId FROM destinations").all().map((row) => row.ownerId), [owner], "each trip's destinations are its owner's");
    assert.equal(db.prepare("SELECT count(*) AS count FROM trip_shares").get().count, 1);
  } finally {
    db.close();
  }

  // Restoring the backup returns the schema 19 database as it was, and upgrading it again gives the same result.
  db = new DatabaseSync(backup, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
    assert.ok(!db.prepare("PRAGMA table_info(trips)").all().some((column) => column.name === "ownerId"));
    assert.equal(db.prepare("SELECT count(*) AS count FROM trips").get().count, 2);
  } finally {
    db.close();
  }
  const restored = join(path, "..", "restored.sqlite");
  copyFileSync(backup, restored);
  store = createStore(restored, OWNER);
  t.after(() => store.close());
  assert.deepEqual(store.getSnapshot(), content);
  assert.equal(store.getHomeOverview(store.authorizeAccount(OWNER).id).data.trips.length, 2);
});
