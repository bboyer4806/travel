import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import { pageHelp } from "../src/lib/help.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import { addDestination, candidateInput, setup, stop, visit } from "./budget-fixtures.mjs";
import { cssRules } from "./css-rules.mjs";

const { calculateAccommodation, calculateActivitiesBudget, calculateBudget, calculateFoodBudget, calculateMiscellaneous, tripVisits, unsetStayAmount, unsetTripAmount } = budget;

// TRA-165: a budget's Not set and Not estimated amounts open the existing editor that enters them, focused on its field.
// The first tests find what each category lacks, from the store's trip as its page loads it. The rest use the trip's page,
// rendered by the planner with a small hook harness, with its saves made by the store. No browser or server is involved.

/** A trip for two from Boston to Vienna and Salzburg with nothing estimated, and each stay's ID, which its destination shares. */
function austria(t) {
  const { store, tripId } = setup(t);
  const vienna = addDestination(store, tripId, { city: "Vienna" });
  const salzburg = addDestination(store, tripId, { city: "Salzburg" });
  return { store, tripId, vienna, salzburg };
}

/** An unset amount as [its category, or a connection or idea, what it belongs to, and its field], or null. */
function what(snapshot, unset) {
  if (unset === null) return null;
  const place = (stopId) => stopId === null ? "Boston" : snapshot.destinations.find((item) => item.id === snapshot.stops.find((stay) => stay.id === stopId).destinationId).city;
  if (unset.kind === "leg") return ["leg", place(unset.leg.fromId) + " to " + place(unset.leg.toId), unset.field];
  if (unset.kind === "idea") return ["idea", unset.idea.name, "price"];
  return [unset.category, unset.visit.city, unset.field];
}
const STAY_CATEGORIES = ["hotels", "activities", "food", "shopping", "miscellaneous"];
/** What each of a stay's categories lacks. */
function stayGaps(store, id) {
  const snapshot = store.getSnapshot();
  return Object.fromEntries(STAY_CATEGORIES.map((category) => [category, what(snapshot, unsetStayAmount(snapshot, stop(store, id), visit(store, id), category))]));
}
/** What each category of a trip's estimate lacks first. */
function tripGaps(store, tripId) {
  const snapshot = store.getTripSnapshot(tripId).data;
  return Object.fromEntries(["travel", "transitMiscellaneous", ...STAY_CATEGORIES].map((category) => [category, what(snapshot, unsetTripAmount(snapshot, tripId, category))]));
}
/** A connection's save, as its editor sends it, with `changes`. */
const legSave = (leg, changes) => ({ type: "leg.save", id: leg.id, method: leg.method, price: leg.priceCents === null ? "" : money.minorAmountValue(leg.priceCents, "USD"), departure: leg.departure, arrival: leg.arrival, url: leg.url, notes: leg.notes, ...changes });

test("a stay's category lacks its amount, then the nights that multiply it, and nothing once both are known (TRA-165)", (t) => {
  const { store, vienna } = austria(t);
  assert.deepEqual(stayGaps(store, vienna), {
    hotels: ["hotels", "Vienna", "hotelNightlyAmount"],
    // Itemized costs, the default, with nothing included, are a known $0.
    activities: null, food: null,
    shopping: ["shopping", "Vienna", "shoppingAmount"],
    miscellaneous: ["miscellaneous", "Vienna", "miscDailyAmount"],
  });
  store.applyMutation({ type: "destination.save", id: vienna, hotelNightlyAmount: "200", miscDailyAmount: "40", activitiesBudgetMode: "general", foodBudgetMode: "daily", foodDailyAmount: "100" });
  assert.deepEqual(stayGaps(store, vienna), {
    hotels: ["hotels", "Vienna", "nights"], activities: ["activities", "Vienna", "activitiesGeneralAmount"], food: ["food", "Vienna", "nights"],
    shopping: ["shopping", "Vienna", "shoppingAmount"], miscellaneous: ["miscellaneous", "Vienna", "nights"],
  });
  // Zero is a known amount, and a same-day visit's zero nights are known nights.
  store.applyMutation({ type: "destination.save", id: vienna, stopId: vienna, nights: 0, activitiesGeneralAmount: "350", shoppingAmount: "0" });
  assert.deepEqual(stayGaps(store, vienna), { hotels: null, activities: null, food: null, shopping: null, miscellaneous: null });
});

