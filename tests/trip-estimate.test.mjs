import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import { createOwnedStore } from "./owned-store.mjs";
import { addDestination, candidateInput, newItem, setup, tripInput } from "./budget-fixtures.mjs";

// TRA-149 and TRA-151: the trip estimate beside each trip's page, rendered by the planner from what the store
// gives `/trips/<trip ID>`, as its page does, with each render a page load. No browser or server is involved.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
const element = (type, props) => ({ type, props });
const modules = {
  // A page load's render: state starts as given, and effects, which run only in a browser, don't run.
  "react": { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}], useTransition: () => [false, () => {}], useId: () => "id", useRef: (current) => ({ current }), useEffect: () => {} },
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
  "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
  "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort,
};
// Every other module is one the estimate doesn't use: each of its exports renders, and returns, nothing.
const unused = new Proxy({}, { get: () => () => null });
const require = (name) => modules[name] ?? unused;
// The estimate shows its amounts as each destination's budget does.
modules["@/components/destination-budget"] = load("../src/components/destination-budget.tsx", require);
const { default: PlannerApp } = load("../src/components/planner-app.tsx", require);

/**
 * An element as the browser has it: host elements with their children rendered, and text, each component and fragment
 * rendered in its place. Its arrays are this file's, not the planner's context's, so they compare as any other.
 */
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
/** A rendered host element's text. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");

/**
 * A trip for two to Vienna and Salzburg with every estimate added: flights with spending in transit, entry and visa
 * fees (TRA-159), each stay's hotel, activities, food, shopping and miscellaneous, and an At home cost.
 */
function plan(t) {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput({ name: "Spring in Austria", travelers: 2, entryVisaFeesAmount: "40" })).id;
  addDestination(store, tripId, { city: "Vienna", nights: 4, hotelNightlyAmount: "240", activitiesBudgetMode: "general", activitiesGeneralAmount: "350", foodBudgetMode: "daily", foodDailyAmount: "120", shoppingAmount: "300", miscDailyAmount: "40" });
  addDestination(store, tripId, { city: "Salzburg", nights: 3, hotelNightlyAmount: "190", activitiesBudgetMode: "general", activitiesGeneralAmount: "200", foodBudgetMode: "daily", foodDailyAmount: "100", miscDailyAmount: "30" });
  for (const leg of store.getTripSnapshot(tripId).data.legs) {
    store.applyMutation({ type: "leg.save", id: leg.id, method: "Flight", price: "900", miscAmount: "60", departure: "", arrival: "", url: "", notes: "" });
  }
  store.applyMutation({ type: "homeItem.save", ...newItem(), tripId, name: "Pet sitter", price: "350", notes: "" });
  return { store, tripId };
}
/** The trip's page as `/trips/<trip ID>` renders it, as its host elements. */
function tripPage(store, tripId) {
  const { data, access, library } = store.getTripSnapshot(tripId);
  return render(PlannerApp({ initialData: data, access: { [tripId]: access }, library, tripId }));
}
/** The page's one trip estimate. */
function estimate(page) {
  const panels = page.flatMap(within).filter((node) => node.props.className === "budget-panel");
  assert.equal(panels.length, 1);
  return panels[0];
}

test("the trip estimate has no Room in the budget label: its heading follows the wallet (TRA-149)", (t) => {
  const { store, tripId } = plan(t);
  const page = tripPage(store, tripId);
  const panel = estimate(page);
  // What the estimate shows, in order: the wallet, its heading, the total and who it is for, the categories, and
  // whether every estimate is added. Nothing is between the wallet and the heading.
  assert.deepEqual(panel.props.children.map((child) => [child.type, child.props.className]), [
    ["span", "budget-symbol"], ["h2", undefined], ["div", "budget-total"], ["p", "budget-caption"],
    ["dl", "budget-breakdown"], ["div", "budget-note"],
  ]);
  assert.deepEqual(within(panel.props.children[0]).map((node) => node.type), ["span", "icon:Wallet"]);
  assert.equal(text(panel.props.children[1]), "The trip estimate");
  assert.ok(!within(panel).some((node) => node.props.className === "eyebrow"), "no label above the heading");
  assert.doesNotMatch(page.map(text).join(""), /room in the budget/i, "nowhere on the trip's page");
});

