import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import { createStore, ValidationError } from "../src/lib/store.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import { addCity, addDestination, candidateInput, destination, destinationEdit, setup, stop, tripInput } from "./budget-fixtures.mjs";
import { cssRules } from "./css-rules.mjs";

// TRA-153: a + above each destination card on a trip's page, and below the last one, adds a destination there with Add
// destination. The store puts the new stop directly before the stop the + names, or last, and changes nothing else.

const ROUTE_CHANGED = { name: "ValidationError", message: "This trip's route has changed. Refresh to see it, then add the destination again." };
const NOT_AVAILABLE = { name: "ValidationError", message: "This item no longer exists or isn't shared with you. Please refresh and try again." };

/** A trip's stops in route order, as its page shows them. */
const stopsOf = (store, tripId) => store.getTripSnapshot(tripId).data.stops.filter((item) => item.tripId === tripId).sort((a, b) => a.position - b.position);
/** A trip's cities in route order. */
const route = (store, tripId) => stopsOf(store, tripId).map((item) => destination(store, item.destinationId).city);
/** A trip's connections, each as the stops it joins, null for the departing or return city. */
const connections = (store, tripId) => store.getTripSnapshot(tripId).data.legs.map((leg) => [leg.fromId, leg.toId]);
/** Rome, Florence and Venice, each with nights and stay notes, in a trip that starts on April 10, 2027. */
function italy(t) {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-04-10" }));
  const rome = addDestination(store, tripId, { city: "Rome", nights: 3, stay: "Near the Pantheon" });
  const florence = addDestination(store, tripId, { city: "Florence", nights: 2, stay: "Oltrarno" });
  const venice = addDestination(store, tripId, { city: "Venice", nights: 2, stay: "Cannaregio" });
  return { store, tripId, rome, florence, venice };
}

test("a destination added before a stop goes directly before it, and the other stops keep their order (TRA-153)", (t) => {
  const { store, tripId, rome, florence, venice } = italy(t);
  const add = (city, before) => store.applyMutation({ type: "stop.add", tripId, city, before }).id;
  add("Siena", florence);
  assert.deepEqual(route(store, tripId), ["Rome", "Siena", "Florence", "Venice"], "between two stops");
  add("Naples", rome);
  assert.deepEqual(route(store, tripId), ["Naples", "Rome", "Siena", "Florence", "Venice"], "before the first");
  add("Verona", venice);
  assert.deepEqual(route(store, tripId), ["Naples", "Rome", "Siena", "Florence", "Verona", "Venice"], "before the last");
  add("Milan");
  assert.deepEqual(route(store, tripId), ["Naples", "Rome", "Siena", "Florence", "Verona", "Venice", "Milan"], "without a stop, last, as Add destination adds");
  assert.deepEqual(stopsOf(store, tripId).map((item) => item.position), [0, 1, 2, 3, 4, 5, 6], "the route keeps one place for each stop");
});

test("a saved destination chosen in Add destination goes before the stop too, with everything saved for it (TRA-153)", (t) => {
  const { store, tripId, florence } = italy(t);
  const siena = store.applyMutation({ type: "destination.create", city: "Siena" }).id;
  store.applyMutation(destinationEdit(siena, { notes: "The Palio is in July", hotelNightlyAmount: "140" }));
  const campo = store.applyMutation(candidateInput(siena, "activities", { name: "Piazza del Campo" })).id;
  const saved = destination(store, siena);
  const stopId = store.applyMutation({ type: "stop.visit", tripId, destinationId: siena, before: florence }).id;
  assert.deepEqual(route(store, tripId), ["Rome", "Siena", "Florence", "Venice"]);
  assert.deepEqual(destination(store, siena), saved, "the destination is the saved one, unchanged");
  assert.ok(store.getTripSnapshot(tripId).data.candidates.some((item) => item.id === campo), "its ideas come with it");
  assert.deepEqual([stop(store, stopId).nights, stop(store, stopId).stay], [null, ""], "the new stay has no nights or notes yet");
});