test("a chosen hotel lacks its price, as do the included ideas of itemized costs, in saved order (TRA-165)", (t) => {
  const { store, vienna } = austria(t);
  store.applyMutation({ type: "destination.save", id: vienna, stopId: vienna, nights: 3, hotelNightlyAmount: "200" });
  assert.equal(stayGaps(store, vienna).hotels, null);
  for (const [category, name, overrides] of [["hotels", "Hotel Sacher", {}], ["activities", "Museum", { included: false }], ["activities", "Opera", {}], ["activities", "Palace", {}], ["restaurants", "Figlmüller", {}]]) {
    store.applyMutation(candidateInput(vienna, category, { name, price: "", ...overrides }));
  }
  // The chosen hotel's unknown price replaces the known nightly estimate.
  assert.deepEqual(stayGaps(store, vienna), {
    hotels: ["idea", "Hotel Sacher", "price"], activities: ["idea", "Opera", "price"], food: ["idea", "Figlmüller", "price"],
    shopping: ["shopping", "Vienna", "shoppingAmount"], miscellaneous: ["miscellaneous", "Vienna", "miscDailyAmount"],
  });
  const opera = store.getSnapshot().candidates.find((item) => item.name === "Opera");
  store.applyMutation(candidateInput(vienna, "activities", { id: opera.id, name: "Opera", price: "120" }));
  assert.deepEqual(stayGaps(store, vienna).activities, ["idea", "Palace", "price"], "the next included activity, never one left out");
  // General mode uses its amount alone, whatever its activities' prices.
  store.applyMutation({ type: "destination.save", id: vienna, activitiesBudgetMode: "general", activitiesGeneralAmount: "300" });
  assert.equal(stayGaps(store, vienna).activities, null);
});

test("each category of the trip estimate lacks its first amount in route order, from the departure (TRA-165)", (t) => {
  const { store, tripId, vienna } = austria(t);
  assert.deepEqual(tripGaps(store, tripId), {
    travel: ["leg", "Boston to Vienna", "price"], transitMiscellaneous: ["leg", "Boston to Vienna", "miscAmount"],
    hotels: ["hotels", "Vienna", "hotelNightlyAmount"], activities: null, food: null,
    shopping: ["shopping", "Vienna", "shoppingAmount"], miscellaneous: ["miscellaneous", "Vienna", "miscDailyAmount"],
  });
  const departure = store.getTripSnapshot(tripId).data.legs.find((leg) => leg.fromId === null);
  store.applyMutation(legSave(departure, { method: "Flight", price: "900", miscAmount: "60" }));
  store.applyMutation({ type: "destination.save", id: vienna, stopId: vienna, nights: 4, hotelNightlyAmount: "240", miscDailyAmount: "40", shoppingAmount: "300" });
  assert.deepEqual(tripGaps(store, tripId), {
    travel: ["leg", "Vienna to Salzburg", "price"], transitMiscellaneous: ["leg", "Vienna to Salzburg", "miscAmount"],
    hotels: ["hotels", "Salzburg", "hotelNightlyAmount"], activities: null, food: null,
    shopping: ["shopping", "Salzburg", "shoppingAmount"], miscellaneous: ["miscellaneous", "Salzburg", "miscDailyAmount"],
  });
});

test("a trip without destinations has no connection or stay amounts to enter, only its entry and visa fees (TRA-165, TRA-159)", (t) => {
  const { store, tripId } = setup(t);
  assert.deepEqual(Object.values(tripGaps(store, tripId)), [null, null, null, null, null, null, null]);
  const snapshot = store.getTripSnapshot(tripId).data;
  assert.deepEqual(unsetTripAmount(snapshot, tripId, "entryVisaFees"), { kind: "trip", trip: snapshot.trips[0], field: "entryVisaFeesAmount" });
});

