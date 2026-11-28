import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import { pageHelp } from "../src/lib/help.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import * as money from "../src/lib/money.ts";
import { isValidationError, SCHEMA_VERSION } from "../src/lib/store.ts";
import * as transportation from "../src/lib/transportation-methods.ts";
import * as tripBestTime from "../src/lib/trip-best-time.ts";
import * as tripCalendar from "../src/lib/trip-calendar.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripMap from "../src/lib/trip-map.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import * as typicalWeather from "../src/lib/typical-weather.ts";
import { aiSetup } from "./ai-fixtures.mjs";
import { addDestination, candidateInput, fileDatabase, setup, stop, stopEdit, tripInput } from "./budget-fixtures.mjs";
import { contrast, cssRules } from "./css-rules.mjs";
import { createOwnedStore } from "./owned-store.mjs";

// TRA-185: each trip's Calendar, its days in order, Day 1, Day 2 and on, with their dates once the trip has a start date,
// what happens on each, and where each night is spent: at a destination, or traveling, on a connection's nights spent
// traveling, which move the trip's later days and dates and count as no destination's nights. It is worked out from the
// trip's saved route alone, read only, and invents nothing after a destination whose nights aren't set.

const { MAX_CALENDAR_DAYS } = tripCalendar;
const calendarOf = (store, tripId) => tripCalendar.tripCalendar(store.getTripSnapshot(tripId).data, tripId);
/** A trip's connection from `fromId` to `toId`, null for the departing and return cities. */
const legOf = (store, tripId, fromId, toId) => store.getSnapshot().legs.find((leg) => leg.tripId === tripId && leg.fromId === fromId && leg.toId === toId);
/** Saves a connection's transportation and nights spent traveling, as its editor does, with nothing else. */
const plan = (store, tripId, fromId, toId, method, travelNights = 0) => store.applyMutation({ type: "leg.save", id: legOf(store, tripId, fromId, toId).id, method, price: "", departure: "", arrival: "", url: "", notes: "", travelNights });
/** What happens on a day, in words. */
const what = (event) => event.kind === "end" ? `end in ${event.place}` : "stay" in event ? `${event.kind} ${event.stay.place}` : `${event.kind} ${event.leg.method || "Travel"}: ${event.leg.from} → ${event.leg.to}`;
/** Where a night is spent, in words, or null after the last day. */
const where = (night) => night === null ? null : "stay" in night ? `${night.kind} ${night.stay.place}` : `traveling ${night.leg.method || "Travel"}: ${night.leg.from} → ${night.leg.to}`;
/** Each day of a calendar: its number, what happens and where its night is spent. */
const outline = (calendar) => calendar.days.map((day) => [day.number, ...day.events.map(what), where(day.night)]);

/** The ticket's example: an overnight flight to Paris, three nights there, then Rome, by train the same day, for two. */
function parisAndRome(t, trip = tripInput()) {
  const { store, tripId } = setup(t, trip);
  const paris = addDestination(store, tripId, { city: "Paris", nights: 3 });
  const rome = addDestination(store, tripId, { city: "Rome", nights: 2 });
  plan(store, tripId, null, paris, "Flight", 1);
  plan(store, tripId, paris, rome, "Train");
  plan(store, tripId, rome, null, "Flight");
  return { store, tripId, paris, rome };
}