test("the trip estimate still shows the trip's total and each category's amount (TRA-149)", (t) => {
  const { store, tripId } = plan(t);
  const panel = estimate(tripPage(store, tripId));
  const part = (className) => panel.props.children.find((child) => child.props.className === className);
  assert.deepEqual(part("budget-total").props.children.map(text), ["$6,680", "Estimated total"]);
  assert.equal(text(part("budget-caption")), "Total for all 2 travelers");
  assert.deepEqual(part("budget-breakdown").props.children.map((row) => row.props.children.map(text)), [
    ["Travel", "$2,700"], ["Transit miscellaneous", "$180"], ["Entry / visa fees", "$40"], ["Hotels", "$1,530"], ["Activities", "$550"],
    ["Food", "$780"], ["Shopping", "$300"], ["At home", "$350"], ["Miscellaneous", "$250"],
  ]);
  assert.equal(text(part("budget-note")), "All required estimates are added.");
});

test("the trip estimate ends with its note, without a paragraph about what it includes, and keeps every amount (TRA-151)", (t) => {
  const { store, tripId } = setup(t, tripInput({ name: "Spring in Austria" }));
  const vienna = addDestination(store, tripId, { city: "Vienna", nights: 3, hotelNightlyAmount: "180", miscDailyAmount: "40", foodBudgetMode: "daily", foodDailyAmount: "120", shoppingAmount: "150" });
  // Salzburg's hotel isn't estimated, nor is the travel home.
  addDestination(store, tripId, { city: "Salzburg", nights: 2, miscDailyAmount: "35", foodBudgetMode: "daily", foodDailyAmount: "100" });
  store.applyMutation(candidateInput(vienna, "activities", { name: "Schönbrunn Palace tour", price: "65" }));
  const [flight, train] = store.getTripSnapshot(tripId).data.legs;
  store.applyMutation({ type: "leg.save", id: flight.id, method: "Flight", price: "1400", miscAmount: "60", departure: "", arrival: "", url: "", notes: "" });
  store.applyMutation({ type: "leg.save", id: train.id, method: "Train", price: "90", departure: "", arrival: "", url: "", notes: "" });
  store.applyMutation({ type: "homeItem.save", ...newItem(), tripId, name: "Pet sitter", price: "300", notes: "" });

  const panel = estimate(tripPage(store, tripId));
  // Everything the estimate shows, in order: the amounts the trip's page showed before TRA-151, then the note, last. Each
  // count of what isn't estimated links to the first one, which screen readers also hear (TRA-165). Entry and visa fees
  // that aren't set link to the trip's editor, and aren't among the details still needed (TRA-159).
  assert.deepEqual(panel.props.children.map((child) => [child.props.className ?? child.type, text(child)]), [
    ["budget-symbol", ""],
    ["h2", "The trip estimate"],
    ["budget-total", "$3,355Partial estimate"],
    ["budget-caption", "Total for all 2 travelers"],
    ["budget-breakdown", "Travel1 not estimated: add the price of travel from Salzburg to Boston$1,490Transit miscellaneous$60Entry / visa feesNot set: add the trip's entry and visa feesHotels1 not estimated: add the nightly hotel amount for Salzburg$540Activities$65Food$560Shopping$150At home$300Miscellaneous$190"],
    ["budget-note", "2 details still need an estimate or a choice."],
  ]);
  assert.deepEqual(within(panel).filter((node) => node.props.className === "helper"), [], "no explanation follows the note");
});

test("nights spent traveling change no amount: the trip estimate, each stay's budget and the trip's card stay as they were (TRA-185)", (t) => {
  const { store, tripId } = plan(t);
  const panel = () => estimate(tripPage(store, tripId)).props.children.map(text);
  const stays = () => budget.tripVisits(store.getSnapshot(), tripId).map(({ visit }) => [visit.nights, budget.calculateDestinationBudget(store.getSnapshot(), visit), budget.calculateAccommodation(store.getSnapshot(), visit).totalMinor]);
  const before = { panel: panel(), budget: budget.calculateBudget(store.getSnapshot(), tripId), card: store.getHomeOverview().budgets[tripId], stays: stays() };
  store.applyMutation(tripInput({ id: tripId, name: "Spring in Austria", travelers: 2, startDate: "2027-04-02" }));
  const legs = store.getTripSnapshot(tripId).data.legs;
  // An overnight flight there, a night train between, and a red-eye home: four nights spent traveling.
  legs.forEach((leg, index) => store.applyMutation({ type: "leg.save", id: leg.id, method: "Flight", price: "900", miscAmount: "60", departure: "", arrival: "", url: "", notes: "", travelNights: [1, 2, 1][index] }));
  assert.equal(store.getSnapshot().trips[0].endDate, "2027-04-13", "the trip is four days longer");
  assert.deepEqual({ panel: panel(), budget: budget.calculateBudget(store.getSnapshot(), tripId), card: store.getHomeOverview().budgets[tripId], stays: stays() }, before,
    "no hotel night, daily amount, travel price or total changes, and each stay keeps its nights");
});
