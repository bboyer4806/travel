import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "../src/lib/store.ts";
import { newItem } from "./budget-fixtures.mjs";

// TRA-162: Access lists every trip and destination an account can open, with its owner and who else can open it, from
// the store's own sharing rules: its owner sees everyone, and anyone else only the owner and themselves.
const OWNER = "owner@example.com";

/**
 * The designated owner's trips, Portugal (Lisbon and Porto) shared with Eddie and Fran and Lisbon weekend shared with
 * Eddie and Gina, a trip of the owner's alone, a destination in no trip, and Gina's Kyoto trip shared with the owner and
 * Cole. Fran has never signed in, so has no name. Nothing is shared with Oscar.
 */
function setup(t) {
  const store = createStore(":memory:", OWNER);
  t.after(() => store.close());
  const signIn = (email, name) => store.authorizeGoogleSignIn({ subject: "subject-" + email, email, emailVerified: true, name });
  store.authorizeAccount(OWNER);
  const accounts = { owner: signIn(OWNER, "Olivia Owner") };
  for (const [key, email, name] of [["eddie", "eddie@example.com", "Eddie Editor"], ["gina", "gina@example.com", "Gina Guest"], ["cole", "cole@example.com", "Cole Colleague"], ["oscar", "oscar@example.com", "Oscar Outsider"]]) {
    store.authorizeAccount(email);
    accounts[key] = signIn(email, name);
  }
  const as = (account) => (input) => store.applyMutation(account.id, input).id;
  const owner = as(accounts.owner), gina = as(accounts.gina);
  const trip = (save, name) => save({ type: "trip.save", ...newItem(), name, dateLabel: "", homeCity: "", travelers: 2, notes: "" });
  const ids = {};
  ids.portugal = trip(owner, "Portugal");
  ids.lisbon = owner({ type: "stop.add", tripId: ids.portugal, city: "Lisbon" });
  ids.porto = owner({ type: "stop.add", tripId: ids.portugal, city: "Porto" });
  ids.weekend = trip(owner, "Lisbon weekend");
  ids.weekendLisbon = owner({ type: "stop.add", tripId: ids.weekend, city: "Lisbon" });
  ids.alone = trip(owner, "alone at home");
  ids.vienna = owner({ type: "destination.create", city: "Vienna" });
  for (const [tripId, email] of [[ids.portugal, "eddie@example.com"], [ids.portugal, "fran@example.com"], [ids.weekend, "gina@example.com"], [ids.weekend, "eddie@example.com"]]) owner({ type: "trip.share", tripId, email });
  accounts.fran = store.authorizeAccount("fran@example.com");
  ids.kyotoTrip = trip(gina, "Kyoto in autumn");
  ids.kyoto = gina({ type: "stop.add", tripId: ids.kyotoTrip, city: "Kyoto" });
  for (const email of [OWNER, "cole@example.com"]) gina({ type: "trip.share", tripId: ids.kyotoTrip, email });
  return { store, accounts, ids };
}

/** What Access shows `account`, with each row's people as emails, for comparing at a glance. */
function shown(store, account) {
  const { trips, destinations } = store.getAccessOverview(account.id);
  const row = ({ role, owner, sharedWith }) => ({ role, owner: owner.email, sharedWith: sharedWith.map((member) => member.email) });
  return { trips: trips.map((trip) => [trip.name, row(trip)]), destinations: destinations.map((destination) => [destination.city, row(destination)]) };
}