test("a destination added between two stops replaces only the connection between them, and keeps every stay, start date and destination (TRA-153)", (t) => {
  const { store, tripId, rome, florence, venice } = italy(t);
  for (const [index, leg] of store.getTripSnapshot(tripId).data.legs.entries()) {
    store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: String(50 + index), miscAmount: "12", departure: "Morning", arrival: "Noon", url: "https://example.com/trains", notes: "Booked " + index });
  }
  const before = store.getTripSnapshot(tripId).data;
  const siena = store.applyMutation({ type: "stop.add", tripId, city: "Siena", before: florence }).id;
  const after = store.getTripSnapshot(tripId).data;
  assert.deepEqual(connections(store, tripId), [[null, rome], [rome, siena], [siena, florence], [florence, venice], [venice, null]]);
  // Rome's connection to Florence is gone, since the route no longer goes from one to the other. Every other keeps its
  // ID and everything planned for it, and the two new ones have nothing planned yet.
  const replaced = before.legs.find((leg) => leg.fromId === rome && leg.toId === florence);
  assert.deepEqual(after.legs.filter((leg) => before.legs.some((kept) => kept.id === leg.id)), before.legs.filter((leg) => leg !== replaced));
  for (const leg of after.legs.filter((item) => item.fromId === siena || item.toId === siena)) {
    assert.deepEqual([leg.method, leg.priceCents, leg.miscCents, leg.notes], ["", null, null, ""]);
  }
  // Every stay keeps its nights and notes, every destination what is saved for it, and the trip its start date.
  for (const saved of before.stops) {
    const now = after.stops.find((item) => item.id === saved.id);
    assert.deepEqual([now.nights, now.stay, now.destinationId], [saved.nights, saved.stay, saved.destinationId]);
  }
  for (const saved of before.destinations) assert.deepEqual(after.destinations.find((item) => item.id === saved.id), saved);
  assert.equal(after.trips[0].startDate, "2027-04-10");
  // Dates are worked out in route order from the start date and each stay's nights, as before (TRA-153 adds none): stays
  // before Siena keep theirs, and later ones wait for Siena's nights.
  const dates = () => stopsOf(store, tripId).map((item) => [item.arrivalDate, item.departureDate]);
  assert.deepEqual(dates(), [["2027-04-10", "2027-04-13"], [null, null], [null, null], [null, null]]);
  store.applyMutation({ type: "destination.save", id: siena, stopId: siena, nights: 1 });
  assert.deepEqual(dates(), [["2027-04-10", "2027-04-13"], ["2027-04-13", "2027-04-14"], ["2027-04-14", "2027-04-16"], ["2027-04-16", "2027-04-18"]]);
});

test("a city the trip already visits opens its stop where it is, whichever + was used, and a save sent again adds it once (TRA-153)", (t) => {
  const { store, tripId, rome, florence, venice } = italy(t);
  const before = store.getSnapshot();
  assert.equal(store.applyMutation({ type: "stop.add", tripId, city: "Venice", before: rome }).id, venice);
  assert.equal(store.applyMutation({ type: "stop.visit", tripId, destinationId: venice, before: rome }).id, venice);
  assert.deepEqual(store.getSnapshot(), before, "nothing moves or changes");
  const add = { type: "stop.add", tripId, city: "Siena", before: florence };
  const siena = store.applyMutation(add).id;
  assert.equal(store.applyMutation(add).id, siena, "after a lost response");
  assert.deepEqual(route(store, tripId), ["Rome", "Siena", "Florence", "Venice"]);
});

test("a + for a stop that has left the trip, or for another trip's stop, adds nothing (TRA-153)", (t) => {
  const { store, tripId, florence } = italy(t);
  store.applyMutation({ type: "stop.remove", id: florence });
  const lisbon = addDestination(store, store.applyMutation(tripInput({ name: "Portugal" })).id, { city: "Lisbon" });
  const siena = store.applyMutation({ type: "destination.create", city: "Siena" }).id;
  const before = store.getSnapshot();
  for (const stopId of [florence, lisbon]) {
    for (const input of [{ type: "stop.add", tripId, city: "Pisa", before: stopId }, { type: "stop.visit", tripId, destinationId: siena, before: stopId }]) {
      assert.throws(() => store.applyMutation(input), ROUTE_CHANGED);
      assert.deepEqual(store.getSnapshot(), before, "no destination, stop or connection is added");
    }
  }
  for (const stopId of ["", "Florence", 7, null]) assert.throws(() => store.applyMutation({ type: "stop.add", tripId, city: "Pisa", before: stopId }), ValidationError);
  assert.deepEqual(store.getSnapshot(), before);
});

