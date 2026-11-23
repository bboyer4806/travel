import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import { SCHEMA_VERSION } from "../src/lib/store.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripTags from "../src/lib/trip-tags.ts";
import { aiSetup } from "./ai-fixtures.mjs";
import { addDestination, fileDatabase, setup, tripInput, visit } from "./budget-fixtures.mjs";
import { createOwnedStore } from "./owned-store.mjs";

const { calculateBudget, calculateDestinationBudget } = budget;
const { MAX_AMOUNT_CENTS, MAX_AMOUNT_DOLLARS } = money;

// TRA-159: each trip's entry and visa fees, one optional estimate in USD for the whole party and every destination,
// entered in the trip's editor and counted once in the trip estimate. Not set adds no cost and is not a missing estimate,
// so trips without one keep their totals; a saved $0 is an amount.

/** A trip's saved entry and visa fees in cents, or null while not set. */
const feesOf = (store, tripId) => store.getSnapshot().trips.find((trip) => trip.id === tripId).entryVisaFeesCents;
/** A saved trip's save as its editor sends it, with `overrides`. */
const tripSave = (tripId, overrides = {}) => tripInput({ id: tripId, ...overrides });
const FORMAT = "Entry / visa fees must be a positive USD amount or zero, with up to 2 decimal places. Leave it blank if unknown.";
/** A connection's save, every field included, priced at `price`. */
const legSave = (leg, price) => ({ type: "leg.save", id: leg.id, method: "Flight", price, departure: "", arrival: "", url: "", notes: "" });
/** A trip for two to Paris and Lyon with every required estimate added: each stay's nights, hotel and miscellaneous, and every connection's price. */
function completeTrip(t) {
  const { store, tripId } = setup(t);
  const amounts = { nights: 2, hotelNightlyAmount: "100", miscDailyAmount: "10" };
  const stays = [addDestination(store, tripId, amounts), addDestination(store, tripId, { city: "Lyon", ...amounts })];
  for (const leg of store.getTripSnapshot(tripId).data.legs) store.applyMutation(legSave(leg, "300"));
  return { store, tripId, stays };
}

test("a trip saves its entry and visa fees blank, as zero or as an amount, and refuses any other amount without saving (TRA-159)", (t) => {
  const { store, tripId } = setup(t);
  assert.equal(feesOf(store, tripId), null, "a new trip has none");
  for (const [entryVisaFeesAmount, cents] of [["350", 35000], ["0", 0], [" 12.34 ", 1234], ["100000000", MAX_AMOUNT_CENTS], ["", null], ["45.50", 4550], ["  ", null]]) {
    store.applyMutation(tripSave(tripId, { entryVisaFeesAmount }));
    assert.equal(feesOf(store, tripId), cents, JSON.stringify(entryVisaFeesAmount));
  }
  store.applyMutation(tripSave(tripId, { entryVisaFeesAmount: "45.50" }));
  const before = store.getSnapshot();
  for (const [entryVisaFeesAmount, message] of [
    ["-1", FORMAT], ["-0.01", FORMAT], ["1.001", FORMAT], ["1e2", FORMAT], ["$5", FORMAT], ["1,000", FORMAT], ["NaN", FORMAT],
    ["100000000.01", "Entry / visa fees must be $100,000,000 or less."], [5, "entryVisaFeesAmount must be text."], [null, "entryVisaFeesAmount must be text."],
  ]) {
    assert.throws(() => store.applyMutation(tripSave(tripId, { name: "Renamed", entryVisaFeesAmount })), { name: "ValidationError", message }, JSON.stringify(entryVisaFeesAmount));
  }
  assert.deepEqual(store.getSnapshot(), before, "a refused amount saves nothing, not even the trip's other fields");
  // A new trip can start with an amount, or without one.
  assert.equal(feesOf(store, store.applyMutation(tripInput({ name: "Japan", entryVisaFeesAmount: "120" })).id), 12000);
  assert.equal(feesOf(store, store.applyMutation(tripInput({ name: "Canada", entryVisaFeesAmount: "" })).id), null);
});