test("an amount is lacking wherever the estimate counts one missing, and entering each in turn completes it (TRA-165)", (t) => {
  const { store, tripId, vienna, salzburg } = austria(t);
  // Vienna's chosen hotel, included activity and restaurant have no prices, and its miscellaneous amount and nights
  // aren't entered. Salzburg's nightly and daily food amounts wait for its nights, and its general activities amount and
  // miscellaneous amount aren't entered. No connection has a price.
  store.applyMutation({ type: "destination.save", id: salzburg, hotelNightlyAmount: "150", activitiesBudgetMode: "general", foodBudgetMode: "daily", foodDailyAmount: "90" });
  for (const [category, name] of [["hotels", "Hotel Sacher"], ["activities", "Opera"], ["restaurants", "Figlmüller"]]) store.applyMutation(candidateInput(vienna, category, { name, price: "" }));
  const required = { travel: "travelMissingCount", hotels: "hotelMissingCount", activities: "activitiesMissingCount", food: "foodMissingCount", miscellaneous: "miscMissingCount" };
  const entered = [];
  for (;;) {
    const snapshot = store.getTripSnapshot(tripId).data;
    const estimate = calculateBudget(snapshot, tripId);
    // Each stay's categories lack an amount exactly when its budget doesn't have them, and each of the estimate's
    // required categories exactly when it counts one missing.
    for (const { stop: stay, visit: place } of tripVisits(snapshot, tripId)) {
      const unknown = { hotels: calculateAccommodation(snapshot, place).totalMinor === null, activities: calculateActivitiesBudget(snapshot, place).missingCount > 0, food: calculateFoodBudget(snapshot, place).missingCount > 0, shopping: place.shoppingMinor === null, miscellaneous: calculateMiscellaneous(place).subtotalMinor === null };
      for (const [category, lacking] of Object.entries(unknown)) assert.equal(unsetStayAmount(snapshot, stay, place, category) !== null, lacking, place.city + ": " + category);
    }
    for (const [category, count] of Object.entries(required)) assert.equal(unsetTripAmount(snapshot, tripId, category) !== null, estimate[count] > 0, category);
    const next = Object.keys(required).map((category) => unsetTripAmount(snapshot, tripId, category)).find(Boolean);
    if (!next) { assert.ok(estimate.complete, "every required estimate is added"); break; }
    entered.push(what(snapshot, next));
    // Each amount entered as its editor saves it: 100 for an amount, and 2 nights.
    store.applyMutation(next.kind === "leg" ? legSave(next.leg, { price: "100" })
      : next.kind === "idea" ? candidateInput(next.idea.destinationId, next.idea.category, { id: next.idea.id, name: next.idea.name, price: "100" })
      : next.field === "nights" ? { type: "destination.save", id: next.visit.id, stopId: next.stop.id, nights: 2 }
      : { type: "destination.save", id: next.visit.id, [next.field]: "100" });
  }
  assert.deepEqual(entered, [
    ["leg", "Boston to Vienna", "price"], ["leg", "Vienna to Salzburg", "price"], ["leg", "Salzburg to Boston", "price"],
    ["idea", "Hotel Sacher", "price"], ["hotels", "Salzburg", "nights"],
    ["idea", "Opera", "price"], ["activities", "Salzburg", "activitiesGeneralAmount"],
    // Salzburg's food was estimated once its nights were.
    ["idea", "Figlmüller", "price"],
    ["miscellaneous", "Vienna", "miscDailyAmount"], ["miscellaneous", "Vienna", "nights"], ["miscellaneous", "Salzburg", "miscDailyAmount"],
  ]);
});

// The trip's page, as `/trips/<trip ID>` renders it for its owner.
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