test("anyone a trip is shared with can add a destination before one of its stops, and no one else can (TRA-153)", (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const [owner, editor, outsider] = ["owner@example.com", "editor@example.com", "outsider@example.com"].map((email) => store.authorizeAccount(email).id);
  const tripId = store.applyMutation(owner, tripInput()).id;
  const rome = addCity((input) => store.applyMutation(owner, input).id, tripId, "Rome");
  const florence = addCity((input) => store.applyMutation(owner, input).id, tripId, "Florence");
  store.applyMutation(owner, { type: "trip.share", tripId, email: "editor@example.com" });
  const siena = store.applyMutation(editor, { type: "stop.add", tripId, city: "Siena", before: florence }).id;
  const order = () => store.getTripSnapshot(owner, tripId).data.stops.sort((a, b) => a.position - b.position).map((item) => item.id);
  assert.deepEqual(order(), [rome, siena, florence]);
  const outsiders = store.applyMutation(outsider, { type: "destination.create", city: "Pisa" }).id;
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(outsider, { type: "stop.add", tripId, city: "Lucca", before: florence }), NOT_AVAILABLE);
  assert.throws(() => store.applyMutation(outsider, { type: "stop.visit", tripId, destinationId: outsiders, before: florence }), NOT_AVAILABLE);
  assert.deepEqual(store.getSnapshot(), before);
});

// The trip's page, rendered by the planner from what the store gives `/trips/<trip ID>`, with React's state kept between
// renders so its + buttons and Add destination can be used, and its saves made by the store. No browser or server is involved.
function load(file, require, globals) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}
const element = (type, props) => ({ type, props });
/** A submitted form's fields, as the planner reads them from the form's elements. */
class FormData {
  constructor(form) { this.fields = form.fields; }
  get(name) { return name in this.fields ? this.fields[name] : null; }
  has(name) { return name in this.fields; }
  getAll(name) { return name in this.fields ? [this.fields[name]] : []; }
}

/** The trip's page for the trip's owner, with the changes it saves and a way to use it. */
function tripPage(store, tripId) {
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
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), unstable_isUnrecognizedActionError: () => false },
    // The page's save, made by the store as the signed-in owner. Each change sent is kept as this file's object, so it
    // compares as any other.
    "@/app/actions": { mutatePlanner: async (mutation) => { sent.push({ ...mutation }); return { ok: true, ...store.applyMutation(mutation) }; } },
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates,
  };
  // Every other module is one the destinations and Add destination don't need: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", (name) => modules[name] ?? unused, { FormData });
  /** An element as the browser has it: host elements with their children rendered, and text, each component and fragment rendered in its place. */
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
  /**
   * The page as it renders now, from the store's trip as the page last loaded it. It renders twice, as React renders
   * again at once when the page changes its state while rendering, as it does on loading a trip again.
   */
  const show = () => { for (let pass = 0; pass < 2; pass++) { cursor = 0; shown = render(PlannerApp(props)); } };
  /** Loads the page again, as it does after a save. */
  const load_ = () => { const { data, access, library } = store.getTripSnapshot(tripId); props = { initialData: data, access: { [tripId]: access }, library, tripId }; show(); };
  load_();
  const all = () => shown.flatMap(within);
  return {
    sent,
    all,
    /** The + buttons, in order, by what each is named. */
    pluses: () => all().filter((node) => node.props.className === "stop-insertion").map((row) => row.props.children[0]),
    plus: (label) => all().find((node) => node.type === "button" && node.props["aria-label"] === label),
    button: (label) => all().find((node) => node.type === "button" && text(node) === label),
    /** The open editor's title, or undefined without one. */
    dialog: () => { const dialog = all().find((node) => node.type === "dialog" && node.props.className === "editor-dialog"); return dialog && text(within(dialog).find((node) => node.type === "h2")); },
    click(button) { button.props.onClick({ currentTarget: button }); show(); },
    /** Submits the open editor with `fields`, waits for its save, and loads the page again. */
    async submit(fields) {
      all().find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { fields } });
      await new Promise((resolve) => setImmediate(resolve));
      load_();
    },
    /** The destination cards' names, in order. */
    cards: () => all().filter((node) => node.type === "article" && node.props.className === "destination-card").map((card) => text(within(card).find((node) => node.type === "h3"))),
  };
}
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");

test("each destination card has a + above it, and the last one a + below it, each named for where it adds (TRA-153)", (t) => {
  const { store, tripId } = italy(t);
  const page = tripPage(store, tripId);
  const list = page.all().find((node) => node.props.className === "destination-list");
  assert.deepEqual(list.props.children.map((child) => child.props.className), ["stop-insertion", "destination-card", "stop-insertion", "destination-card", "stop-insertion", "destination-card", "stop-insertion"]);
  assert.deepEqual(page.pluses().map((button) => button.props["aria-label"]), ["Add a destination before Rome", "Add a destination before Florence", "Add a destination before Venice", "Add a destination after Venice"]);
  for (const button of page.pluses()) {
    assert.deepEqual([button.type, button.props.type, button.props.className], ["button", "button", "button secondary"], "Travel's secondary button");
    assert.deepEqual(button.props.children.map((icon) => [icon.type, icon.props["aria-hidden"]]), [["icon:Plus", "true"]], "a + alone, named by its label");
  }
});

