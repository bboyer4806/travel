import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as coordinates from "../src/lib/coordinates.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as estimatedTime from "../src/lib/estimated-time.ts";
import * as galleryDraft from "../src/lib/gallery-draft.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import * as money from "../src/lib/money.ts";
import * as photoSizes from "../src/lib/photo-sizes.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripTags from "../src/lib/trip-tags.ts";
import * as types from "../src/lib/types.ts";
import * as uuid from "../src/lib/uuid.ts";
import { aiSetup } from "./ai-fixtures.mjs";
import { addCity, addDestination, candidateInput, fileDatabase, prepared, setup, tripInput } from "./budget-fixtures.mjs";
import { cssRules } from "./css-rules.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

// TRA-170: each activity's estimated time, about how long it takes, typed in whole minutes in the activity's editor and
// shown in hours and minutes in its details and on its card on the Activities page. Hotels and restaurants have none.

const { formatEstimatedTime } = estimatedTime;
const INVALID = "Estimated time must be a whole number of minutes, 1 or more, or left blank.";
const ACTIVITIES_ONLY = "Estimated time is available for activities only.";
const NOT_AVAILABLE = "This item no longer exists or isn't shared with you. Please refresh and try again.";
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
const minutesOf = (store, id) => store.getSnapshot().candidates.find((item) => item.id === id).estimatedMinutes;
/** A snapshot with every idea's estimated time left out, to compare everything else. */
const withoutEstimates = (snapshot) => ({ ...snapshot, candidates: snapshot.candidates.map((item) => ({ ...item, estimatedMinutes: undefined })) });
const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));

test("an activity's estimated time reads in hours and minutes, however long it is (TRA-170)", () => {
  assert.deepEqual([1, 2, 45, 59, 60, 61, 90, 119, 120, 150, 1439, 1440, 1500, 1530, 10080].map(formatEstimatedTime), [
    "1 minute", "2 minutes", "45 minutes", "59 minutes", "1 hour", "1 hour 1 minute", "1 hour 30 minutes", "1 hour 59 minutes", "2 hours",
    "2 hours 30 minutes", "23 hours 59 minutes", "24 hours", "25 hours", "25 hours 30 minutes", "168 hours",
  ]);
});

test("an activity starts without an estimated time unless one is given, saves it, and clearing it removes it (TRA-170)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
    // A page opened before estimated times, ChatGPT and Claude can add an activity without one. A time in its notes stays there.
    const plain = store.applyMutation(candidateInput(id, "activities", { name: "Prater", notes: "Takes about 2 hours" })).id;
    const timed = store.applyMutation(candidateInput(id, "activities", { name: "Schönbrunn Palace", estimatedMinutes: 90 })).id;
    const blank = store.applyMutation(candidateInput(id, "activities", { name: "Naschmarkt", estimatedMinutes: null })).id;
    const all = [plain, timed, blank];
    assert.deepEqual(all.map((item) => minutesOf(store, item)), [null, 90, null]);
    assert.equal(store.getSnapshot().candidates.find((item) => item.id === plain).notes, "Takes about 2 hours", "nothing is read from its notes");
    store.applyMutation(candidateInput(id, "activities", { id: plain, name: "Prater", notes: "Takes about 2 hours", estimatedMinutes: 45 }));
    assert.equal(minutesOf(store, plain), 45, "editing an activity saves its estimated time");
    // The trip's page and the destination's page have it.
    const shown = (candidates) => all.map((item) => candidates.find((candidate) => candidate.id === item).estimatedMinutes);
    assert.deepEqual(shown(store.getTripSnapshot(tripId).data.candidates), [45, 90, null]);
    assert.deepEqual(shown(store.getDestinationSnapshot(id).data.candidates), [45, 90, null]);
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(all.map((item) => minutesOf(store, item)), [45, 90, null], "reopening keeps them");
    store.applyMutation(candidateInput(id, "activities", { id: timed, name: "Schönbrunn Palace", estimatedMinutes: 120 }));
    assert.equal(minutesOf(store, timed), 120, "changing it saves the new one");
    store.applyMutation(candidateInput(id, "activities", { id: timed, name: "Schönbrunn Palace", estimatedMinutes: null }));
    assert.equal(minutesOf(store, timed), null, "clearing it removes it");
    assert.equal(minutesOf(store, plain), 45, "another activity's is its own");
  } finally { store?.close(); }
});

