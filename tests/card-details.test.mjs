import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import { addDestination, setup, tripInput } from "./budget-fixtures.mjs";
import { contrast, cssRules } from "./css-rules.mjs";

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
const secondary = [[globals, ".idea-address"], [globals, ".idea-notes"], [globals, ".destination-notes"], [globals, ".trip-card .trip-meta", ".trip-meta"], [globals, ".destination-full-name"]];
/** What a card shows in place of a detail it doesn't have yet. */
const placeholders = [[carousel, ".price.unknown"], [globals, ".destination-name p.unknown"]];
/** Small labels and tags, the size each is at least, and the rule each takes its color from. */
const labels = [[globals, ".trip-number", 10, ".trip-card-top"], [globals, ".selection-tag", 11], [globals, ".idea-bottom small", 11], [restaurantTypes, ".tag", 11]];

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

test("every detail beneath a location's image reaches 4.5:1 contrast with what is behind it (TRA-51)", () => {
  /** A color as written, or the one its custom property is in :root. */
  const color = (value) => /^#[0-9a-f]{6}$/i.test(value) ? value : only(globals, ":root", /^var\((--[a-z-]+)\)$/.exec(value)[1]);
  // Travel has one theme. Each card is --white behind its text, unless the text has a background of its own.
  const shown = [...primary, ...secondary.map(([file, selector, colorFrom]) => [file, selector, null, colorFrom]), ...placeholders,
    ...labels.map(([file, selector, , colorFrom]) => [file, selector, null, colorFrom]), [globals, ".selection-tag.chosen"]];
  for (const [file, selector, , colorFrom = selector] of shown) {
    const text = color(only(file, colorFrom, "color"));
    const background = color(only(file, selector, "background") ?? "var(--white)");
    assert.ok(contrast(text, background) >= 4.5, `${selector}: ${text} on ${background} is ${contrast(text, background).toFixed(2)}:1`);
  }
  // Every card's tone colors its trip or destination number.
  for (const tone of [".tone-1 .trip-card-top", ".tone-2 .trip-card-top"]) assert.ok(contrast(color(only(globals, tone, "color")), color("var(--white)")) >= 4.5, tone);
});

// A trip's page, rendered by the planner from what the store gives `/trips/<trip ID>`, as its page does, with each
// render a page load. No browser or server is involved.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
const element = (type, props) => ({ type, props });
const modules = {
  "react": { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}], useTransition: () => [false, () => {}], useId: () => "id", useRef: (current) => ({ current }), useEffect: () => {} },
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
  "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
  "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates,
};
// Every other module is one the destinations' names don't use: each of its exports renders, and returns, nothing.
const unused = new Proxy({}, { get: () => () => null });
const { default: PlannerApp } = load("../src/components/planner-app.tsx", (name) => modules[name] ?? unused);
/** An element as the browser has it, each component and fragment rendered in its place. */
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

test("a stay's notes show below its destination's name as saved, and without any the placeholder is marked to show muted (TRA-51)", (t) => {
  const { store, tripId } = setup(t, tripInput({ name: "Spring in Austria" }));
  addDestination(store, tripId, { city: "Vienna", stay: "Three nights near the Ringstrasse" });
  addDestination(store, tripId, { city: "Salzburg", stay: "" });
  const { data, access, library } = store.getTripSnapshot(tripId);
  const page = render(PlannerApp({ initialData: data, access: { [tripId]: access }, library, tripId })).flatMap(within);
  // Each destination's name and what is below it, in route order: the text is as before, and only the placeholder has a class.
  assert.deepEqual(page.filter((node) => node.props.className === "destination-name").map((name) => name.props.children.map((child) => [child.type, child.props.className, text(child)])), [
    [["h3", undefined, "Vienna"], ["p", undefined, "Three nights near the Ringstrasse"]],
    [["h3", undefined, "Salzburg"], ["p", "unknown", "Stay notes not added"]],
  ]);
});
