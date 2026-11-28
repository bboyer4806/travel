import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { calculateBudget } from "../src/lib/budget.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import * as transportation from "../src/lib/transportation-methods.ts";
import { aiSetup } from "./ai-fixtures.mjs";
import { addCity, addDestination, destinationEdit, fileDatabase, setup, stopEdit, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

// TRA-147: a flight's airline and flight number, entered by hand on its connection, shown while its transportation names
// an airplane, and kept when it doesn't.

const NOT_AVAILABLE = "This item no longer exists or isn't shared with you. Please refresh and try again.";
const tooLong = (field) => `${field} must be 120 characters or fewer.`;
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
/** A connection's save, with everything its editor sends but its airline and flight number, unless `overrides` give them. */
const legSave = (id, overrides = {}) => ({ type: "leg.save", id, method: "Flight", price: "450", miscAmount: "", departure: "May 3, 9:00", arrival: "May 3, 22:15", url: "", notes: "Aisle seats", ...overrides });
const legsOf = (store, tripId) => store.getSnapshot().legs.filter((leg) => leg.tripId === tripId);
/** A connection's airline and flight number. */
const flightOf = (store, legId) => { const leg = store.getSnapshot().legs.find((item) => item.id === legId); return [leg.airline, leg.flightNumber]; };
/** A snapshot with every airline and flight number left out, to compare everything else. */
const withoutFlights = (snapshot) => ({ ...snapshot, legs: snapshot.legs.map((leg) => ({ ...leg, airline: null, flightNumber: null })) });

test("a connection names an airplane exactly when its transportation shows the airplane icon", () => {
  for (const method of ["Flight", "flights", "Plane", "AIRPLANE", "fly", "Air France", "Jet", "Train and flight", "Rental car, then a flight"]) {
    assert.equal(transportation.isFlight(method), true, method);
  }
  for (const method of ["", "   ", "Train", "Rental car", "Ferry", "Bus", "Airbnb", "Delta", "Fairway", "Flightless bird"]) {
    assert.equal(transportation.isFlight(method), false, method);
  }
});

test("a connection starts without an airline or flight number, saves them as typed, and clearing either removes it", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    addDestination(store, tripId, { city: "Vienna", nights: 3 });
    addDestination(store, tripId, { city: "Rome", nights: 2 });
    const [outbound, between, home] = legsOf(store, tripId).map((leg) => leg.id);
    assert.ok(legsOf(store, tripId).every((leg) => leg.airline === "" && leg.flightNumber === ""), "a new connection has neither");
    // Each connection keeps its own: both, one or the other.
    store.applyMutation(legSave(outbound, { airline: "  Austrian Airlines ", flightNumber: " OS 88 " }));
    store.applyMutation(legSave(between, { airline: "ITA Airways", flightNumber: "" }));
    store.applyMutation(legSave(home, { airline: "", flightNumber: "DL 413" }));
    const expected = [["Austrian Airlines", "OS 88"], ["ITA Airways", ""], ["", "DL 413"]];
    assert.deepEqual([outbound, between, home].map((id) => flightOf(store, id)), expected, "saved as typed, without the spaces around them");
    assert.deepEqual(store.getTripSnapshot(tripId).data.legs.map((leg) => [leg.airline, leg.flightNumber]), expected, "the trip's page has them");
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual([outbound, between, home].map((id) => flightOf(store, id)), expected, "reopening keeps them");
    store.applyMutation(legSave(outbound, { airline: "Lufthansa", flightNumber: "LH 1234" }));
    assert.deepEqual(flightOf(store, outbound), ["Lufthansa", "LH 1234"], "saving new ones replaces them");
    for (const cleared of ["", "   ", "\t\n"]) {
      store.applyMutation(legSave(outbound, { airline: "Lufthansa", flightNumber: "LH 1234" }));
      store.applyMutation(legSave(outbound, { airline: cleared, flightNumber: cleared }));
      assert.deepEqual(flightOf(store, outbound), ["", ""], `clearing them with ${JSON.stringify(cleared)} removes them`);
    }
    assert.deepEqual([between, home].map((id) => flightOf(store, id)), expected.slice(1), "other connections keep their own");
  } finally { store?.close(); }
});