test("changing an activity's estimated time changes nothing else, and saving it without one, or changing anything else, keeps it (TRA-170)", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const links = [{ id: randomUUID(), url: "https://example.com/tour", description: "Booking" }];
  // Everything the activity's editor sends, as saved, except its estimated time.
  const editor = { name: "Walking tour", description: "Guided walk through the old town", price: "45.50", included: true, mustDo: true, address: "Stephansplatz", notes: "Morning\nAbout 2 hours", url: links[0].url, links,
    coordinates: { latitude: 48.20849, longitude: 16.37208, accuracy: "approximate" } };
  const tourId = store.applyMutation(candidateInput(id, "activities", { ...editor, gallery: { add: [{ id: randomUUID(), ...prepared(webp) }], remove: [] } })).id;
  store.applyMutation(candidateInput(id, "activities", { name: "Another", price: "20", included: true }));
  const before = store.getSnapshot();
  const estimate = budget.calculateBudget(before, tripId);
  const { coordinates: saved, ...details } = editor;
  for (const estimatedMinutes of [90, null, 1530]) {
    store.applyMutation(candidateInput(id, "activities", { id: tourId, ...details, estimatedMinutes }));
    assert.equal(minutesOf(store, tourId), estimatedMinutes);
    assert.deepEqual(withoutEstimates(store.getSnapshot()), withoutEstimates(before), "its name, what it is, price, address, coordinates, photos, links, notes, selection, Must do and place in the list are unchanged");
    assert.deepEqual(budget.calculateBudget(store.getSnapshot(), tripId), estimate, "and no budget changes");
  }
  assert.deepEqual(store.getSnapshot().candidates.find((item) => item.id === tourId).coordinates, { ...saved, review: false });
  // A page opened before estimated times, ChatGPT and Claude can save an activity without one, which keeps it. So does every other change.
  for (const edit of [
    candidateInput(id, "activities", { id: tourId, ...details, notes: "Book a day ahead" }),
    candidateInput(id, "activities", { id: tourId, ...details, gallery: { add: [{ id: randomUUID(), ...prepared(webp) }], remove: [] } }),
    { type: "candidate.move", id: tourId, direction: "down" },
    { type: "candidate.mustDo", id: tourId, mustDo: false },
    { type: "candidate.include", id: tourId, included: false },
    { type: "destination.save", id, activitiesBudgetMode: "general", activitiesGeneralAmount: "300" },
  ]) {
    store.applyMutation(edit);
    assert.equal(minutesOf(store, tourId), 1530, JSON.stringify(edit.type));
  }
});