test("an owner sees everyone who can open each of their trips and destinations, a destination once however many trips open it", (t) => {
  const { store, accounts } = setup(t);
  assert.deepEqual(shown(store, accounts.owner), {
    // Alphabetical, ignoring letter case.
    trips: [
      ["alone at home", { role: "owner", owner: OWNER, sharedWith: [] }],
      ["Kyoto in autumn", { role: "editor", owner: "gina@example.com", sharedWith: [OWNER] }],
      ["Lisbon weekend", { role: "owner", owner: OWNER, sharedWith: ["eddie@example.com", "gina@example.com"] }],
      ["Portugal", { role: "owner", owner: OWNER, sharedWith: ["eddie@example.com", "fran@example.com"] }],
    ],
    destinations: [
      // Gina's, through her trip shared with the owner: only Gina sees who else it opens to.
      ["Kyoto", { role: "editor", owner: "gina@example.com", sharedWith: [OWNER] }],
      // Open through Portugal and Lisbon weekend: Eddie, on both, is listed once.
      ["Lisbon", { role: "owner", owner: OWNER, sharedWith: ["eddie@example.com", "fran@example.com", "gina@example.com"] }],
      ["Porto", { role: "owner", owner: OWNER, sharedWith: ["eddie@example.com", "fran@example.com"] }],
      // In no trip, so open to its owner alone.
      ["Vienna", { role: "owner", owner: OWNER, sharedWith: [] }],
    ],
  });
  // Each person is named as Google named them at sign-in, or by email alone until they first sign in.
  const portugal = store.getAccessOverview(accounts.owner.id).trips.find((trip) => trip.name === "Portugal");
  assert.deepEqual([portugal.owner, ...portugal.sharedWith], [{ email: OWNER, name: "Olivia Owner" }, { email: "eddie@example.com", name: "Eddie Editor" }, { email: "fran@example.com", name: null }]);
});

test("someone a trip is shared with sees its owner and themselves, never who else it or its destinations are shared with", (t) => {
  const { store, accounts } = setup(t);
  assert.deepEqual(shown(store, accounts.eddie), {
    trips: [
      ["Lisbon weekend", { role: "editor", owner: OWNER, sharedWith: ["eddie@example.com"] }],
      ["Portugal", { role: "editor", owner: OWNER, sharedWith: ["eddie@example.com"] }],
    ],
    // Lisbon opens to Eddie through both trips, and is listed once.
    destinations: [
      ["Lisbon", { role: "editor", owner: OWNER, sharedWith: ["eddie@example.com"] }],
      ["Porto", { role: "editor", owner: OWNER, sharedWith: ["eddie@example.com"] }],
    ],
  });
  assert.deepEqual(shown(store, accounts.gina), {
    trips: [
      ["Kyoto in autumn", { role: "owner", owner: "gina@example.com", sharedWith: ["cole@example.com", OWNER] }],
      ["Lisbon weekend", { role: "editor", owner: OWNER, sharedWith: ["gina@example.com"] }],
    ],
    destinations: [
      ["Kyoto", { role: "owner", owner: "gina@example.com", sharedWith: ["cole@example.com", OWNER] }],
      // Not Porto, which only Portugal visits.
      ["Lisbon", { role: "editor", owner: OWNER, sharedWith: ["gina@example.com"] }],
    ],
  });
  // Nothing is shared with Oscar, who sees nothing, and nobody's account ID or Google subject reaches a page.
  assert.deepEqual(store.getAccessOverview(accounts.oscar.id), { trips: [], destinations: [] });
  for (const account of Object.values(accounts)) {
    const overview = JSON.stringify(store.getAccessOverview(account.id));
    for (const other of Object.values(accounts)) assert.ok(!overview.includes(other.id) && !overview.includes("subject-"), "no account ID or subject");
  }
});