test("changing a flight's airline and flight number changes nothing else, and every other change keeps them", (t) => {
  const { store, tripId } = setup(t);
  const vienna = addDestination(store, tripId, { city: "Vienna", nights: 3, hotelNightlyAmount: "180" });
  const [outbound, home] = legsOf(store, tripId).map((leg) => leg.id);
  const links = [{ id: randomUUID(), url: "https://example.com/booking", description: "Booking" }];
  const layover = { id: randomUUID(), kind: "layover", place: "Frankfurt (FRA)", arrival: "7:05", departure: "9:40", notes: "Change terminals" };
  // Everything the connection's editor sends, as saved, but its airline and flight number.
  const editor = { method: "Flight", price: "1200.50", miscAmount: "80", departure: "May 3, 18:30", arrival: "May 4, 11:55", url: links[0].url, links, notes: "Seats 23A and 23B", itinerary: [layover] };
  store.applyMutation(legSave(outbound, editor));
  store.applyMutation(legSave(home, { method: "Train", price: "90", airline: "Not a flight", flightNumber: "ICE 21" }));
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId);
  for (const [airline, flightNumber] of [["Lufthansa", "LH 1234"], ["", "LH 1234"], ["Austrian Airlines", ""], ["", ""], ["Lufthansa", "LH 1234"]]) {
    store.applyMutation(legSave(outbound, { ...editor, airline, flightNumber }));
    assert.deepEqual(flightOf(store, outbound), [airline, flightNumber]);
    assert.deepEqual(withoutFlights(store.getSnapshot()), withoutFlights(before), "its transportation, price, spending, times, links, notes, itinerary, and every other connection and destination are unchanged");
    assert.deepEqual(flightOf(store, home), ["Not a flight", "ICE 21"], "another connection keeps its own");
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget, "the estimate is unchanged");
  }
  // A page opened before them, ChatGPT and Claude can save a connection without them, which keeps them. Changing its
  // transportation away from a flight keeps them, whether a save sends them, as the editor does while they're hidden,
  // or not. So does every other change to the trip that keeps the connection.
  for (const edit of [
    legSave(outbound, { ...editor, notes: "Seats 23A and 23B, by the window" }),
    legSave(outbound, { ...editor, method: "Train" }),
    legSave(outbound, { ...editor, method: "Overnight train", airline: "Lufthansa", flightNumber: "LH 1234" }),
    legSave(outbound, editor),
    { type: "leg.layoverPlan", id: outbound, layoverId: layover.id, plan: { timeZone: "Europe/Berlin", arrival: "2027-05-04T07:05", departure: "2027-05-04T09:40", immigrationMinutes: 0, customsMinutes: 0, securityMinutes: 30, transferMinutes: 15, boardingMinutes: 30, returnMinutes: null, activities: [] } },
    stopEdit(vienna, { nights: 5 }),
    destinationEdit(vienna, { notes: "Opera tickets" }),
    tripInput({ id: tripId, name: "Renamed", startDate: "2027-05-03" }),
    { type: "stop.add", tripId, city: "Salzburg" },
  ]) {
    store.applyMutation(edit);
    assert.deepEqual(flightOf(store, outbound), ["Lufthansa", "LH 1234"], JSON.stringify(edit));
  }
  assert.equal(legsOf(store, tripId).some((leg) => leg.id === home), false, "adding a city replaced the connection home, and its new connections have neither");
  assert.ok(legsOf(store, tripId).filter((leg) => leg.id !== outbound).every((leg) => leg.airline === "" && leg.flightNumber === ""));
});

test("an airline and a flight number have at most 120 characters each, and a refused save keeps the saved ones", (t) => {
  const { store, tripId } = setup(t);
  addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const [outbound] = legsOf(store, tripId).map((leg) => leg.id);
  const longest = "Ä".repeat(120);
  store.applyMutation(legSave(outbound, { airline: ` ${longest} `, flightNumber: `${longest}\n` }));
  assert.deepEqual(flightOf(store, outbound), [longest, longest], "spaces around them don't count");
  store.applyMutation(legSave(outbound, { airline: "Delta", flightNumber: "DL 413" }));
  const before = store.getSnapshot();
  for (const [field, value, message] of [
    ["airline", "Ä".repeat(121), tooLong("airline")], ["flightNumber", "1".repeat(121), tooLong("flightNumber")],
    ["airline", 42, "airline must be text."], ["flightNumber", null, "flightNumber must be text."], ["airline", ["Delta"], "airline must be text."],
  ]) {
    const input = legSave(outbound, { airline: "Not saved", flightNumber: "Not saved", [field]: value });
    assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input));
    assert.deepEqual(store.getSnapshot(), before);
  }
  // A save refused for any other reason keeps them too.
  for (const [input, message] of [
    [legSave(outbound, { airline: "Not saved", flightNumber: "Not saved", method: "M".repeat(121) }), tooLong("method")],
    [legSave(outbound, { airline: "Not saved", flightNumber: "Not saved", url: "ftp://example.com/booking" }), "Enter a website link starting with https:// or http://."],
    [legSave(randomUUID(), { airline: "Not saved", flightNumber: "Not saved" }), NOT_AVAILABLE],
  ]) {
    assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input));
    assert.deepEqual(store.getSnapshot(), before);
  }
});

test("Clear, and a route or city change that clears a connection, clear its airline and flight number", (t) => {
  const { store, tripId } = setup(t);
  const vienna = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const [outbound, home] = legsOf(store, tripId).map((leg) => leg.id);
  const fill = () => [outbound, home].forEach((id) => store.applyMutation(legSave(id, { airline: "Lufthansa", flightNumber: "LH 1234" })));
  fill();
  store.applyMutation({ type: "leg.clear", id: outbound });
  assert.deepEqual(flightOf(store, outbound), ["", ""], "Clear clears them with the rest of the travel plan");
  assert.deepEqual(flightOf(store, home), ["Lufthansa", "LH 1234"], "clearing one connection keeps the others'");
  fill();
  // The trip still returns to Boston, so only the connection from the departing city changes.
  store.applyMutation(tripInput({ id: tripId, homeCity: "Chicago", returnCity: "Boston" }));
  assert.deepEqual([outbound, home].map((id) => flightOf(store, id)), [["", ""], ["Lufthansa", "LH 1234"]], "a new departing city clears the connection from it");
  fill();
  store.applyMutation(destinationEdit(vienna, { city: "Salzburg" }));
  assert.deepEqual([outbound, home].map((id) => flightOf(store, id)), [["", ""], ["", ""]], "a new city clears the connections to and from it");
});