test("an estimated time is a whole number of minutes from 1, with no maximum, and a refused save keeps the saved one (TRA-170)", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const tourId = store.applyMutation(candidateInput(id, "activities", { name: "Walking tour", estimatedMinutes: 90 })).id;
  // Longer than a day, a week, or as long as JavaScript holds whole numbers exactly.
  for (const longest of [1, 1441, 10080, 525600, Number.MAX_SAFE_INTEGER]) {
    store.applyMutation(candidateInput(id, "activities", { id: tourId, name: "Walking tour", estimatedMinutes: longest }));
    assert.equal(minutesOf(store, tourId), longest);
  }
  assert.equal(formatEstimatedTime(4320), "72 hours", "a three-day trek reads in hours");
  store.applyMutation(candidateInput(id, "activities", { id: tourId, name: "Walking tour", estimatedMinutes: 90 }));
  const before = store.getSnapshot();
  for (const value of [0, -1, -90, 1.5, 90.25, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "90", "", "1 hour", true, [], {}]) {
    // Neither a new activity nor a change to a saved one is saved.
    for (const input of [candidateInput(id, "activities", { estimatedMinutes: value }), candidateInput(id, "activities", { id: tourId, name: "Walking tour", estimatedMinutes: value })]) {
      assert.throws(() => store.applyMutation(input), refusal(INVALID), String(value));
      assert.deepEqual(store.getSnapshot(), before);
    }
  }
  // A save refused for any other reason keeps it too.
  for (const [input, message] of [
    [candidateInput(id, "activities", { id: tourId, name: " ", estimatedMinutes: 30 }), "Please enter name."],
    [candidateInput(id, "activities", { id: tourId, name: "Walking tour", price: "-1", estimatedMinutes: 30 }), "Estimated price must be a positive USD amount or zero, with up to 2 decimal places. Leave it blank if unknown."],
    [candidateInput(id, "activities", { id: tourId, name: "Walking tour", estimatedMinutes: 30, gallery: { add: [], remove: [randomUUID()] } }), "A photo has changed or no longer exists. Refresh and try again."],
  ]) {
    assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input.name));
    assert.deepEqual(store.getSnapshot(), before);
  }
});

test("only activities have an estimated time, and the database keeps it a whole number from 1 (TRA-170)", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput()).id;
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const hotelId = store.applyMutation(candidateInput(id, "hotels", { name: "Hotel Sacher" })).id;
  const restaurantId = store.applyMutation(candidateInput(id, "restaurants", { name: "Figlmüller", restaurantTypes: ["lunch"] })).id;
  const activityId = store.applyMutation(candidateInput(id, "activities", { name: "Opera" })).id;
  const before = store.getSnapshot();
  for (const [category, itemId, name] of [["hotels", hotelId, "Hotel Sacher"], ["restaurants", restaurantId, "Figlmüller"]]) {
    for (const input of [candidateInput(id, category, { estimatedMinutes: 60 }), candidateInput(id, category, { id: itemId, name, estimatedMinutes: 60 })]) {
      assert.throws(() => store.applyMutation(input), refusal(ACTIVITIES_ONLY), category);
      assert.deepEqual(store.getSnapshot(), before);
    }
    // None, as an assistant can send, saves it as before.
    store.applyMutation(candidateInput(id, category, { id: itemId, name, estimatedMinutes: null }));
    assert.deepEqual(store.getSnapshot(), before, category);
  }
  const db = new DatabaseSync(path);
  try {
    for (const [itemId, minutes] of [[hotelId, 60], [restaurantId, 60], [activityId, 0], [activityId, -5]]) {
      assert.throws(() => db.prepare("UPDATE candidates SET estimatedMinutes = ? WHERE id = ?").run(minutes, itemId), /CHECK constraint failed/, `${itemId} ${minutes}`);
    }
    db.prepare("UPDATE candidates SET estimatedMinutes = ? WHERE id = ?").run(90, activityId);
  } finally { db.close(); }
  assert.equal(minutesOf(store, activityId), 90);
});