test("every row is a trip or destination the account can open, and lists only people who can open it, all of them for its owner", (t) => {
  const { store, accounts } = setup(t);
  const everyone = Object.values(accounts);
  const byEmail = new Map(everyone.map((account) => [account.email, account]));
  const opens = {
    trips: (account, id) => store.getTripSnapshot(account.id, id) !== undefined,
    destinations: (account, id) => store.getDestinationSnapshot(account.id, id) !== undefined,
  };
  for (const account of everyone) {
    const overview = store.getAccessOverview(account.id);
    // The same trips and destinations as All trips and Destinations list for the account.
    assert.deepEqual(overview.trips.map((trip) => trip.id).sort(), store.getHomeOverview(account.id).data.trips.map((trip) => trip.id).sort());
    assert.deepEqual(overview.destinations.map((destination) => destination.id).sort(), store.getDestinationsOverview(account.id).data.destinations.map((destination) => destination.id).sort());
    for (const kind of ["trips", "destinations"]) {
      for (const row of overview[kind]) {
        const people = [row.owner, ...row.sharedWith].map((member) => member.email);
        assert.equal(new Set(people).size, people.length, "each person once");
        assert.ok(people.every((email) => opens[kind](byEmail.get(email), row.id)), "everyone listed can open it");
        const withAccess = everyone.filter((other) => opens[kind](other, row.id)).map((other) => other.email);
        if (row.role === "owner") assert.deepEqual(people.toSorted(), withAccess.toSorted(), "its owner sees everyone who can open it");
        else assert.deepEqual(people, [row.owner.email, account.email], "anyone else sees its owner and themselves");
      }
    }
  }
});

test("Access follows sharing as it changes: removed access and removed stays leave it, and names appear once people sign in", (t) => {
  const { store, accounts, ids } = setup(t);
  const owner = (input) => store.applyMutation(accounts.owner.id, input);
  const sharedWith = (account, kind, name) => store.getAccessOverview(account.id)[kind].find((row) => (row.name ?? row.city) === name)?.sharedWith.map((member) => member.email);

  // Fran, never signed in, is listed by email alone, then with her Google name once she signs in.
  assert.deepEqual(store.getAccessOverview(accounts.owner.id).trips.find((trip) => trip.name === "Portugal").sharedWith[1], { email: "fran@example.com", name: null });
  store.authorizeGoogleSignIn({ subject: "subject-fran", email: "fran@example.com", emailVerified: true, name: "Fran First" });
  assert.deepEqual(store.getAccessOverview(accounts.owner.id).trips.find((trip) => trip.name === "Portugal").sharedWith[1], { email: "fran@example.com", name: "Fran First" });

  // Removing Fran from Portugal ends her access to it and to the destinations only it opened to her.
  owner({ type: "trip.unshare", tripId: ids.portugal, email: "fran@example.com" });
  assert.deepEqual(sharedWith(accounts.owner, "trips", "Portugal"), ["eddie@example.com"]);
  assert.deepEqual(sharedWith(accounts.owner, "destinations", "Lisbon"), ["eddie@example.com", "gina@example.com"]);
  assert.deepEqual(sharedWith(accounts.owner, "destinations", "Porto"), ["eddie@example.com"]);
  assert.deepEqual(store.getAccessOverview(accounts.fran.id), { trips: [], destinations: [] });

  // Removing Eddie from Lisbon weekend leaves him Lisbon through Portugal.
  owner({ type: "trip.unshare", tripId: ids.weekend, email: "eddie@example.com" });
  assert.deepEqual(sharedWith(accounts.owner, "destinations", "Lisbon"), ["eddie@example.com", "gina@example.com"]);
  assert.deepEqual(shown(store, accounts.eddie).destinations.map(([city]) => city), ["Lisbon", "Porto"]);

  // Lisbon leaving Lisbon weekend ends Gina's access to it, though she keeps the trip.
  owner({ type: "stop.remove", id: ids.weekendLisbon });
  assert.deepEqual(sharedWith(accounts.owner, "destinations", "Lisbon"), ["eddie@example.com"]);
  assert.deepEqual(shown(store, accounts.gina).trips.map(([name]) => name), ["Kyoto in autumn", "Lisbon weekend"]);
  assert.deepEqual(shown(store, accounts.gina).destinations.map(([city]) => city), ["Kyoto"]);

  // Deleting Portugal takes it from everyone's Access, and its destinations stay their owner's alone.
  owner({ type: "trip.delete", id: ids.portugal });
  assert.deepEqual(shown(store, accounts.eddie), { trips: [], destinations: [] });
  assert.deepEqual(shown(store, accounts.owner).destinations.filter(([city]) => city !== "Kyoto").map(([city, row]) => [city, row.sharedWith]), [["Lisbon", []], ["Porto", []], ["Vienna", []]]);
});