test("a trip's calendar numbers its days from Day 1 without dates, and spends each night at a destination or traveling, never both (TRA-185)", (t) => {
  const { store, tripId, paris } = parisAndRome(t);
  const calendar = calendarOf(store, tripId);
  assert.deepEqual(outline(calendar), [
    [1, "travel Flight: Boston → Paris", "traveling Flight: Boston → Paris"],
    [2, "arrive Paris", "stay Paris"],
    [3, "stay Paris", "stay Paris"],
    [4, "stay Paris", "stay Paris"],
    [5, "depart Paris", "travel Train: Paris → Rome", "arrive Rome", "stay Rome"],
    [6, "stay Rome", "stay Rome"],
    [7, "depart Rome", "travel Flight: Rome → Boston", "end in Boston", null],
  ], "arriving on Day 2 for three nights departs on Day 5, and Paris's departure and Rome's arrival share it");
  assert.ok(calendar.days.every((day) => day.date === null), "without a start date, no day has a date");
  assert.deepEqual([calendar.unlisted, calendar.waitingFor, calendar.unscheduled], [0, null, []]);
  // Each night once: a destination's nights are its own, and the night spent traveling is no destination's.
  const nights = calendar.days.map((day) => where(day.night)).filter(Boolean);
  assert.deepEqual([nights.filter((night) => night === "stay Paris").length, nights.filter((night) => night === "stay Rome").length, nights.filter((night) => night.startsWith("traveling")).length], [3, 2, 1]);
  assert.equal(stop(store, paris).nights, 3, "Paris keeps its three nights");
});

test("with a start date each day has its date, the stays' dates and the trip's end among them, and the start date stays Day 1 (TRA-185)", (t) => {
  const { store, tripId, paris, rome } = parisAndRome(t, tripInput({ startDate: "2027-06-05" }));
  const days = calendarOf(store, tripId).days;
  assert.deepEqual(days.map((day) => day.date), ["2027-06-05", "2027-06-06", "2027-06-07", "2027-06-08", "2027-06-09", "2027-06-10", "2027-06-11"]);
  const dayOf = (kind, id) => days.find((day) => day.events.some((event) => event.kind === kind && event.stay?.stopId === id)).date;
  assert.deepEqual([dayOf("arrive", paris), dayOf("depart", paris), dayOf("arrive", rome), dayOf("depart", rome)], [stop(store, paris).arrivalDate, stop(store, paris).departureDate, stop(store, rome).arrivalDate, stop(store, rome).departureDate]);
  const trip = store.getSnapshot().trips[0];
  assert.deepEqual([days[0].date, days.at(-1).date], [trip.startDate, trip.endDate]);
});

test("nights spent traveling add days before the first destination, between destinations and on the way home, and a same-day visit has no night (TRA-185)", (t) => {
  const { store, tripId } = setup(t);
  const lisbon = addDestination(store, tripId, { city: "Lisbon", nights: 2 });
  const porto = addDestination(store, tripId, { city: "Porto", nights: 0 });
  plan(store, tripId, null, lisbon, "Cruise", 2);
  plan(store, tripId, lisbon, porto, "");
  plan(store, tripId, porto, null, "Flight", 1);
  assert.deepEqual(outline(calendarOf(store, tripId)), [
    [1, "travel Cruise: Boston → Lisbon", "traveling Cruise: Boston → Lisbon"],
    [2, "transit Cruise: Boston → Lisbon", "traveling Cruise: Boston → Lisbon"],
    [3, "arrive Lisbon", "stay Lisbon"],
    [4, "stay Lisbon", "stay Lisbon"],
    [5, "depart Lisbon", "travel Travel: Lisbon → Porto", "visit Porto", "travel Flight: Porto → Boston", "traveling Flight: Porto → Boston"],
    [6, "end in Boston", null],
  ]);
  // Without any, the trip is as many days as before them: one more than its destinations' nights.
  for (const [fromId, toId] of [[null, lisbon], [porto, null]]) plan(store, tripId, fromId, toId, "Flight", 0);
  assert.equal(calendarOf(store, tripId).days.length, 3);
});

test("the connections and the trip's end are named as the trip page names them (TRA-185)", (t) => {
  const { store, tripId } = setup(t, tripInput({ homeCity: "" }));
  const paris = addDestination(store, tripId, { city: "Paris", nights: 1 });
  plan(store, tripId, null, paris, "");
  assert.deepEqual(outline(calendarOf(store, tripId)).map((day) => day.slice(1)), [
    ["travel Travel: Departing city → Paris", "arrive Paris", "stay Paris"],
    ["depart Paris", "travel Travel: Paris → Return city", "end in Return city", null],
  ]);
  store.applyMutation(tripInput({ id: tripId, homeCity: "Boston", returnCity: "Chicago" }));
  assert.deepEqual(outline(calendarOf(store, tripId)).at(-1).slice(1), ["depart Paris", "travel Travel: Paris → Chicago", "end in Chicago", null]);
});

