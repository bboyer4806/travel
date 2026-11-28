import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as layoverPlan from "../src/lib/layover-plan.ts";
import * as money from "../src/lib/money.ts";
import * as transportation from "../src/lib/transportation-methods.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripMap from "../src/lib/trip-map.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import { addDestination, setup } from "./budget-fixtures.mjs";

// TRA-184: a flight's layovers are planned with the flight. In a connection's editor they are part of its flight, below
// its airline and flight number, and on its card they show directly below them, while its other stops stay under Stops
// along the way. A connection that isn't a flight shows every entry there, layovers included. Every part works on the
// connection's one itinerary, so its IDs, order, details, plans, map and budget stay as saved. Components run with a
// small hook harness that keeps their state between renders, as React does. No browser is involved.

const element = (type, props, key) => ({ type, props, key });
/** An element as the browser has it: components rendered in place, down to host elements and text. */
function render(node) {
  if (Array.isArray(node)) return [...node].flatMap(render);
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node !== "object") return [String(node)];
  if (typeof node.type === "function") return render(node.type(node.props));
  if (node.type === "fragment") return render(node.props.children);
  return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
}
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");
/** A value made in a component's context, copied out of it to compare as any other value. */
const copy = (value) => JSON.parse(JSON.stringify(value));

/** Runs a component file with `require` for its imports. */
function run(file, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, Error, ...globals });
  return exports;
}

/** React's hooks, keeping state and refs in `state`'s slots between renders, in the order components call them. */
function hooks(state) {
  return {
    useState(initial) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial;
      return [state.slots[index], (value) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }];
    },
    useRef(current) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = { current };
      return state.slots[index];
    },
    useId: () => "id-" + state.cursor++,
    useMemo: (make) => make(),
    // A transition finishes at once, and effects, which run only in a browser, don't run.
    useTransition: () => [false, (work) => work()],
    useEffect: () => {},
    useEffectEvent: (callback) => callback,
  };
}

