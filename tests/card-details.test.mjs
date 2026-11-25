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
import * as tripTags from "../src/lib/trip-tags.ts";
import { addDestination, destinationEdit, setup, tripInput } from "./budget-fixtures.mjs";
import { contrast, cssRules, onlyRule } from "./css-rules.mjs";

// TRA-51: the text beneath a location's image ranks the same way on every card that shows one: a destination's on a
// trip's page and in Destinations, whose cards trips' cards on All trips share, and a hotel's, activity's, restaurant's
// or church's in a destination's carousels and on its pages.
const globals = "../src/app/globals.css";
const carousel = "../src/components/destination-ideas.module.css";
const churches = "../src/components/churches.module.css";
const restaurantTypes = "../src/components/restaurant-types.module.css";

/** Each value a selector's rules in a CSS file give a property, at any screen width. */
function values(file, selector, property) {
  const rules = cssRules(file).filter(([selectors]) => selectors.split(",").map((part) => part.trim()).includes(selector));
  assert.ok(rules.length, selector);
  return [...new Set(rules.map(([, declarations]) => declarations[property]).filter((value) => value !== undefined))];
}
/** The one value a selector gives a property at every screen width, or undefined without one, so no width shows it differently. */
function only(file, selector, property) {
  const found = values(file, selector, property);
  assert.ok(found.length <= 1, `${selector} has one ${property} at every width`);
  return found[0];
}
/** A length in pixels, written as CSS does, with 0 written alone. */
const px = (size) => size === "0" ? 0 : Number(/^(\d+(?:\.\d+)?)px$/.exec(size)[1]);

/** What the place, stay or trip is, on each card: its file, its selector, and the location's name above it. */
const primary = [
  [carousel, ".description", ".name"],
  [globals, ".idea-description", ".idea-card h2"],
  [churches, ".denomination", ".name"],
  [globals, ".destination-name p", ".destination-name h3"],
  [globals, ".city-list", ".trip-card h3"],
];
/** Further details, and the rule each takes its color from. */
const secondary = [[globals, ".idea-address"], [globals, ".idea-notes"], [globals, ".destination-notes"], [globals, ".trip-card .trip-meta", ".trip-meta"], [globals, ".destination-full-name"], [globals, ".trip-focus"]];
/** What a card shows in place of a detail it doesn't have yet. */
const placeholders = [[carousel, ".price.unknown"], [globals, ".destination-name p.unknown"]];
/** Small labels and tags, the size each is at least, and the rule each takes its color from. */
const labels = [[globals, ".trip-number", 10, ".trip-card-top"], [globals, ".selection-tag", 11], [globals, ".idea-bottom small", 11], [restaurantTypes, ".tag", 11]];
/** Supporting text directly below a name, in the accent color: a trip's tagline on its card on All trips (TRA-167). */
const accents = [[globals, ".trip-tagline", ".trip-card h3"]];

test("the details beneath location images rank the same way on every card: the name, what it is in ink, then further details, muted (TRA-51)", () => {
  for (const [file, selector, name] of primary) {
    assert.equal(only(file, selector, "color"), "var(--ink)", selector);
    const size = px(only(file, selector, "font-size"));
    assert.ok(size >= 13, `${selector} is at least 13px`);
    // The name above it is larger at every width: a serif heading, or the carousel's bold name.
    assert.ok(Math.min(...values(file, name, "font-size").map(px)) > size, `${name} leads ${selector}`);
  }
  assert.equal(only(carousel, ".name", "font-weight"), "600");
  for (const [file, selector, colorFrom = selector] of secondary) {
    assert.equal(only(file, colorFrom, "color"), "var(--muted)", selector);
    assert.ok(px(only(file, selector, "font-size")) >= 13, `${selector} is at least 13px`);
  }
  for (const [file, selector] of placeholders) assert.equal(only(file, selector, "color"), "var(--muted)", selector);
  // A known price is bold, below what the idea is, and an unknown one isn't.
  assert.deepEqual([only(carousel, ".price", "font-weight"), only(carousel, ".price", "font-size"), only(carousel, ".price.unknown", "font-weight")], ["600", "14px", "400"]);
  for (const [file, selector, size] of labels) assert.ok(px(only(file, selector, "font-size")) >= size, `${selector} is at least ${size}px`);
  assert.equal(only(globals, ".selection-tag", "font-weight"), "600");
});