test("after a destination without nights, the calendar lists the rest of the trip without days or dates, inventing none (TRA-185)", (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-04-01" }));
  const tokyo = addDestination(store, tripId, { city: "Tokyo", nights: 4 });
  const kyoto = addDestination(store, tripId, { city: "Kyoto", nights: null });
  const osaka = addDestination(store, tripId, { city: "Osaka", nights: 2 });
  plan(store, tripId, null, tokyo, "Flight", 1);
  plan(store, tripId, kyoto, osaka, "Night bus", 1);
  const calendar = calendarOf(store, tripId);
  assert.deepEqual(outline(calendar), [
    [1, "travel Flight: Boston → Tokyo", "traveling Flight: Boston → Tokyo"],
    [2, "arrive Tokyo", "stay Tokyo"],
    [3, "stay Tokyo", "stay Tokyo"],
    [4, "stay Tokyo", "stay Tokyo"],
    [5, "stay Tokyo", "stay Tokyo"],
    [6, "depart Tokyo", "travel Travel: Tokyo → Kyoto", "arrive Kyoto", "unknown Kyoto"],
  ], "the arrival in Kyoto is known, and its night isn't");
  assert.equal(calendar.days.at(-1).date, "2027-04-06");
  assert.deepEqual(calendar.waitingFor, { stopId: kyoto, place: "Kyoto", nights: null, hotel: null });
  assert.deepEqual(calendar.unscheduled.map((part) => part.kind === "stay" ? [part.stay.place, part.stay.nights] : [part.leg.method, part.leg.travelNights]),
    [["Night bus", 1], ["Osaka", 2], ["", 0]], "the rest of the route in travel order, each with what is saved for it");
  assert.deepEqual([stop(store, kyoto).arrivalDate, stop(store, osaka).arrivalDate, store.getSnapshot().trips[0].endDate], [null, null, null], "and no stored date after Tokyo");
  // Setting the nights gives the rest of the trip its days.
  store.applyMutation(stopEdit(kyoto, { nights: 2 }));
  // Ten nights: eight in Tokyo, Kyoto and Osaka, and two spent traveling.
  assert.deepEqual([calendarOf(store, tripId).days.length, calendarOf(store, tripId).waitingFor, calendarOf(store, tripId).unscheduled], [11, null, []]);
});

test("a trip without destinations has no days, and a destination's night names its chosen hotel, only while one is chosen (TRA-185)", (t) => {
  const { store, tripId } = setup(t);
  assert.deepEqual(calendarOf(store, tripId), { days: [], unlisted: 0, waitingFor: null, unscheduled: [] });
  const paris = addDestination(store, tripId, { city: "Paris", nights: 2 });
  const hotels = (name, included) => store.applyMutation(candidateInput(paris, "hotels", { name, included })).id;
  hotels("Hôtel Lutetia", false);
  assert.deepEqual(calendarOf(store, tripId).days.map((day) => day.night?.stay.hotel), [null, null, undefined], "an idea that isn't chosen isn't where anyone sleeps");
  hotels("Le Bristol", true);
  assert.deepEqual(calendarOf(store, tripId).days.map((day) => day.night?.stay.hotel), ["Le Bristol", "Le Bristol", undefined]);
});

test(`the calendar lists at most ${MAX_CALENDAR_DAYS} days and counts the rest (TRA-185)`, (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-01-01" }));
  addDestination(store, tripId, { city: "Paris", nights: 400 });
  const calendar = calendarOf(store, tripId);
  assert.equal(MAX_CALENDAR_DAYS, 366);
  assert.deepEqual([calendar.days.length, calendar.unlisted], [366, 35], "401 days, the last 35 not listed");
  assert.deepEqual([calendar.days.at(-1).number, calendar.days.at(-1).date, outline(calendar).at(-1)], [366, "2028-01-01", [366, "stay Paris", "stay Paris"]]);
});