test("a trip without destinations has no +: its empty state adds the first (TRA-153)", (t) => {
  const { store, tripId } = setup(t);
  const page = tripPage(store, tripId);
  assert.deepEqual(page.pluses(), []);
  assert.ok(page.button("Add a destination "), "the empty state's Add a destination");
});

test("a + opens Add destination there, and the city or saved destination chosen goes directly before the card below it, or last (TRA-153)", async (t) => {
  const { store, tripId, rome, florence } = italy(t);
  const siena = store.applyMutation({ type: "destination.create", city: "Siena" }).id;
  const page = tripPage(store, tripId);
  page.click(page.plus("Add a destination before Florence"));
  assert.equal(page.dialog(), "Add a destination before Florence");
  await page.submit({ city: "Siena", destinationId: siena });
  assert.deepEqual(page.sent.at(-1), { type: "stop.visit", tripId, destinationId: siena, before: florence }, "a saved destination by its ID");
  assert.deepEqual(page.cards(), ["Rome", "Siena", "Florence", "Venice"]);
  assert.equal(page.dialog(), undefined, "saving closes it");

  page.click(page.plus("Add a destination before Rome"));
  assert.equal(page.dialog(), "Add a destination before Rome");
  await page.submit({ city: "Naples, Campania, Italy", cityFromSuggestion: "on", destinationId: "" });
  assert.deepEqual(page.sent.at(-1), { type: "stop.add", tripId, city: "Naples, Campania, Italy", cityFromSuggestion: true, before: rome }, "any other city by its name");
  assert.deepEqual(page.cards(), ["Naples, Italy", "Rome", "Siena", "Florence", "Venice"]);

  page.click(page.plus("Add a destination after Venice"));
  assert.equal(page.dialog(), "Add a destination", "after the last card, it adds last, as Add destination does");
  await page.submit({ city: "Milan", destinationId: "" });
  assert.deepEqual(page.sent.at(-1), { type: "stop.add", tripId, city: "Milan", cityFromSuggestion: undefined, before: undefined });
  assert.deepEqual(page.cards(), ["Naples, Italy", "Rome", "Siena", "Florence", "Venice", "Milan"]);
});

test("Cancel closes Add destination from a + without saving, and the heading's Add destination still adds last (TRA-153)", async (t) => {
  const { store, tripId } = italy(t);
  const before = store.getSnapshot();
  const page = tripPage(store, tripId);
  page.click(page.plus("Add a destination before Florence"));
  page.click(page.button("Cancel"));
  assert.equal(page.dialog(), undefined);
  assert.deepEqual(page.sent, []);
  assert.deepEqual(store.getSnapshot(), before, "the trip and its route are unchanged");
  page.click(page.button("Add destination"));
  assert.equal(page.dialog(), "Add a destination");
  await page.submit({ city: "Milan", destinationId: "" });
  assert.equal(page.sent.at(-1).before, undefined);
  assert.deepEqual(page.cards(), ["Rome", "Florence", "Venice", "Milan"]);
});

test("with a mouse, a + shows while the pointer is over it or a card beside it, or it has keyboard focus; touchscreens always show it as a 44 × 44 target (TRA-153)", () => {
  const file = "../src/app/globals.css";
  const css = readFileSync(new URL(file, import.meta.url), "utf8");
  assert.match(css, /@media\(hover:hover\) \{\s*\.stop-insertion \.button \{\s*opacity:0\s*\}/, "hidden only where the pointer can hover");
  const rules = cssRules(file).filter(([selector]) => selector.includes("stop-insertion"));
  const shown = rules.find(([, declarations]) => declarations.opacity === "1");
  assert.deepEqual(shown[0].split(",").map((selector) => selector.trim()).sort(), [
    ".destination-card:hover+.stop-insertion .button", ".stop-insertion .button:focus-visible", ".stop-insertion:has(+.destination-card:hover) .button", ".stop-insertion:hover .button",
  ]);
  assert.match(css, /@media\(pointer:coarse\) \{\s*\.stop-insertion \{\s*height:44px\s*\}\s*\.stop-insertion \.button \{\s*flex-basis:44px;\s*height:44px\s*\}/);
});
