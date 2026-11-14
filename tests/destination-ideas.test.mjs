import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as imageLimits from "../src/lib/image-limits.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as uuid from "../src/lib/uuid.ts";
import { addDestination, candidateInput, setup, stop, visit } from "./budget-fixtures.mjs";

// The actual components, rendered with each hook's initial state, as on a page's first render. No browser is involved.
const element = (type, props) => ({ type, props });
const shared = {
  "react": { useId: () => "id", useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }), useEffect: () => {} },
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "next/link": { default: "a" }, "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
  "@/lib/budget": budget, "@/lib/image-limits": imageLimits, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/uuid": uuid,
};
/** A component module, given the components it imports. A CSS module's class names are their own names. */
function load(file, modules = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URL,
    require(name) {
      if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (!(name in modules) && !(name in shared)) throw new Error("Unexpected component import: " + name);
      return modules[name] ?? shared[name];
    },
  });
  return exports;
}
const { DestinationIdeas, IdeaDetails } = load("../src/components/destination-ideas.tsx", {
  "./candidate-gallery": load("../src/components/candidate-gallery.tsx"), "./research-links": load("../src/components/research-links.tsx"),
});
const { DestinationBudget } = load("../src/components/destination-budget.tsx");

/** The host elements an element renders to, with every component rendered. */
function hosts(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (typeof node.type === "function") return hosts(node.type(node.props));
  return [node, ...hosts(node.props.children)];
}
/** An element's text, including what only screen readers read. */
function text(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(typeof node.type === "function" ? node.type(node.props) : node.props.children);
}
const byClass = (nodes, className) => nodes.filter((node) => String(node.props.className ?? "").split(" ").includes(className));

const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
/** A trip's destination with hotels and activities, some chosen for the budget, and no restaurants. */
function seed(t) {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const [first, second] = [randomUUID(), randomUUID()];
  const save = (category, name, overrides) => store.applyMutation(candidateInput(id, category, { name, price: "", included: false, ...overrides })).id;
  const ideas = {
    first: save("hotels", "First hotel", { price: "980", gallery: { add: [{ id: first, data: webp }, { id: second, data: webp }], remove: [], mainImageId: second } }),
    chosen: save("hotels", "Chosen hotel", { price: "1250", included: true }),
    third: save("hotels", "Third hotel", { gallery: { add: [{ id: randomUUID(), data: webp }], remove: [] } }),
    opera: save("activities", "Opera", { price: "260" }),
    palace: save("activities", "Palace", { price: "80", included: true, mustDo: true }),
    museum: save("activities", "Museum", { price: "40", included: true }),
  };
  return { store, tripId, id, ideas, snapshot: store.getSnapshot() };
}
function render(t) {
  const { snapshot, id, ideas } = seed(t);
  const calls = [];
  const tree = { type: DestinationIdeas, props: {
    ideas: snapshot.candidates.filter((item) => item.destinationId === id), city: "Vienna", pages: "/trips/trip/destinations/stop", busy: false,
    onView: (item) => calls.push(["view", item.id]), onAdd: (category) => calls.push(["add", category]), onBudgetEdit: (category) => calls.push(["budget", category]),
  } };
  const sections = hosts(tree).filter((node) => node.type === "section");
  return { snapshot, ideas, calls, sections: Object.fromEntries(sections.map((section) => [section.props["aria-label"], hosts(section)])), order: sections.map((section) => section.props["aria-label"]) };
}

test("a destination's Hotels, Activities and Restaurants sections start expanded, in that order (TRA-120)", (t) => {
  const { sections, order } = render(t);
  assert.deepEqual(order, ["Hotels", "Activities", "Restaurants"]);
  for (const [name, count] of [["Hotels", 3], ["Activities", 3], ["Restaurants", 0]]) {
    const toggle = sections[name].find((node) => node.props["aria-controls"]);
    assert.equal(text(toggle), name + "(" + count + ")");
    assert.equal(toggle.props["aria-expanded"], true);
    assert.equal(sections[name].find((node) => node.props.id === toggle.props["aria-controls"]).props.hidden, false);
  }
  assert.equal(text(byClass(sections.Restaurants, "empty")[0]), "No restaurants saved yet.");
  assert.deepEqual(byClass(sections.Restaurants, "card"), []);
});

