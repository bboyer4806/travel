import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import { addDestination, candidateInput, newItem, setup, tripInput } from "./budget-fixtures.mjs";

// TRA-151: the trip estimate on a trip's page, rendered by the planner from what the store gives the page, as a page
// load does. No browser or server is involved.
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
  "@/lib/budget": budget, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/destination-label": destinationLabel,
};
// Every other module is one the estimate doesn't use: each of its exports renders, and returns, nothing.
const unused = new Proxy({}, { get: () => () => null });
const require = (name) => modules[name] ?? unused;
// The estimate shows its amounts with CurrencyTotals. The module's other parts, such as each destination's budget on
// its card, render nothing.
const { CurrencyTotals } = load("../src/components/destination-budget.tsx", require);
modules["@/components/destination-budget"] = new Proxy({ CurrencyTotals }, { get: (target, name) => target[name] ?? (() => null) });
const { default: PlannerApp } = load("../src/components/planner-app.tsx", require);

/** An element as the browser has it: host elements with their children rendered, and text, each component rendered in its place. */
function render(node) {
  // The planner's arrays are from the context it runs in, so they are copied into this one's to be compared.
  if (Array.isArray(node)) return Array.from(node).flatMap(render);
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node !== "object") return [String(node)];
  if (typeof node.type === "function") return render(node.type(node.props));
  return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
}
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");

/** The trip estimate on a trip's page, as a page load shows it. */
function tripEstimate(store, tripId) {
  const { data, access, library } = store.getTripSnapshot(tripId);
  const page = render(PlannerApp({ initialData: data, access: { [tripId]: access }, library, tripId })).flatMap(within);
  const panels = page.filter((node) => node.type === "aside");
  assert.equal(panels.length, 1, "a trip's page has one estimate");
  return panels[0];
}

test("the trip estimate ends with its note, without a paragraph about what it includes, and keeps every amount (TRA-151)", (t) => {
  const { store, tripId } = setup(t, tripInput({ name: "Spring in Austria" }));
  const vienna = addDestination(store, tripId, { city: "Vienna", nights: 3, hotelNightlyAmount: "180", miscDailyAmount: "40", foodBudgetMode: "daily", foodDailyAmount: "120", shoppingAmount: "150" });
  // Salzburg's hotel isn't estimated, nor is the travel home.
  addDestination(store, tripId, { city: "Salzburg", nights: 2, miscDailyAmount: "35", foodBudgetMode: "daily", foodDailyAmount: "100" });
  store.applyMutation(candidateInput(vienna, "activities", { name: "Schönbrunn Palace tour", price: "65" }));
  const [flight, train] = store.getTripSnapshot(tripId).data.legs;
  store.applyMutation({ type: "leg.save", id: flight.id, method: "Flight", price: "1400", miscAmount: "60", departure: "", arrival: "", url: "", notes: "" });
  store.applyMutation({ type: "leg.save", id: train.id, method: "Train", price: "90", departure: "", arrival: "", url: "", notes: "" });
  store.applyMutation({ type: "homeItem.save", ...newItem(), tripId, name: "Pet sitter", price: "300", notes: "", completed: false });

  const panel = tripEstimate(store, tripId);
  assert.equal(panel.props.className, "budget-panel");
  // Everything the estimate shows, in order: the amounts the trip's page showed before TRA-151, then the note, last.
  assert.deepEqual(panel.props.children.map((child) => [child.props.className ?? child.type, text(child)]), [
    ["budget-symbol", ""],
    ["eyebrow", "ROOM IN THE BUDGET"],
    ["h2", "The trip estimate"],
    ["budget-total", "$3,355Partial estimate"],
    ["budget-caption", "Total for all 2 travelers"],
    ["budget-breakdown", "Travel1 not estimated$1,490Transit miscellaneous$60Hotels1 not estimated$540Activities$65Food$560Shopping$150At home$300Miscellaneous$190"],
    ["budget-note", "2 details still need an estimate or a choice."],
  ]);
  assert.deepEqual(within(panel).filter((node) => node.props.className === "helper"), [], "no explanation follows the note");
});
