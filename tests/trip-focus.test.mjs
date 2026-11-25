import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import * as money from "../src/lib/money.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import * as tripTags from "../src/lib/trip-tags.ts";
import { aiSetup, OWNER } from "./ai-fixtures.mjs";
import { addDestination, fileDatabase, newItem, setup, stopEdit, tripInput } from "./budget-fixtures.mjs";
import { cssRules } from "./css-rules.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

// TRA-168: each trip's focus, what it is mostly about, typed in the trip's editor and shown after Focus: below the trip's
// name on its card on All trips. A trip without one shows no Focus line, and no other page shows it.

/** A focus as someone types it: several interests on one line. */
const FOCUS = "History, architecture, local cuisine";
const TAGLINE = "Ancient cities along the Silk Road";
const TOO_LONG = "focus must be 120 characters or fewer.";
const NOT_AVAILABLE = "This item no longer exists or isn't shared with you. Please refresh and try again.";
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
const focusOf = (store, tripId) => store.getSnapshot().trips.find((trip) => trip.id === tripId).focus;
/** A snapshot with every trip's focus left out, to compare everything else. */
const withoutFocus = (snapshot) => ({ ...snapshot, trips: snapshot.trips.map((trip) => ({ ...trip, focus: null })) });

test("a trip starts without a focus unless one is typed, saves it as typed, and clearing it removes it (TRA-168)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    // A page opened before Focus, ChatGPT and Claude can add a trip without one.
    const plain = store.applyMutation(tripInput()).id;
    const typed = store.applyMutation(tripInput({ focus: `  ${FOCUS} ` })).id;
    const blank = store.applyMutation(tripInput({ focus: "" })).id;
    assert.deepEqual([focusOf(store, plain), focusOf(store, typed), focusOf(store, blank)], ["", FOCUS, ""], "saved as typed, without the spaces around it");
    store.applyMutation(tripInput({ id: plain, focus: "Wildlife, hiking and photography" }));
    assert.equal(focusOf(store, plain), "Wildlife, hiking and photography", "editing a trip saves its focus");
    // All trips has each trip's for its card, and the trip's page has it for the trip's editor.
    assert.deepEqual(Object.fromEntries(store.getHomeOverview().data.trips.map((trip) => [trip.id, trip.focus])), { [plain]: "Wildlife, hiking and photography", [typed]: FOCUS, [blank]: "" });
    assert.equal(store.getTripSnapshot(typed).data.trips[0].focus, FOCUS);
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual([focusOf(store, plain), focusOf(store, typed)], ["Wildlife, hiking and photography", FOCUS], "reopening keeps them");
    for (const cleared of ["", "   ", "\t\n"]) {
      store.applyMutation(tripInput({ id: typed, focus: FOCUS }));
      store.applyMutation(tripInput({ id: typed, focus: cleared }));
      assert.equal(focusOf(store, typed), "", `clearing it with ${JSON.stringify(cleared)} removes it`);
    }
    assert.equal(focusOf(store, plain), "Wildlife, hiking and photography", "another trip's focus is its own");
  } finally { store?.close(); }
});

test("saving a trip without a focus, or changing anything else, keeps its focus, and the focus and tagline change apart (TRA-168)", (t) => {
  const { store, tripId } = setup(t, tripInput({ tagline: TAGLINE, focus: FOCUS }));
  const destinationId = addDestination(store, tripId, { nights: 4 });
  // A page opened before Focus, ChatGPT and Claude can save a trip without one, which keeps it. So does every other change,
  // a new tagline included.
  for (const edit of [
    tripInput({ id: tripId, name: "Central Asia 2027", travelers: 3, startDate: "2027-04-01" }),
    tripInput({ id: tripId, tagline: "Caravanserais and bazaars" }),
    { type: "trip.tag", tripId, name: "Asia" },
    { type: "trip.untag", tripId, name: "Asia" },
    stopEdit(destinationId, { nights: 5 }),
    { type: "homeItem.save", ...newItem(), tripId, name: "House sitting", price: "120", notes: "" },
  ]) {
    store.applyMutation(edit);
    assert.equal(focusOf(store, tripId), FOCUS, JSON.stringify(edit));
  }
  const before = store.getSnapshot();
  const estimate = budget.calculateBudget(before, tripId);
  const saved = before.trips[0];
  assert.equal(saved.tagline, "Caravanserais and bazaars");
  for (const value of ["Food, markets and long lunches", "", FOCUS]) {
    // The trip's editor sends every detail as saved, with the focus typed.
    store.applyMutation({ type: "trip.save", id: tripId, name: saved.name, tagline: saved.tagline, focus: value, startDate: saved.startDate, dateLabel: saved.dateLabel, homeCity: saved.homeCity, returnCity: saved.returnCity, travelers: saved.travelers, notes: saved.notes });
    assert.equal(focusOf(store, tripId), value);
    assert.deepEqual(withoutFocus(store.getSnapshot()), withoutFocus(before), "the trip's tagline, name, dates, cities, notes, stays and At home items are unchanged");
    assert.deepEqual(budget.calculateBudget(store.getSnapshot(), tripId), estimate);
  }
});