test("a trip's airlines and flight numbers are for everyone it is shared with, and no one else", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const friend = store.authorizeAccount("friend@example.test").id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  addCity((input) => store.applyMutation(owner, input).id, tripId, "Lisbon", { nights: 3 });
  const [outbound] = store.getTripSnapshot(owner, tripId).data.legs.map((leg) => leg.id);
  store.applyMutation(owner, legSave(outbound, { airline: "TAP Air Portugal", flightNumber: "TP 218" }));
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const shown = (account) => store.getTripSnapshot(account, tripId).data.legs.map((leg) => [leg.airline, leg.flightNumber])[0];
  assert.deepEqual(shown(friend), ["TAP Air Portugal", "TP 218"], "someone it is shared with sees them");
  store.applyMutation(friend, legSave(outbound, { airline: "United", flightNumber: "UA 64" }));
  assert.deepEqual(shown(owner), ["United", "UA 64"], "and changes them for everyone");
  const before = store.getSnapshot();
  assert.equal(store.getTripSnapshot(outsider, tripId), undefined, "anyone else can't see them");
  assert.throws(() => store.applyMutation(outsider, legSave(outbound, { airline: "Not saved", flightNumber: "Not saved" })), refusal(NOT_AVAILABLE), "anyone else can't change them");
  store.applyMutation(owner, { type: "trip.unshare", tripId, email: "friend@example.test" });
  assert.throws(() => store.applyMutation(friend, legSave(outbound, { airline: "Not saved", flightNumber: "Not saved" })), refusal(NOT_AVAILABLE), "nor can someone it is no longer shared with");
  assert.deepEqual(store.getSnapshot().legs, before.legs);
});

test("schema 40 databases upgrade without any airline or flight number, and a replay keeps what was saved since", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    addDestination(store, tripId, { city: "Vienna", nights: 3 });
    const [outbound, home] = legsOf(store, tripId).map((leg) => leg.id);
    store.applyMutation(legSave(outbound, { method: "Flight", price: "980", miscAmount: "40", notes: "Booked", links: [{ id: randomUUID(), url: "https://example.com/booking", description: "" }], itinerary: [{ id: randomUUID(), kind: "layover", place: "Frankfurt (FRA)", arrival: "", departure: "", notes: "" }] }));
    store.applyMutation(legSave(home, { method: "Train", price: "" }));
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE legs DROP COLUMN flightNumber; ALTER TABLE legs DROP COLUMN airline; PRAGMA user_version = 40;");
    db.close();
    store = createOwnedStore(path);
    assert.ok(store.getSnapshot().legs.every((leg) => leg.airline === "" && leg.flightNumber === ""), "no connection has either");
    assert.deepEqual(store.getSnapshot(), saved, "every connection keeps everything saved for it");
    store.applyMutation(legSave(outbound, { method: "Flight", price: "980", miscAmount: "40", notes: "Booked", airline: "Lufthansa", flightNumber: "LH 425" }));
    const later = store.getSnapshot();
    assert.deepEqual(flightOf(store, outbound), ["Lufthansa", "LH 425"]);
    // A replay of schema 41, also after the schema 1 build resets the schema version, keeps them.
    for (const version of [40, 1]) {
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
      const columns = observer.prepare("PRAGMA table_info(legs)").all().filter((info) => ["airline", "flightNumber"].includes(info.name));
      assert.deepEqual(columns.map(({ name, type, notnull, dflt_value }) => ({ name, type, notnull, dflt_value })), [
        { name: "airline", type: "TEXT", notnull: 1, dflt_value: "''" }, { name: "flightNumber", type: "TEXT", notnull: 1, dflt_value: "''" },
      ]);
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude read a connection's airline and flight number and propose them, previewed as Airline and Flight number", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Vienna" });
  const legId = store.getSnapshot().legs.find((leg) => leg.tripId === ownerTrip && leg.fromId === null).id;
  const save = (overrides) => ({ type: "leg.save", id: legId, method: "Flight", price: "500", departure: "", arrival: "", url: "", notes: "", ...overrides });
  const record = (proposal) => proposal.preview[0].records.find((item) => item.record.includes(": travel from the departing city"));
  /** The connection's fields with these names in a proposal's preview, each undefined when the proposal doesn't change it. */
  const previewed = (proposal, ...names) => names.map((name) => record(proposal)?.fields.find((field) => field.name === name));
  const readNow = () => { const leg = store.aiTrip(ownerTrip).travel.find((item) => item.id === legId); return [leg.airline, leg.flightNumber]; };

  const added = propose([save({ airline: "Austrian Airlines", flightNumber: "OS 88" })]);
  assert.deepEqual(previewed(added, "Airline", "Flight number"), [{ name: "Airline", before: null, after: "Austrian Airlines" }, { name: "Flight number", before: null, after: "OS 88" }]);
  assert.deepEqual(readNow(), ["", ""], "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.deepEqual(readNow(), ["Austrian Airlines", "OS 88"], "assistants read them with the connection");

  const renoted = propose([save({ notes: "Window seats" })]);
  assert.deepEqual(previewed(renoted, "Airline", "Flight number"), [undefined, undefined], "a change without them keeps them, so the preview leaves them out");
  assert.equal(decide(renoted, true).status, "applied");
  assert.deepEqual(readNow(), ["Austrian Airlines", "OS 88"]);

  const cleared = propose([save({ notes: "Window seats", airline: "", flightNumber: "OS 87" })]);
  assert.deepEqual(previewed(cleared, "Airline", "Flight number"), [{ name: "Airline", before: "Austrian Airlines", after: null }, { name: "Flight number", before: "OS 88", after: "OS 87" }]);
  assert.equal(decide(cleared, true).status, "applied");
  assert.deepEqual(readNow(), ["", "OS 87"]);

  const before = store.getSnapshot();
  assert.throws(() => propose([save({ airline: "A".repeat(121) })]), refusal(`Change 1: ${tooLong("airline")}`));
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "leg.save");
  assert.deepEqual([schema.properties.airline.maxLength, schema.properties.flightNumber.maxLength], [120, 120], "assistants are told the limits");
  assert.ok(!schema.required.includes("airline") && !schema.required.includes("flightNumber"), "left out, they are kept");
  assert.match(schema.description, /only while its method names an airplane/);
});