test("the calendar follows destinations as they are added, moved and removed, their nights and the nights spent traveling (TRA-185)", (t) => {
  const { store, tripId } = setup(t);
  const paris = addDestination(store, tripId, { city: "Paris", nights: 2 });
  const places = () => calendarOf(store, tripId).days.map((day) => where(day.night));
  assert.deepEqual(places(), ["stay Paris", "stay Paris", null]);
  const rome = addDestination(store, tripId, { city: "Rome", nights: 1 });
  assert.deepEqual(places(), ["stay Paris", "stay Paris", "stay Rome", null]);
  plan(store, tripId, paris, rome, "Night train", 1);
  assert.deepEqual(places(), ["stay Paris", "stay Paris", "traveling Night train: Paris → Rome", "stay Rome", null]);
  store.applyMutation(stopEdit(paris, { nights: 1 }));
  assert.deepEqual(places(), ["stay Paris", "traveling Night train: Paris → Rome", "stay Rome", null]);
  // Moving Rome first replaces both connections that change, which start without nights spent traveling.
  store.applyMutation({ type: "stop.move", id: rome, direction: "up" });
  assert.deepEqual(places(), ["stay Rome", "stay Paris", null]);
  store.applyMutation({ type: "stop.remove", id: rome });
  assert.deepEqual(places(), ["stay Paris", null]);
});

// The trip page, rendered by the planner from what the store gives it, with a small hook harness that keeps state between
// renders, as React does. No browser is involved.
const element = (type, props) => ({ type, props });
function load(file, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}
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
/** A submitted form's fields, as the planner reads them. */
class FormData {
  constructor(form) { this.fields = form.fields; }
  get(name) { return name in this.fields ? this.fields[name] : null; }
  has(name) { return name in this.fields; }
  getAll(name) { return name in this.fields ? [this.fields[name]] : []; }
}