test("a trip's focus has at most 120 characters, and a refused save keeps the saved one (TRA-168)", (t) => {
  const { store, tripId } = setup(t, tripInput({ focus: FOCUS }));
  const longest = "Ä".repeat(120);
  const longestTrip = store.applyMutation(tripInput({ focus: ` ${longest} ` })).id;
  assert.equal(focusOf(store, longestTrip), longest, "spaces around it don't count");
  const before = store.getSnapshot();
  for (const [value, message] of [["Ä".repeat(121), TOO_LONG], [`${"word ".repeat(24)}x`, TOO_LONG], [42, "focus must be text."], [null, "focus must be text."], [["History", "food"], "focus must be text."]]) {
    // Neither a new trip nor a change to a saved one is saved.
    for (const input of [tripInput({ focus: value }), tripInput({ id: tripId, focus: value })]) {
      assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input));
      assert.deepEqual(store.getSnapshot(), before);
    }
  }
  // A save refused for any other reason keeps the saved focus too.
  for (const [input, message] of [
    [tripInput({ id: tripId, focus: "Not saved", travelers: 0 }), "Number of travelers must be a whole number between 1 and 999."],
    [tripInput({ id: tripId, focus: "Not saved", name: " " }), "Please enter name."],
    [tripInput({ id: tripId, focus: "Not saved", tagline: "A".repeat(121) }), "tagline must be 120 characters or fewer."],
  ]) {
    assert.throws(() => store.applyMutation(input), refusal(message), JSON.stringify(input));
    assert.deepEqual(store.getSnapshot(), before);
  }
});

test("everyone a trip is shared with sees its focus on All trips and can change it, and no one else can (TRA-168)", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const tripId = store.applyMutation(owner, tripInput({ focus: FOCUS })).id;
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const friend = store.authorizeAccount("friend@example.test").id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  /** The focus on the trip's card on the account's All trips, or undefined when the account has no card for it. */
  const shown = (account) => store.getHomeOverview(account).data.trips.find((trip) => trip.id === tripId)?.focus;
  assert.deepEqual([shown(owner), shown(friend), shown(outsider)], [FOCUS, FOCUS, undefined]);
  store.applyMutation(friend, tripInput({ id: tripId, focus: "Wildlife, hiking and photography" }));
  assert.deepEqual([shown(owner), shown(friend)], ["Wildlife, hiking and photography", "Wildlife, hiking and photography"], "and changes it for everyone");
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(outsider, tripInput({ id: tripId, focus: "Not saved" })), refusal(NOT_AVAILABLE), "anyone else can't change it");
  store.applyMutation(owner, { type: "trip.unshare", tripId, email: "friend@example.test" });
  assert.throws(() => store.applyMutation(friend, tripInput({ id: tripId, focus: "Not saved" })), refusal(NOT_AVAILABLE), "nor can someone it is no longer shared with");
  assert.equal(shown(friend), undefined, "who no longer sees it");
  assert.deepEqual(store.getSnapshot().trips, before.trips);
});