// The editor's fields and the card's details, run with a small hook harness that keeps state between renders, as React
// does. No browser is involved.
const element = (type, props, key) => ({ type, props, key });
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node === null || node === undefined || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props.children);

function load(state) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/connection-flight.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require(name) {
      if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      const modules = {
        react: { useState(initial) { const index = state.cursor++; if (!(index in state.hooks)) state.hooks[index] = initial; return [state.hooks[index], (value) => { state.hooks[index] = value; }]; } },
        "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
        "@/lib/transportation-methods": transportation,
      };
      if (!(name in modules)) throw new Error("Unexpected component import: " + name);
      return modules[name];
    },
  });
  return exports;
}

/**
 * The editor's Transportation field and the flight's fields for a saved connection, rendered again after each change.
 * The connection's editor holds what Transportation says, as it does for its layovers (TRA-184), whose editor is a
 * stand-in here.
 */
function editor(leg) {
  const { TransportationFields } = load({ hooks: [], cursor: 0 });
  const layovers = element("layovers-editor", {});
  let method = leg.method;
  let tree;
  const render = () => { tree = TransportationFields({ leg, method, onMethodChange: (value) => { method = value; }, layovers }); };
  render();
  const input = (name) => nodes(tree).find((node) => node.type === "input" && node.props.name === name);
  /** The element that hides the flight's fields, around all of them. */
  const flight = () => nodes(tree).find((node) => node.type === "div" && "hidden" in node.props);
  return {
    input,
    flight,
    /** Whether Airline and Flight number show. */
    shown: () => !flight().props.hidden,
    /** Whether the flight's layovers show, inside the flight's section, below Airline and Flight number. */
    layovers: () => nodes(flight()).includes(layovers),
    /** What Transportation's hint says. */
    hint: () => text(nodes(tree).find((node) => node.type === "small")),
    /** Types into Transportation, as its change event sets it. */
    type(value) { input("method").props.onChange({ target: { value } }); render(); },
  };
}

test("the editor shows Airline and Flight number below Transportation only while it names an airplane, keeping what they hold", () => {
  const form = editor({ method: "Flight", airline: "Delta", flightNumber: "DL 413" });
  assert.equal(form.input("method").props.value, "Flight");
  assert.equal(form.shown(), true, "a saved flight shows them");
  assert.deepEqual(["airline", "flightNumber"].map((name) => form.input(name).props.defaultValue), ["Delta", "DL 413"], "with what was saved");
  assert.deepEqual(nodes(form.flight()).filter((node) => node.type === "label").map((label) => text(label.props.children[0])), ["Airline", "Flight number"]);
  for (const name of ["method", "airline", "flightNumber"]) {
    const { maxLength, required, disabled } = form.input(name).props;
    assert.deepEqual({ maxLength, required, disabled }, { maxLength: 120, required: undefined, disabled: undefined }, `${name} is optional, up to 120 characters`);
  }
  for (const [method, shown] of [["Train", false], ["", false], ["Delta", false], ["Train and flight", true], ["Rental car", false], ["plane", true]]) {
    form.type(method);
    assert.equal(form.input("method").props.value, method, "Transportation shows what was typed");
    assert.equal(form.shown(), shown, `${JSON.stringify(method)} ${shown ? "shows" : "hides"} them`);
    // Hidden, they stay in the form with what they hold, so saving sends them and keeps them.
    assert.deepEqual(["airline", "flightNumber"].map((name) => form.input(name).props.defaultValue), ["Delta", "DL 413"]);
    // The flight's layovers show with them, and not at all while they're hidden: the connection's editor then shows
    // them under Stops along the way (TRA-184).
    assert.equal(form.layovers(), shown, `${JSON.stringify(method)} ${shown ? "shows" : "hides"} the flight's layovers`);
  }
  assert.deepEqual([...form.flight().props.children].map((child) => child && (child.type === "div" ? child.props.className : child.type)), ["form-grid", "layovers-editor"], "the layovers come below Airline and Flight number");
  assert.equal(form.hint(), "Name a flight, such as Flight or Plane, to add its airline and flight number, with its layovers below them.");
  const train = editor({ method: "Train", airline: "", flightNumber: "" });
  assert.equal(train.shown(), false, "a connection that isn't a flight hides them");
  assert.equal(train.layovers(), false);
  train.type("Flight");
  assert.equal(train.shown(), true, "naming a flight shows them, empty");
  assert.equal(train.layovers(), true, "and the flight's layovers below them");
  assert.deepEqual(["airline", "flightNumber"].map((name) => train.input(name).props.defaultValue), ["", ""]);
});