test("the carousel's cards give the name room below the photo, and each detail room below the one before (TRA-51)", () => {
  // Top, sides and, for the price, bottom: the name sits 12px below the photo, and every line has 14px sides.
  assert.deepEqual(Object.fromEntries([".name", ".description", ".types", ".price"].map((selector) => [selector, only(carousel, selector, "margin").split(" ").map(px)])), {
    ".name": [12, 14, 0], ".description": [4, 14, 0], ".types": [8, 14, 0], ".price": [10, 14, 14],
  });
});

test("a trip's tagline on its card is smaller than its name, in the accent color its page shows it in, and wraps in full (TRA-167)", () => {
  for (const [file, selector, name] of accents) {
    // A trip's page shows its tagline in its heading's eyebrow.
    assert.equal(only(file, selector, "color"), only(globals, ".eyebrow", "color"), selector);
    const size = px(only(file, selector, "font-size"));
    assert.ok(size >= 13, `${selector} is at least 13px`);
    assert.ok(Math.min(...values(file, name, "font-size").map(px)) > size, `${name} leads ${selector}`);
    // One rule at every width: it wraps, a long word included, and nothing cuts it short.
    const rule = onlyRule(file, selector);
    assert.equal(rule["overflow-wrap"], "anywhere", selector);
    for (const property of ["white-space", "overflow", "text-overflow", "line-clamp", "-webkit-line-clamp", "height", "max-height"]) assert.equal(rule[property], undefined, `${selector} ${property}`);
  }
});

test("every detail beneath a location's image reaches 4.5:1 contrast with what is behind it (TRA-51)", () => {
  /** A color as written, or the one its custom property is in :root. */
  const color = (value) => /^#[0-9a-f]{6}$/i.test(value) ? value : only(globals, ":root", /^var\((--[a-z-]+)\)$/.exec(value)[1]);
  // Travel has one theme. Each card is --white behind its text, unless the text has a background of its own.
  const shown = [...primary, ...secondary.map(([file, selector, colorFrom]) => [file, selector, null, colorFrom]), ...placeholders,
    ...labels.map(([file, selector, , colorFrom]) => [file, selector, null, colorFrom]), ...accents, [globals, ".selection-tag.chosen"], [globals, ".destination-name p.tagline"]];
  for (const [file, selector, , colorFrom = selector] of shown) {
    const text = color(only(file, colorFrom, "color"));
    const background = color(only(file, selector, "background") ?? "var(--white)");
    assert.ok(contrast(text, background) >= 4.5, `${selector}: ${text} on ${background} is ${contrast(text, background).toFixed(2)}:1`);
  }
  // Every card's tone colors its trip or destination number.
  for (const tone of [".tone-1 .trip-card-top", ".tone-2 .trip-card-top"]) assert.ok(contrast(color(only(globals, tone, "color")), color("var(--white)")) >= 4.5, tone);
});