test("everyone a trip is shared with sees an activity's estimated time and can change it, and no one else can (TRA-170)", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  const otherTrip = store.applyMutation(owner, tripInput({ name: "Second visit" })).id;
  const id = addCity((input) => store.applyMutation(owner, input).id, tripId, "Lisbon", { nights: 3 });
  store.applyMutation(owner, { type: "stop.add", tripId: otherTrip, city: "Lisbon" });
  const tourId = store.applyMutation(owner, candidateInput(id, "activities", { name: "Tram 28", estimatedMinutes: 90 })).id;
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const friend = store.authorizeAccount("friend@example.test").id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  const tourIn = (snapshot) => snapshot?.data.candidates.find((item) => item.id === tourId).estimatedMinutes;
  /** The tour's estimated time on the pages the account can open: each trip that visits Lisbon, then the destination's page. */
  const shown = (account, trips) => [...trips.map((trip) => tourIn(store.getTripSnapshot(account, trip))), tourIn(store.getDestinationSnapshot(account, id))];
  assert.deepEqual(shown(owner, [tripId, otherTrip]), [90, 90, 90]);
  assert.deepEqual(shown(friend, [tripId]), [90, 90]);
  assert.deepEqual(shown(outsider, [tripId]), [undefined, undefined], "anyone else can't open it");
  store.applyMutation(friend, candidateInput(id, "activities", { id: tourId, name: "Tram 28", estimatedMinutes: 120 }));
  assert.deepEqual(shown(owner, [tripId, otherTrip]), [120, 120, 120], "changing it from one trip changes it everywhere");
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(outsider, candidateInput(id, "activities", { id: tourId, name: "Tram 28", estimatedMinutes: 30 })), refusal(NOT_AVAILABLE), "nor change it");
  store.applyMutation(owner, { type: "trip.unshare", tripId, email: "friend@example.test" });
  assert.throws(() => store.applyMutation(friend, candidateInput(id, "activities", { id: tourId, name: "Tram 28", estimatedMinutes: 30 })), refusal(NOT_AVAILABLE), "nor can someone it is no longer shared with");
  assert.deepEqual(store.getSnapshot().candidates, before.candidates);
});