/** A card's flight details for a connection, as host elements, or null when it shows none. */
function details(leg) {
  const { FlightDetails } = load({ hooks: [], cursor: 0 });
  const tree = FlightDetails({ leg });
  // Children arrays come from the component's own context, so they are copied into this one before comparing.
  return tree && nodes(tree).filter((node) => node.type === "div").map((entry) => [...entry.props.children].filter(Boolean).map(text));
}

test("a card shows a flight's airline and flight number, each labeled only once entered, and neither for other transportation", () => {
  assert.deepEqual(details({ method: "Flight", airline: "Delta", flightNumber: "DL 413" }), [["Airline", "Delta"], ["Flight number", "DL 413"]]);
  assert.deepEqual(details({ method: "Flight", airline: "Delta", flightNumber: "" }), [["Airline", "Delta"]], "an empty one shows no label");
  assert.deepEqual(details({ method: "Train and flight", airline: "", flightNumber: "DL 413" }), [["Flight number", "DL 413"]]);
  assert.equal(details({ method: "Flight", airline: "", flightNumber: "" }), null, "a flight without them shows nothing");
  assert.equal(details({ method: "Train", airline: "Delta", flightNumber: "DL 413" }), null, "saved ones don't show while the connection isn't a flight");
  assert.equal(details({ method: "", airline: "Delta", flightNumber: "DL 413" }), null);
});

// TRA-186: a flight's estimated miles required, entered by hand beside its cash price, shown while its transportation
// names an airplane and kept when it doesn't. They are never money: the price, budgets and estimates never read them.

const MILES = "Estimated miles required must be a whole number, 0 or more, or left blank.";
/** A connection's saved miles. */
const milesOf = (store, legId) => store.getSnapshot().legs.find((leg) => leg.id === legId).milesRequired;
/** A Dublin layover, with a plan for it. */
const dublin = { id: randomUUID(), kind: "layover", place: "Dublin (DUB)", arrival: "May 4, 6:10", departure: "May 4, 8:05", notes: "U.S. preclearance" };
const dublinPlan = { timeZone: "Europe/Dublin", arrival: "2027-05-04T06:10", departure: "2027-05-04T08:05", immigrationMinutes: 30, customsMinutes: 0, securityMinutes: 20, transferMinutes: 10, boardingMinutes: 30, returnMinutes: null, activities: [] };

test("a connection starts without miles, saves a whole number from 0, keeps it when a save leaves it out, and null clears it (TRA-186)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    addDestination(store, tripId, { city: "London", nights: 4 });
    const [outbound, home] = legsOf(store, tripId).map((leg) => leg.id);
    assert.ok(legsOf(store, tripId).every((leg) => leg.milesRequired === null), "a new connection has none: unknown, not 0");
    store.applyMutation(legSave(outbound, { price: "1250", milesRequired: 85000 }));
    store.applyMutation(legSave(home, { price: "", milesRequired: 0 }));
    assert.deepEqual([milesOf(store, outbound), milesOf(store, home)], [85000, 0], "each connection keeps its own, 0 included");
    assert.deepEqual(store.getTripSnapshot(tripId).data.legs.map((leg) => leg.milesRequired), [85000, 0], "the trip's page has them");
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual([milesOf(store, outbound), milesOf(store, home)], [85000, 0], "reopening keeps them");
    store.applyMutation(legSave(outbound, { milesRequired: 120000 }));
    assert.equal(milesOf(store, outbound), 120000, "saving a new number replaces them");
    store.applyMutation(legSave(outbound));
    assert.equal(milesOf(store, outbound), 120000, "a save that leaves them out, as a page opened before them does, keeps them");
    store.applyMutation(legSave(outbound, { milesRequired: Number.MAX_SAFE_INTEGER }));
    assert.equal(milesOf(store, outbound), Number.MAX_SAFE_INTEGER, "up to the largest whole number Travel checks exactly");
    store.applyMutation(legSave(outbound, { milesRequired: null }));
    assert.equal(milesOf(store, outbound), null, "null, which a blank field sends, clears them");
    assert.equal(milesOf(store, home), 0, "another connection keeps its own");
  } finally { store?.close(); }
});

