import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import { CHANGE_FIELDS, TOOLS } from "../src/lib/mcp-tools.ts";
import * as money from "../src/lib/money.ts";
import { isValidationError, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import * as tripBestTime from "../src/lib/trip-best-time.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import * as tripTags from "../src/lib/trip-tags.ts";
import * as typicalWeather from "../src/lib/typical-weather.ts";
import { aiSetup, OWNER } from "./ai-fixtures.mjs";
import { addDestination, fileDatabase, newItem, setup, stopEdit, tripInput } from "./budget-fixtures.mjs";
import { cssRules } from "./css-rules.mjs";
import { createOwnedStore } from "./owned-store.mjs";

// TRA-178: each trip's Best time to go, the calendar months recommended for taking the whole trip, why, and the times to
// avoid, apart from its destinations' typical weather, and All trips' month filter, which shows the trips recommended for
// any selected month alongside the search and tag filters. Nothing about it changes a trip's dates or plans.
const { BEST_TIME_NOTE_LENGTH, bestTimeFromForm, hasBestTime, normalizeBestTime, recommendedFor } = tripBestTime;
const { MONTHS } = typicalWeather;

/** A trip without a Best time to go, as every trip starts. */
const NONE = { months: [], reasons: "", avoid: "" };
const JAPAN = { months: ["March", "April", "October", "November"], reasons: "Cherry blossoms in spring and autumn leaves in fall.", avoid: "Golden Week crowds, and the rainy season in June." };
const save = (id, bestTime) => ({ type: "trip.bestTime", id, bestTime });
const bestTimeOf = (store, tripId) => store.getSnapshot().trips.find((trip) => trip.id === tripId).bestTime;
/** A snapshot with every trip's Best time to go left out, to compare everything else. */
const withoutBestTime = (snapshot) => ({ ...snapshot, trips: snapshot.trips.map((trip) => ({ ...trip, bestTime: null })) });
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;

test("a best time to go takes any of the 12 months by their full names, each once, in calendar order, and two notes of up to 4000 characters (TRA-178)", () => {
  assert.deepEqual(normalizeBestTime(NONE), NONE, "no months and no notes");
  assert.deepEqual(normalizeBestTime({ ...NONE, months: [...MONTHS].reverse() }).months, [...MONTHS], "all 12, in calendar order whatever order they come in");
  assert.deepEqual(normalizeBestTime({ months: ["October", "April", "November", "March"], reasons: `  ${JAPAN.reasons}\n`, avoid: `\t${JAPAN.avoid} ` }), JAPAN, "notes without the spaces around them");
  assert.equal(normalizeBestTime({ ...NONE, reasons: ` ${"Ä".repeat(BEST_TIME_NOTE_LENGTH)} ` }).reasons.length, 4000, "spaces around a note don't count");
  const nameMonths = "Choose the recommended months from January to December, each written in full.";
  for (const [record, message] of [
    [null, "Give the best time to go as its months, reasons and avoid."],
    [["April"], "Give the best time to go as its months, reasons and avoid."],
    ["April", "Give the best time to go as its months, reasons and avoid."],
    [{ reasons: "", avoid: "" }, "Choose the recommended months from January to December."],
    [{ ...NONE, months: "April" }, "Choose the recommended months from January to December."],
    [{ ...NONE, months: ["Apr"] }, nameMonths],
    [{ ...NONE, months: ["april"] }, nameMonths],
    [{ ...NONE, months: [4] }, nameMonths],
    [{ ...NONE, months: ["Spring"] }, nameMonths],
    [{ ...NONE, months: ["April", "May", "April"] }, "Choose April only once."],
    [{ ...NONE, reasons: 5 }, "Why these months must be text."],
    [{ months: [], avoid: "" }, "Why these months must be text."],
    [{ ...NONE, avoid: null }, "Times to avoid must be text."],
    [{ ...NONE, reasons: "x".repeat(4001) }, "Why these months must be 4000 characters or fewer."],
    [{ ...NONE, avoid: "x".repeat(4001) }, "Times to avoid must be 4000 characters or fewer."],
    [{ ...NONE, rating: 5 }, "The best time to go takes only months, reasons and avoid: leave out rating."],
  ]) assert.throws(() => normalizeBestTime(record), { message }, JSON.stringify(record));
  // A trip has one once it has a month or either note.
  assert.deepEqual([hasBestTime(NONE), hasBestTime({ ...NONE, months: ["May"] }), hasBestTime({ ...NONE, reasons: "Mild" }), hasBestTime({ ...NONE, avoid: "August" })], [false, true, true, true]);
});

test("with no month selected every trip shows; otherwise a trip recommended for any selected month does, and one without months doesn't (TRA-178)", () => {
  const spring = ["March", "April", "May"];
  assert.deepEqual([recommendedFor(spring, []), recommendedFor([], [])], [true, true], "no month selected filters nothing");
  assert.equal(recommendedFor(spring, ["April"]), true);
  assert.equal(recommendedFor(spring, ["December", "May"]), true, "one selected month is enough");
  assert.equal(recommendedFor(spring, ["June", "December"]), false);
  assert.equal(recommendedFor([], ["April"]), false, "a trip without recommended months never matches a month");
  assert.equal(recommendedFor([...MONTHS], ["August"]), true);
});

test("the editor's form gives the months checked, in calendar order, and its notes as typed (TRA-178)", () => {
  const fields = new Map([["months", ["November", "April"]], ["reasons", " Leaves "], ["avoid", ""]]);
  const form = { getAll: (name) => fields.get(name) ?? [], get: (name) => fields.get(name) ?? null };
  assert.deepEqual(bestTimeFromForm(form), { months: ["April", "November"], reasons: " Leaves ", avoid: "" });
  assert.deepEqual(bestTimeFromForm({ getAll: () => [], get: () => null }), NONE, "nothing checked or typed");
});

test("a trip starts without a best time to go, saves one, keeps it after reopening, and changes or clears it as a whole (TRA-178)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const japan = store.applyMutation(tripInput({ name: "Japan" })).id;
    const lisbon = store.applyMutation(tripInput({ name: "Lisbon" })).id;
    assert.deepEqual(bestTimeOf(store, japan), NONE, "a new trip has none");
    assert.deepEqual(store.applyMutation(save(japan, { months: ["October", "April", "November", "March"], reasons: ` ${JAPAN.reasons}`, avoid: JAPAN.avoid })), { id: japan });
    assert.deepEqual(bestTimeOf(store, japan), JAPAN, "its months in calendar order, its notes without the spaces around them");
    // All trips has each trip's, for its month filter, and the trip's page has it for its section.
    assert.deepEqual(Object.fromEntries(store.getHomeOverview().data.trips.map((trip) => [trip.id, trip.bestTime])), { [japan]: JAPAN, [lisbon]: NONE });
    assert.deepEqual(store.getTripSnapshot(japan).data.trips[0].bestTime, JAPAN);
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(bestTimeOf(store, japan), JAPAN, "reopening keeps it");
    // A save replaces the whole record, so a month or note it leaves out is removed.
    store.applyMutation(save(japan, { months: [...MONTHS], reasons: "Every season has something.", avoid: "" }));
    assert.deepEqual(bestTimeOf(store, japan), { months: [...MONTHS], reasons: "Every season has something.", avoid: "" }, "all 12 months");
    store.applyMutation(save(japan, { months: ["July"], reasons: "", avoid: "  " }));
    assert.deepEqual(bestTimeOf(store, japan), { months: ["July"], reasons: "", avoid: "" });
    store.applyMutation(save(japan, NONE));
    assert.deepEqual(bestTimeOf(store, japan), NONE, "no months and empty notes clear it");
    assert.deepEqual(bestTimeOf(store, lisbon), NONE, "another trip's is its own");
  } finally { store?.close(); }
});

