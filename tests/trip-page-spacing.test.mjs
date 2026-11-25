import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import { addDestination, setup } from "./budget-fixtures.mjs";
import { cssRules, styles } from "./css-rules.mjs";

// TRA-156: on phones, up to 540 pixels wide, a trip's page shows more of itself on each screen, with less room around and
// between its boxes and sections. Only a trip's page changes: the planner marks it, and every rule for it applies only
// on phones and changes only spacing. Its pages are rendered by the planner from what the store gives them, as a page
// load renders them. No browser or server is involved.
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
  "react": { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}], useTransition: () => [false, () => {}], useId: () => "id", useRef: (current) => ({ current }), useEffect: () => {}, useEffectEvent: (callback) => callback },
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
  "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
  "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates,
};
// Every other module is one these pages' main content doesn't need: each of its exports renders, and returns, nothing.
const unused = new Proxy({}, { get: () => () => null });
const require = (name) => modules[name] ?? unused;
// All trips lets its cards be dragged into a new order (TRA-16).
modules["@/components/trip-drag"] = load("../src/components/trip-drag.ts", require);
const { default: PlannerApp } = load("../src/components/planner-app.tsx", require);
/** The classes of the main content the planner renders with `props`. */
const mainClasses = (props) => PlannerApp(props).props.children.find((child) => child?.type === "main").props.className.split(" ");

test("only a trip's page is marked for its spacing on phones, not its idea pages, a destination's page or All trips (TRA-156)", (t) => {
  const { store, tripId } = setup(t);
  const lisbon = addDestination(store, tripId, { city: "Lisbon" });
  const trip = store.getTripSnapshot(tripId);
  assert.deepEqual(mainClasses({ initialData: trip.data, access: { [tripId]: trip.access }, library: trip.library, tripId }), ["main-content", "trip-page"]);
  // A destination added to a trip shares its stop's ID.
  const stay = store.getTripSnapshot(tripId, lisbon);
  for (const page of [{ category: "hotels" }, { church: true }]) {
    assert.deepEqual(mainClasses({ initialData: stay.data, access: { [tripId]: stay.access }, tripId, stopId: lisbon, ...page }), ["main-content"], JSON.stringify(page));
  }
  const destination = store.getDestinationSnapshot(lisbon);
  assert.deepEqual(mainClasses({ initialData: destination.data, destinationAccess: { [lisbon]: destination.access }, destinationId: lisbon }), ["main-content"]);
  const home = store.getHomeOverview();
  assert.deepEqual(mainClasses({ initialData: home.data, initialBudgets: home.budgets, access: home.access }), ["main-content"]);
});

const GLOBALS = "../src/app/globals.css";
const component = (name) => `../src/components/${name}.module.css`;
const IDEAS = component("destination-ideas");
const PANELS = ["entry-requirements", "health-safety", "typical-weather"].map(component);
const SUNDAYS = component("church-sundays");
const HOME = component("home-items");
// The packing list (TRA-18) keeps At home's spacing.
const PACKING = component("packing-list");
const MAP = component("trip-map");
/** Phones, up to 540 pixels wide, and tablets and desktops. */
const PHONES = [320, 360, 375, 390, 414, 448, 540];
const WIDER = [541, 600, 780, 1024, 1440];
/** The rules a trip's page takes for a part: every page's, then its own, and the spacing they give it on phones. */
const SPACING = [
  // Every box has 12px of padding: the destination cards, the panels in them, Sundays and churches, At home items and the
  // estimate. The panels in a card are 12px apart, below its budget, which lines up with the rest of the card.
  [GLOBALS, [".destination-card", ".trip-page .destination-card"], { padding: "12px" }],
  [GLOBALS, [".destination-budget", ".trip-page .destination-budget"], { margin: "0 0 12px" }],
  [IDEAS, [".section", ":global(.trip-page) .section"], { padding: "12px", margin: "12px 0" }],
  ...PANELS.map((file) => [file, [".panel", ":global(.trip-page) .panel"], { padding: "12px", margin: "12px 0" }]),
  [SUNDAYS, [".panel", ":global(.trip-page) .panel"], { padding: "12px", "margin-bottom": "12px" }],
  [GLOBALS, [".idea-card", ".destination-church .idea-card", ".trip-page .destination-church .idea-card"], { padding: "12px" }],
  [HOME, [".card"], { padding: "12px" }],
  [PACKING, [".progress"], { padding: "12px" }],
  [PACKING, [".group"], { padding: "12px" }],
  [GLOBALS, [".budget-panel", ".trip-page .budget-panel"], { padding: "12px", "margin-top": "0" }],
  // Sections are 28px apart: the map, the destinations, the travel between them, At home and the estimate.
  [MAP, [".section"], { "margin-bottom": "28px" }],
  [GLOBALS, [".travel-section", ".trip-page .travel-section"], { "margin-top": "28px" }],
  [HOME, [".section"], { "margin-top": "28px" }],
  [PACKING, [".section"], { "margin-top": "28px" }],
  [GLOBALS, [".trip-layout", ".trip-page .trip-layout"], { gap: "28px" }],
  // Headings have 16px of room: below each section's, and above each heading in a destination's card.
  [GLOBALS, [".section-heading", ".trip-page .trip-main>section>.section-heading"], { "margin-bottom": "16px" }],
  [GLOBALS, [".budget-section-heading", ".trip-page .budget-section-heading"], { "margin-top": "16px" }],
  // The trip's heading, and each connection between the lines that part them.
  [GLOBALS, [".trip-heading", ".trip-page .trip-heading"], { padding: "20px 0", "margin-bottom": "20px" }],
  [GLOBALS, [".travel-card", ".trip-page .travel-card", ".trip-page .travel-card+.travel-card"], { "padding-top": "14px", "padding-bottom": "14px" }],
];