test("a flight's price and miles are saved independently, and changing its miles changes nothing else (TRA-186)", (t) => {
  const { store, tripId } = setup(t);
  const london = addDestination(store, tripId, { city: "London", nights: 4, hotelNightlyAmount: "210" });
  const [outbound, home] = legsOf(store, tripId).map((leg) => leg.id);
  const links = [{ id: randomUUID(), url: "https://example.com/award", description: "Award search" }];
  // Everything the connection's editor sends, as saved, but its price and miles.
  const editor = { method: "Flight", airline: "Aer Lingus", flightNumber: "EI 124", miscAmount: "60", departure: "May 3, 18:30", arrival: "May 4, 9:55", travelNights: 1, url: links[0].url, links, notes: "Seats 23A and 23B", itinerary: [dublin] };
  store.applyMutation(legSave(outbound, { ...editor, price: "1250" }));
  store.applyMutation({ type: "leg.layoverPlan", id: outbound, layoverId: dublin.id, plan: dublinPlan });
  store.applyMutation(legSave(home, { method: "Flight", price: "900", milesRequired: 60000 }));
  const priceAndMiles = () => { const leg = store.getSnapshot().legs.find((item) => item.id === outbound); return [leg.priceCents, leg.milesRequired]; };
  /** Everything saved but the connection's price and miles. */
  const rest = (snapshot) => ({ ...snapshot, legs: snapshot.legs.map((leg) => leg.id === outbound ? { ...leg, priceCents: null, milesRequired: null } : leg) });
  const before = store.getSnapshot();
  // A price alone, miles alone, both or neither.
  for (const [price, milesRequired, cents] of [["1250", 85000, 125000], ["", 85000, null], ["1250", null, 125000], ["", null, null], ["980.50", 0, 98050]]) {
    const label = `price ${JSON.stringify(price)} and miles ${milesRequired}`;
    store.applyMutation(legSave(outbound, { ...editor, price, milesRequired }));
    assert.deepEqual(priceAndMiles(), [cents, milesRequired], label);
    assert.deepEqual(rest(store.getSnapshot()), rest(before), `${label}: its airline, flight number, spending, times, nights spent traveling, links, notes, layover and plan, and every other connection and destination are unchanged`);
    const estimate = calculateBudget(store.getSnapshot(), tripId);
    store.applyMutation(legSave(outbound, { ...editor, price, milesRequired: null }));
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), estimate, `${label}: the estimate follows the price alone`);
  }
  // Changing its transportation away from a flight keeps them, whether a save sends them, as the editor does while its
  // field is hidden, or not. So does every other change to the trip that keeps the connection.
  store.applyMutation(legSave(outbound, { ...editor, price: "1250", milesRequired: 85000 }));
  for (const edit of [
    legSave(outbound, { ...editor, price: "1250", method: "Train" }),
    legSave(outbound, { ...editor, price: "1250", method: "Overnight train", milesRequired: 85000 }),
    legSave(outbound, { ...editor, price: "1250" }),
    { type: "leg.layoverPlan", id: outbound, layoverId: dublin.id, plan: null },
    stopEdit(london, { nights: 5 }),
    destinationEdit(london, { notes: "Theatre tickets" }),
    tripInput({ id: tripId, name: "Renamed", startDate: "2027-05-03" }),
  ]) {
    store.applyMutation(edit);
    assert.equal(milesOf(store, outbound), 85000, JSON.stringify(edit));
  }
  assert.equal(milesOf(store, home), 60000, "another connection keeps its own");
});

test("miles are a whole number from 0, or null, and a refused save keeps everything saved (TRA-186)", (t) => {
  const { store, tripId } = setup(t);
  addDestination(store, tripId, { city: "London", nights: 4 });
  const [outbound] = legsOf(store, tripId).map((leg) => leg.id);
  store.applyMutation(legSave(outbound, { milesRequired: 85000 }));
  const before = store.getSnapshot();
  for (const milesRequired of [-1, -0.5, 1.5, 85000.25, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, "85000", "", "85,000", true, [85000], {}]) {
    const label = `${typeof milesRequired} ${JSON.stringify(milesRequired) ?? String(milesRequired)}`;
    assert.throws(() => store.applyMutation(legSave(outbound, { price: "999", notes: "Not saved", milesRequired })), refusal(MILES), label);
    assert.deepEqual(store.getSnapshot(), before, `${label}: nothing changes, not even the connection's other fields`);
  }
});

test("Clear, and a route or city change that clears or replaces a connection, clear its miles (TRA-186)", (t) => {
  const { store, tripId } = setup(t);
  const london = addDestination(store, tripId, { city: "London", nights: 4 });
  const [outbound, home] = legsOf(store, tripId).map((leg) => leg.id);
  const fill = () => [outbound, home].forEach((id) => store.applyMutation(legSave(id, { milesRequired: 85000 })));
  fill();
  store.applyMutation({ type: "leg.clear", id: outbound });
  assert.deepEqual([milesOf(store, outbound), milesOf(store, home)], [null, 85000], "Clear clears them with the rest of the travel plan, for that connection alone");
  fill();
  // The trip still returns to Boston, so only the connection from the departing city changes.
  store.applyMutation(tripInput({ id: tripId, homeCity: "Chicago", returnCity: "Boston" }));
  assert.deepEqual([milesOf(store, outbound), milesOf(store, home)], [null, 85000], "a new departing city clears the connection from it");
  fill();
  store.applyMutation(destinationEdit(london, { city: "Edinburgh" }));
  assert.deepEqual([milesOf(store, outbound), milesOf(store, home)], [null, null], "a new city clears the connections to and from it");
  fill();
  store.applyMutation({ type: "stop.add", tripId, city: "Paris" });
  assert.equal(milesOf(store, outbound), 85000, "a connection the route keeps keeps them");
  assert.equal(legsOf(store, tripId).some((leg) => leg.id === home), false, "adding a city replaced the connection home");
  assert.ok(legsOf(store, tripId).filter((leg) => leg.id !== outbound).every((leg) => leg.milesRequired === null), "and its new connections start without miles");
});