test("each carousel shows ideas chosen for the budget first, each group in its saved order, with photo, name and price", (t) => {
  const { sections, snapshot, ideas } = render(t);
  const cards = (name) => byClass(sections[name], "card").map((card) => {
    const rendered = hosts(card);
    return { name: text(byClass(rendered, "name")[0]), price: text(byClass(rendered, "price")[0]), chosen: text(byClass(rendered, "chosen")[0]), photo: rendered.find((node) => node.type === "img")?.props.src };
  });
  const main = (id) => { const item = snapshot.candidates.find((candidate) => candidate.id === id); const image = item.images.find((photo) => photo.id === item.mainImageId); return `/api/candidate-images/${id}/${image.id}?v=${image.version}`; };
  assert.deepEqual(cards("Hotels"), [
    { name: "Chosen hotel", price: "$1,250", chosen: "Chosen stay", photo: undefined },
    { name: "First hotel", price: "$980", chosen: "", photo: main(ideas.first) },
    { name: "Third hotel", price: "Not estimated", chosen: "", photo: main(ideas.third) },
  ]);
  assert.deepEqual(cards("Activities").map((card) => [card.name, card.chosen]), [["Palace", "In the plan"], ["Museum", "In the plan"], ["Opera", ""]]);
  // Every carousel has its arrows, which wait to be measured before they scroll.
  assert.deepEqual(sections.Hotels.filter((node) => byClass([node], "arrow").length).map((node) => [node.props["aria-label"], node.props.disabled]), [["Previous hotels", true], ["Next hotels", true]]);
});

test("cards show details, and each section edits its budget, adds an idea and links to its page", (t) => {
  const { sections, ideas, calls } = render(t);
  byClass(sections.Hotels, "card")[0].props.onClick();
  for (const [name, category] of [["Hotels", "hotels"], ["Activities", "activities"], ["Restaurants", "restaurants"]]) {
    const buttons = sections[name].filter((node) => node.type === "button");
    buttons.find((node) => text(node).startsWith("Edit budget")).props.onClick();
    buttons.find((node) => text(node).startsWith("Add ")).props.onClick();
    assert.deepEqual(sections[name].filter((node) => node.type === "a").map((link) => [link.props.href, text(link)]), [["/trips/trip/destinations/stop/" + category, "Manage " + category + " in Vienna"]]);
  }
  assert.deepEqual(calls, [["view", ideas.chosen], ["budget", "hotels"], ["add", "hotels"], ["budget", "activities"], ["add", "activities"], ["budget", "restaurants"], ["add", "restaurants"]]);
  assert.deepEqual(sections.Activities.filter((node) => node.type === "button" && !byClass([node], "card").length && !byClass([node], "arrow").length).map(text),
    ["Activities(3)", "Edit budget for activities in Vienna", "Add activity in Vienna"]);
});

test("an idea's details show what its editor saves, read only", (t) => {
  const { store, id } = seed(t);
  const saved = store.applyMutation(candidateInput(id, "activities", { name: "Walking tour", price: "45.50", address: "Stephansplatz", notes: "Morning\nBring water", links: [{ id: randomUUID(), url: "https://example.com/tour", description: "Booking" }], included: true, mustDo: true })).id;
  const details = (itemId) => {
    const rendered = hosts({ type: IdeaDetails, props: { item: store.getSnapshot().candidates.find((item) => item.id === itemId) } });
    return rendered.filter((node) => node.type === "div").map((row) => [text(row.props.children[0]), text(row.props.children[1])]);
  };
  assert.deepEqual(details(saved), [
    ["Estimated price (USD)", "$45.50Total for the whole party for this activity."],
    ["Address or neighborhood", "Stephansplatz"],
    ["Activity photos", "Not added"],
    ["Website and research links", "Bookingexample.com"],
    ["Notes", "Morning\nBring water"],
    ["Must do", "Yes"],
    ["Include in itemized activity costs", "Yes"],
  ]);
  const hotel = store.applyMutation(candidateInput(id, "hotels", { name: "Plain hotel", price: "", included: false })).id;
  assert.deepEqual(details(hotel), [
    ["Estimated price (USD)", "Not estimatedTotal for all rooms and the entire stay."],
    ["Address or neighborhood", "Not added"],
    ["Hotel photos", "Not added"],
    ["Website and research links", "Not added"],
    ["Notes", "Not added"],
    ["Choose this hotel for the budget", "No"],
  ]);
});

test("the destination budget no longer links to the idea pages, and keeps its other editors (TRA-120)", (t) => {
  const { store, id } = seed(t);
  const rendered = hosts({ type: DestinationBudget, props: { snapshot: store.getSnapshot(), visit: visit(store, id), stop: stop(store, id), onShoppingEdit() {}, onMiscellaneousEdit() {} } });
  assert.deepEqual(rendered.filter((node) => node.type === "a"), []);
  assert.deepEqual(byClass(rendered, "budget-category").map((row) => [text(row.props.children[0]), text(byClass(hosts(row), "budget-category-action")[0])]), [
    ["Accommodation", ""], ["Activities", ""], ["Food", ""],
    ["Shopping", "Edit shopping budget for Vienna"], ["Miscellaneous", "Edit miscellaneous budget for Vienna"],
  ]);
});