test("a destination's tagline on a trip's page is in the orange accent, smaller than its name, and wraps whole as the stay's notes do (TRA-166)", () => {
  // Its one rule, the same at every width, changes only its color, so it has the stay's notes' size, spacing and wrapping.
  assert.deepEqual(onlyRule(globals, ".destination-name p.tagline"), { color: "var(--orange)" });
  // The name, which has no color of its own, and the stay's notes are in ink.
  assert.deepEqual([only(globals, ".destination-name h3", "color"), only(globals, "body", "color"), only(globals, ".destination-name p", "color")], [undefined, "var(--ink)", "var(--ink)"]);
  assert.ok(Math.min(...values(globals, ".destination-name h3", "font-size").map(px)) > px(only(globals, ".destination-name p", "font-size")), "the name leads");
  // Nothing shortens it: a long tagline, or a long word in one, wraps onto more lines.
  assert.equal(only(globals, ".destination-name p", "overflow-wrap"), "anywhere");
  for (const property of ["white-space", "overflow", "text-overflow", "-webkit-line-clamp", "max-height"]) assert.equal(only(globals, ".destination-name p", property), undefined, property);
});

// A trip's page, and All trips, rendered by the planner from what the store gives `/trips/<trip ID>` and `/`, as their
// pages do, with each render a page load. No browser or server is involved.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
const element = (type, props) => ({ type, props });
const modules = {
  "react": { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}], useTransition: () => [false, () => {}], useId: () => "id", useRef: (current) => ({ current }), useEffect: () => {}, useEffectEvent: (handler) => handler },
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
  "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
  "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort,
  // All trips shows the trips that have every selected tag: with none selected, every trip.
  "@/lib/trip-tags": tripTags,
};
// Every other module is one the cards' text doesn't use: each of its exports renders, and returns, nothing.
const unused = new Proxy({}, { get: () => () => null });
const require = (name) => modules[name] ?? unused;
// Each trip's card on All trips has the handle that drags it into a new place (TRA-16).
modules["@/components/trip-drag"] = load("../src/components/trip-drag.ts", require);
const { default: PlannerApp } = load("../src/components/planner-app.tsx", require);
/** An element as the browser has it, each component and fragment rendered in its place. */
function render(node) {
  if (Array.isArray(node)) return [...node].flatMap(render);
  // React renders nothing for these, an empty string included.
  if (node === null || node === undefined || typeof node === "boolean" || node === "") return [];
  if (typeof node !== "object") return [String(node)];
  if (typeof node.type === "function") return render(node.type(node.props));
  if (node.type === "fragment") return render(node.props.children);
  return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
}
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");

/** A destination's Like below its stay's notes (TRA-31), whose button these tests leave out. */
const LIKE = ["div", "destination-like", ""];
/** Each destination's name and what is below it on a trip's page as it loads now, in route order: each element's tag, class and text. */
function destinationNames(store, tripId) {
  const { data, access, library } = store.getTripSnapshot(tripId);
  return render(PlannerApp({ initialData: data, access: { [tripId]: access }, library, tripId })).flatMap(within)
    .filter((node) => node.props.className === "destination-name").map((name) => name.props.children.map((child) => [child.type, child.props.className, text(child)]));
}

test("a stay's notes show below its destination's name as saved, and without any the placeholder is marked to show muted (TRA-51)", (t) => {
  const { store, tripId } = setup(t, tripInput({ name: "Spring in Austria" }));
  addDestination(store, tripId, { city: "Vienna", stay: "Three nights near the Ringstrasse" });
  addDestination(store, tripId, { city: "Salzburg", stay: "" });
  // The text is as before, and only the placeholder has a class. The destination's Like follows (TRA-31).
  assert.deepEqual(destinationNames(store, tripId), [
    [["h3", undefined, "Vienna"], ["p", undefined, "Three nights near the Ringstrasse"], LIKE],
    [["h3", undefined, "Salzburg"], ["p", "unknown", "Stay notes not added"], LIKE],
  ]);
});