test("a trip's flight miles are for everyone it is shared with, and no one else (TRA-186)", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const friend = store.authorizeAccount("friend@example.test").id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  addCity((input) => store.applyMutation(owner, input).id, tripId, "London", { nights: 4 });
  const [outbound] = store.getTripSnapshot(owner, tripId).data.legs.map((leg) => leg.id);
  store.applyMutation(owner, legSave(outbound, { milesRequired: 85000 }));
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const shown = (account) => store.getTripSnapshot(account, tripId).data.legs.find((leg) => leg.id === outbound).milesRequired;
  assert.equal(shown(friend), 85000, "someone it is shared with sees them");
  store.applyMutation(friend, legSave(outbound, { milesRequired: 70000 }));
  assert.equal(shown(owner), 70000, "and changes them for everyone");
  const before = store.getSnapshot();
  assert.equal(store.getTripSnapshot(outsider, tripId), undefined, "anyone else can't see them");
  assert.throws(() => store.applyMutation(outsider, legSave(outbound, { milesRequired: 1 })), refusal(NOT_AVAILABLE), "anyone else can't change them");
  store.applyMutation(owner, { type: "trip.unshare", tripId, email: "friend@example.test" });
  assert.throws(() => store.applyMutation(friend, legSave(outbound, { milesRequired: 1 })), refusal(NOT_AVAILABLE), "nor can someone it is no longer shared with");
  assert.deepEqual(store.getSnapshot().legs, before.legs);
});