/** A trip's page as its owner sees it, with the changes it sends, and ways to use it. Its save is the Server Action's. */
function tripPage(store, tripId) {
  const slots = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(current) { const index = cursor++; if (!(index in slots)) slots[index] = { current }; return slots[index]; },
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
    "@/app/actions": {
      mutatePlanner: async (mutation) => {
        sent.push(structuredClone(mutation));
        try { return { ok: true, ...store.applyMutation(mutation) }; }
        catch (error) { if (isValidationError(error)) return { ok: false, error: error.message }; throw error; }
      },
    },
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort,
    "@/lib/trip-calendar": tripCalendar, "@/lib/transportation-methods": transportation, "@/lib/trip-map": tripMap,
    "@/lib/trip-best-time": tripBestTime, "@/lib/typical-weather": typicalWeather,
  };
  // Every other module is one these checks don't need: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  const cssModule = { default: new Proxy({}, { get: (_, name) => String(name) }) };
  const require = (name) => name.endsWith(".module.css") ? cssModule : modules[name] ?? unused;
  modules["@/components/transportation-icons"] = load("../src/components/transportation-icons.tsx", require);
  modules["@/components/trip-calendar"] = load("../src/components/trip-calendar.tsx", require);
  modules["@/components/trip-best-time"] = load("../src/components/trip-best-time.tsx", require);
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", require, { FormData });
  let props;
  let shown;
  const show = () => { for (let pass = 0; pass < 2; pass++) { cursor = 0; shown = render(PlannerApp(props)); } };
  const reload = () => { const { data, access, library } = store.getTripSnapshot(tripId); props = { initialData: data, access: { [tripId]: access }, library, tripId }; show(); };
  reload();
  const all = () => shown.flatMap(within);
  const dialog = () => all().find((node) => node.type === "dialog");
  const section = () => all().find((node) => node.type === "section" && node.props["aria-labelledby"] === "trip-calendar-heading");
  /** A line of a day: its title, and its detail or null. */
  const line = (node) => { const words = node.props.children.at(-1); return [text(words.props.children[0]), words.props.children[1] ? text(words.props.children[1]) : null]; };
  return {
    sent,
    /** The headings of the trip's sections, in order. */
    headings: () => all().filter((node) => node.type === "h2").map(text),
    /**
     * The Calendar section: the classes and text of its paragraphs but its eyebrow and the days' nights, each day's heading,
     * lines and night, with the night's class, and what it lists without days.
     */
    calendar() {
      const found = section();
      return {
        paragraphs: within(found).filter((node) => node.type === "p" && node.props.className !== "eyebrow" && !node.props.className.startsWith("night")).map((child) => [child.props.className, text(child)]),
        days: within(found).filter((node) => node.type === "li" && node.props.className === "day").map((day) => {
          const night = day.props.children.find((child) => child.type === "p");
          return {
            heading: text(day.props.children.find((child) => child.type === "h3")),
            lines: day.props.children.find((child) => child.type === "ul").props.children.map(line),
            night: night ? [night.props.className, ...line(night)] : null,
          };
        }),
        unscheduled: within(found).filter((node) => node.type === "ul" && node.props.className === "unscheduled").flatMap((list) => list.props.children.map(text)),
      };
    },
    /** A connection's card: its line of transportation and times, and whether it has Clear. */
    card(legId) {
      const card = all().find((node) => node.type === "article" && node.props.id === "connection-" + legId);
      return { line: text(within(card).find((node) => node.type === "p")), clear: within(card).some((node) => node.type === "button" && text(node) === "Clear") };
    },
    click(label) { const control = all().find((node) => node.type === "button" && (node.props["aria-label"] === label || text(node) === label)) ?? assert.fail("No button " + label); control.props.onClick({ currentTarget: control }); show(); },
    /** The open editor's title, its Nights spent traveling field's label, input and hint, a confirmation's description, and any error. */
    editor() {
      const open = dialog();
      if (!open) return undefined;
      const field = within(open).find((node) => node.type === "label" && within(node).some((child) => child.props.name === "travelNights"));
      const description = within(open).find((node) => node.props.className === "delete-description wide");
      const error = within(open).find((node) => node.props.className === "form-error");
      return {
        title: text(within(open).find((node) => node.type === "h2")), label: field && text(field.props.children[0]), input: field && within(field).find((node) => node.type === "input").props,
        hint: field && text(field.props.children.at(-1)), description: description && text(description), error: error && text(error),
      };
    },
    /** Submits the open editor with `fields`, waits for its save, and loads the page again. */
    async submit(fields) {
      within(dialog()).find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { fields } });
      await new Promise((resolve) => setImmediate(resolve));
      reload();
    },
  };
}