test("the trip estimate counts entry and visa fees once, for the whole party and every destination, and Not set keeps its total and completeness (TRA-159)", (t) => {
  const { store, tripId, stays } = completeTrip(t);
  const estimate = () => calculateBudget(store.getSnapshot(), tripId);
  const destinations = () => stays.map((id) => calculateDestinationBudget(store.getSnapshot(), visit(store, id)));
  const baseline = estimate();
  const destinationBaseline = destinations();
  assert.equal(baseline.complete, true, "every required estimate is added without entry and visa fees");
  assert.equal(baseline.entryVisaFeesCents, null);

  store.applyMutation(tripSave(tripId, { entryVisaFeesAmount: "350" }));
  const withFees = { ...baseline, entryVisaFeesCents: 35000, totalsByCurrency: { USD: baseline.totalsByCurrency.USD + 35000 }, knownCount: baseline.knownCount + 1 };
  assert.deepEqual(estimate(), withFees, "added to the total exactly once, and every other category and completeness are unchanged");
  assert.deepEqual(destinations(), destinationBaseline, "each stay's destination budget is unchanged");
  assert.deepEqual(store.getHomeOverview().budgets[tripId], estimate(), "the trip's card on All trips includes it too");

  // One amount for the whole party and every destination: neither travelers nor stays multiply it.
  store.applyMutation(tripSave(tripId, { travelers: 6, entryVisaFeesAmount: "350" }));
  assert.deepEqual(estimate(), withFees);
  addDestination(store, tripId, { city: "Nice" });
  assert.equal(estimate().entryVisaFeesCents, 35000);

  // Zero is a known amount; clearing it takes it out of the estimate. A partial estimate stays partial either way.
  store.applyMutation(tripSave(tripId, { travelers: 6, entryVisaFeesAmount: "0" }));
  const partial = estimate();
  assert.deepEqual([partial.entryVisaFeesCents, partial.complete], [0, false], "Nice's amounts aren't entered");
  store.applyMutation(tripSave(tripId, { travelers: 6, entryVisaFeesAmount: "" }));
  assert.deepEqual(estimate(), { ...partial, entryVisaFeesCents: null, knownCount: partial.knownCount - 1 }, "Not set adds no cost and isn't a missing estimate");
});

test("entry and visa fees stay with the trip when it is reopened, edited, or saved from a page or assistant that doesn't send them (TRA-159)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ entryVisaFeesAmount: "350" })).id;
    addDestination(store, tripId, { nights: 3 });
    const saved = store.getSnapshot();
    // Clearing `store` after each close means the finally block never closes a closed store, which would hide the real failure.
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved, "reopening keeps it");
    assert.equal(feesOf(store, tripId), 35000);

    // The editor sends the saved amount with every other field, so changing them keeps it.
    store.applyMutation(tripSave(tripId, { name: "Paris in spring", travelers: 3, homeCity: "Chicago", entryVisaFeesAmount: "350.00" }));
    assert.equal(feesOf(store, tripId), 35000);
    // A page opened before this, or a ChatGPT or Claude change, sends none, which keeps it.
    store.applyMutation(tripSave(tripId, { name: "Older page" }));
    assert.equal(feesOf(store, tripId), 35000);
    store.applyMutation(tripSave(tripId, { entryVisaFeesAmount: "420" }));
    const changed = store.getSnapshot();
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), changed);
    assert.equal(feesOf(store, tripId), 42000);
  } finally { store?.close(); }
});