/** A planner page for the owner: `props` from the store, its saves and its focus, and ways to use it. */
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
  // The page's keyboard focus, which an element's `focus()` takes.
  const document = { activeElement: null };
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), unstable_isUnrecognizedActionError: () => false },
    // The page's save, made by the store as the signed-in owner. Each change sent is kept as this file's object.
    "@/app/actions": { mutatePlanner: async (mutation) => { sent.push({ ...mutation }); return { ok: true, ...store.applyMutation(mutation) }; } },
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates,
  };
  // Every other module is one the budgets and their editors don't need: each of its exports renders, and returns, nothing.
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
  /**
   * The page as it renders now. It renders twice, as React renders again at once when the page loads a trip again. The
   * editor renders last, so a closed editor's state is dropped, as React drops it when the editor goes away.
   */
  const show = () => { for (let pass = 0; pass < 2; pass++) { cursor = 0; editorEffects = []; rendered = render(PlannerApp(props)); slots.length = cursor; } };
  /** Loads the page again, as it does after a save. */
  const reload = () => { props = pageProps(); show(); };
  reload();
  const all = () => rendered.flatMap(within);
  const editor = () => all().find((node) => node.type === "dialog" && node.props.className === "editor-dialog");
  const page = {
    sent, document, all,
    /** The trip estimate. */
    estimate: () => all().find((node) => node.props.className === "budget-panel"),
    /** A trip destination card, by its city. */
    card: (city) => all().find((node) => node.type === "article" && node.props.className === "destination-card" && text(within(node).find((child) => child.type === "h3")) === city),
    button: (label) => all().find((node) => node.type === "button" && text(node) === label),
    /** The open editor's title, or undefined without one. */
    title: () => editor() && text(within(editor()).find((node) => node.type === "h2")),
    /** The connection the open editor plans. */
    route: () => text(within(editor()).find((node) => node.props.className === "form-route wide")),
    click(button) { button.props.onClick({ currentTarget: button }); show(); },
    /** The field the open editor focuses as the browser shows it, after its effects run, as [its name, its value]. */
    focused() {
      const dialog = editor();
      let field;
      dialog.props.ref.current = { showModal() {}, close() {}, querySelector: (selector) => { const found = within(dialog).find((node) => matches(node, selector)); return found && { focus: () => { field = found; } }; } };
      for (const effect of editorEffects) effect();
      return field && [field.props.name, field.props.value ?? field.props.defaultValue];
    },
    /** Opens an amount's editor from its link, and closes it with Cancel: its title, focused field and connection. */
    open(link) {
      page.click(link);
      const opened = { title: page.title(), focused: page.focused(), ...(page.title() === "Plan this connection" && { route: page.route() }) };
      page.click(page.button("Cancel"));
      return opened;
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
/** The trip estimate's rows, as [category, what each shows]. */
const rows = (page) => page.estimate().props.children.find((child) => child.type === "dl").props.children.map((row) => row.props.children.map(shown));

test("each Not set and Not estimated in the trip estimate, and each count of them, is a link; amounts aren't (TRA-165)", (t) => {
  const { store, tripId, vienna } = austria(t);
  const page = tripPage(store, tripId);
  assert.deepEqual(links(page.estimate()).map((link) => [shown(link), text(link)]), [
    ["3 not estimated", "3 not estimated: add the price of travel from Boston to Vienna"], ["Not estimated", "Not estimated: add the price of travel from Boston to Vienna"],
    ["Not set", "Not set: add miscellaneous spending from Boston to Vienna"],
    ["Not set", "Not set: add the trip's entry and visa fees"],
    ["2 not estimated", "2 not estimated: add the nightly hotel amount for Vienna"], ["Not estimated", "Not estimated: add the nightly hotel amount for Vienna"],
    ["Not set", "Not set: add the shopping amount for Vienna"],
    ["2 not estimated", "2 not estimated: add the daily miscellaneous amount for Vienna"], ["Not estimated", "Not estimated: add the daily miscellaneous amount for Vienna"],
  ]);
  for (const link of links(page.estimate())) assert.deepEqual([link.props.type, link.props.className], ["button", "text-button unset-amount"], "styled as Travel's links");
  // Activities and Food include nothing, a known $0, and At home has nothing to enter.
  assert.deepEqual(rows(page), [
    ["Travel3 not estimated", "Not estimated"], ["Transit miscellaneous", "Not set"], ["Entry / visa fees", "Not set"], ["Hotels2 not estimated", "Not estimated"],
    ["Activities", "$0"], ["Food", "$0"], ["Shopping", "Not set"], ["At home", "$0"], ["Miscellaneous2 not estimated", "Not estimated"],
  ]);
  // Once part of a category is estimated, its amount shows as before, and its count links to what is left.
  store.applyMutation({ type: "destination.save", id: vienna, stopId: vienna, nights: 3, hotelNightlyAmount: "200" });
  const reloaded = tripPage(store, tripId);
  assert.deepEqual(rows(reloaded)[3], ["Hotels1 not estimated", "$600"]);
  assert.deepEqual(links(reloaded.estimate()).filter((link) => text(link).includes("hotel")).map(text), ["1 not estimated: add the nightly hotel amount for Salzburg"]);
});

test("each link opens the existing editor for its first unset amount in route order, focused on its field, with what is saved (TRA-165)", (t) => {
  const { store, tripId, vienna, salzburg } = austria(t);
  const page = tripPage(store, tripId);
  const [travelCount, travel, transit, entryVisaFees, hotelCount, hotels, shopping, misc] = links(page.estimate());
  assert.deepEqual(page.open(travelCount), { title: "Plan this connection", focused: ["price", ""], route: "Boston to Vienna" });
  assert.deepEqual(page.open(travel), { title: "Plan this connection", focused: ["price", ""], route: "Boston to Vienna" });
  assert.deepEqual(page.open(transit), { title: "Plan this connection", focused: ["miscAmount", ""], route: "Boston to Vienna" });
  // The trip's own amount opens the trip's editor (TRA-159).
  assert.deepEqual(page.open(entryVisaFees), { title: "Edit trip", focused: ["entryVisaFeesAmount", ""] });
  assert.deepEqual(page.open(hotelCount), { title: "Edit accommodation budget for Vienna", focused: ["hotelNightlyAmount", ""] });
  assert.deepEqual(page.open(hotels), { title: "Edit accommodation budget for Vienna", focused: ["hotelNightlyAmount", ""] });
  assert.deepEqual(page.open(shopping), { title: "Edit shopping budget for Vienna", focused: ["shoppingAmount", ""] });
  assert.deepEqual(page.open(misc), { title: "Edit miscellaneous budget for Vienna", focused: ["miscDailyAmount", ""] });

  // Amounts waiting for nights open the stay's nights: in Accommodation's editor, which keeps the saved nightly amount,
  // and otherwise in their own. A missing amount opens its category's editor.
  const departure = store.getTripSnapshot(tripId).data.legs.find((leg) => leg.fromId === null);
  store.applyMutation(legSave(departure, { method: "Flight", price: "900" }));
  store.applyMutation({ type: "destination.save", id: vienna, hotelNightlyAmount: "200", miscDailyAmount: "40", activitiesBudgetMode: "general", foodBudgetMode: "daily" });
  store.applyMutation({ type: "destination.save", id: salzburg, foodBudgetMode: "daily", foodDailyAmount: "90" });
  const later = tripPage(store, tripId);
  const named = (label) => links(later.estimate()).find((link) => text(link).includes(label));
  assert.deepEqual(later.open(named("price of travel")), { title: "Plan this connection", focused: ["price", ""], route: "Vienna to Salzburg" }, "the first connection still without a price");
  assert.deepEqual(later.open(named("nights")), { title: "Edit accommodation budget for Vienna", focused: ["nights", ""] });
  later.click(named("nights"));
  assert.deepEqual(later.all().filter((node) => node.props.name === "hotelNightlyAmount").map((node) => node.props.value), [money.minorAmountValue(20000, "USD")], "the saved nightly amount");
  later.click(later.button("Cancel"));
  assert.deepEqual(later.open(named("general activities")), { title: "Edit activities budget for Vienna", focused: ["activitiesGeneralAmount", ""] });
  assert.deepEqual(later.open(named("daily food")), { title: "Edit food budget for Vienna", focused: ["foodDailyAmount", ""] });
  const miscNights = links(later.estimate()).filter((link) => text(link).includes("nights in Vienna")).at(-1);
  assert.deepEqual(later.open(miscNights), { title: "Edit destination nights for Vienna", focused: ["nights", ""] });

  // Ideas chosen for the budget without a price open their own editors, at their price.
  store.applyMutation({ type: "destination.save", id: vienna, stopId: vienna, nights: 3, foodBudgetMode: "itemized", activitiesBudgetMode: "itemized" });
  for (const [category, name] of [["hotels", "Hotel Sacher"], ["activities", "Opera"], ["restaurants", "Figlmüller"]]) store.applyMutation(candidateInput(vienna, category, { name, price: "" }));
  const ideas = tripPage(store, tripId);
  const idea = (name) => links(ideas.estimate()).find((link) => text(link).endsWith("the price of " + name));
  for (const [name, title] of [["Hotel Sacher", "Edit hotel"], ["Opera", "Edit activity"], ["Figlmüller", "Edit restaurant"]]) {
    ideas.click(idea(name));
    assert.deepEqual([ideas.title(), ideas.focused()], [title, ["price", ""]], name);
    assert.equal(ideas.all().find((node) => node.props.name === "name").props.defaultValue, name, "the idea's saved name");
    ideas.click(ideas.button("Cancel"));
  }
});

test("saving the editor updates the estimate and its totals as any save does, and Cancel changes nothing (TRA-165)", async (t) => {
  const { store, tripId, vienna } = austria(t);
  const page = tripPage(store, tripId);
  const before = store.getSnapshot();
  page.click(links(page.estimate()).find((link) => shown(link) === "Not set" && text(link).includes("shopping")));
  assert.equal(page.title(), "Edit shopping budget for Vienna");
  page.click(page.button("Cancel"));
  assert.equal(page.title(), undefined, "Cancel closes it");
  assert.deepEqual(page.sent, [], "and saves nothing");
  assert.deepEqual(store.getSnapshot(), before, "the trip and its budget are unchanged");

  page.click(links(page.estimate()).find((link) => shown(link) === "Not estimated" && text(link).includes("nightly hotel")));
  await page.submit({ nights: "3", hotelNightlyAmount: "200" });
  assert.deepEqual(page.sent, [{ type: "destination.save", id: vienna, stopId: vienna, nights: 3, hotelNightlyAmount: "200" }], "the editor's own save, as from Hotels");
  assert.equal(page.title(), undefined, "saving closes it");
  assert.deepEqual(rows(page)[3], ["Hotels1 not estimated", "$600"]);
  assert.equal(text(page.estimate().props.children.find((child) => child.props.className === "budget-total")), "$600Partial estimate");
  assert.deepEqual(calculateBudget(store.getTripSnapshot(tripId).data, tripId).hotelsByCurrency, { USD: 60000 });
});

test("a saved $0 is an amount, distinct from Not set, and isn't a link (TRA-165)", (t) => {
  const { store, tripId, vienna } = austria(t);
  const departure = store.getTripSnapshot(tripId).data.legs.find((leg) => leg.fromId === null);
  store.applyMutation(legSave(departure, { miscAmount: "0" }));
  store.applyMutation({ type: "destination.save", id: vienna, stopId: vienna, nights: 2, shoppingAmount: "0", miscDailyAmount: "0", hotelNightlyAmount: "0" });
  const page = tripPage(store, tripId);
  assert.deepEqual(rows(page).filter(([category]) => ["Transit miscellaneous", "Shopping"].includes(category)), [["Transit miscellaneous", "$0"], ["Shopping", "$0"]]);
  const amounts = (city) => within(page.card(city)).filter((node) => node.props.className === "budget-category").map((row) => [shown(row.props.children[0]), shown(row.props.children[1]), links(row).length]);
  assert.deepEqual(amounts("Vienna"), [["Accommodation", "$0", 0], ["Activities", "$0", 0], ["Food", "$0", 0], ["Shopping", "$0", 0], ["Miscellaneous", "$0", 0]]);
  assert.deepEqual(amounts("Salzburg"), [["Accommodation", "Not estimated", 1], ["Activities", "$0", 0], ["Food", "$0", 0], ["Shopping", "Not set", 1], ["Miscellaneous", "Not estimated", 1]]);
});

test("each destination card's Not set and Not estimated amounts open that destination's editors (TRA-165)", (t) => {
  const { store, tripId, salzburg } = austria(t);
  store.applyMutation({ type: "destination.save", id: salzburg, activitiesBudgetMode: "general", foodBudgetMode: "daily" });
  const page = tripPage(store, tripId);
  const card = page.card("Salzburg");
  assert.deepEqual(links(card).map((link) => [shown(link), text(link)]), [
    ["Not estimated", "Not estimated: add the nightly hotel amount for Salzburg"], ["Not estimated", "Not estimated: add the general activities amount for Salzburg"],
    ["Not estimated", "Not estimated: add the daily food amount for Salzburg"], ["Not set", "Not set: add the shopping amount for Salzburg"],
    ["Not estimated", "Not estimated: add the daily miscellaneous amount for Salzburg"],
  ]);
  assert.deepEqual(links(card).map((link) => page.open(link)), [
    { title: "Edit accommodation budget for Salzburg", focused: ["hotelNightlyAmount", ""] },
    { title: "Edit activities budget for Salzburg", focused: ["activitiesGeneralAmount", ""] },
    { title: "Edit food budget for Salzburg", focused: ["foodDailyAmount", ""] },
    { title: "Edit shopping budget for Salzburg", focused: ["shoppingAmount", ""] },
    { title: "Edit miscellaneous budget for Salzburg", focused: ["miscDailyAmount", ""] },
  ]);
  // The card's other editors are unchanged, and also name the destination.
  page.click(page.button("Edit shopping budget for Salzburg"));
  assert.deepEqual([page.title(), page.focused()], ["Edit shopping budget for Salzburg", ["shoppingAmount", ""]]);
});

test("outside a trip, a destination's budget shows Not set and Not estimated as before, without links (TRA-165)", (t) => {
  const { store, vienna } = austria(t);
  const page = plannerPage(store, () => { const { data, access } = store.getDestinationSnapshot(vienna); return { initialData: data, destinationAccess: { [vienna]: access }, destinationId: vienna }; });
  const categories = page.all().filter((node) => node.props.className === "budget-category");
  assert.deepEqual(categories.map((row) => shown(row.props.children[1])), ["Not estimated", "$0", "$0", "Not set", "Not estimated"]);
  assert.deepEqual(categories.flatMap(links), [], "nights belong to each trip, so the trip's page enters what depends on them");
});

test("when a save replaces a link with keyboard focus, the trip estimate's heading or the card's Budget heading takes it (TRA-165)", (t) => {
  const { store, tripId } = austria(t);
  const page = tripPage(store, tripId);
  const focused = [];
  const heading = page.estimate().props.children.find((child) => child.type === "h2");
  assert.equal(heading.props.tabIndex, -1, "focusable from script only");
  heading.props.ref.current = { focus: () => focused.push("The trip estimate") };
  const toggle = within(page.card("Vienna")).find((node) => node.props.className === "budget-toggle");
  toggle.props.ref.current = { focus: () => focused.push("Vienna's Budget") };
  /** A link as the browser has it, attached to the page, and what its removal does with focus while it has it, or not. */
  const remove = (link, withFocus) => {
    const control = { contains: (node) => node === control };
    const detach = link.props.ref(control);
    page.document.activeElement = withFocus ? control : { name: "elsewhere" };
    detach();
  };
  remove(links(page.estimate())[0], true);
  remove(links(page.card("Vienna"))[0], true);
  assert.deepEqual(focused, ["The trip estimate", "Vienna's Budget"]);
  remove(links(page.estimate())[1], false);
  remove(links(page.card("Vienna"))[1], false);
  assert.deepEqual(focused, ["The trip estimate", "Vienna's Budget"], "focus elsewhere stays where it is");
});

test("the links keep their text's size and place, underlined as research links are, and are 44 pixels tall on touchscreens (TRA-165)", () => {
  const rules = cssRules("../src/app/globals.css");
  assert.deepEqual(rules.filter(([selector]) => selector === ".unset-amount"), [
    [".unset-amount", { padding: "0", "font-size": "inherit", "text-decoration": "underline", "text-underline-offset": "3px" }, null],
    [".unset-amount", { "min-height": "44px" }, "@media(pointer:coarse)"],
  ]);
  // Research links' underline, with the green and hover color every text button has.
  const research = cssRules("../src/components/research-links.module.css").find(([selector]) => selector === ".link")[1];
  assert.deepEqual([research["text-decoration"], research["text-underline-offset"], research.color], ["underline", "3px", "var(--green)"]);
  const textButton = (selector) => rules.find(([name]) => name === selector)[1];
  assert.deepEqual([textButton(".text-button").color, textButton(".text-button:hover:not(:disabled)").color], ["var(--green)", "var(--orange)"]);
});

test("the trip's Help says what selecting Not set or Not estimated does (TRA-165)", () => {
  assert.ok(pageHelp("/trips/t1").points.some((point) => point.includes("Not set or Not estimated")));
});