test("a trip's page shows its Calendar after Between the places, each day under its own heading with its date (TRA-185)", (t) => {
  const { store, tripId } = parisAndRome(t, tripInput({ startDate: "2027-06-05" }));
  const page = tripPage(store, tripId);
  const headings = page.headings();
  assert.equal(headings.indexOf("Calendar"), headings.indexOf("Between the places") + 1, "after the travel between the places");
  assert.equal(headings.indexOf("Best time to go"), headings.indexOf("Calendar") + 1, "and before Best time to go");
  const calendar = page.calendar();
  assert.deepEqual(calendar.days.map((day) => day.heading), ["Day 1, Sat, Jun 5, 2027", "Day 2, Sun, Jun 6, 2027", "Day 3, Mon, Jun 7, 2027", "Day 4, Tue, Jun 8, 2027", "Day 5, Wed, Jun 9, 2027", "Day 6, Thu, Jun 10, 2027", "Day 7, Fri, Jun 11, 2027"]);
  assert.deepEqual(calendar.paragraphs, [["description", "Each day from your departure to your return, and where each night is spent. It follows each destination's nights and each connection's nights spent traveling."]]);
  assert.deepEqual(calendar.days[0], {
    heading: "Day 1, Sat, Jun 5, 2027", lines: [["Flight: Boston → Paris", "1 night spent traveling · arrives on Day 2"]],
    night: ["night traveling", "Night 1: Spent traveling", "Flight: Boston → Paris"],
  }, "a night spent traveling is set apart from a destination's, naming the transportation and connection");
  assert.deepEqual(calendar.days[1].lines, [["Arrive in Paris", "3-night stay begins"]]);
  assert.deepEqual(calendar.days[1].night, ["night", "Night 2: Paris", null]);
  assert.deepEqual(calendar.days[2].lines, [["In Paris", null]]);
  assert.deepEqual(calendar.days[4].lines, [["Depart Paris", null], ["Train: Paris → Rome", null], ["Arrive in Rome", "2-night stay begins"]]);
  assert.deepEqual(calendar.days[6], { heading: "Day 7, Fri, Jun 11, 2027", lines: [["Depart Rome", null], ["Flight: Rome → Boston", null], ["Arrive in Boston", "End of the trip"]], night: null });
});

test("without a start date the Calendar's days have numbers alone, and without destinations it says where its days will come from (TRA-185)", (t) => {
  const { store, tripId } = setup(t);
  assert.deepEqual(tripPage(store, tripId).calendar(), { paragraphs: [["section-description", "Your trip's days will appear once you add a destination."]], days: [], unscheduled: [] });
  const lisbon = addDestination(store, tripId, { city: "Lisbon", nights: null });
  addDestination(store, tripId, { city: "Porto", nights: 0 });
  const calendar = tripPage(store, tripId).calendar();
  assert.deepEqual(calendar.days.map((day) => day.heading), ["Day 1"]);
  assert.deepEqual(calendar.days[0].lines, [["Travel: Boston → Lisbon", null], ["Arrive in Lisbon", "Nights not set yet"]]);
  assert.deepEqual(calendar.days[0].night, ["night unknown", "Night 1: Not known yet", "Depends on the nights set for Lisbon"]);
  assert.deepEqual(calendar.paragraphs.map(([className]) => className), ["description", "note"]);
  assert.match(calendar.paragraphs[0][1], / Add a start date in Edit trip to see each day’s date\.$/);
  assert.equal(calendar.paragraphs[1][1], "Lisbon has no nights set yet, so the rest of the trip has no days. Set them to add these to the calendar:");
  assert.deepEqual(calendar.unscheduled, ["Travel: Lisbon → Porto", "Porto · 0 nights", "Travel: Porto → Boston"]);
  store.applyMutation(stopEdit(lisbon, { nights: 400 }));
  const long = tripPage(store, tripId).calendar();
  assert.equal(long.days.length, MAX_CALENDAR_DAYS);
  assert.deepEqual(long.paragraphs.at(-1), ["note", "The calendar lists the trip's first 366 days. 35 more days follow."]);
});