test("a destination's tagline shows whole, directly below its name on a trip's page, and one without a tagline shows nothing there (TRA-166)", (t) => {
  const { store, tripId } = setup(t, tripInput({ name: "Spring in Austria" }));
  // As long as a tagline can be.
  const longest = "Red roofs below the Schlossberg, a clock tower above them, pumpkin seed oil on everything, and a steel island in the Mur";
  assert.equal(longest.length, 120);
  const vienna = addDestination(store, tripId, { city: "Vienna", stay: "Three nights near the Ringstrasse", tagline: "Where the Danube meets the Old Town" });
  addDestination(store, tripId, { city: "Salzburg", stay: "" });
  const graz = addDestination(store, tripId, { city: "Graz", stay: "", tagline: longest });
  assert.deepEqual(destinationNames(store, tripId), [
    [["h3", undefined, "Vienna"], ["p", "tagline", "Where the Danube meets the Old Town"], ["p", undefined, "Three nights near the Ringstrasse"], LIKE],
    [["h3", undefined, "Salzburg"], ["p", "unknown", "Stay notes not added"], LIKE],
    [["h3", undefined, "Graz"], ["p", "tagline", longest], ["p", "unknown", "Stay notes not added"], LIKE],
  ]);
  // The next load shows a changed tagline, and a cleared one leaves only the name and stay notes. Each moves with its destination.
  store.applyMutation(destinationEdit(vienna, { tagline: "Coffee, cake and the opera" }));
  store.applyMutation(destinationEdit(graz, { tagline: "" }));
  store.applyMutation({ type: "stop.move", id: vienna, direction: "down" });
  assert.deepEqual(destinationNames(store, tripId), [
    [["h3", undefined, "Salzburg"], ["p", "unknown", "Stay notes not added"], LIKE],
    [["h3", undefined, "Vienna"], ["p", "tagline", "Coffee, cake and the opera"], ["p", undefined, "Three nights near the Ringstrasse"], LIKE],
    [["h3", undefined, "Graz"], ["p", "unknown", "Stay notes not added"], LIKE],
  ]);
});

/** Each trip's card on All trips, by the address its link opens: each element the link shows, with its class and text. */
function tripCards(store) {
  const { data, budgets, access } = store.getHomeOverview();
  const page = render(PlannerApp({ initialData: data, initialBudgets: budgets, access })).flatMap(within);
  return Object.fromEntries(page.filter((node) => node.type === "article").map((card) => {
    const link = card.props.children.find((child) => child.type === "a");
    return [link.props.href, link.props.children.map((child) => [child.type, child.props.className, text(child)])];
  }));
}

test("a trip's saved tagline shows as typed and in full directly below its name on its card on All trips, and a trip without one keeps its card (TRA-167)", (t) => {
  const { store, tripId } = setup(t, tripInput({ name: "Spring in Japan" }));
  addDestination(store, tripId, { city: "Kyoto" });
  const japan = "/trips/" + tripId;
  const weekend = "/trips/" + store.applyMutation(tripInput({ name: "A long weekend" })).id;
  const before = tripCards(store);
  for (const card of Object.values(before)) assert.ok(card.every(([, className]) => className !== "trip-tagline"), "no empty line or default for a trip without a tagline");
  /** A card as it was, with `tagline` directly below the trip's name. */
  const withTagline = (card, tagline) => {
    const below = card.findIndex(([type]) => type === "h3") + 1;
    return [...card.slice(0, below), ["p", "trip-tagline", tagline], ...card.slice(below)];
  };
  // Shown as saved, not in the capitals of the trip's page, the longest a trip can have included.
  for (const tagline of ["Cherry blossoms and late trains", "Three weeks of temples, ramen counters, mountain onsen towns and bullet trains, ending with a slow ferry to the islands."]) {
    store.applyMutation(tripInput({ id: tripId, name: "Spring in Japan", tagline }));
    const cards = tripCards(store);
    assert.deepEqual(cards[japan], withTagline(before[japan], tagline));
    assert.deepEqual(cards[weekend], before[weekend], "another trip's card is unchanged");
  }
  // Clearing it shows the card as it was.
  store.applyMutation(tripInput({ id: tripId, name: "Spring in Japan", tagline: "" }));
  assert.deepEqual(tripCards(store), before);
});