test("saving a best time to go changes nothing else, a refused one changes nothing, and every other change keeps it (TRA-178)", (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-04-02", tagline: "Temples and gardens", focus: "Food and history" }));
  const kyoto = addDestination(store, tripId, { city: "Kyoto", nights: 4, hotelNightlyAmount: "180" });
  store.applyMutation({ type: "trip.tag", tripId, name: "Asia" });
  store.applyMutation({ type: "homeItem.save", ...newItem(), tripId, name: "House sitting", price: "120", notes: "" });
  const before = store.getSnapshot();
  const estimate = budget.calculateBudget(before, tripId);
  store.applyMutation(save(tripId, JAPAN));
  assert.deepEqual(withoutBestTime(store.getSnapshot()), withoutBestTime(before), "its dates, destination, stay, travel, tags and At home items are unchanged");
  assert.deepEqual(budget.calculateBudget(store.getSnapshot(), tripId), estimate, "and so is its estimate");
  assert.deepEqual(store.getSnapshot().trips[0].endDate, before.trips[0].endDate);

  const saved = store.getSnapshot();
  for (const [record, message] of [
    [{ ...JAPAN, months: ["Apr"] }, "Choose the recommended months from January to December, each written in full."],
    [{ ...JAPAN, reasons: "x".repeat(4001) }, "Why these months must be 4000 characters or fewer."],
    [{ ...JAPAN, startDate: "2027-05-01" }, "The best time to go takes only months, reasons and avoid: leave out startDate."],
  ]) {
    assert.throws(() => store.applyMutation(save(tripId, record)), refusal(message));
    assert.deepEqual(store.getSnapshot(), saved, "a refused save keeps the saved one and changes nothing");
  }
  assert.throws(() => store.applyMutation(save("6f0c2d9e-1b7a-4c55-9d1e-0a8b7c6d5e4f", JAPAN)), refusal("This item no longer exists or isn't shared with you. Please refresh and try again."));

  // Editing the trip, as its editor saves every other detail, and changing its stays, tags and At home items keep it.
  for (const edit of [
    tripInput({ id: tripId, name: "Japan 2027", startDate: "2027-03-28", travelers: 3, notes: "New notes" }),
    stopEdit(kyoto, { nights: 5 }),
    { type: "trip.untag", tripId, name: "Asia" },
    { type: "stop.add", tripId, city: "Osaka" },
    { type: "homeItem.save", ...newItem(), tripId, name: "Pet care", price: "", notes: "" },
  ]) {
    store.applyMutation(edit);
    assert.deepEqual(bestTimeOf(store, tripId), JAPAN, JSON.stringify(edit));
  }
});