test("schema 52 databases upgrade without any miles, and a replay keeps what was saved since (TRA-186)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    addDestination(store, tripId, { city: "London", nights: 4 });
    const [outbound, home] = legsOf(store, tripId).map((leg) => leg.id);
    const booked = { airline: "Aer Lingus", flightNumber: "EI 124", price: "1250", miscAmount: "60", travelNights: 1, notes: "Booked", links: [{ id: randomUUID(), url: "https://example.com/booking", description: "" }], itinerary: [dublin] };
    store.applyMutation(legSave(outbound, booked));
    store.applyMutation(legSave(home, { method: "Train", price: "" }));
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE legs DROP COLUMN milesRequired; PRAGMA user_version = 52;");
    db.close();
    store = createOwnedStore(path);
    assert.ok(store.getSnapshot().legs.every((leg) => leg.milesRequired === null), "no connection has any");
    assert.deepEqual(store.getSnapshot(), saved, "every connection keeps everything saved for it, its price included");
    store.applyMutation(legSave(outbound, { ...booked, milesRequired: 85000 }));
    const later = store.getSnapshot();
    assert.equal(milesOf(store, outbound), 85000);
    // A replay of schema 53, also after the schema 1 build resets the schema version, keeps them.
    for (const version of [52, 1]) {
      store.close(); store = null;
      const replay = new DatabaseSync(path);
      replay.exec(`PRAGMA user_version = ${version};`);
      replay.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps what was saved`);
    }
    store.close(); store = null;
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      const columns = observer.prepare("PRAGMA table_info(legs)").all().filter((info) => info.name === "milesRequired");
      assert.deepEqual(columns.map(({ name, type, notnull, dflt_value }) => ({ name, type, notnull, dflt_value })), [{ name: "milesRequired", type: "INTEGER", notnull: 0, dflt_value: null }], "NULL while unknown");
      // The database refuses what the store does: fewer than 0 miles, or more than it checks exactly.
      for (const miles of [-1, 9007199254740992n]) {
        assert.throws(() => observer.prepare("UPDATE legs SET milesRequired = ? WHERE id = ?").run(miles, outbound), /CHECK constraint failed/, String(miles));
      }
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude read a flight's miles and propose them, previewed as Estimated miles required (TRA-186)", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "London" });
  const legId = store.getSnapshot().legs.find((leg) => leg.tripId === ownerTrip && leg.fromId === null).id;
  const save = (overrides) => ({ type: "leg.save", id: legId, method: "Flight", price: "1250", departure: "", arrival: "", url: "", notes: "", ...overrides });
  /** The connection's Estimated miles required in a proposal's preview, or undefined when the proposal doesn't change them. */
  const previewed = (proposal) => proposal.preview[0].records.find((item) => item.record.includes(": travel from the departing city"))?.fields.find((field) => field.name === "Estimated miles required");
  const readNow = () => store.aiTrip(ownerTrip).travel.find((item) => item.id === legId).milesRequired;

  const added = propose([save({ milesRequired: 85000 })]);
  assert.deepEqual(previewed(added), { name: "Estimated miles required", before: null, after: "85000" });
  assert.equal(readNow(), null, "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.equal(readNow(), 85000, "assistants read them with the connection");
  const estimate = store.aiTrip(ownerTrip).budget;

  const renoted = propose([save({ notes: "Window seats" })]);
  assert.equal(previewed(renoted), undefined, "a change without them keeps them, so the preview leaves them out");
  assert.equal(decide(renoted, true).status, "applied");
  assert.equal(readNow(), 85000);

  const cleared = propose([save({ notes: "Window seats", milesRequired: null })]);
  assert.deepEqual(previewed(cleared), { name: "Estimated miles required", before: "85000", after: null });
  assert.equal(decide(cleared, true).status, "applied");
  assert.equal(readNow(), null);
  assert.deepEqual(store.aiTrip(ownerTrip).budget, estimate, "the trip's estimate never counted them");

  const before = store.getSnapshot();
  for (const milesRequired of [-5, 1.5, "85000"]) {
    assert.throws(() => propose([save({ milesRequired })]), refusal(`Change 1: ${MILES}`), JSON.stringify(milesRequired));
  }
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "leg.save");
  assert.deepEqual([schema.properties.milesRequired.type, schema.properties.milesRequired.minimum, schema.required.includes("milesRequired")], [["integer", "null"], 0, false], "assistants are told it is a whole number from 0 or null, and left out, it is kept");
  assert.match(schema.properties.milesRequired.description, /for the whole connection/);
  assert.match(schema.properties.milesRequired.description, /never converts miles to dollars or counts them in any budget/);
  assert.match(schema.description, /airline, flight number and miles required show only while its method names an airplane/);
});

/** The editor's Estimated miles required for a saved connection while its Transportation says `method`. */
function milesField(leg, method) {
  const { FlightMilesField } = load({ hooks: [], cursor: 0 });
  const tree = FlightMilesField({ leg, method });
  const label = nodes(tree).find((node) => node.type === "label");
  return { shown: tree.props.hidden === false, label: text(label.props.children[0]), input: nodes(tree).find((node) => node.type === "input").props, hint: text(nodes(tree).find((node) => node.type === "small")) };
}

test("the editor shows Estimated miles required only while Transportation names an airplane, and hidden leaves it out of the save (TRA-186)", () => {
  for (const [method, shown] of [["Flight", true], ["Train and flight", true], ["plane", true], ["Train", false], ["", false], ["Delta", false], ["Rental car", false]]) {
    const field = milesField({ milesRequired: 85000 }, method);
    assert.equal(field.shown, shown, `${JSON.stringify(method)} ${shown ? "shows" : "hides"} it`);
    // Hidden, it is disabled, so the browser leaves it out of the save, which keeps the saved miles, and nothing typed
    // in it can stop the save. Naming a flight again shows it with what it holds.
    assert.equal(field.input.disabled, !shown, `${JSON.stringify(method)} ${shown ? "enables" : "disables"} it`);
    assert.equal(field.input.defaultValue, 85000, `${JSON.stringify(method)} keeps what is saved`);
  }
  const field = milesField({ milesRequired: null }, "Flight");
  assert.equal(field.label, "Estimated miles required");
  assert.equal(field.input.defaultValue, "", "unknown miles start blank, not 0");
  const { name, type, min, max, step, inputMode, className, placeholder, required, disabled } = field.input;
  assert.deepEqual({ name, type, min, max, step, inputMode, className, placeholder, required, disabled }, { name: "milesRequired", type: "number", min: "0", max: Number.MAX_SAFE_INTEGER, step: "1", inputMode: "numeric", className: "no-spin-buttons", placeholder: "Not estimated", required: undefined, disabled: false }, "an optional whole number from 0, typed without increment and decrement arrows, as the price is");
  assert.equal(field.hint, "Airline miles instead of the price: the total for the whole party for the full connection, including layovers. The trip estimate counts only the price. Leave blank if unknown.");
});

/** A card's miles for a connection, as its element's type, class and text, or null when it shows none. */
function cardMiles(leg) {
  const { FlightMiles } = load({ hooks: [], cursor: 0 });
  const tree = FlightMiles({ leg });
  return tree && [tree.type, tree.props.className, text(tree)];
}

test("a card shows a flight's miles with thousands separators and a label, and none for other transportation or unknown miles (TRA-186)", () => {
  for (const [milesRequired, shown] of [[85000, "85,000 miles required"], [125000, "125,000 miles required"], [999, "999 miles required"], [1, "1 mile required"], [0, "0 miles required"], [Number.MAX_SAFE_INTEGER, "9,007,199,254,740,991 miles required"]]) {
    assert.deepEqual(cardMiles({ method: "Flight", milesRequired }), ["span", "price", shown]);
  }
  assert.deepEqual(cardMiles({ method: "Train and flight", milesRequired: 85000 }), ["span", "price", "85,000 miles required"]);
  assert.equal(cardMiles({ method: "Flight", milesRequired: null }), null, "a flight without them shows nothing");
  assert.equal(cardMiles({ method: "Train", milesRequired: 85000 }), null, "saved ones don't show while the connection isn't a flight");
  assert.equal(cardMiles({ method: "", milesRequired: 85000 }), null);
});