test("on phones, a trip's boxes have 12px of padding, its sections are 28px apart and its headings have 16px of room; wider screens are as every page is (TRA-156)", () => {
  for (const [file, selectors, spacing] of SPACING) {
    for (const width of PHONES) {
      const given = styles(file, selectors, width);
      assert.deepEqual(Object.fromEntries(Object.keys(spacing).map((property) => [property, given[property]])), spacing, `${selectors.at(-1)} at ${width}px`);
    }
    // Tablets and desktops give a trip's page what they give every page.
    const everyPage = selectors.filter((selector) => !selector.includes("trip-page"));
    for (const width of WIDER) assert.deepEqual(styles(file, selectors, width), styles(file, everyPage, width), `${selectors.at(-1)} at ${width}px`);
  }
});

test("a trip's page has its own rules only on phones, and they change only spacing, so its fonts and controls are as they were (TRA-156)", () => {
  // Padding, margins and gaps, the room a destination's name keeps beside its buttons, and where a carousel's arrows sit.
  const spacing = /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left))?|gap|min-width|left|right)$/;
  for (const file of [GLOBALS, IDEAS, ...PANELS, SUNDAYS]) {
    const rules = cssRules(file).filter(([selector]) => selector.includes("trip-page"));
    assert.ok(rules.length > 0, file);
    for (const [selector, declarations, atRule] of rules) {
      assert.equal(atRule, "@media(max-width:540px)", selector);
      for (const property of Object.keys(declarations)) assert.match(property, spacing, `${selector} ${property}`);
    }
  }
});

test("a carousel's arrows stay within its panel's padding, on a trip's page and every other, at every width (TRA-156)", () => {
  for (const width of [...PHONES, ...WIDER]) {
    for (const scope of [[], [":global(.trip-page) "]]) {
      const rules = (selector) => styles(IDEAS, [selector, ...scope.map((prefix) => prefix + selector)], width);
      const padding = parseInt(rules(".section").padding);
      const page = scope.length ? "a trip's page" : "other pages";
      assert.ok(-parseInt(rules(".previous").left) <= padding, `${page} at ${width}px: the previous arrow reaches past the padding`);
      assert.ok(-parseInt(rules(".next").right) <= padding, `${page} at ${width}px: the next arrow reaches past the padding`);
    }
  }
});

test("a destination's buttons wrap below its name on a trip's page at the same widths as before, rather than squeezing it (TRA-156)", () => {
  for (const width of PHONES) {
    // Its card's padding narrows on both sides, and its name needs as much more room beside the buttons, so the row of its
    // number, name and buttons wraps where it did. A destination's page, as the trip's page was, keeps both.
    const card = (selectors) => parseInt(styles(GLOBALS, selectors, width).padding);
    const name = (selectors) => parseInt(styles(GLOBALS, selectors, width)["min-width"]);
    const gained = 2 * (card([".destination-card"]) - card([".destination-card", ".trip-page .destination-card"]));
    assert.ok(gained > 0, `${width}px`);
    assert.equal(name([".destination-name", ".trip-page .destination-name"]) - name([".destination-name"]), gained, `${width}px`);
  }
});