test("schema 49 databases upgrade with no best time to go on any trip and nothing else changed, and a replay keeps saved ones (TRA-178)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const japan = store.applyMutation(tripInput({ name: "Japan", startDate: "2027-04-02", focus: "Gardens" })).id;
    addDestination(store, japan, { city: "Kyoto", nights: 3 });
    store.applyMutation({ type: "trip.tag", tripId: japan, name: "Asia" });
    store.applyMutation(tripInput({ name: "Lisbon" }));
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE trips DROP COLUMN bestTimeAvoid; ALTER TABLE trips DROP COLUMN bestTimeReasons; ALTER TABLE trips DROP COLUMN bestTimeMonthsJson; PRAGMA user_version = 49;");
    db.close();
    store = createOwnedStore(path);
    assert.ok(store.getSnapshot().trips.every((trip) => JSON.stringify(trip.bestTime) === JSON.stringify(NONE)), "no trip has one, so none shows under a month filter");
    assert.deepEqual(store.getSnapshot(), saved, "every trip keeps everything saved for it");
    store.applyMutation(save(japan, JAPAN));
    const later = store.getSnapshot();
    // A replay of schema 50, also after the schema 1 build resets the schema version, keeps it.
    for (const version of [49, 1]) {
      store.close(); store = null;
      const replay = new DatabaseSync(path);
      replay.exec(`PRAGMA user_version = ${version};`);
      replay.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps the saved best time to go`);
    }
    store.close(); store = null;
    const observer = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      const columns = Object.fromEntries(observer.prepare("PRAGMA table_info(trips)").all().filter((info) => info.name.startsWith("bestTime")).map((info) => [info.name, [info.type, info.notnull, info.dflt_value]]));
      assert.deepEqual(columns, { bestTimeMonthsJson: ["TEXT", 1, "'[]'"], bestTimeReasons: ["TEXT", 1, "''"], bestTimeAvoid: ["TEXT", 1, "''"] });
      assert.equal(observer.prepare("SELECT bestTimeMonthsJson FROM trips WHERE id = ?").get(japan).bestTimeMonthsJson, JSON.stringify(JAPAN.months), "months are saved by name, in calendar order");
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude read a trip's best time to go and propose one for the owner to approve, previewed by its labels (TRA-178)", (t) => {
  const { store, ownerTrip, guestTrip, propose, decide } = aiSetup(t);
  const record = `Trip “Owner trip” (${OWNER})`;
  const added = propose([save(ownerTrip, { months: ["October", "April"], reasons: "Blossoms and autumn leaves", avoid: "" })]);
  assert.deepEqual(added.preview, [{ operation: "Save a trip's best time to go", records: [{ action: "Changes", record, fields: [
    { name: "Recommended months", before: null, after: "April; October" },
    { name: "Why these months", before: null, after: "Blossoms and autumn leaves" },
  ] }] }]);
  assert.deepEqual(store.aiTrip(ownerTrip).trip.bestTime, NONE, "proposing changes nothing");
  const before = store.getSnapshot();
  assert.equal(decide(added, true).status, "applied");
  const approved = { months: ["April", "October"], reasons: "Blossoms and autumn leaves", avoid: "" };
  assert.deepEqual(store.aiTrip(ownerTrip).trip.bestTime, approved);
  assert.deepEqual(store.aiTrips().find((trip) => trip.id === ownerTrip).bestTime, approved, "assistants read it with the trip's other details");
  assert.deepEqual(withoutBestTime(store.getSnapshot()), withoutBestTime(before), "and approving changes nothing else");

  // Any trip, whoever owns it, as every proposal can.
  assert.equal(decide(propose([save(guestTrip, { months: ["June"], reasons: "", avoid: "Winter storms" })]), true).status, "applied");
  assert.deepEqual(store.aiTrip(guestTrip).trip.bestTime, { months: ["June"], reasons: "", avoid: "Winter storms" });

  const cleared = propose([save(ownerTrip, NONE)]);
  assert.deepEqual(cleared.preview, [{ operation: "Clear a trip's best time to go", records: [{ action: "Changes", record, fields: [
    { name: "Recommended months", before: "April; October", after: null },
    { name: "Why these months", before: "Blossoms and autumn leaves", after: null },
  ] }] }]);
  assert.equal(decide(cleared, false).status, "rejected");
  assert.deepEqual(store.aiTrip(ownerTrip).trip.bestTime, approved, "a rejected proposal changes nothing");

  const unchanged = store.getSnapshot();
  for (const [change, message] of [
    [{ ...save(ownerTrip, approved), startDate: "2027-04-01" }, "trip.bestTime has no field startDate."],
    [save(ownerTrip, { ...approved, rating: 5 }), "The best time to go takes only months, reasons and avoid: leave out rating."],
    [save(ownerTrip, { ...approved, months: ["Apr"] }), "Choose the recommended months from January to December, each written in full."],
    [save(ownerTrip, { months: ["April"] }), "Why these months must be text."],
  ]) assert.throws(() => propose([change]), refusal(`Change 1: ${message}`), message);
  assert.deepEqual(store.getSnapshot(), unchanged, "a refused proposal changes nothing");

  // Assistants are told the months, each once, by name, and the notes' limits.
  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((item) => item.title === "trip.bestTime");
  assert.deepEqual(schema.required, ["type", "id", "bestTime"]);
  assert.deepEqual(CHANGE_FIELDS["trip.bestTime"], ["type", "id", "bestTime"]);
  const { months, reasons, avoid } = schema.properties.bestTime.properties;
  assert.deepEqual([months.items.enum, months.maxItems, months.uniqueItems], [MONTHS, 12, true]);
  assert.deepEqual([reasons.maxLength, avoid.maxLength], [4000, 4000]);
  assert.deepEqual(schema.properties.bestTime.required, ["months", "reasons", "avoid"]);
});

// All trips and a trip's page, rendered by the planner from what the store gives `/` and `/trips/<trip ID>`, as their
// pages do, with a small hook harness that keeps state between renders, as React does. No browser or server is involved.
function load(file, require, globals) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}
const element = (type, props) => ({ type, props });
/** A submitted form's fields, as the planner reads them from the form's elements: checkboxes of one name give a list. */
class FormData {
  constructor(form) { this.fields = form.fields; }
  get(name) { return name in this.fields ? [this.fields[name]].flat()[0] : null; }
  has(name) { return name in this.fields; }
  getAll(name) { return name in this.fields ? [this.fields[name]].flat() : []; }
}
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");

/**
 * The page `read` gives the props of, for the trips' owner, with the changes it sends, whether its trips may be dragged,
 * and ways to use it. Its save is the Server Action's: the store's refusal comes back as an error, and `loseResponses`
 * makes the save's response go missing, as when the connection drops.
 */
function plannerPage(store, read) {
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
  let drag;
  let lost = false;
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), unstable_isUnrecognizedActionError: () => false },
    "@/app/actions": {
      mutatePlanner: async (mutation) => {
        // Kept as this test's own objects: the page makes its changes in its own context.
        sent.push(structuredClone(mutation));
        if (lost) throw new TypeError("Failed to fetch");
        try { return { ok: true, ...store.applyMutation(mutation) }; }
        catch (error) { if (isValidationError(error)) return { ok: false, error: error.message }; throw error; }
      },
    },
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort, "@/lib/trip-tags": tripTags,
    "@/lib/trip-best-time": tripBestTime, "@/lib/typical-weather": typicalWeather,
    // Dragging itself is tested in trip-drag.test.mjs. Here the list keeps the trips it was given and whether they may move.
    "@/components/trip-drag": { useTripDrag: (trips, place, enabled) => { drag = { trips: trips.map((item) => item.name), enabled }; return { card: () => ({}), handle: () => ({}), announcement: "" }; } },
  };
  // Every other module is one these pages don't need here: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  const cssModule = { default: new Proxy({}, { get: (_, name) => String(name) }) };
  const require = (name) => name.endsWith(".module.css") ? cssModule : modules[name] ?? unused;
  modules["@/components/trip-tags"] = load("../src/components/trip-tags.tsx", require);
  modules["@/components/trip-best-time"] = load("../src/components/trip-best-time.tsx", require);
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", require, { FormData });
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
  const reload = () => { props = read(); show(); };
  reload();
  const all = () => shown.flatMap(within);
  const button = (label) => all().find((node) => node.type === "button" && (text(node) === label || node.props["aria-label"] === label)) ?? assert.fail("No button " + label);
  const dialog = () => all().find((node) => node.type === "dialog");
  const section = () => all().find((node) => node.type === "section" && node.props["aria-labelledby"] === "best-time-heading");
  /** All trips' month filter. */
  const filter = () => all().find((node) => node.props.role === "group" && text(node.props.children[0]) === "Best time to go");
  const emptyState = () => all().find((node) => node.props.className === "empty-state");
  return {
    sent,
    drag: () => drag,
    loseResponses() { lost = true; },
    click(label) { const control = button(label); control.props.onClick({ currentTarget: control }); show(); },
    /** The Best time to go section: its heading's button, and what it shows, an empty state's heading and button, or each of its details. */
    section() {
      const found = section();
      if (!found) return undefined;
      const empty = within(found).find((node) => node.props.className?.startsWith("empty-state"));
      return {
        heading: text(within(found).find((node) => node.type === "h2")),
        button: text(within(found).find((node) => node.type === "button")),
        empty: empty && [text(within(empty).find((node) => node.type === "h3")), text(within(empty).find((node) => node.type === "button"))],
        months: within(found).filter((node) => node.type === "li").map(text),
        details: within(found).filter((node) => node.type === "div" && node.props.children[0]?.type === "dt").map((group) => [text(group.props.children[0]), text(group.props.children[1])]),
      };
    },
    /** Where the trip's sections are in its main column, by their headings. */
    headings: () => all().filter((node) => node.type === "h2").map(text),
    /** The open editor: its title, its months, each as its value and whether it starts checked, its notes, and any error. */
    editor() {
      const open = dialog();
      if (!open) return undefined;
      const form = within(open).find((node) => node.type === "form");
      const error = within(open).find((node) => node.props.className === "form-error");
      return {
        title: text(within(open).find((node) => node.type === "h2")),
        legend: text(within(form).find((node) => node.type === "legend")),
        months: within(form).filter((node) => node.type === "input" && node.props.name === "months").map((input) => [input.props.value, input.props.defaultChecked, input.props.type]),
        notes: within(form).filter((node) => node.type === "textarea").map((area) => [area.props.name, area.props.defaultValue, area.props.maxLength]),
        error: error && text(error),
      };
    },
    /** A save's message, or undefined without one. */
    toast: () => { const toast = all().find((node) => node.props.className === "toast"); return toast && text(toast); },
    /** Submits the open editor with `fields`, waits for its save, and loads the page again. */
    async submit(fields) {
      within(dialog()).find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { fields } });
      await new Promise((resolve) => setImmediate(resolve));
      reload();
    },
    /** What the trip list shows before its cards: each part's tag and, for a filter, its label. */
    parts: () => all().find((node) => node.type === "section" && node.props.className === "trips-section").props.children
      .map((child) => child.props.role === "group" ? text(child.props.children[0]) : child.type + "." + child.props.className),
    /** The month filter's months: each one's text, its name and whether it is pressed, and its Clear button, if any. */
    filter() {
      const group = filter();
      return {
        months: within(group).filter((node) => node.type === "button" && node.props["aria-pressed"] !== undefined).map((month) => [text(month), month.props["aria-label"], month.props["aria-pressed"]]),
        clear: within(group).filter((node) => node.type === "button" && node.props["aria-pressed"] === undefined).map(text),
      };
    },
    toggleMonth(month) { within(filter()).find((node) => node.props["aria-label"] === month).props.onClick(); show(); },
    toggleTag(tag) { all().find((node) => node.type === "button" && node.props["aria-pressed"] !== undefined && text(node) === tag).props.onClick(); show(); },
    search(value) { all().find((node) => node.type === "input" && node.props["aria-label"] === "Search trips").props.onChange({ target: { value } }); show(); },
    /** The trip cards' names, in the order they show. */
    cards: () => all().filter((node) => node.type === "article" && node.props.className.startsWith("trip-card ")).map((card) => text(within(card).find((node) => node.type === "h3"))),
    note: () => { const note = all().find((node) => node.props.className === "helper trip-order-note"); return note && text(note); },
    /** The empty trip list's heading and buttons, or undefined while trips show. */
    empty: () => { const found = emptyState(); return found && [text(within(found).find((node) => node.type === "h3")), ...within(found).filter((node) => node.type === "button").map(text)]; },
    clickInEmpty(label) { within(emptyState()).find((node) => node.type === "button" && text(node) === label).props.onClick(); show(); },
  };
}
const tripPage = (store, tripId) => plannerPage(store, () => { const trip = store.getTripSnapshot(tripId); return { initialData: trip.data, access: { [tripId]: trip.access }, library: trip.library, tripId }; });
const homePage = (store) => plannerPage(store, () => { const { data, budgets, access } = store.getHomeOverview(); return { initialData: data, initialBudgets: budgets, access }; });

test("a trip's page shows Best time to go after the travel between its places, with an empty state that adds it (TRA-178)", async (t) => {
  const { store, tripId } = setup(t);
  addDestination(store, tripId, { city: "Kyoto", nights: 3 });
  const page = tripPage(store, tripId);
  assert.deepEqual(page.section(), { heading: "Best time to go", button: "Add best time to go", empty: ["When is the best time to go?", "Choose the best months"], months: [], details: [] });
  const headings = page.headings();
  assert.ok(headings.indexOf("Between the places") < headings.indexOf("Best time to go"), "below the travel between the places, before At home and the packing list");
  for (const label of ["Choose the best months", "Add best time to go"]) {
    page.click(label);
    assert.deepEqual(page.editor(), {
      title: "Add best time to go", legend: "Recommended months",
      months: MONTHS.map((month) => [month, false, "checkbox"]),
      notes: [["reasons", "", 4000], ["avoid", "", 4000]], error: undefined,
    }, label);
    page.click("Cancel");
    assert.equal(page.editor(), undefined);
  }
  assert.deepEqual(page.sent, [], "opening and canceling saves nothing");
});

test("saving the editor saves the months checked, in calendar order, and its notes, which the section shows and the editor starts with (TRA-178)", async (t) => {
  const { store, tripId } = setup(t);
  const page = tripPage(store, tripId);
  page.click("Add best time to go");
  // The browser sends the months checked in the order the editor lists them; the store keeps calendar order either way.
  await page.submit({ months: ["October", "April", "November", "March"], reasons: JAPAN.reasons, avoid: JAPAN.avoid });
  assert.deepEqual(page.sent, [save(tripId, JAPAN)]);
  assert.equal(page.editor(), undefined, "the editor closes");
  assert.equal(page.toast(), "Best time to go saved.");
  assert.deepEqual(page.section(), {
    heading: "Best time to go", button: "Edit best time to go", empty: undefined, months: JAPAN.months,
    details: [["Recommended months", JAPAN.months.join("")], ["Why these months", JAPAN.reasons], ["Times to avoid", JAPAN.avoid]],
  });
  assert.deepEqual(tripPage(store, tripId).section().months, JAPAN.months, "reopening the trip shows the saved months");

  page.click("Edit best time to go");
  const editor = page.editor();
  assert.equal(editor.title, "Edit best time to go");
  assert.deepEqual(editor.months.filter(([, checked]) => checked).map(([month]) => month), JAPAN.months);
  assert.deepEqual(editor.notes, [["reasons", JAPAN.reasons, 4000], ["avoid", JAPAN.avoid, 4000]]);
  // Notes without months show that none are chosen; a note left empty isn't shown.
  await page.submit({ reasons: "Any time suits the city.", avoid: "" });
  assert.deepEqual(page.section().details, [["Recommended months", "No months chosen yet"], ["Why these months", "Any time suits the city."]]);
  page.click("Edit best time to go");
  await page.submit({ reasons: "", avoid: "" });
  assert.deepEqual(page.section().empty, ["When is the best time to go?", "Choose the best months"], "unchecking every month and clearing the notes removes it");
  assert.deepEqual(store.getSnapshot().trips[0].bestTime, NONE);
});

test("a failed save shows its error in the editor, which keeps its draft, and nothing shows as saved (TRA-178)", async (t) => {
  const { store, tripId } = setup(t);
  store.applyMutation(save(tripId, JAPAN));
  const before = store.getSnapshot();
  const page = tripPage(store, tripId);
  page.click("Edit best time to go");
  await page.submit({ months: ["May"], reasons: "x".repeat(4001), avoid: "" });
  assert.equal(page.editor().error, "Why these months must be 4000 characters or fewer.", "the store's refusal shows in the editor");
  assert.equal(page.toast(), undefined, "and nothing says it saved");
  assert.deepEqual(page.section().months, JAPAN.months, "the section still shows what is saved");
  assert.deepEqual(store.getSnapshot(), before);
  // A save whose response is lost may or may not have saved, so the editor says so and stays open to save again.
  page.loseResponses();
  await page.submit({ months: ["May"], reasons: "", avoid: "" });
  assert.equal(page.editor().error, "We couldn't confirm that your changes were saved. Please try again.");
  assert.equal(page.toast(), undefined);
});

test("All trips' Best time to go filter lists the 12 months between Filter by tag and Sort by, each named in full (TRA-178)", (t) => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const japan = store.applyMutation(tripInput({ name: "Japan" })).id;
  store.applyMutation({ type: "trip.tag", tripId: japan, name: "Asia" });
  const page = homePage(store);
  assert.deepEqual(page.parts(), ["div.section-heading", "Filter by tag", "Best time to go", "label.trip-sort", "p.sr-only", "p.sr-only", "div.trip-grid"]);
  assert.deepEqual(page.filter(), { months: MONTHS.map((month) => [month.slice(0, 3), month, false]), clear: [] });
  page.toggleMonth("September");
  assert.deepEqual(page.filter().months.filter(([, , pressed]) => pressed).map(([, month]) => month), ["September"]);
  assert.deepEqual(page.filter().clear, ["Clear month filters"]);
  // Nothing saves the months selected: All trips opens with none each time.
  assert.ok(homePage(store).filter().months.every(([, , pressed]) => !pressed));
  // Without trips there is nothing to filter, as there is nothing to search or sort.
  const empty = createOwnedStore(":memory:");
  t.after(() => empty.close());
  assert.equal(homePage(empty).parts().includes("Best time to go"), false);
});

test("selected months show the trips recommended for any of them, with the search and every selected tag, and never change a trip or its order (TRA-178)", (t) => {
  // Time stands still but for adding a trip, a minute after the one before, so trips come in the owner's own order as
  // they were added, as trips never arranged do (TRA-16).
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 1) });
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const trips = {};
  for (const [name, city, tag, months] of [
    ["Japan", "Kyoto", "Asia", ["March", "April", "October", "November"]],
    ["Iceland", "Reykjavik", "Europe", ["June", "July", "August"]],
    ["Lisbon", "Lisbon", "Europe", []],
    ["Alps", "Innsbruck", "Europe", ["December", "January", "February", "July"]],
  ]) {
    t.mock.timers.tick(60_000);
    // Without a general date, a search finds a trip only by its name and cities.
    trips[name] = store.applyMutation(tripInput({ name, dateLabel: "" })).id;
    store.applyMutation({ type: "stop.add", tripId: trips[name], city });
    store.applyMutation({ type: "trip.tag", tripId: trips[name], name: tag });
    if (months.length) store.applyMutation(save(trips[name], { months, reasons: "", avoid: "" }));
  }
  const saved = store.getSnapshot();
  const page = homePage(store);
  const order = ["Japan", "Iceland", "Lisbon", "Alps"];
  assert.deepEqual([page.cards(), page.drag().enabled, page.note()], [order, true, undefined], "no month selected filters nothing");
  page.toggleMonth("April");
  assert.deepEqual(page.cards(), ["Japan"]);
  page.toggleMonth("July");
  assert.deepEqual(page.cards(), ["Japan", "Iceland", "Alps"], "a trip recommended for either month, in the account's order; Lisbon has none");
  assert.deepEqual([page.drag().enabled, page.note()], [false, "Clear the search and filters to drag trips into a new order."], "trips move only while every trip shows");
  page.toggleTag("Europe");
  assert.deepEqual(page.cards(), ["Iceland", "Alps"], "with every selected tag");
  page.search("ice");
  assert.deepEqual(page.cards(), ["Iceland"], "and the search");
  page.search("lis");
  assert.deepEqual(page.empty(), ["No trips match that search, have every selected tag and are recommended for any selected month.", "Clear search", "Clear tag filters", "Clear month filters"]);
  page.clickInEmpty("Clear month filters");
  assert.deepEqual(page.cards(), ["Lisbon"], "clearing the months keeps the search and tags");
  assert.deepEqual(page.filter().months.filter(([, , pressed]) => pressed), []);
  page.search("");
  page.toggleTag("Europe");
  page.toggleMonth("December");
  assert.deepEqual(page.cards(), ["Alps"]);
  page.toggleMonth("May");
  assert.deepEqual(page.cards(), ["Alps"], "a month no trip is recommended for adds none");
  page.toggleMonth("December");
  assert.deepEqual(page.empty(), ["No trips are recommended for any selected month.", "Clear month filters"]);
  page.click("Clear month filters");
  assert.deepEqual([page.cards(), page.drag().enabled, page.note()], [order, true, undefined], "clearing shows every trip, in the account's order, and they move again");
  assert.deepEqual(page.sent, [], "filtering sends no change");
  assert.deepEqual(store.getSnapshot(), saved, "and changes no trip, date, destination or order");
});

test("on phones the month filter's months are four to a row at a touchscreen's size, and so are the editor's checkboxes' heights (TRA-178)", () => {
  const rules = cssRules("../src/components/trip-best-time.module.css");
  const value = (selector, property, atRule) => rules.filter(([selectors, , at]) => selectors === selector && at === atRule).map(([, declarations]) => declarations[property]).find((found) => found !== undefined);
  const phones = "@media(max-width:540px)";
  assert.deepEqual([value(".filterMonths", "display", phones), value(".filterMonths", "grid-template-columns", phones)], ["grid", "repeat(4, 1fr)"]);
  assert.equal(value(".filterMonth", "min-height", phones), "44px");
  assert.equal(value(".choice", "min-height", phones), "44px");
  // A selected month's check fits within its width, so selecting one never moves the others on wider screens.
  assert.equal(value(".filterMonth", "min-width", null), "64px");
  // The months in the editor fill the dialog's width, as many to a row as fit.
  assert.equal(value(".choices", "grid-template-columns", null), "repeat(auto-fill, minmax(118px, 1fr))");
});