/** The connection components, sharing `react`'s hooks, with what they import. New entries' IDs count up from 1. */
function components(react) {
  let ids = 0;
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "@/lib/layover-plan": layoverPlan, "@/lib/trip-map": tripMap, "@/lib/transportation-methods": transportation,
    "@/lib/uuid": { randomUuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}` },
    // Focus moves only in a browser.
    "./focus-after": { useFocusAfter: () => () => {}, controlOrNeighbor: (control) => control },
  };
  const require = (name) => {
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (!(name in modules)) throw new Error("Unexpected component import: " + name);
    return modules[name];
  };
  modules["./layover-plan"] = run("../src/components/layover-plan.tsx", require);
  return { itinerary: run("../src/components/connection-itinerary.tsx", require), flight: run("../src/components/connection-flight.tsx", require), plans: modules["./layover-plan"] };
}

const frankfurt = { id: "f0000000-0000-4000-8000-000000000001", kind: "layover", place: "Frankfurt (FRA)", arrival: "May 4, 7:05", departure: "May 4, 9:40", notes: "Change terminals" };
const heidelberg = { id: "f0000000-0000-4000-8000-000000000002", kind: "stop", place: "Heidelberg", arrival: "", departure: "", notes: "Castle at sunset" };
const london = { id: "f0000000-0000-4000-8000-000000000003", kind: "layover", place: "London Heathrow (LHR)", arrival: "", departure: "", notes: "" };
const windsor = { id: "f0000000-0000-4000-8000-000000000004", kind: "stop", place: "Windsor", arrival: "", departure: "", notes: "" };
/** A connection's itinerary in travel order, layovers and other stops in turn. */
const itinerary = [frankfurt, heidelberg, london, windsor];
const plan = { timeZone: "Europe/Berlin", arrival: "2027-05-04T07:05", departure: "2027-05-04T09:40", immigrationMinutes: 0, customsMinutes: 0, securityMinutes: 30, transferMinutes: 15, boardingMinutes: 30, returnMinutes: null, activities: [] };

/** A connection's card's list of `group`'s entries, as host elements, with its saved plans and what its controls call. */
function cardList(group, stops = itinerary) {
  const { itinerary: { ConnectionItinerary } } = components(hooks({ slots: [], cursor: 0 }));
  const calls = [];
  const tree = render(ConnectionItinerary({ group, legId: "leg", stops, plans: [{ layoverId: frankfurt.id, ...plan }], disabled: false, onPlan: (stop) => calls.push(["plan", stop.id]), onRemovePlan: (stop) => calls.push(["remove", stop.id]) }));
  const list = tree.find((node) => node.type === "ol");
  // A plan's schedule is a list of its own, inside its layover's entry.
  const items = list?.props.children.filter((node) => node.type === "li");
  return {
    calls,
    list,
    /** Each entry: its ID on the page, its number, its kind and its place. */
    entries: items?.map((item) => {
      const [number, detail] = item.props.children;
      return [item.props.id, text(number), text(within(detail).find((node) => node.props.className === "connection-itinerary-kind")), text(within(detail).find((node) => node.type === "strong"))];
    }),
    /** The labels of each entry's buttons. */
    buttons: items?.map((item) => within(item).filter((node) => node.type === "button").map((button) => button.props["aria-label"])),
  };
}

test("a flight's card lists its layovers in their saved order apart from its other stops, each entry once, where the map leads (TRA-184)", () => {
  const layovers = cardList("layovers");
  assert.equal(layovers.list.props["aria-label"], "Layovers on this flight");
  assert.deepEqual(layovers.entries, [
    [tripMap.itineraryTarget("leg", frankfurt.id), "1", "Layover", "Frankfurt (FRA)"],
    [tripMap.itineraryTarget("leg", london.id), "2", "Layover", "London Heathrow (LHR)"],
  ], "only layovers, numbered from 1 in travel order");
  assert.deepEqual(layovers.buttons, [["Edit the layover plan for Frankfurt (FRA)", "Remove the layover plan for Frankfurt (FRA)"], ["Plan your layover in London Heathrow (LHR)"]], "each with its plan or Plan layover");
  const stops = cardList("stops");
  assert.equal(stops.list.props["aria-label"], "Stops along this connection");
  assert.deepEqual(stops.entries, [
    [tripMap.itineraryTarget("leg", heidelberg.id), "1", "Stop", "Heidelberg"],
    [tripMap.itineraryTarget("leg", windsor.id), "2", "Stop", "Windsor"],
  ]);
  assert.deepEqual(stops.buttons, [[], []], "other stops have no plan");
  const shown = [...layovers.entries, ...stops.entries].map(([id]) => id);
  assert.deepEqual(shown.toSorted(), itinerary.map((stop) => tripMap.itineraryTarget("leg", stop.id)).toSorted(), "every entry shows once");

  // Any other connection lists its whole itinerary in travel order, as before.
  const all = cardList("all");
  assert.equal(all.list.props["aria-label"], "Stops along this connection");
  assert.deepEqual(all.entries.map(([id, number, kind]) => [id, number, kind]), itinerary.map((stop, index) => [tripMap.itineraryTarget("leg", stop.id), String(index + 1), stop.kind === "layover" ? "Layover" : "Stop"]));
  // A part without entries shows nothing.
  assert.equal(cardList("layovers", [heidelberg, windsor]).list, undefined);
  assert.equal(cardList("stops", [frankfurt]).list, undefined);
  // Plan layover and the plan's controls work as they did.
  within(layovers.list).find((node) => node.props["aria-label"] === "Plan your layover in London Heathrow (LHR)").props.onClick();
  within(layovers.list).find((node) => node.props["aria-label"] === "Remove the layover plan for Frankfurt (FRA)").props.onClick();
  assert.deepEqual(layovers.calls, [["plan", london.id], ["remove", frankfurt.id]]);
});

/**
 * A connection's editor's parts, as it shows them: a flight's layovers and Stops along the way, or for a connection that
 * isn't a flight, Stops along the way alone. Both edit one itinerary, held as the editor holds it.
 */
function editorParts(stops, { flight = true, planned = [] } = {}) {
  const state = { slots: [], cursor: 0 };
  const { itinerary: { ConnectionItineraryEditor, groupAlongTheWay } } = components(hooks(state));
  let held = stops;
  let shown;
  const show = () => {
    state.cursor = 0;
    const part = (group) => render(ConnectionItineraryEditor({ group, stops: held, onChange: (next) => { held = next; }, planned, disabled: false })).flatMap(within);
    shown = { layovers: flight ? part("layovers") : [], along: part(groupAlongTheWay(flight)) };
  };
  show();
  const labeled = (part, label) => shown[part].filter((node) => node.type === "label" && text(node.props.children[0]) === label).map((node) => within(node).find((child) => ["input", "select", "textarea"].includes(child.type)));
  const control = (part, name) => shown[part].find((node) => node.type === "button" && (node.props["aria-label"] ?? text(node)) === name);
  return {
    /** The itinerary as the editor holds it, to save. */
    itinerary: () => copy(held),
    section: (part) => shown[part][0],
    heading: (part) => text(shown[part].find((node) => node.type === "h3")),
    help: (part) => text(shown[part].find((node) => node.type === "p")),
    legends: (part) => shown[part].filter((node) => node.type === "legend").map(text),
    places: (part) => labeled(part, "Place").map((input) => input.props.value),
    /** The part's Add buttons, by their text, and whether each is disabled. */
    adds: (part) => shown[part].filter((node) => node.type === "button" && !node.props["aria-label"]).map((button) => [text(button), button.props.disabled]),
    /** The names of the part's buttons for its entries. */
    tools: (part) => shown[part].filter((node) => node.type === "button" && node.props["aria-label"]).map((button) => button.props["aria-label"]),
    /** What each entry's fields say about its plan. */
    notes: (part) => shown[part].filter((node) => node.type === "fieldset").map((fieldset) => within(fieldset).filter((node) => node.type === "p").map(text)),
    status: (part) => text(shown[part].find((node) => node.props.role === "status")),
    paragraphs: (part) => shown[part].filter((node) => node.type === "p").map(text),
    /** Types into, or chooses in, the part's nth field with `label`, and renders again. */
    set(part, label, value, nth = 0) { labeled(part, label)[nth].props.onChange({ target: { value } }); show(); },
    /** Selects the part's button named `name`, and renders again. */
    click(part, name) { control(part, name).props.onClick({ currentTarget: control(part, name) }); show(); },
    /** Changes the connection's transportation to or from a flight, as typing in Transportation does. */
    flight(value) { flight = value; show(); },
  };
}

test("a flight's layovers are edited in its own part, and its other stops under Stops along the way, as one itinerary (TRA-184)", () => {
  const ui = editorParts(itinerary, { planned: [frankfurt.id] });
  assert.deepEqual([ui.heading("layovers"), ui.legends("layovers"), ui.places("layovers"), ui.adds("layovers")], ["Layovers", ["1. Layover", "2. Layover"], ["Frankfurt (FRA)", "London Heathrow (LHR)"], [["Add layover", false]]]);
  assert.equal(ui.help("layovers"), "Add the flight’s layovers in travel order. Once saved, each can have a plan from Plan layover on the trip page.");
  assert.equal(ui.section("layovers").props.className, "connection-itinerary-editor flight-layovers");
  assert.deepEqual([ui.heading("along"), ui.legends("along"), ui.places("along"), ui.adds("along")], ["Stops along the way", ["1. Stop", "2. Stop"], ["Heidelberg", "Windsor"], [["Add stop", false]]]);
  assert.equal(ui.help("along"), "Add optional points of interest or other stops in travel order. The connection’s estimated price covers the full itinerary.");
  // Each control is named for its part, so none shares another's name.
  const tools = [...ui.tools("layovers"), ...ui.tools("along")];
  assert.deepEqual(tools.slice(0, 3), ["Move layover 1 up", "Move layover 1 down", "Remove layover 1"]);
  assert.deepEqual(tools.slice(6, 9), ["Move stop 1 up", "Move stop 1 down", "Remove stop 1"]);
  assert.equal(new Set(tools).size, tools.length);
  assert.deepEqual(ui.notes("layovers"), [["This layover has a plan. Removing the layover, or changing it to another kind of stop, removes its plan when you save."], []]);

  // A layover's place, times and notes are edited in the flight's part, changing only it.
  ui.set("layovers", "Place", "Frankfurt am Main (FRA)");
  ui.set("layovers", "Arrival at stop", "May 4, 7:15");
  ui.set("layovers", "Departure from stop", "May 4, 9:50", 0);
  ui.set("layovers", "Stop notes", "Terminal 1 to 2", 0);
  const frankfurtNow = { ...frankfurt, place: "Frankfurt am Main (FRA)", arrival: "May 4, 7:15", departure: "May 4, 9:50", notes: "Terminal 1 to 2" };
  assert.deepEqual(ui.itinerary(), [frankfurtNow, heidelberg, london, windsor]);

  // Up and Down move an entry within its part: the other part's entries keep their places in travel order.
  ui.click("layovers", "Move layover 2 up");
  assert.deepEqual(ui.itinerary(), [london, heidelberg, frankfurtNow, windsor]);
  assert.equal(ui.status("layovers"), "London Heathrow (LHR) moved to position 1.");
  ui.click("along", "Move stop 2 up");
  assert.deepEqual(ui.itinerary(), [london, windsor, frankfurtNow, heidelberg]);
  assert.deepEqual([ui.places("layovers"), ui.places("along")], [["London Heathrow (LHR)", "Frankfurt am Main (FRA)"], ["Windsor", "Heidelberg"]]);

  // Add layover adds one last in travel order, in the flight's part, and Add stop one under Stops along the way.
  ui.click("layovers", "Add layover");
  const added = { id: "00000000-0000-4000-8000-000000000001", kind: "layover", place: "", arrival: "", departure: "", notes: "" };
  assert.deepEqual(ui.itinerary(), [london, windsor, frankfurtNow, heidelberg, added]);
  assert.deepEqual([ui.legends("layovers"), ui.status("layovers")], [["1. Layover", "2. Layover", "3. Layover"], "Layover added at position 3."]);
  ui.click("along", "Add stop");
  assert.deepEqual(ui.itinerary().at(-1), { ...added, id: "00000000-0000-4000-8000-000000000002", kind: "stop" });
  assert.deepEqual(ui.legends("along"), ["1. Stop", "2. Stop", "3. Stop"]);

  // Removing a layover with a plan says saving removes the plan, and keeps every other entry.
  ui.click("layovers", "Remove layover 2");
  assert.deepEqual(ui.itinerary().map((stop) => stop.id), [london.id, windsor.id, heidelberg.id, added.id, "00000000-0000-4000-8000-000000000002"]);
  assert.equal(ui.status("layovers"), "Frankfurt am Main (FRA) removed. Saving removes its layover plan.");
  ui.click("along", "Remove stop 3");
  assert.equal(ui.status("along"), "Stop removed.");
  assert.deepEqual(ui.itinerary().map((stop) => stop.id), [london.id, windsor.id, heidelberg.id, added.id]);
});

test("changing an entry's Stop type moves it to the other part in its place, keeping its plan's warning (TRA-184)", () => {
  const ui = editorParts(itinerary, { planned: [frankfurt.id] });
  ui.set("layovers", "Stop type", "stop");
  assert.deepEqual(ui.itinerary(), [{ ...frankfurt, kind: "stop" }, heidelberg, london, windsor], "it keeps its place in travel order");
  assert.deepEqual([ui.places("layovers"), ui.places("along")], [["London Heathrow (LHR)"], ["Frankfurt (FRA)", "Heidelberg", "Windsor"]]);
  assert.equal(ui.status("layovers"), "Frankfurt (FRA) moved to Stops along the way.");
  assert.deepEqual(ui.notes("along")[0], ["This layover has a plan. Removing the layover, or changing it to another kind of stop, removes its plan when you save."], "saving it as a stop still removes its plan, as it says");
  ui.set("along", "Stop type", "layover", 2);
  assert.deepEqual(ui.itinerary(), [{ ...frankfurt, kind: "stop" }, heidelberg, london, { ...windsor, kind: "layover" }]);
  assert.deepEqual([ui.places("layovers"), ui.places("along")], [["London Heathrow (LHR)", "Windsor"], ["Frankfurt (FRA)", "Heidelberg"]]);
  assert.equal(ui.status("along"), "Windsor moved to Layovers, with the flight.");
  ui.set("along", "Stop type", "layover", 0);
  assert.deepEqual(ui.itinerary(), itinerary.map((stop) => stop === windsor ? { ...windsor, kind: "layover" } : stop), "and back");
  assert.deepEqual(ui.places("layovers"), ["Frankfurt (FRA)", "London Heathrow (LHR)", "Windsor"], "in travel order");
});

test("a connection that isn't a flight edits its whole itinerary under Stops along the way, layovers included, as before (TRA-184)", () => {
  const ui = editorParts(itinerary, { flight: false, planned: [frankfurt.id] });
  assert.deepEqual(ui.places("layovers"), [], "there is no flight's part");
  assert.deepEqual([ui.heading("along"), ui.legends("along"), ui.adds("along")], ["Stops along the way", ["1. Layover", "2. Stop", "3. Layover", "4. Stop"], [["Add layover", false], ["Add stop", false]]]);
  assert.equal(ui.help("along"), "Add optional layovers or points of interest in travel order. The connection’s estimated price covers the full itinerary.");
  assert.deepEqual(ui.tools("along").slice(0, 3), ["Move stop 1 up", "Move stop 1 down", "Remove stop 1"]);
  // Its entries move among all of them, and changing a kind keeps an entry where it is.
  ui.click("along", "Move stop 2 down");
  assert.deepEqual(ui.itinerary(), [frankfurt, london, heidelberg, windsor]);
  ui.set("along", "Stop type", "layover", 3);
  assert.deepEqual(ui.legends("along"), ["1. Layover", "2. Layover", "3. Stop", "4. Layover"]);
  assert.equal(ui.status("along"), "Heidelberg moved to position 3.", "no part to move to");
  // Naming a flight again shows its layovers in its own part, unchanged, and its other stops under Stops along the way.
  ui.flight(true);
  assert.deepEqual([ui.places("layovers"), ui.places("along")], [["Frankfurt (FRA)", "London Heathrow (LHR)", "Windsor"], ["Heidelberg"]]);
  assert.deepEqual(ui.itinerary(), [frankfurt, london, heidelberg, { ...windsor, kind: "layover" }]);
});

test("a connection's layovers and other stops share its limit of 30 (TRA-184)", () => {
  const entries = (count) => Array.from({ length: count }, (_, index) => ({ id: `e0000000-0000-4000-8000-${String(index).padStart(12, "0")}`, kind: index % 2 ? "stop" : "layover", place: "Place " + index, arrival: "", departure: "", notes: "" }));
  const room = editorParts(entries(29));
  assert.deepEqual([room.adds("layovers"), room.adds("along")], [[["Add layover", false]], [["Add stop", false]]]);
  room.click("along", "Add stop");
  assert.equal(room.itinerary().length, 30);
  for (const part of ["layovers", "along"]) {
    assert.deepEqual(room.adds(part).map(([, disabled]) => disabled), [true], part + " can't add more");
    assert.ok(room.paragraphs(part).includes("This connection has the maximum of 30 layovers and stops."), part + " says why");
  }
  room.click("layovers", "Add layover");
  assert.equal(room.itinerary().length, 30, "adding does nothing");
  const other = editorParts(entries(30), { flight: false });
  assert.deepEqual(other.adds("along"), [["Add layover", true], ["Add stop", true]]);
  assert.ok(other.paragraphs("along").includes("This connection has the maximum of 30 layovers and stops."));
});

// The trip's page, rendered by the planner from what the store gives `/trips/<trip ID>`, with the connection components,
// React's state kept between renders, and its saves made by the store.
/** A submitted form's fields, as the planner reads them from the form's elements. */
class FormData {
  constructor(form) { this.fields = form.fields; }
  get(name) { return name in this.fields ? this.fields[name] : null; }
  has(name) { return name in this.fields; }
  getAll(name) { return name in this.fields ? [this.fields[name]] : []; }
}

function tripPage(store, tripId) {
  const state = { slots: [], cursor: 0 };
  const react = hooks(state);
  const { itinerary: itineraryComponents, flight, plans } = components(react);
  const sent = [];
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), unstable_isUnrecognizedActionError: () => false },
    // The page's save, made by the store as the signed-in owner.
    "@/app/actions": { mutatePlanner: async (mutation) => { sent.push(copy(mutation)); return { ok: true, ...store.applyMutation(mutation) }; } },
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort,
    "@/lib/trip-map": tripMap, "@/lib/transportation-methods": transportation, "@/lib/layover-plan": layoverPlan,
    "@/components/connection-itinerary": itineraryComponents, "@/components/connection-flight": flight, "@/components/layover-plan": plans,
  };
  // Every other module is one these checks don't need: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  const { default: PlannerApp } = run("../src/components/planner-app.tsx", (name) => modules[name] ?? unused, { FormData });
  let props;
  let shown;
  // It renders twice, as React renders again at once when the page changes its state while rendering, as it does on
  // loading a trip again.
  const show = () => { for (let pass = 0; pass < 2; pass++) { state.cursor = 0; shown = render(PlannerApp(props)); } };
  const reload = () => { const { data, access, library } = store.getTripSnapshot(tripId); props = { initialData: data, access: { [tripId]: access }, library, tripId }; show(); };
  reload();
  const all = () => shown.flatMap(within);
  return {
    sent,
    all,
    find: (match) => all().find(match),
    /** The open editor's title, or undefined without one. */
    dialog: () => { const dialog = all().find((node) => node.type === "dialog"); return dialog && text(within(dialog).find((node) => node.type === "h2")); },
    click(button) { button.props.onClick({ currentTarget: button }); show(); },
    type(input, value) { input.props.onChange({ target: { value } }); show(); },
    /** Submits the open editor with `fields`, waits for its save, and loads the page again. */
    async submit(fields) {
      all().find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { fields } });
      await new Promise((resolve) => setImmediate(resolve));
      reload();
    },
  };
}

test("on the trip page and in its editor, a flight's layovers are with its airline and flight number, and saving keeps one itinerary (TRA-184)", async (t) => {
  const { store, tripId } = setup(t);
  addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const outbound = store.getSnapshot().legs.find((leg) => leg.tripId === tripId && leg.fromId === null).id;
  const save = { type: "leg.save", id: outbound, method: "Flight", airline: "Lufthansa", flightNumber: "LH 425", price: "980", miscAmount: "40", departure: "May 3, 18:30", arrival: "May 4, 11:55", url: "", notes: "Seats 23A and 23B" };
  store.applyMutation({ ...save, itinerary: [frankfurt, heidelberg, london] });
  store.applyMutation({ type: "leg.layoverPlan", id: outbound, layoverId: frankfurt.id, plan });
  const estimate = budget.calculateBudget(store.getSnapshot(), tripId);
  const journey = () => tripMap.tripJourney(store.getTripSnapshot(tripId).data, tripId).places.filter((place) => place.connection).map((place) => [place.kind, place.target]);
  const mapped = journey();
  const page = tripPage(store, tripId);

  /** The connection's card: what its content shows, in order, and the entries of the list labeled `label`. */
  const content = () => within(page.find((node) => node.type === "article" && node.props.id === tripMap.connectionTarget(outbound))).find((node) => node.props.className === "travel-content").props.children;
  const outline = () => content().map((child) => child.type === "ol" ? child.props["aria-label"] : child.props.className || child.type);
  const entries = (label) => content().find((child) => child.props["aria-label"] === label).props.children.map((node) => node.props.id);
  const target = (stop) => tripMap.itineraryTarget(outbound, stop.id);
  assert.deepEqual(outline(), ["h3", "p", "details", "Layovers on this flight", "preserve-lines", "Stops along this connection", "price", "price"], "layovers directly below the airline and flight number, then the notes and the other stops");
  assert.deepEqual(entries("Layovers on this flight"), [target(frankfurt), target(london)]);
  assert.deepEqual(entries("Stops along this connection"), [target(heidelberg)]);
  const onPage = page.all().map((node) => node.props.id).filter((id) => id?.startsWith("itinerary-"));
  assert.deepEqual(onPage.toSorted(), [frankfurt, heidelberg, london].map(target).toSorted(), "each entry once");
  assert.deepEqual(mapped, [["layover", target(frankfurt)], ["stop", target(heidelberg)], ["layover", target(london)]], "the map's markers lead to them, in travel order");

  // The editor shows the flight's layovers in its flight, below Airline and Flight number, and its other stops last.
  page.click(page.find((node) => node.type === "button" && node.props["aria-label"] === "Edit travel from Boston to Vienna"));
  assert.equal(page.dialog(), "Plan this connection");
  const flightPart = () => page.find((node) => node.type === "div" && "hidden" in node.props && within(node).some((child) => child.props.name === "airline"));
  const section = (title) => page.find((node) => node.type === "section" && node.props.children.some((child) => child.type === "h3" && text(child) === title));
  const places = (node) => within(node).filter((child) => child.type === "label" && text(child.props.children[0]) === "Place").map((label) => within(label).find((child) => child.type === "input").props.value);
  const transportationField = () => page.find((node) => node.type === "input" && node.props.name === "method");
  assert.equal(flightPart().props.hidden, false);
  assert.ok(within(flightPart()).includes(section("Layovers")), "in the flight's part");
  assert.deepEqual([places(section("Layovers")), places(section("Stops along the way"))], [["Frankfurt (FRA)", "London Heathrow (LHR)"], ["Heidelberg"]]);
  const fields = within(page.find((node) => node.type === "dialog")).filter((node) => node.type === "input" || node.type === "textarea" || node.type === "section").map((node) => node.props.name ?? node.type);
  assert.ok(fields.indexOf("flightNumber") < fields.indexOf("section") && fields.indexOf("section") < fields.indexOf("price"), "between the flight number and the price");

  // While Transportation names no flight, every entry is under Stops along the way, and naming one again moves them back.
  page.type(transportationField(), "Train");
  assert.deepEqual([flightPart().props.hidden, section("Layovers")], [true, undefined]);
  assert.deepEqual(places(section("Stops along the way")), ["Frankfurt (FRA)", "Heidelberg", "London Heathrow (LHR)"]);
  page.type(transportationField(), "Flight");
  assert.deepEqual([places(section("Layovers")), places(section("Stops along the way"))], [["Frankfurt (FRA)", "London Heathrow (LHR)"], ["Heidelberg"]]);

  // Moving a layover and saving keeps every entry's ID and details, the other stop's place, and the plan.
  page.click(page.find((node) => node.type === "button" && node.props["aria-label"] === "Move layover 2 up"));
  await page.submit({ method: "Flight", airline: "Lufthansa", flightNumber: "LH 425", price: "980", miscAmount: "40", departure: save.departure, arrival: save.arrival, notes: save.notes });
  assert.deepEqual(page.sent.at(-1).itinerary, [london, heidelberg, frankfurt]);
  assert.equal(page.dialog(), undefined, "saving closes it");
  assert.deepEqual(entries("Layovers on this flight"), [target(london), target(frankfurt)]);
  assert.deepEqual(entries("Stops along this connection"), [target(heidelberg)]);
  assert.ok(within(page.find((node) => node.props.id === target(frankfurt))).some((node) => node.props["aria-label"] === "Edit the layover plan for Frankfurt (FRA)"), "Frankfurt keeps its plan");
  assert.deepEqual(budget.calculateBudget(store.getSnapshot(), tripId), estimate, "the estimate is unchanged");

  // Saved as a train, the card lists every entry together, each layover still with its plan or Plan layover.
  page.click(page.find((node) => node.type === "button" && node.props["aria-label"] === "Edit travel from Boston to Vienna"));
  page.type(transportationField(), "Train");
  await page.submit({ method: "Train", airline: "Lufthansa", flightNumber: "LH 425", price: "980", miscAmount: "40", departure: save.departure, arrival: save.arrival, notes: save.notes });
  assert.deepEqual(page.sent.at(-1).itinerary, [london, heidelberg, frankfurt]);
  assert.deepEqual(outline(), ["h3", "p", "preserve-lines", "Stops along this connection", "price", "price"]);
  assert.deepEqual(entries("Stops along this connection"), [target(london), target(heidelberg), target(frankfurt)]);
  assert.ok(within(page.find((node) => node.props.id === target(frankfurt))).some((node) => node.props["aria-label"] === "Edit the layover plan for Frankfurt (FRA)"));
  assert.deepEqual(store.getSnapshot().legs.find((leg) => leg.id === outbound).layoverPlans.map((saved) => saved.layoverId), [frankfurt.id]);
  assert.deepEqual(journey(), [["layover", target(london)], ["stop", target(heidelberg)], ["layover", target(frankfurt)]]);
});

// TRA-186: the same trip page, for a flight's estimated miles required beside its price.
test("a flight's miles show on its card below its price, and its editor's Estimated miles required, below Estimated price (USD), saves them, blank as unknown (TRA-186)", async (t) => {
  const { store, tripId } = setup(t);
  addDestination(store, tripId, { city: "London", nights: 4 });
  const outbound = store.getSnapshot().legs.find((leg) => leg.tripId === tripId && leg.fromId === null).id;
  const fields = { method: "Flight", airline: "Aer Lingus", flightNumber: "EI 124", price: "1250", miscAmount: "60", departure: "", arrival: "", notes: "" };
  store.applyMutation({ type: "leg.save", id: outbound, ...fields, url: "" });
  const estimate = budget.calculateBudget(store.getSnapshot(), tripId);
  let page = tripPage(store, tripId);
  const card = () => within(page.find((node) => node.type === "article" && node.props.id === tripMap.connectionTarget(outbound)));
  /** The card's price, miles and spending, in order. */
  const prices = () => card().filter((node) => node.type === "span" && node.props.className?.startsWith("price")).map(text);
  const edit = () => page.click(page.find((node) => node.type === "button" && node.props["aria-label"] === "Edit travel from Boston to London"));
  const milesPart = () => page.find((node) => node.type === "div" && "hidden" in node.props && within(node).some((child) => child.props.name === "milesRequired"));
  const saved = () => store.getSnapshot().legs.find((leg) => leg.id === outbound);
  assert.deepEqual(prices(), ["$1,250", "Miscellaneous spending: $60"], "a flight without miles shows none");

  edit();
  const inputs = within(page.find((node) => node.type === "dialog")).filter((node) => node.type === "input").map((node) => node.props.name);
  assert.equal(inputs.indexOf("milesRequired"), inputs.indexOf("price") + 1, "directly below Estimated price (USD)");
  assert.equal(milesPart().props.hidden, false, "shown for a flight");
  await page.submit({ ...fields, milesRequired: "85000" });
  assert.equal(page.sent.at(-1).milesRequired, 85000, "sent as a whole number");
  assert.deepEqual(prices(), ["$1,250", "85,000 miles required", "Miscellaneous spending: $60"], "directly below the price");
  assert.deepEqual(budget.calculateBudget(store.getSnapshot(), tripId), estimate, "the estimate is unchanged");

  // Miles alone don't stand in for an unknown price, and a blank field saves unknown miles, never 0.
  edit();
  await page.submit({ ...fields, price: "", milesRequired: "85000" });
  assert.deepEqual([saved().priceCents, saved().milesRequired], [null, 85000]);
  assert.deepEqual(prices(), ["Not estimated · Needs estimate", "85,000 miles required", "Miscellaneous spending: $60"]);
  edit();
  await page.submit({ ...fields, milesRequired: "" });
  assert.deepEqual([page.sent.at(-1).milesRequired, saved().milesRequired], [null, null]);
  assert.deepEqual(prices(), ["$1,250", "Miscellaneous spending: $60"]);
  edit();
  await page.submit({ ...fields, milesRequired: "0" });
  assert.deepEqual(prices(), ["$1,250", "0 miles required", "Miscellaneous spending: $60"], "0 is known");

  // While Transportation names no airplane the field hides and is disabled, so the browser leaves it out of the save,
  // which keeps the miles, and the card shows none until the connection is a flight again.
  edit();
  page.type(page.find((node) => node.type === "input" && node.props.name === "method"), "Train");
  assert.deepEqual([milesPart().props.hidden, within(milesPart()).find((node) => node.props.name === "milesRequired").props.disabled], [true, true]);
  await page.submit({ ...fields, method: "Train" });
  assert.equal("milesRequired" in page.sent.at(-1), false, "the save leaves them out");
  assert.equal(saved().milesRequired, 0, "which keeps them");
  assert.deepEqual(prices(), ["$1,250", "Miscellaneous spending: $60"], "a connection that isn't a flight shows none");

  // A connection with only miles can be cleared, and the confirmation names them.
  store.applyMutation({ type: "leg.clear", id: outbound });
  store.applyMutation({ type: "leg.save", id: outbound, method: "", price: "", departure: "", arrival: "", url: "", notes: "", milesRequired: 85000 });
  page = tripPage(store, tripId);
  const clear = card().find((node) => node.type === "button" && text(node) === "Clear");
  assert.ok(clear, "Clear shows for a connection with only miles");
  page.click(clear);
  assert.match(text(page.find((node) => node.props.className === "delete-description wide")), /with its price, miles required, miscellaneous spending,/);
});