test("Plan this connection's Nights spent traveling saves a whole number, blank as none, refuses any other, and the page follows it (TRA-185)", async (t) => {
  const { store, tripId, paris } = parisAndRome(t, tripInput({ startDate: "2027-06-05" }));
  const outbound = legOf(store, tripId, null, paris).id;
  const page = tripPage(store, tripId);
  assert.deepEqual(page.card(outbound), { line: "Flight · 1 night spent traveling", clear: true });
  page.click("Edit travel from Boston to Paris");
  const { title, label, input, hint } = page.editor();
  assert.deepEqual([title, label, hint], ["Plan this connection", "Nights spent traveling", "Nights on the way, such as 1 for an overnight flight or train. Each moves the rest of the trip a day later in its calendar and dates, without adding a destination night or any cost. Blank is 0."]);
  assert.deepEqual({ type: input.type, min: input.min, max: input.max, step: input.step, inputMode: input.inputMode, defaultValue: input.defaultValue, placeholder: input.placeholder }, { type: "number", min: "0", max: 3652058, step: "1", inputMode: "numeric", defaultValue: 1, placeholder: "0" }, "it starts with what is saved");
  const fields = { method: "Flight", airline: "", flightNumber: "", price: "", miscAmount: "", departure: "", arrival: "", notes: "" };
  await page.submit({ ...fields, travelNights: "2" });
  assert.equal(page.sent.at(-1).travelNights, 2);
  assert.deepEqual(page.card(outbound), { line: "Flight · 2 nights spent traveling", clear: true });
  assert.deepEqual(page.calendar().days.slice(0, 3).map((day) => day.lines[0][0]), ["Flight: Boston → Paris", "Still traveling", "Arrive in Paris"]);
  assert.equal(store.getSnapshot().trips[0].endDate, "2027-06-12", "the trip ends a day later");
  // Saving its other details keeps them, and a blank field saves none.
  page.click("Edit travel from Boston to Paris");
  await page.submit({ ...fields, method: "Plane", travelNights: "" });
  assert.deepEqual([page.sent.at(-1).travelNights, legOf(store, tripId, null, paris).method], [0, "Plane"]);
  assert.deepEqual(page.card(outbound), { line: "Plane", clear: true });
  assert.equal(page.calendar().days.length, 6);
  // A negative or fractional number is refused, with the editor and what is saved as they were.
  for (const value of ["-1", "1.5"]) {
    const before = store.getSnapshot();
    page.click("Edit travel from Boston to Paris");
    await page.submit({ ...fields, travelNights: value });
    assert.deepEqual([page.editor()?.title, page.editor()?.error], ["Plan this connection", "Nights spent traveling must be a whole number between 0 and 3652058."], value);
    assert.deepEqual(store.getSnapshot(), before);
    page.click("Cancel");
  }
});

test("a connection with only nights spent traveling can be cleared, and its card names them (TRA-185)", (t) => {
  const { store, tripId } = setup(t);
  const paris = addDestination(store, tripId, { city: "Paris", nights: 2 });
  const outbound = legOf(store, tripId, null, paris).id;
  assert.deepEqual(tripPage(store, tripId).card(outbound), { line: "Travel details to be decided", clear: false });
  plan(store, tripId, null, paris, "", 3);
  const page = tripPage(store, tripId);
  assert.deepEqual(page.card(outbound), { line: "Travel details to be decided · 3 nights spent traveling", clear: true });
  page.click("Clear");
  assert.deepEqual([page.editor().title, page.editor().description], ["Clear this travel plan?", "The connection will remain in your route, with its price, miscellaneous spending, travel details, nights spent traveling, links, itinerary, and layover plans cleared. This cannot be undone."]);
});

test("ChatGPT and Claude propose nights spent traveling, previewed with the dates they move, and approving saves them (TRA-185)", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  store.applyMutation(owner, tripInput({ id: ownerTrip, name: "Owner trip", startDate: "2027-06-05" }));
  const paris = store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Paris" }).id;
  store.applyMutation(owner, { type: "destination.save", id: paris, stopId: paris, nights: 3 });
  const outbound = store.getSnapshot().legs.find((leg) => leg.tripId === ownerTrip && leg.fromId === null);
  const proposal = propose([{ type: "leg.save", id: outbound.id, method: "Flight", price: "", departure: "", arrival: "", url: "", notes: "", travelNights: 1 }]);
  const fields = proposal.preview[0].records.flatMap((record) => record.fields);
  assert.deepEqual(fields.find((field) => field.name === "Nights spent traveling"), { name: "Nights spent traveling", before: "0", after: "1" });
  assert.deepEqual(fields.filter((field) => ["Arrival", "Departure"].includes(field.name)), [{ name: "Arrival", before: "2027-06-05", after: "2027-06-06" }, { name: "Departure", before: "2027-06-08", after: "2027-06-09" }]);
  assert.equal(store.getSnapshot().legs.find((leg) => leg.id === outbound.id).travelNights, 0, "proposing changes nothing");
  assert.equal(decide(proposal, true).status, "applied");
  assert.equal(store.aiTrip(ownerTrip).travel.find((leg) => leg.id === outbound.id).travelNights, 1, "assistants read them with the trip's travel");
  assert.equal(store.aiTrip(ownerTrip).trip.endDate, "2027-06-09");
  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "leg.save");
  assert.deepEqual([schema.properties.travelNights.type, schema.properties.travelNights.minimum, schema.required.includes("travelNights")], ["integer", 0, false]);
});