test("schema 42 databases upgrade without an estimated time on any activity, and a replay keeps the times saved since (TRA-170)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
    const ideas = Object.fromEntries(["hotels", "activities", "restaurants"].map((category) => [category, store.applyMutation(candidateInput(id, category, {
      name: "Saved " + category, description: "What it is", mustDo: category !== "hotels", notes: "Notes about " + category, ...(category === "restaurants" && { restaurantTypes: ["dinner"] }),
    })).id]));
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE candidates DROP COLUMN estimatedMinutes; PRAGMA user_version = 42;");
    db.close();
    store = createOwnedStore(path);
    assert.ok(store.getSnapshot().candidates.every((item) => item.estimatedMinutes === null), "no activity has an estimated time, so none shows one");
    assert.deepEqual(store.getSnapshot(), saved, "every idea keeps everything saved for it");
    store.applyMutation(candidateInput(id, "activities", { id: ideas.activities, name: "Saved activities", description: "What it is", mustDo: true, notes: "Notes about activities", estimatedMinutes: 90 }));
    const later = store.getSnapshot();
    assert.equal(minutesOf(store, ideas.activities), 90);
    // A replay of schema 43, also after the schema 1 build resets the schema version, keeps it.
    for (const version of [42, 1]) {
      store.close(); store = null;
      const replay = new DatabaseSync(path);
      replay.exec(`PRAGMA user_version = ${version};`);
      replay.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps the saved estimated time`);
    }
    store.close(); store = null;
    const observer = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      const column = observer.prepare("PRAGMA table_info(candidates)").all().find((info) => info.name === "estimatedMinutes");
      assert.deepEqual({ type: column.type, notnull: column.notnull, dflt_value: column.dflt_value }, { type: "INTEGER", notnull: 0, dflt_value: null });
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude read an activity's estimated time and propose it, previewed in minutes, and approving saves it (TRA-170)", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  const destinationId = store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Vienna" }).id;
  const tourId = randomUUID();
  const save = (overrides) => ({ type: "candidate.save", id: tourId, destinationId, category: "activities", name: "Walking tour", price: "", address: "", url: "", notes: "", included: false, ...overrides });
  /** The activity's Estimated time field in a proposal's preview, or undefined when the proposal doesn't change it. */
  const previewed = (proposal) => proposal.preview[0].records.find((record) => record.record.endsWith("activity “Walking tour”"))?.fields.find((field) => field.name === "Estimated time (minutes)");
  const minutesNow = () => store.aiDestination(destinationId).ideas.find((item) => item.id === tourId)?.estimatedMinutes;

  const added = propose([save({ create: true, estimatedMinutes: 90 })]);
  assert.deepEqual(previewed(added), { name: "Estimated time (minutes)", before: null, after: "90" });
  assert.equal(minutesNow(), undefined, "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.equal(minutesNow(), 90, "assistants read it with the activity's other details");
  assert.equal(store.aiTrip(ownerTrip).ideas.find((item) => item.id === tourId).estimatedMinutes, 90);

  const noted = propose([save({ notes: "Meet at the cathedral" })]);
  assert.equal(previewed(noted), undefined, "a change without it keeps it, so the preview leaves it out");
  assert.equal(decide(noted, true).status, "applied");
  assert.equal(minutesNow(), 90);

  const longer = propose([save({ estimatedMinutes: 1530 })]);
  assert.deepEqual(previewed(longer), { name: "Estimated time (minutes)", before: "90", after: "1530" });
  assert.equal(decide(longer, false).status, "rejected");
  assert.equal(minutesNow(), 90, "a rejected proposal changes nothing");

  const cleared = propose([save({ estimatedMinutes: null })]);
  assert.deepEqual(previewed(cleared), { name: "Estimated time (minutes)", before: "90", after: null });
  assert.equal(decide(cleared, true).status, "applied");
  assert.equal(minutesNow(), null);

  const before = store.getSnapshot();
  assert.throws(() => propose([save({ estimatedMinutes: 0 })]), refusal(`Change 1: ${INVALID}`));
  const hotel = { type: "candidate.save", id: randomUUID(), create: true, destinationId, category: "hotels", name: "Hotel Sacher", price: "", address: "", url: "", notes: "", included: false, estimatedMinutes: 60 };
  assert.throws(() => propose([hotel]), refusal(`Change 1: ${ACTIVITIES_ONLY}`));
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "candidate.save");
  assert.deepEqual([schema.properties.estimatedMinutes.type, schema.properties.estimatedMinutes.minimum, schema.properties.estimatedMinutes.maximum], [["integer", "null"], 1, undefined], "whole minutes from 1, with no maximum");
  assert.ok(!schema.required.includes("estimatedMinutes"), "left out, it is kept");
});

// The actual components, given the modules they import. Any other module's exports render, and return, nothing.
function load(file, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}
const element = (type, props) => ({ type, props });
const icons = new Proxy({}, { get: (_, name) => "icon:" + String(name) });
const unused = new Proxy({}, { get: () => () => null });
const libraries = { "@/lib/budget": budget, "@/lib/coordinates": coordinates, "@/lib/destination-label": destinationLabel, "@/lib/estimated-time": estimatedTime, "@/lib/gallery-draft": galleryDraft, "@/lib/money": money, "@/lib/photo-sizes": photoSizes, "@/lib/trip-dates": tripDates, "@/lib/trip-tags": tripTags, "@/lib/types": types, "@/lib/uuid": uuid };
/** A require for components rendered once, with each hook's initial state. A CSS module's class names are their own names. */
function stateless(name) {
  if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
  const modules = { "react": { useId: () => "id", useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }), useEffect: () => {} }, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" }, "lucide-react": icons, ...libraries };
  return modules[name] ?? unused;
}
const { IdeaDetails } = load("../src/components/destination-ideas.tsx", stateless);
const CandidateList = load("../src/components/candidate-list.tsx", stateless).default;

/** The host elements an element renders to, with every component rendered. */
function hosts(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (typeof node.type === "function") return hosts(node.type(node.props));
  return [node, ...hosts(node.props.children)];
}
/** An element's text, including what only screen readers read. */
function text(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(typeof node.type === "function" ? node.type(node.props) : node.props.children);
}
/** An element's text as the page shows it, without what only screen readers read. */
function shownText(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(shownText).join("");
  if (typeof node.type === "function") return shownText(node.type(node.props));
  return String(node.props.className ?? "").split(" ").includes("sr-only") ? "" : shownText(node.props.children);
}

/** A trip's Vienna with an activity estimated at an hour and a half, one without an estimate, and a hotel. */
function vienna(t) {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const save = (category, name, overrides) => store.applyMutation(candidateInput(id, category, { name, price: "", included: false, ...overrides })).id;
  const ideas = {
    palace: save("activities", "Schönbrunn Palace", { price: "80", address: "Schönbrunner Schloßstraße 47", notes: "Book the Grand Tour", estimatedMinutes: 90 }),
    opera: save("activities", "Opera", { price: "260", address: "Opernring 2" }),
    hotel: save("hotels", "Hotel Sacher", { price: "980" }),
  };
  return { store, tripId, id, ideas };
}

test("an activity's details show its estimated time after its price, and an idea without one shows no row or placeholder for it (TRA-170)", (t) => {
  const { store, ideas } = vienna(t);
  const details = (itemId) => hosts({ type: IdeaDetails, props: { item: store.getSnapshot().candidates.find((item) => item.id === itemId) } })
    .filter((node) => node.type === "div").map((row) => [text(row.props.children[0]), text(row.props.children[1])]);
  assert.deepEqual(details(ideas.palace).slice(0, 4).map(([name, value]) => [name, name === "Estimated price (USD)" ? value.slice(0, 3) : value]),
    [["What it is", "Not added"], ["Estimated price (USD)", "$80"], ["Estimated time", "1 hour 30 minutes"], ["Address or neighborhood", "Schönbrunner Schloßstraße 47"]], "in its editor's order");
  const names = ["What it is", "Estimated price (USD)", "Address or neighborhood", "Coordinates"];
  assert.deepEqual(details(ideas.opera).slice(0, 4).map(([name]) => name), names, "an activity without one has no row for it");
  assert.deepEqual(details(ideas.hotel).slice(0, 4).map(([name]) => name), names, "nor has a hotel");
  assert.ok(!details(ideas.opera).some(([, value]) => value.includes("minute")));
  // More than a day reads in hours.
  store.applyMutation(candidateInput(store.getSnapshot().candidates.find((item) => item.id === ideas.opera).destinationId, "activities", { id: ideas.opera, name: "Opera", price: "260", address: "Opernring 2", included: false, estimatedMinutes: 1530 }));
  assert.deepEqual(details(ideas.opera).find(([name]) => name === "Estimated time"), ["Estimated time", "25 hours 30 minutes"]);
});

test("the Activities page shows each activity's estimated time on its card, after a clock, and nothing for one without (TRA-170)", (t) => {
  const { store, id } = vienna(t);
  const snapshot = store.getSnapshot();
  const list = (category) => hosts({ type: CandidateList, props: { items: snapshot.candidates.filter((item) => item.category === category), category, destination: snapshot.destinations.find((item) => item.id === id), busy: false, onEdit() {}, onDelete() {}, onMutate() {} } });
  const cards = Object.fromEntries(list("activities").filter((node) => node.type === "article").map((card) => {
    const lines = hosts(card).filter((node) => node.type === "p").map((line) => [line.props.className, shownText(line)]);
    const time = hosts(card).find((node) => node.props.className === "idea-time");
    return [card.props["aria-label"], { lines, time: time && { icon: time.props.children[0].type, read: text(time) } }];
  }));
  assert.deepEqual(cards["Schönbrunn Palace"].lines, [["idea-time", "1 hour 30 minutes"], ["idea-address", "Schönbrunner Schloßstraße 47"], ["idea-notes", "Book the Grand Tour"]], "below Must do, above its address");
  assert.deepEqual(cards["Schönbrunn Palace"].time, { icon: "icon:Clock", read: "Estimated time: 1 hour 30 minutes" }, "screen readers hear what it is");
  assert.deepEqual(cards.Opera, { lines: [["idea-address", "Opernring 2"]], time: undefined }, "no line, label or placeholder without one");
  assert.ok(!list("hotels").some((node) => node.props.className === "idea-time"), "a hotel's card has none");
});

test("an activity's estimated time is a further detail on its card, styled as its address is (TRA-170)", () => {
  const rules = cssRules("../src/app/globals.css");
  /** The declarations each rule naming `selector`, alone or in a list, gives at any screen width. */
  const declarations = (selector) => rules.filter(([selectors]) => selectors.split(",").map((part) => part.trim()).includes(selector)).map(([, values, atRule]) => [atRule, values]);
  assert.deepEqual(declarations(".idea-time"), declarations(".idea-address"), "the same rules, at every width");
  assert.deepEqual(declarations(".idea-time svg"), declarations(".idea-address svg"));
  const [[atRule, line]] = declarations(".idea-time");
  assert.equal(atRule, null);
  assert.deepEqual([line.color, line["font-size"], line.display, line["overflow-wrap"]], ["var(--muted)", "13px", "flex", "anywhere"], "muted, 13px, and it wraps on phones");
});

// A destination's Activities and Hotels pages, rendered by the planner from what the store gives
// `/destinations/<destination ID>/<category>`, as its page does, with a small hook harness that keeps state between
// renders, as React does. No browser or server is involved.
/** A submitted form's fields, as the planner reads them from the form's elements. */
class FormData {
  constructor(form) { this.fields = form.fields; }
  get(name) { return name in this.fields ? this.fields[name] : null; }
  has(name) { return name in this.fields; }
  getAll(name) { return name in this.fields ? [this.fields[name]] : []; }
}
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text. */
const rendered = (node) => typeof node === "string" ? node : node.props.children.map(rendered).join("");

function ideasPage(store, destinationId, category) {
  const slots = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(current) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current };
      return slots[index];
    },
    useId: () => "id-" + cursor++,
    // A transition finishes at once, and effects, which run only in a browser, don't run.
    useTransition: () => [false, (work) => work()],
    useEffect: () => {},
  };
  const sent = [];
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" }, "lucide-react": icons,
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), unstable_isUnrecognizedActionError: () => false },
    // The page's save, made by the store as the signed-in owner, which keeps each change sent.
    "@/app/actions": { mutatePlanner: async (mutation) => { sent.push({ ...mutation }); return { ok: true, ...store.applyMutation(mutation) }; } },
    "@/components/candidate-list": { default: CandidateList },
    ...libraries,
  };
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", (name) => modules[name] ?? unused, { FormData });
  function render(node) {
    if (Array.isArray(node)) return [...node].flatMap(render);
    if (node === null || node === undefined || typeof node === "boolean") return [];
    if (typeof node !== "object") return [String(node)];
    if (typeof node.type === "function") return render(node.type(node.props));
    if (node.type === "fragment") return render(node.props.children);
    return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
  }
  let props;
  let shown;
  /** The page as it renders now. It renders twice, as React renders again at once when the page changes its state while rendering. */
  const show = () => { for (let pass = 0; pass < 2; pass++) { cursor = 0; shown = render(PlannerApp(props)); } };
  /** Loads the page again, as it does after a save. */
  const reload = () => { const { data, access } = store.getDestinationSnapshot(destinationId); props = { initialData: data, destinationAccess: { [destinationId]: access }, destinationId, category }; show(); };
  reload();
  const all = () => shown.flatMap(within);
  return {
    sent,
    all,
    /** Each idea's card on the page by its name: its estimated time's line, or undefined without one. */
    times: () => Object.fromEntries(all().filter((node) => node.type === "article" && node.props.className.startsWith("idea-card")).map((card) => [card.props["aria-label"], within(card).find((node) => node.props.className === "idea-time")])),
    button: (label) => all().find((node) => node.type === "button" && (node.props["aria-label"] === label || rendered(node) === label)),
    /** The open editor's fields, in order, each as its label and its control. */
    fields: () => within(all().find((node) => node.type === "form")).filter((node) => node.type === "label" && node.props.className?.startsWith("field"))
      .map((label) => [rendered(label.props.children[0]), label.props.children[1]]),
    click(button) { button.props.onClick({ currentTarget: button }); show(); },
    /** Submits the open editor with `fields`, waits for its save, and loads the page again. */
    async submit(fields) {
      all().find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { fields } });
      await new Promise((resolve) => setImmediate(resolve));
      reload();
    },
  };
}

test("an activity's editor has Estimated time (minutes) below its price, and saving sends what is typed, so clearing it removes it (TRA-170)", async (t) => {
  const { store, id, ideas } = vienna(t);
  const page = ideasPage(store, id, "activities");
  page.click(page.button("Edit Schönbrunn Palace"));
  assert.deepEqual(page.fields().slice(0, 4).map(([label]) => label), ["Name", "What it is", "Estimated price (USD)", "Estimated time (minutes)"]);
  const field = () => page.fields().find(([label]) => label === "Estimated time (minutes)")[1];
  const { type, name, min, step, max, required, defaultValue, inputMode } = field().props;
  assert.deepEqual([field().type, type, name, min, step, max, required, defaultValue, inputMode], ["input", "number", "estimatedMinutes", "1", "1", undefined, undefined, 90, "numeric"],
    "optional whole minutes from 1, with no maximum, opening with the saved time");
  const details = { name: "Schönbrunn Palace", description: "", price: "80", address: "Schönbrunner Schloßstraße 47", notes: "Book the Grand Tour" };
  await page.submit({ ...details, estimatedMinutes: "150" });
  assert.deepEqual([page.sent.at(-1).type, page.sent.at(-1).id, page.sent.at(-1).estimatedMinutes], ["candidate.save", ideas.palace, 150], "sent as a number");
  assert.equal(minutesOf(store, ideas.palace), 150);
  assert.equal(shownText(page.times()["Schönbrunn Palace"]), "2 hours 30 minutes", "its card shows the saved time");
  page.click(page.button("Edit Schönbrunn Palace"));
  assert.equal(field().props.defaultValue, 150, "the editor opens with it");
  await page.submit({ ...details, estimatedMinutes: "" });
  assert.equal(page.sent.at(-1).estimatedMinutes, null, "cleared, it is sent as none");
  assert.deepEqual([minutesOf(store, ideas.palace), page.times()["Schönbrunn Palace"]], [null, undefined], "and its card shows no time");
  assert.equal(store.getSnapshot().candidates.find((item) => item.id === ideas.palace).notes, "Book the Grand Tour");
  // A new activity's editor starts without one.
  page.click(page.button("Add activity"));
  assert.equal(field().props.defaultValue, undefined);
  await page.submit({ name: "Belvedere", description: "", price: "", address: "", notes: "", estimatedMinutes: "45" });
  const belvedere = store.getSnapshot().candidates.find((item) => item.name === "Belvedere");
  assert.deepEqual([page.sent.at(-1).create, belvedere.estimatedMinutes, shownText(page.times().Belvedere)], [true, 45, "45 minutes"]);
});

test("a hotel's and a restaurant's editors have no estimated time, and their saves send none (TRA-170)", async (t) => {
  const { store, id, ideas } = vienna(t);
  const restaurant = store.applyMutation(candidateInput(id, "restaurants", { name: "Figlmüller", price: "", included: false })).id;
  for (const [category, itemName, itemId] of [["hotels", "Hotel Sacher", ideas.hotel], ["restaurants", "Figlmüller", restaurant]]) {
    const page = ideasPage(store, id, category);
    page.click(page.button("Edit " + itemName));
    assert.ok(page.fields().length > 2 && !page.fields().some(([label]) => label.startsWith("Estimated time")), category);
    await page.submit({ name: itemName, description: "", price: "120", address: "", notes: "" });
    assert.deepEqual([page.sent.at(-1).id, "estimatedMinutes" in page.sent.at(-1), minutesOf(store, itemId)], [itemId, false, null]);
  }
});