test("schema 45 databases upgrade with no entry or visa fees on any trip, keeping every estimate, and a replay keeps amounts saved since (TRA-159)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    addDestination(store, tripId, { nights: 3, hotelNightlyAmount: "180", miscDailyAmount: "40", shoppingAmount: "150" });
    for (const leg of store.getTripSnapshot(tripId).data.legs) store.applyMutation(legSave(leg, "450"));
    const saved = store.getSnapshot();
    const estimate = calculateBudget(saved, tripId);
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE trips DROP COLUMN entryVisaFeesCents; PRAGMA user_version = 45;");
    db.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved, "every trip keeps everything saved for it, with no entry or visa fees");
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), estimate, "and its estimate, total and completeness included, is unchanged");
    store.applyMutation(tripSave(tripId, { entryVisaFeesAmount: "350" }));
    const later = store.getSnapshot();
    // A replay of schema 46, also after the schema 1 build resets the schema version, keeps it.
    for (const version of [45, 1]) {
      store.close(); store = null;
      const replay = new DatabaseSync(path);
      replay.exec(`PRAGMA user_version = ${version};`);
      replay.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps saved amounts`);
    }
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
      // The database itself keeps the amount within Travel's limits, as it does every price.
      for (const cents of [-1, MAX_AMOUNT_CENTS + 1]) {
        assert.throws(() => observer.prepare("UPDATE trips SET entryVisaFeesCents = ? WHERE id = ?").run(cents, tripId), /CHECK constraint failed/);
      }
    } finally { observer.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude read and propose a trip's entry and visa fees, previewed as Entry / visa fees, and approving saves them (TRA-159)", (t) => {
  const { store, ownerTrip, propose, decide } = aiSetup(t);
  const save = (overrides) => ({ ...tripSave(ownerTrip, { name: "Owner trip" }), ...overrides });
  const previewed = (proposal) => proposal.preview[0].records[0]?.fields.find((field) => field.name === "Entry / visa fees");

  const added = propose([save({ entryVisaFeesAmount: "350" })]);
  assert.deepEqual(previewed(added), { name: "Entry / visa fees", before: null, after: "$350" });
  assert.equal(feesOf(store, ownerTrip), null, "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.equal(store.aiTrip(ownerTrip).trip.entryVisaFeesCents, 35000, "assistants read it with the trip");
  assert.equal(store.aiTrip(ownerTrip).budget.entryVisaFeesCents, 35000, "and in its budget");

  const renamed = propose([save({ notes: "Visas sorted" })]);
  assert.equal(previewed(renamed), undefined, "a change without it keeps it, so the preview leaves it out");
  assert.equal(decide(renamed, true).status, "applied");
  assert.equal(feesOf(store, ownerTrip), 35000);

  const cleared = propose([save({ notes: "Visas sorted", entryVisaFeesAmount: "" })]);
  assert.deepEqual(previewed(cleared), { name: "Entry / visa fees", before: "$350", after: null });
  assert.equal(decide(cleared, true).status, "applied");
  assert.equal(feesOf(store, ownerTrip), null);
});

// The trip's page, as `/trips/<trip ID>` renders it for its owner, and All trips.
const compile = (file) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(file, require, globals = {}) {
  const exports = {};
  runInNewContext(compile(file), { exports, require, ...globals });
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
class HTMLElement {}
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text, with what only screen readers read. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");
/** A rendered host element's text as the page shows it, without what only screen readers read. */
const shown = (node) => typeof node === "string" ? node : String(node.props.className ?? "").split(" ").includes("sr-only") ? "" : node.props.children.map(shown).join("");
/** Whether a rendered element matches a selector an editor focuses its field with. */
function matches(node, selector) {
  return selector.split(",").map((part) => part.trim()).some((part) => {
    const named = part.match(/^\[name="([^"]+)"\]$/);
    if (named) return node.props.name === named[1];
    if (part === "input:not([type=hidden])") return node.type === "input" && node.props.type !== "hidden";
    if (part === "[data-autofocus]") return node.props["data-autofocus"] !== undefined;
    if (part === "select" || part === "textarea") return node.type === part;
    throw new Error("Unexpected selector " + part);
  });
}
/** Each link to an amount's editor in a rendered element, in order. */
const links = (node) => within(node).filter((child) => child.type === "button" && String(child.props.className).split(" ").includes("unset-amount"));

/** A planner page for the owner: `pageProps` from the store, its saves and its focus, and ways to use it. */
function plannerPage(store, pageProps) {
  const slots = [];
  let cursor = 0;
  // The editor dialog's effects, which open it and focus its field, collected while it renders.
  let collecting = null;
  let editorEffects = [];
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
    // A callback is kept until one of its dependencies changes.
    useCallback(callback, deps) {
      const index = cursor++;
      const saved = slots[index];
      if (!saved || deps.some((dep, at) => !Object.is(dep, saved.deps[at]))) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useId: () => "id-" + cursor++,
    // A transition finishes at once. Effects run only in a browser, except the editor dialog's, which `focused` runs.
    useTransition: () => [false, (work) => work()],
    useEffect: (effect) => { collecting?.push(effect); },
  };
  const sent = [];
  const document = { activeElement: null };
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), unstable_isUnrecognizedActionError: () => false },
    // The page's save, made by the store as the signed-in owner. Each change sent is kept as this file's object.
    "@/app/actions": { mutatePlanner: async (mutation) => { sent.push({ ...mutation }); return { ok: true, ...store.applyMutation(mutation) }; } },
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-tags": tripTags,
    // Dragging trips into order (TRA-16) is tested in trip-drag.test.mjs. Here no card or handle takes a drag's props.
    "@/components/trip-drag": { useTripDrag: () => ({ card: () => ({}), handle: () => ({}), announcement: "" }) },
  };
  // Every other module is one the budgets and editors here don't need: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  const require = (name) => modules[name] ?? unused;
  modules["@/components/focus-after"] = load("../src/components/focus-after.ts", require, { document });
  modules["@/components/destination-budget"] = load("../src/components/destination-budget.tsx", require);
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", require, { FormData, document, HTMLElement });
  /** An element as the browser has it: host elements with their children rendered, and text, each component and fragment rendered in its place. */
  function render(node) {
    if (Array.isArray(node)) return [...node].flatMap(render);
    if (node === null || node === undefined || typeof node === "boolean") return [];
    if (typeof node !== "object") return [String(node)];
    if (typeof node.type === "function") {
      if (node.type.name !== "Dialog" || node.props.confirm) return render(node.type(node.props));
      collecting = [];
      const dialog = node.type(node.props);
      editorEffects = collecting;
      collecting = null;
      return render(dialog);
    }
    if (node.type === "fragment") return render(node.props.children);
    return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
  }
  let props;
  let rendered;
  /** The page as it renders now, twice, as React renders again at once when the page loads again. A closed editor's state is dropped. */
  const show = () => { for (let pass = 0; pass < 2; pass++) { cursor = 0; editorEffects = []; rendered = render(PlannerApp(props)); slots.length = cursor; } };
  /** Loads the page again, as it does after a save. */
  const reload = () => { props = pageProps(); show(); };
  reload();
  const all = () => rendered.flatMap(within);
  const editor = () => all().find((node) => node.type === "dialog" && node.props.className === "editor-dialog");
  const page = {
    sent, all,
    /** The trip estimate. */
    estimate: () => all().find((node) => node.props.className === "budget-panel"),
    /** A button by its text. */
    button: (label) => all().find((node) => node.type === "button" && text(node) === label),
    /** The open editor's title, or undefined without one. */
    title: () => editor() && text(within(editor()).find((node) => node.type === "h2")),
    /** The open editor's fields, in order, each as its label and its control. */
    fields: () => within(editor()).filter((node) => node.type === "label" && node.props.className?.startsWith("field")).map((label) => [text(label.props.children[0]), label.props.children[1]]),
    click(button) { button.props.onClick({ currentTarget: button }); show(); },
    /** The field the open editor focuses as the browser shows it, after its effects run, as [its name, its value]. */
    focused() {
      const dialog = editor();
      let field;
      dialog.props.ref.current = { showModal() {}, close() {}, querySelector: (selector) => { const found = within(dialog).find((node) => matches(node, selector)); return found && { focus: () => { field = found; } }; } };
      for (const effect of editorEffects) effect();
      return field && [field.props.name, field.props.value ?? field.props.defaultValue];
    },
    /** Submits the open editor with `fields`, waits for its save, and loads the page again. */
    async submit(fields) {
      all().find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { fields } });
      await new Promise((resolve) => setImmediate(resolve));
      reload();
    },
  };
  return page;
}
const tripPage = (store, tripId) => plannerPage(store, () => { const { data, access, library } = store.getTripSnapshot(tripId); return { initialData: data, access: { [tripId]: access }, library, tripId }; });
const homePage = (store) => plannerPage(store, () => { const { data, budgets, access } = store.getHomeOverview(); return { initialData: data, initialBudgets: budgets, access }; });
/** The trip estimate's rows, as [category, what it shows]. */
const rows = (page) => page.estimate().props.children.find((child) => child.type === "dl").props.children.map((row) => row.props.children.map(shown));
/** The trip estimate's total and its status. */
const total = (page) => page.estimate().props.children.find((child) => child.props.className === "budget-total").props.children.map(text);
/** What the trip's editor sends for the details `tripInput` saves, as its fields hold them. */
const DETAILS = { name: "Trip", startDate: "", dateLabel: "Someday", homeCity: "Boston", travelers: "2", notes: "Trip notes" };

test("the trip estimate shows Entry / visa fees after Transit miscellaneous: Not set links to the trip's editor at its field, and an amount, $0 included, is text (TRA-159)", (t) => {
  const { store, tripId } = completeTrip(t);
  const page = tripPage(store, tripId);
  assert.deepEqual(rows(page).map(([category]) => category).slice(0, 4), ["Travel", "Transit miscellaneous", "Entry / visa fees", "Hotels"]);
  assert.deepEqual(rows(page)[2], ["Entry / visa fees", "Not set"]);
  assert.deepEqual(total(page), ["$1,340", "Estimated total"], "an estimate without them is still complete, with its total unchanged");
  const link = links(page.estimate()).find((item) => text(item).includes("entry and visa fees"));
  assert.equal(text(link), "Not set: add the trip's entry and visa fees", "screen readers hear what it adds");
  page.click(link);
  assert.deepEqual([page.title(), page.focused()], ["Edit trip", ["entryVisaFeesAmount", ""]], "it opens the trip's editor, ready to type in");
  page.click(page.button("Cancel"));
  assert.deepEqual(page.sent, [], "Cancel saves nothing");

  for (const [amount, shows] of [["350", "$350"], ["0", "$0"], ["12.5", "$12.50"]]) {
    store.applyMutation(tripSave(tripId, { entryVisaFeesAmount: amount }));
    const saved = tripPage(store, tripId);
    assert.deepEqual(rows(saved)[2], ["Entry / visa fees", shows], amount);
    assert.ok(!links(saved.estimate()).some((item) => text(item).includes("entry and visa fees")), "a saved amount, zero included, isn't a link");
  }
});

test("the trip's editor has Entry / visa fees beside Travelers with the saved amount, and saving it updates the estimate's total once (TRA-159)", async (t) => {
  const { store, tripId } = completeTrip(t);
  const page = tripPage(store, tripId);
  page.click(page.button("Edit trip"));
  const labels = page.fields().map(([label]) => label);
  assert.equal(labels[labels.indexOf("Travelers") + 1], "Entry / visa fees (USD, optional)", "directly after Travelers, which leaves room beside it on wider screens");
  const [, control] = page.fields().find(([label]) => label.startsWith("Entry / visa fees"));
  assert.deepEqual(
    [control.type, control.props.name, control.props.type, control.props.className, control.props.min, control.props.max, control.props.step, control.props.placeholder, control.props.defaultValue, control.props.required],
    ["input", "entryVisaFeesAmount", "number", "no-spin-buttons", "0", MAX_AMOUNT_DOLLARS, "0.01", "Not set", "", undefined],
    "an optional USD amount, typed as every amount is, blank while not set");

  await page.submit({ ...DETAILS, entryVisaFeesAmount: "350" });
  assert.deepEqual([page.sent.at(-1).type, page.sent.at(-1).id, page.sent.at(-1).entryVisaFeesAmount], ["trip.save", tripId, "350"], "sent with the trip's other details, as typed");
  assert.equal(page.title(), undefined, "saving closes the editor");
  assert.deepEqual(rows(page)[2], ["Entry / visa fees", "$350"]);
  assert.deepEqual(total(page), ["$1,690", "Estimated total"], "the total adds it once");

  page.click(page.button("Edit trip"));
  assert.equal(page.fields().find(([label]) => label.startsWith("Entry / visa fees"))[1].props.defaultValue, "350.00", "the editor opens with the saved amount");
  await page.submit({ ...DETAILS, entryVisaFeesAmount: "" });
  assert.deepEqual(rows(page)[2], ["Entry / visa fees", "Not set"], "cleared, it is Not set again");
  assert.deepEqual(total(page), ["$1,340", "Estimated total"]);
  assert.equal(feesOf(store, tripId), null);
});

test("All trips' editor shows a trip's saved entry and visa fees, and a new trip's starts blank (TRA-159)", (t) => {
  const { store, tripId } = setup(t, tripInput({ name: "Japan", entryVisaFeesAmount: "120" }));
  const page = homePage(store);
  page.click(page.all().find((node) => node.type === "button" && node.props["aria-label"] === "Edit Japan"));
  assert.equal(page.fields().find(([label]) => label.startsWith("Entry / visa fees"))[1].props.defaultValue, "120.00");
  page.click(page.button("Cancel"));
  page.click(page.button("New trip"));
  assert.equal(page.title(), "A new adventure");
  assert.equal(page.fields().find(([label]) => label.startsWith("Entry / visa fees"))[1].props.defaultValue, "");
  assert.equal(feesOf(store, tripId), 12000);
});