test("schema 41 databases upgrade without a focus on any trip, and a replay keeps the focus saved since (TRA-168)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ tagline: TAGLINE })).id;
    addDestination(store, tripId);
    store.applyMutation({ type: "trip.tag", tripId, name: "Asia" });
    store.applyMutation(tripInput({ name: "Europe", returnCity: "Boston" }));
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE trips DROP COLUMN focus; PRAGMA user_version = 41;");
    db.close();
    store = createOwnedStore(path);
    assert.ok(store.getSnapshot().trips.every((trip) => trip.focus === ""), "no trip has a focus, so no card shows one");
    assert.deepEqual(store.getSnapshot(), saved, "every trip keeps everything saved for it, its tagline included");
    store.applyMutation(tripInput({ id: tripId, focus: FOCUS }));
    const later = store.getSnapshot();
    assert.equal(focusOf(store, tripId), FOCUS);
    // A replay of schema 42, also after the schema 1 build resets the schema version, keeps it.
    for (const version of [41, 1]) {
      store.close(); store = null;
      const replay = new DatabaseSync(path);
      replay.exec(`PRAGMA user_version = ${version};`);
      replay.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps the saved focus`);
    }
    store.close(); store = null;
    const observer = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      const column = observer.prepare("PRAGMA table_info(trips)").all().find((info) => info.name === "focus");
      assert.deepEqual({ type: column.type, notnull: column.notnull, dflt_value: column.dflt_value }, { type: "TEXT", notnull: 1, dflt_value: "''" });
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude read a trip's focus and propose one, previewed as Focus, and approving saves it (TRA-168)", (t) => {
  const { store, ownerTrip, propose, decide } = aiSetup(t);
  /** The trip's Focus field in a proposal's preview, or undefined when the proposal doesn't change it. */
  const previewed = (proposal) => proposal.preview[0].records.find((record) => record.record === `Trip “Owner trip” (${OWNER})`)?.fields.find((field) => field.name === "Focus");
  const focusNow = () => store.aiTrip(ownerTrip).trip.focus;
  /** The owner's trip as an assistant changes it, with every detail as saved and `overrides`. */
  const change = (overrides) => {
    const { name, dateLabel, homeCity, travelers, notes } = store.aiTrip(ownerTrip).trip;
    return { type: "trip.save", id: ownerTrip, name, dateLabel, homeCity, travelers, notes, ...overrides };
  };

  const added = propose([change({ focus: FOCUS })]);
  assert.deepEqual(previewed(added), { name: "Focus", before: null, after: FOCUS });
  assert.equal(focusNow(), "", "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.equal(focusNow(), FOCUS);
  assert.equal(store.aiTrips().find((trip) => trip.id === ownerTrip).focus, FOCUS, "assistants read it with the trip's other details");

  const retagged = propose([change({ tagline: TAGLINE })]);
  assert.equal(previewed(retagged), undefined, "a change without a focus keeps it, so the preview leaves it out");
  assert.equal(decide(retagged, true).status, "applied");
  assert.deepEqual([focusNow(), store.aiTrip(ownerTrip).trip.tagline], [FOCUS, TAGLINE]);

  const rejected = propose([change({ focus: "Not saved" })]);
  assert.equal(decide(rejected, false).status, "rejected");
  assert.equal(focusNow(), FOCUS, "a rejected proposal changes nothing");

  const cleared = propose([change({ focus: "" })]);
  assert.deepEqual(previewed(cleared), { name: "Focus", before: FOCUS, after: null });
  assert.equal(decide(cleared, true).status, "applied");
  assert.deepEqual([focusNow(), store.aiTrip(ownerTrip).trip.tagline], ["", TAGLINE], "clearing the focus keeps the tagline");

  const before = store.getSnapshot();
  assert.throws(() => propose([change({ focus: "A".repeat(121) })]), refusal(`Change 1: ${TOO_LONG}`));
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((item) => item.title === "trip.save");
  assert.equal(schema.properties.focus.maxLength, 120, "assistants are told the limit");
  assert.ok(!schema.required.includes("focus"), "left out, it is kept");
});

test("a trip's focus is a further detail on its card: muted, smaller than the trip's name at every width, its label semibold (TRA-168)", () => {
  /** Each value a selector's rules in globals.css give a property, at any screen width. */
  const values = (selector, property) => [...new Set(cssRules("../src/app/globals.css").filter(([selectors]) => selectors.split(",").map((part) => part.trim()).includes(selector))
    .map(([, declarations]) => declarations[property]).filter((value) => value !== undefined))];
  const px = (size) => Number(/^(\d+(?:\.\d+)?)px$/.exec(size)[1]);
  assert.deepEqual(values(".trip-focus", "color"), ["var(--muted)"]);
  assert.deepEqual(values(".trip-focus", "font-size"), ["13px"]);
  assert.ok(Math.min(...values(".trip-card h3", "font-size").map(px)) > 13, "the trip's name leads at every width");
  assert.deepEqual(values(".trip-focus strong", "font-weight"), ["600"]);
  // Only the line itself has room above it, so a trip without one has none.
  assert.deepEqual(values(".trip-focus", "margin-top"), ["8px"]);
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
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");

/** The page `read` gives the props of, for the trips' owner, with the changes it saves and a way to use it. */
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
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), unstable_isUnrecognizedActionError: () => false },
    // The page's save, made by the store as the signed-in owner, which keeps each change sent.
    "@/app/actions": { mutatePlanner: async (mutation) => { sent.push({ ...mutation }); return { ok: true, ...store.applyMutation(mutation) }; } },
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort, "@/lib/trip-tags": tripTags,
    // Dragging trips into order (TRA-16) is tested in trip-drag.test.mjs. Here no card or handle takes a drag's props.
    "@/components/trip-drag": { useTripDrag: () => ({ card: () => ({}), handle: () => ({}), announcement: "" }) },
  };
  // Every other module is one the trips' cards and editor don't need: each of its exports renders, and returns, nothing.
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
  /** The page as it renders now. It renders twice, as React renders again at once when the page changes its state while rendering. */
  const show = () => { for (let pass = 0; pass < 2; pass++) { cursor = 0; shown = render(PlannerApp(props)); } };
  /** Loads the page again, as it does after a save. */
  const reload = () => { props = read(); show(); };
  reload();
  const all = () => shown.flatMap(within);
  return {
    sent,
    all,
    text: () => shown.map(text).join(""),
    /**
     * Each trip's card on All trips by its trip's name: what its link shows below its image, each element as its tag and
     * class, and its Focus line's text, or undefined without one.
     */
    cards: () => Object.fromEntries(all().filter((node) => node.type === "article" && node.props.className.startsWith("trip-card ")).map((card) => {
      const link = within(card).find((node) => node.props.className === "trip-card-main");
      const shownBelow = link.props.children.filter((child) => child !== "");
      assert.ok(shownBelow.every((child) => typeof child !== "string"), "a card's link shows no stray text");
      const focus = shownBelow.find((child) => child.props.className === "trip-focus");
      return [text(shownBelow.find((child) => child.type === "h3")), { shows: shownBelow.map((child) => child.type + (child.props.className ? "." + child.props.className : "")), focus: focus && text(focus), label: focus && focus.props.children[0] }];
    })),
    button: (label) => all().find((node) => node.type === "button" && node.props["aria-label"] === label),
    /** The open editor's fields, in order, each as its label and its control. */
    fields: () => within(all().find((node) => node.type === "form")).filter((node) => node.type === "label" && node.props.className?.startsWith("field"))
      .map((label) => [text(label.props.children[0]), label.props.children[1]]),
    click(button) { button.props.onClick({ currentTarget: button }); show(); },
    /** Submits the open editor with `fields`, waits for its save, and loads the page again. */
    async submit(fields) {
      all().find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { fields } });
      await new Promise((resolve) => setImmediate(resolve));
      reload();
    },
  };
}
const homePage = (store) => plannerPage(store, () => { const { data, budgets, access } = store.getHomeOverview(); return { initialData: data, initialBudgets: budgets, access }; });
const tripPage = (store, tripId) => plannerPage(store, () => { const { data, access, library } = store.getTripSnapshot(tripId); return { initialData: data, access: { [tripId]: access }, library, tripId }; });

test("a trip's card shows its focus after Focus:, directly below its name or its tagline and in full, and a trip without one shows no Focus line (TRA-168)", (t) => {
  const { store, tripId } = setup(t, tripInput({ name: "Central Asia Adventure", tagline: TAGLINE, focus: FOCUS }));
  addDestination(store, tripId, { city: "Samarkand" });
  store.applyMutation(tripInput({ name: "A weekend away" }));
  // A long focus, with a word longer than a phone is wide, is shown whole: the card wraps it (see trip-focus's styles).
  const long = "Mountain villages, alpine lakes, cheese caves, glacier walks and a Gornergratbahnbergstationpanoramaterrasse at sunrise.";
  assert.equal(long.length, 120);
  store.applyMutation(tripInput({ name: "The Alps", focus: long }));
  const cards = homePage(store).cards();
  const withFocus = ["div.trip-card-top", "h3", "p.trip-focus", "p.city-list", "div.trip-meta", "div.card-budget"];
  // A trip's tagline is directly below its name (TRA-167), so its focus follows the tagline.
  assert.deepEqual(cards["Central Asia Adventure"].shows, ["div.trip-card-top", "h3", "p.trip-tagline", "p.trip-focus", "p.city-list", "div.trip-meta", "div.card-budget"], "the trip's name, its tagline, its focus, then its cities and details");
  assert.equal(cards["Central Asia Adventure"].focus, `Focus: ${FOCUS}`);
  assert.deepEqual([cards["Central Asia Adventure"].label.type, text(cards["Central Asia Adventure"].label)], ["strong", "Focus:"], "its label is set apart from what was typed");
  assert.deepEqual(cards["The Alps"].shows, withFocus, "without a tagline, the focus is directly below the name");
  assert.equal(cards["The Alps"].focus, `Focus: ${long}`, "a long focus is shown whole");
  assert.deepEqual(cards["A weekend away"], { shows: ["div.trip-card-top", "h3", "p.city-list", "div.trip-meta", "div.card-budget"], focus: undefined, label: undefined }, "no label, placeholder or empty line");
  // The trip's own page doesn't show it.
  const page = tripPage(store, tripId);
  assert.ok(!page.all().some((node) => node.props.className === "trip-focus") && !page.text().includes(FOCUS), "only All trips shows a trip's focus");
  assert.ok(page.text().includes(TAGLINE.toUpperCase()), "while the trip's page shows its tagline as before");
});

test("the trip editor has Focus below Tagline with the saved focus, and saving sends what is typed, so clearing it removes the card's Focus line (TRA-168)", async (t) => {
  const { store, tripId } = setup(t, tripInput({ name: "Central Asia Adventure", tagline: TAGLINE, focus: FOCUS }));
  const page = homePage(store);
  page.click(page.button("Edit Central Asia Adventure"));
  assert.deepEqual(page.fields().slice(0, 4).map(([label]) => label), ["Trip name", "Tagline", "Focus", "General date"]);
  const [, control] = page.fields().find(([label]) => label === "Focus");
  assert.deepEqual([control.type, control.props.name, control.props.defaultValue, control.props.maxLength, control.props.required], ["input", "focus", FOCUS, 120, undefined], "optional, up to 120 characters, with the trip's focus");
  const details = { name: "Central Asia Adventure", tagline: TAGLINE, startDate: "", dateLabel: "Someday", homeCity: "Boston", travelers: "2", notes: "Trip notes" };
  await page.submit({ ...details, focus: " Food, markets and long lunches " });
  assert.deepEqual([page.sent.at(-1).type, page.sent.at(-1).id, page.sent.at(-1).focus, page.sent.at(-1).tagline], ["trip.save", tripId, " Food, markets and long lunches ", TAGLINE], "sent beside the tagline, each as typed");
  assert.equal(page.cards()["Central Asia Adventure"].focus, "Focus: Food, markets and long lunches", "the card shows the saved focus");
  page.click(page.button("Edit Central Asia Adventure"));
  assert.equal(page.fields().find(([label]) => label === "Focus")[1].props.defaultValue, "Food, markets and long lunches", "the editor opens with it");
  await page.submit({ ...details, focus: "" });
  assert.equal(page.cards()["Central Asia Adventure"].focus, undefined, "cleared, the card has no Focus line");
  assert.deepEqual([focusOf(store, tripId), store.getSnapshot().trips[0].tagline], ["", TAGLINE], "and the tagline is as saved");
  // A new trip's editor starts without one.
  page.click(page.all().find((node) => node.type === "button" && text(node) === "New trip"));
  assert.equal(page.fields().find(([label]) => label === "Focus")[1].props.defaultValue, undefined);
});