test("schema 51 databases upgrade with no nights spent traveling on any connection, and a replay keeps those saved since (TRA-185)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ startDate: "2027-06-05" })).id;
    const paris = addDestination(store, tripId, { city: "Paris", nights: 3 });
    store.applyMutation({ type: "leg.save", id: legOf(store, tripId, null, paris).id, method: "Flight", price: "980", miscAmount: "40", departure: "June 5", arrival: "June 5", url: "", notes: "Booked" });
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE legs DROP COLUMN travelNights; PRAGMA user_version = 51;");
    db.close();
    store = createOwnedStore(path);
    assert.ok(store.getSnapshot().legs.every((leg) => leg.travelNights === 0), "every connection starts with none");
    assert.deepEqual(store.getSnapshot(), saved, "so every connection, date and the trip's end are as they were");
    plan(store, tripId, null, paris, "Flight", 1);
    const later = store.getSnapshot();
    assert.equal(later.trips[0].endDate, "2027-06-09");
    for (const version of [51, 1]) {
      store.close(); store = null;
      const replay = new DatabaseSync(path);
      replay.exec(`PRAGMA user_version = ${version};`);
      replay.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps them`);
    }
    store.close(); store = null;
    const observer = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      const column = observer.prepare("PRAGMA table_info(legs)").all().find((info) => info.name === "travelNights");
      assert.deepEqual({ type: column.type, notnull: column.notnull, dflt_value: column.dflt_value }, { type: "INTEGER", notnull: 1, dflt_value: "0" });
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    } finally { observer.close(); }
    const writer = new DatabaseSync(path);
    try {
      for (const travelNights of [-1, 3652059, null]) assert.throws(() => writer.prepare("UPDATE legs SET travelNights = ?").run(travelNights), /constraint failed/, `the database refuses ${travelNights}`);
    } finally { writer.close(); }
  } finally { store?.close(); }
});

test("the Calendar's text keeps 4.5:1 contrast, and its trip page's Help names it (TRA-185)", () => {
  const file = "../src/components/trip-calendar.module.css";
  const rules = cssRules(file);
  const background = (selector) => rules.find(([found]) => found === selector)?.[1].background;
  const colors = { "var(--white)": "#fffefb", "var(--wash)": "#edf0e6", "var(--muted)": "#5f6b63", "var(--ink)": "#253d35" };
  const color = (value) => colors[value] ?? value;
  for (const behind of [background(".day"), background(".night"), background(".traveling")]) {
    for (const words of ["var(--ink)", "var(--muted)"]) assert.ok(contrast(color(words), color(behind)) >= 4.5, `${words} on ${behind}`);
  }
  assert.equal(background(".unknown"), "transparent", "a night not known yet shows the day's own background");
  assert.ok(pageHelp("/trips/t1").points.some((point) => point.includes("Calendar") && point.includes("nights spent traveling")));
});

test("a calendar needs its trip and every connection in its route, and stands in for none (TRA-185)", (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-06-05" }));
  addDestination(store, tripId, { city: "Paris", nights: 3 });
  const snapshot = store.getTripSnapshot(tripId).data;
  assert.throws(() => tripCalendar.tripCalendar({ ...snapshot, legs: snapshot.legs.slice(1) }, tripId), { message: "A trip's days need every travel connection in its route." });
  assert.throws(() => tripCalendar.tripCalendar(snapshot, randomUUID()), { message: "A trip's calendar needs the trip." });
});
