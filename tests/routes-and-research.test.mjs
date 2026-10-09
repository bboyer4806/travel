import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createStore, ValidationError } from "../src/lib/store.ts";
import { calculateBudget } from "../src/lib/budget.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Europe", dateLabel: "Fall 2027", homeCity: "New York", travelers: 2, notes: "A possible trip", ...overrides });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Vienna", stay: "4 nights", notes: "", ...overrides });
const legInput = (id, overrides = {}) => ({ type: "leg.save", id, method: "Flight", price: "100.01", departure: "Morning", arrival: "Evening", url: "https://example.com/flights", notes: "Two passengers", ...overrides });
const candidateInput = (destinationId, overrides = {}) => ({ type: "candidate.save", destinationId, category: "hotels", name: "Hotel idea", price: "200.33", address: "", url: "https://example.com/hotel", notes: "", included: true, ...overrides });
const stopInput = (overrides = {}) => ({ id: randomUUID(), kind: "layover", place: "London Heathrow", arrival: "10:30", departure: "13:15", notes: "Change terminals", ...overrides });
const linkInput = (overrides = {}) => ({ id: randomUUID(), url: "https://example.com/research", description: "A useful option", ...overrides });
const legsFor = (store, tripId) => store.getSnapshot().legs.filter((leg) => leg.tripId === tripId);
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  return { store, tripId: store.applyMutation(tripInput()).id };
}
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-route-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}
function legacyDatabase(path, version) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE trips (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, dateLabel TEXT NOT NULL DEFAULT '',
      homeCity TEXT NOT NULL DEFAULT '', travelers INTEGER NOT NULL CHECK(travelers BETWEEN 1 AND 999),
      notes TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL
    ) STRICT;
    CREATE TABLE destinations (
      id TEXT PRIMARY KEY, tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      city TEXT NOT NULL, stay TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL CHECK(position >= 0)
    ) STRICT;
    CREATE TABLE legs (
      id TEXT PRIMARY KEY, tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      fromId TEXT REFERENCES destinations(id) ON DELETE CASCADE,
      toId TEXT REFERENCES destinations(id) ON DELETE CASCADE,
      method TEXT NOT NULL DEFAULT '', priceCents INTEGER CHECK(priceCents BETWEEN 0 AND 10000000000),
      departure TEXT NOT NULL DEFAULT '', arrival TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      CHECK(fromId IS NOT NULL OR toId IS NOT NULL), CHECK(fromId IS NULL OR toId IS NULL OR fromId != toId)
    ) STRICT;
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY, destinationId TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('hotels', 'activities', 'restaurants')),
      name TEXT NOT NULL, priceCents INTEGER CHECK(priceCents BETWEEN 0 AND 10000000000),
      address TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      included INTEGER NOT NULL DEFAULT 0 CHECK(included IN (0,1))
    ) STRICT;
    PRAGMA user_version = 1;
  `);
  const tripId = randomUUID();
  const destinationId = randomUUID();
  const outboundId = randomUUID();
  db.prepare("INSERT INTO trips VALUES (?,?,?,?,?,?,?)").run(tripId, "Existing trip", "Fall 2027", "Wooster, Ohio", 3, "Keep my notes", "2026-10-01T12:00:00.000Z");
  db.prepare("INSERT INTO destinations VALUES (?,?,?,?,?,?)").run(destinationId, tripId, "Vienna", "5 nights", "Walkable hotel", 0);
  db.prepare("INSERT INTO legs VALUES (?,?,?,?,?,?,?,?,?,?)").run(outboundId, tripId, null, destinationId, "Flight", 120050, "October 1", "October 2", "https://example.com/outbound", "Checked bag included");
  db.prepare("INSERT INTO legs VALUES (?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), tripId, destinationId, null, "Train and flight", null, "October 7", "October 8", "", "Research later");
  db.prepare("INSERT INTO candidates VALUES (?,?,?,?,?,?,?,?,?)").run(randomUUID(), destinationId, "hotels", "Existing hotel", 90000, "Downtown", "https://example.com/hotel", "Breakfast", 1);
  const before = {
    trips: db.prepare("SELECT * FROM trips").all().map((row) => ({ ...row, returnCity: version === 2 ? "Boston" : null })),
    destinations: db.prepare("SELECT * FROM destinations").all().map((row) => ({ ...row })),
    legs: db.prepare("SELECT * FROM legs ORDER BY fromId IS NOT NULL").all().map((row) => ({ ...row, itinerary: [] })),
    candidates: db.prepare("SELECT * FROM candidates").all().map((row) => ({ ...row, included: row.included === 1 })),
  };
  if (version === 2) {
    const itinerary = [stopInput()];
    db.exec("ALTER TABLE trips ADD COLUMN returnCity TEXT; ALTER TABLE legs ADD COLUMN itineraryJson TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 2;");
    db.prepare("UPDATE trips SET returnCity = ? WHERE id = ?").run("Boston", tripId);
    db.prepare("UPDATE legs SET itineraryJson = ? WHERE id = ?").run(JSON.stringify(itinerary), outboundId);
    before.legs[0].itinerary = itinerary;
  }
  db.close();
  return before;
}

for (const version of [1, 2]) {
  test(`version ${version} upgrade preserves all data and migrates research links exactly once`, (t) => {
    const path = fileDatabase(t);
    const before = legacyDatabase(path, version);
    let store = createStore(path);
    try {
      const after = store.getSnapshot();
      const withoutLinks = (item) => { const fields = { ...item }; delete fields.links; return fields; };
      assert.deepEqual({ ...after, legs: after.legs.map(withoutLinks), candidates: after.candidates.map(withoutLinks) }, before);
      for (const item of [...after.legs, ...after.candidates]) {
        assert.equal(item.links.length, item.url ? 1 : 0);
        if (item.url) {
          assert.equal(item.links[0].url, item.url);
          assert.equal(item.links[0].description, "");
          assert.match(item.links[0].id, /^[0-9a-f-]{36}$/);
        }
        assert.equal("linksJson" in item, false);
        assert.equal("itineraryJson" in item, false);
      }
      store.close();
      store = createStore(path);
      assert.deepEqual(store.getSnapshot(), after, "reopening preserves migrated link IDs and never duplicates data");
      const observer = new DatabaseSync(path);
      try {
        assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 3);
        assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
      } finally {
        observer.close();
      }
    } finally {
      store.close();
    }
  });
}

test("a future database version is rejected without modifying its schema", (t) => {
  const path = fileDatabase(t);
  let db = new DatabaseSync(path);
  db.exec("PRAGMA user_version = 99");
  db.close();
  assert.throws(() => createStore(path), /newer version/);
  db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 99);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'").get().count, 0);
  } finally {
    db.close();
  }
});

test("return and departing city edits clear only connections whose effective endpoint changes", (t) => {
  const { store, tripId } = setup(t);
  store.applyMutation(destinationInput(tripId));
  store.applyMutation(destinationInput(tripId, { city: "Paris" }));
  const route = legsFor(store, tripId);
  const itinerary = [stopInput()];
  const links = [linkInput()];
  const fill = () => route.forEach((leg) => store.applyMutation(legInput(leg.id, { itinerary, links })));
  const assertCleared = (leg) => {
    assert.equal(leg.method, "");
    assert.equal(leg.priceCents, null);
    assert.equal(leg.notes, "");
    assert.equal(leg.url, "");
    assert.deepEqual(leg.itinerary, []);
    assert.deepEqual(leg.links, []);
  };
  assert.equal(store.getSnapshot().trips[0].returnCity, null);
  fill();
  let before = legsFor(store, tripId);
  store.applyMutation(tripInput({ id: tripId, returnCity: "Boston" }));
  let after = legsFor(store, tripId);
  assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
  assertCleared(after[2]);
  assert.deepEqual(after.map((leg) => leg.id), route.map((leg) => leg.id));
  fill();
  before = legsFor(store, tripId);
  store.applyMutation(tripInput({ id: tripId, homeCity: "Chicago" }));
  after = legsFor(store, tripId);
  assert.equal(store.getSnapshot().trips[0].returnCity, "Boston", "old callers preserve an explicit return city");
  assertCleared(after[0]);
  assert.deepEqual(after.slice(1), before.slice(1));
  fill();
  before = legsFor(store, tripId);
  store.applyMutation(tripInput({ id: tripId, homeCity: "Chicago", returnCity: "Chicago" }));
  after = legsFor(store, tripId);
  assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
  assertCleared(after[2]);
  fill();
  before = legsFor(store, tripId);
  store.applyMutation(tripInput({ id: tripId, homeCity: "Chicago", returnCity: null }));
  assert.deepEqual(legsFor(store, tripId), before, "same effective return endpoint preserves the connection");
  store.applyMutation(tripInput({ id: tripId, homeCity: "Chicago", returnCity: "Chicago" }));
  assert.deepEqual(legsFor(store, tripId), before);
  store.applyMutation(tripInput({ id: tripId, homeCity: "Chicago", returnCity: null }));
  store.applyMutation(tripInput({ id: tripId, homeCity: "Seattle" }));
  after = legsFor(store, tripId);
  assertCleared(after[0]);
  assert.deepEqual(after[1], before[1]);
  assertCleared(after[2]);
});

test("return cities, ordered itineraries, and multiple links survive edits and database restarts", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ returnCity: "Boston" })).id;
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
    const leg = legsFor(store, tripId)[0];
    assert.deepEqual(leg.itinerary, []);
    const layover = stopInput();
    const stop = stopInput({ kind: "stop", place: "Windsor Castle", notes: "Allow time to return to the airport" });
    const links = [linkInput({ description: "Flight comparison" }), linkInput({ url: "https://example.com/castle", description: "Castle visiting hours" })];
    store.applyMutation(legInput(leg.id, { price: "555.55", itinerary: [layover, stop], links }));
    const candidateId = store.applyMutation(candidateInput(destinationId, { links })).id;
    assert.deepEqual(legsFor(store, tripId)[0].itinerary, [layover, stop]);
    assert.equal(calculateBudget(store.getSnapshot(), tripId).travelCents, 55555, "the connection price is counted once, regardless of stop or link count");
    const edited = { ...stop, place: "Windsor town centre", arrival: "11:00", departure: "12:00" };
    store.applyMutation(legInput(leg.id, { itinerary: [edited, layover], links: [...links].reverse() }));
    assert.deepEqual(legsFor(store, tripId)[0].itinerary, [edited, layover]);
    assert.deepEqual(legsFor(store, tripId)[0].links, [...links].reverse());
    store.applyMutation(legInput(leg.id, { url: links[1].url, notes: "Old client notes edit" }));
    assert.deepEqual(legsFor(store, tripId)[0].itinerary, [edited, layover]);
    assert.deepEqual(legsFor(store, tripId)[0].links, [...links].reverse());
    store.applyMutation(legInput(leg.id, { itinerary: [edited], links: [links[1]] }));
    const hotelLinks = [{ ...links[1], description: "Updated description" }, links[0]];
    store.applyMutation(candidateInput(destinationId, { id: candidateId, links: hotelLinks }));
    assert.deepEqual(store.getSnapshot().candidates[0].links, hotelLinks);
    const before = store.getSnapshot();
    store.close();
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.equal(store.getSnapshot().trips[0].returnCity, "Boston");
    store.applyMutation(legInput(leg.id, { itinerary: [], links: [] }));
    assert.deepEqual(legsFor(store, tripId)[0].itinerary, []);
    assert.deepEqual(legsFor(store, tripId)[0].links, []);
    assert.equal(legsFor(store, tripId)[0].url, "");
    store.applyMutation(candidateInput(destinationId, { id: candidateId, links: [] }));
    assert.deepEqual(store.getSnapshot().candidates[0].links, []);
    assert.equal(store.getSnapshot().candidates[0].url, "");
    store.applyMutation(legInput(leg.id, { itinerary: [edited], links }));
    store.applyMutation({ type: "leg.clear", id: leg.id });
    assert.deepEqual(legsFor(store, tripId)[0].itinerary, []);
    assert.deepEqual(legsFor(store, tripId)[0].links, []);
    assert.equal(legsFor(store, tripId)[0].priceCents, null);
  } finally {
    store.close();
  }
});

test("destination route changes preserve unaffected itineraries and links and clear obsolete ones", (t) => {
  const { store, tripId } = setup(t);
  store.applyMutation(destinationInput(tripId));
  const b = store.applyMutation(destinationInput(tripId, { city: "Paris" })).id;
  const c = store.applyMutation(destinationInput(tripId, { city: "London" })).id;
  for (const leg of legsFor(store, tripId)) store.applyMutation(legInput(leg.id, { itinerary: [stopInput()], links: [linkInput()] }));
  let before = legsFor(store, tripId);
  store.applyMutation(destinationInput(tripId, { id: b, city: "Lyon" }));
  let after = legsFor(store, tripId);
  assert.deepEqual(after[0], before[0]);
  assert.deepEqual(after[1].itinerary, []);
  assert.deepEqual(after[1].links, []);
  assert.deepEqual(after[2].itinerary, []);
  assert.deepEqual(after[2].links, []);
  assert.deepEqual(after[3], before[3]);
  for (const leg of after) store.applyMutation(legInput(leg.id, { itinerary: [stopInput()], links: [linkInput()] }));
  before = legsFor(store, tripId);
  store.applyMutation({ type: "destination.move", id: c, direction: "up" });
  after = legsFor(store, tripId);
  assert.deepEqual(after[0], before[0]);
  assert.ok(after.slice(1).every((leg) => leg.itinerary.length === 0 && leg.links.length === 0));
  store.applyMutation({ type: "destination.delete", id: c });
  assert.deepEqual(legsFor(store, tripId)[0], before[0]);
  assert.equal(legsFor(store, tripId).length, 3);
});

for (const kind of ["leg", "candidate"]) {
  test(`legacy ${kind} URL edits preserve other research links and descriptions`, (t) => {
    const { store, tripId } = setup(t);
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
    const id = kind === "leg" ? legsFor(store, tripId)[0].id : store.applyMutation(candidateInput(destinationId)).id;
    const input = (overrides = {}) => kind === "leg" ? legInput(id, overrides) : candidateInput(destinationId, { id, ...overrides });
    const item = () => kind === "leg" ? legsFor(store, tripId)[0] : store.getSnapshot().candidates[0];
    store.applyMutation(input());
    assert.equal(item().links.length, 1, "a legacy URL creates a research link");
    assert.equal(item().links[0].url, item().url);
    const links = [linkInput(), linkInput({ url: "https://example.com/second", description: "Second source" })];
    store.applyMutation(input({ links }));
    store.applyMutation(input({ url: links[0].url }));
    assert.deepEqual(item().links, links);
    store.applyMutation(input({ url: "https://example.com/replaced" }));
    assert.deepEqual(item().links, [{ ...links[0], url: "https://example.com/replaced" }, links[1]]);
    store.applyMutation(input({ url: "" }));
    assert.deepEqual(item().links, [links[1]]);
    assert.equal(item().url, links[1].url);
    store.applyMutation(input({ links: [] }));
    assert.deepEqual(item().links, []);
    assert.equal(item().url, "");
  });
}

test("return city and itinerary validation rejects malformed input atomically and accepts field limits", (t) => {
  const { store, tripId } = setup(t);
  store.applyMutation(destinationInput(tripId));
  const leg = legsFor(store, tripId)[0];
  const stop = stopInput();
  store.applyMutation(legInput(leg.id, { itinerary: [stop] }));
  const before = store.getSnapshot();
  const invalidStops = [
    null, [], "London", { ...stop, id: "bad" }, { ...stop, kind: "flight" },
    { ...stop, place: " " }, { ...stop, place: 123 }, { ...stop, place: "a".repeat(161) },
    { ...stop, arrival: "a".repeat(121) }, { ...stop, departure: "a".repeat(121) },
    { ...stop, notes: "a".repeat(2001) }, { ...stop, departure: null },
  ];
  const invalidInputs = [
    ...["", " ", 1, false, {}, "x".repeat(121)].map((returnCity) => tripInput({ id: tripId, returnCity })),
    ...invalidStops.map((item) => legInput(leg.id, { itinerary: [item] })),
    ...[null, {}, "London", Array.from({ length: 31 }, () => stopInput()), [stop, { ...stop, id: stop.id.toUpperCase() }]].map((itinerary) => legInput(leg.id, { itinerary })),
  ];
  for (const input of invalidInputs) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  store.applyMutation(tripInput({ id: tripId, returnCity: "x".repeat(120) }));
  const stops = Array.from({ length: 30 }, () => stopInput({ place: "p".repeat(160), arrival: "a".repeat(120), departure: "d".repeat(120), notes: "n".repeat(2000) }));
  store.applyMutation(legInput(leg.id, { itinerary: stops }));
  assert.deepEqual(legsFor(store, tripId)[0].itinerary, stops);
  store.applyMutation(legInput(leg.id, { itinerary: [stopInput({ place: "  London  ", notes: "  Check in  " })] }));
  assert.equal(legsFor(store, tripId)[0].itinerary[0].place, "London");
  assert.equal(legsFor(store, tripId)[0].itinerary[0].notes, "Check in");
});

test("research link validation rejects invalid URLs and malformed arrays before making any changes", (t) => {
  const { store, tripId } = setup(t);
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  const legId = legsFor(store, tripId)[0].id;
  store.applyMutation(candidateInput(destinationId));
  const link = linkInput();
  const before = store.getSnapshot();
  const invalidLinks = [
    null, [], "website", { ...link, id: "bad" }, { ...link, description: 12 }, { ...link, description: "d".repeat(161) },
    ...["", " ", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com", "https://user:secret@example.com", "https://example.com/" + "a".repeat(2048)].map((url) => ({ ...link, url })),
  ];
  const arrays = [null, {}, "website", [link, { ...link, id: link.id.toUpperCase() }], Array.from({ length: 21 }, () => linkInput()), ...invalidLinks.map((item) => [item])];
  for (const links of arrays) {
    for (const input of [legInput(legId, { links }), candidateInput(destinationId, { name: "Would deselect existing hotel", links })]) {
      assert.throws(() => store.applyMutation(input), ValidationError);
      assert.deepEqual(store.getSnapshot(), before);
    }
  }
  const links = Array.from({ length: 20 }, () => linkInput({ description: "d".repeat(160) }));
  store.applyMutation(legInput(legId, { links }));
  assert.deepEqual(legsFor(store, tripId)[0].links, links);
  const withoutDescription = { id: randomUUID(), url: "  https://example.com  " };
  store.applyMutation(candidateInput(destinationId, { links: [withoutDescription] }));
  assert.deepEqual(store.getSnapshot().candidates.find((candidate) => candidate.included).links, [{ ...withoutDescription, url: "https://example.com/", description: "" }]);
});

test("URL-only writes during deployment remain visible with stable IDs and preserve later research links", (t) => {
  const path = fileDatabase(t);
  const store = createStore(path);
  const legacy = new DatabaseSync(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
    const legId = legsFor(store, tripId)[0].id;
    const candidateId = randomUUID();
    legacy.prepare("UPDATE legs SET url = ? WHERE id = ?").run("https://example.com/late-flight", legId);
    legacy.prepare("INSERT INTO candidates(id,destinationId,category,name,url) VALUES(?,?,?,?,?)").run(candidateId, destinationId, "hotels", "Legacy hotel", "https://example.com/late-hotel");
    for (const kind of ["leg", "candidate"]) {
      const id = kind === "leg" ? legId : candidateId;
      const table = kind === "leg" ? "legs" : "candidates";
      const item = () => kind === "leg" ? legsFor(store, tripId)[0] : store.getSnapshot().candidates.find((candidate) => candidate.id === id);
      const save = (overrides) => store.applyMutation(kind === "leg" ? legInput(id, overrides) : candidateInput(destinationId, { id, ...overrides }));
      const first = item().links[0];
      assert.equal(first.id, id, "the existing row UUID supplies a stable fallback link ID");
      assert.equal(first.url, item().url);
      assert.deepEqual(item().links[0], first);
      save({ url: first.url });
      assert.deepEqual(item().links[0], first, "editing an old record materializes its fallback link without changing identity");
      const second = linkInput({ description: "Keep this extra source" });
      save({ links: [first, second] });
      legacy.prepare(`UPDATE ${table} SET url = ? WHERE id = ?`).run("https://example.com/older-client-change", id);
      assert.deepEqual(item().links, [{ ...first, url: "https://example.com/older-client-change" }, second]);
      legacy.prepare(`UPDATE ${table} SET url = '' WHERE id = ?`).run(id);
      assert.deepEqual(item().links, [second]);
      assert.equal(item().url, second.url);
      save({ url: second.url });
      assert.deepEqual(item().links, [second]);
    }
  } finally {
    legacy.close();
    store.close();
  }
});

test("redeployment preserves new fields when an older app reset the schema version marker", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ returnCity: "Boston" })).id;
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
    const legId = legsFor(store, tripId)[0].id;
    const links = [linkInput(), linkInput({ url: "https://example.com/second", description: "Second option" })];
    store.applyMutation(legInput(legId, { itinerary: [stopInput(), stopInput({ kind: "stop", place: "Windsor Castle" })], links }));
    store.applyMutation(candidateInput(destinationId, { links: [...links].reverse() }));
    const before = store.getSnapshot();
    store.close();
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec("PRAGMA user_version = 1;");
    } finally {
      legacy.close();
    }
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before, "schema recovery retains every stop, description, return city, and stable link ID");
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 3);
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      observer.close();
    }
  } finally {
    store.close();
  }
});
