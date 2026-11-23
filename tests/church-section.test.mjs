import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import { addDestination, newItem, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore } from "./owned-store.mjs";

// TRA-169: a destination's Church section, on a trip's page and on its page in Destinations, starts closed each time the
// page loads, and its heading opens and closes its Sundays and churches. On a destination's Church page, where it is the
// page, it is always open. The real components run in small harnesses: no browser or server is involved.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
const element = (type, props) => ({ type, props });
const shared = {
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
};
// A CSS module's class names are their own names.
const cssModule = { default: new Proxy({}, { get: (_, key) => String(key) }) };
// Every other module is one these pages' Church sections don't use: each of its exports renders, and returns, nothing.
const unused = new Proxy({}, { get: () => () => null });

/** Hooks that keep their state between renders, as React keeps a section's on its card. */
function hooks() {
  const slots = [];
  let cursor = 0;
  return {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useId: () => "church-" + cursor++,
      useRef: (current) => ({ current }),
      useEffect() {},
    },
    render(component, props) { cursor = 0; return component(props); },
  };
}

/** An element and the elements in it, in order. */
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props.children)];
/** An element's text. */
const text = (node) => typeof node === "string" ? node : !node || typeof node !== "object" ? "" : Array.isArray(node) ? node.map(text).join("") : text(node.props.children);

/**
 * One card's Church section, rendered again after each change, as React does. Stand-ins take the place of its Add church
 * and Hide Church, which record what they are asked to do, and of its Sundays and churches.
 */
function section(collapsible) {
  const { react, render } = hooks();
  const { ChurchSection } = load("../src/components/churches.tsx", (name) => name.endsWith(".module.css") ? cssModule : { react, ...shared }[name] ?? unused);
  const calls = [];
  const props = {
    label: "Vienna", collapsible,
    actions: element("div", { className: "heading-actions", children: [
      element("button", { onClick: () => calls.push("add"), children: "Add church" }),
      element("button", { onClick: () => calls.push("hide"), children: "Hide Church" }),
    ] }),
    children: [element("section", { children: "Sundays during your stay: Sunday, May 2, 2027" }), element("article", { children: "St. Stephen's Cathedral" })],
  };
  let tree = render(ChurchSection, props);
  const toggle = () => nodes(tree).find((node) => node.props["aria-expanded"] !== undefined);
  const heading = () => nodes(tree).find((node) => node.props.className === "budget-section-heading");
  return {
    calls, tree: () => tree, toggle,
    /** Selects the heading, opening or closing the section. */
    select() { toggle().props.onClick(); tree = render(ChurchSection, props); },
    /** The heading's text, then each of its buttons' text, its toggle first. */
    heading: () => [text(nodes(heading()).find((node) => node.type === "h4")), ...nodes(heading()).filter((node) => node.type === "button").map(text)],
    /** Whether the section's Sundays and churches are hidden. */
    hidden: () => nodes(tree).find((node) => node.props.id === toggle().props["aria-controls"]).props.hidden,
    /** What the section's Sundays and churches say, shown or not. */
    content: () => text(nodes(tree).find((node) => node.props.id === toggle().props["aria-controls"])),
    /** Selects one of the heading's buttons by its text. */
    press: (label) => nodes(heading()).find((node) => node.type === "button" && text(node) === label).props.onClick(),
  };
}

test("a destination card's Church section starts closed, and its heading opens and closes it, saving nothing (TRA-169)", () => {
  const church = section(true);
  assert.equal(church.tree().props["aria-label"], "Church in Vienna", "screen readers name it as before");
  assert.deepEqual(church.heading(), ["Church", "Church", "Add church", "Hide Church"], "its heading is a toggle, beside Add church and Hide Church");
  assert.deepEqual([church.toggle().type, church.toggle().props["aria-expanded"], church.hidden()], ["button", false, true], "it starts closed, and says so");
  assert.ok(nodes(church.toggle()).some((node) => node.type === "icon:ChevronDown"), "its chevron shows that it opens and closes");
  assert.match(church.content(), /Sunday, May 2, 2027.*St\. Stephen's Cathedral/, "its Sundays and churches wait, closed, below the heading");
  church.select();
  assert.deepEqual([church.toggle().props["aria-expanded"], church.hidden()], [true, false], "selecting the heading opens it");
  assert.match(church.content(), /Sunday, May 2, 2027.*St\. Stephen's Cathedral/, "with its Sundays and churches");
  church.select();
  assert.deepEqual([church.toggle().props["aria-expanded"], church.hidden()], [false, true], "selecting it again closes it");
  assert.deepEqual(church.calls, [], "opening and closing saves nothing");
  assert.deepEqual(church.heading().slice(2), ["Add church", "Hide Church"], "Add church and Hide Church show either way");
  church.press("Add church");
  church.press("Hide Church");
  assert.deepEqual(church.calls, ["add", "hide"], "and do what they did, while it is closed");
});

test("each card's Church section opens on its own, and starts closed again each time the page loads (TRA-169)", () => {
  const [vienna, salzburg] = [section(true), section(true)];
  vienna.select();
  assert.deepEqual([vienna.hidden(), salzburg.hidden()], [false, true], "opening one card's section leaves another's closed");
  assert.equal(section(true).hidden(), true, "a page load starts it closed again, open or not before");
});

test("a destination's Church page shows its Sundays and churches always, without a toggle (TRA-169)", () => {
  const church = section(false);
  assert.equal(church.toggle(), undefined, "nothing opens or closes it");
  assert.deepEqual(church.heading(), ["Church", "Add church", "Hide Church"], "its heading is the word Church, beside Add church and Hide Church");
  assert.ok(nodes(church.tree()).every((node) => !node.props.hidden), "nothing in it is hidden");
  assert.match(text(church.tree()), /Sunday, May 2, 2027.*St\. Stephen's Cathedral/);
});

// Each page, rendered by the planner from what the store gives its address, as the page does, with each render a page
// load: state starts as given, and effects, which run only in a browser, don't run.
const pageModules = {
  ...shared,
  "react": { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}], useTransition: () => [false, () => {}], useId: () => "id", useRef: (current) => ({ current }), useEffect: () => {} },
  "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
  "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates,
};
const pageRequire = (name) => name.endsWith(".module.css") ? cssModule : pageModules[name] ?? unused;
pageModules["@/components/churches"] = load("../src/components/churches.tsx", pageRequire);
pageModules["@/components/church-sundays"] = load("../src/components/church-sundays.tsx", pageRequire);
const { default: PlannerApp } = load("../src/components/planner-app.tsx", pageRequire);

/** An element as the browser has it: host elements with their children rendered, and text, each component and fragment rendered in its place. */
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
/** A rendered element's text as the page shows it: none from inside a hidden element. */
const shown = (node) => typeof node === "string" ? node : node.props.hidden ? "" : node.props.children.map(shown).join("");

/**
 * A trip from Saturday, May 1, 2027: two nights in Vienna, with St. Stephen's Cathedral saved, then a week in Salzburg,
 * without churches. Each stay has a Sunday, so each card shows Church.
 */
function plan(t) {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput({ name: "Spring in Austria", startDate: "2027-05-01" })).id;
  const vienna = addDestination(store, tripId, { city: "Vienna", nights: 2 });
  addDestination(store, tripId, { city: "Salzburg", nights: 7 });
  store.applyMutation({ type: "church.save", destinationId: vienna, name: "St. Stephen's Cathedral", address: "Stephansplatz 3", denomination: "Roman Catholic", url: "", massTimes: [{ id: randomUUID(), day: "Sunday", time: "10:15 AM" }], ...newItem() });
  return { store, tripId, vienna };
}
/** The trip's page, or with `stopId`, a stay's Church page, as its address renders it. */
function tripPage(store, tripId, stopId) {
  const { data, access, library } = store.getTripSnapshot(tripId, stopId);
  return render(PlannerApp({ initialData: data, access: { [tripId]: access }, library, tripId, stopId, church: stopId !== undefined }));
}
/** A destination's page in Destinations, or with `church`, its Church page, as its address renders it. */
function destinationPage(store, destinationId, church = false) {
  const { data, access } = store.getDestinationSnapshot(destinationId);
  return render(PlannerApp({ initialData: data, destinationAccess: { [destinationId]: access }, destinationId, church }));
}
/** A rendered page's Church sections, each with its heading's toggle and what the toggle opens and closes. */
function churches(page) {
  return page.flatMap(within).filter((node) => node.type === "section" && String(node.props["aria-label"]).startsWith("Church in ")).map((section) => {
    const toggle = within(section).find((node) => node.props["aria-expanded"] !== undefined);
    return { label: section.props["aria-label"], section, toggle, content: toggle && within(section).find((node) => node.props.id === toggle.props["aria-controls"]) };
  });
}

test("every Church section on a trip's page starts closed, with its Sundays and churches waiting below its heading (TRA-169)", (t) => {
  const { store, tripId } = plan(t);
  const [vienna, salzburg] = churches(tripPage(store, tripId));
  assert.deepEqual([vienna.label, salzburg.label], ["Church in Vienna", "Church in Salzburg"], "each card has its Church section");
  for (const { label, section, toggle, content } of [vienna, salzburg]) {
    const heading = within(section).find((node) => node.type === "h4");
    assert.deepEqual([within(heading).includes(toggle), shown(toggle), toggle.props["aria-expanded"], content.props.hidden], [true, "Church", false, true], label + " starts closed, its heading a toggle");
    assert.match(shown(section), /^ChurchAdd churchHide Church$/, label + " shows its heading with Add church and Hide Church");
  }
  assert.match(text(vienna.content), /Sundays during your stay.*Sunday, May 2, 2027.*St\. Stephen's Cathedral.*10:15 AM/, "Vienna's Sunday and saved church open with it");
  assert.match(text(salzburg.content), /Sunday, May 9, 2027.*Find a church for your visit\./, "Salzburg starts closed without churches too");
});

test("a destination's page in Destinations starts its Church section closed too (TRA-169)", (t) => {
  const { store, vienna } = plan(t);
  const [church, ...others] = churches(destinationPage(store, vienna));
  assert.deepEqual([church.label, others], ["Church in Vienna", []]);
  assert.deepEqual([shown(church.toggle), church.toggle.props["aria-expanded"], church.content.props.hidden], ["Church", false, true]);
  assert.match(text(church.content), /St\. Stephen's Cathedral.*10:15 AM/, "its saved church opens with it");
});

test("a destination's Church page, in a trip or in Destinations, shows its churches always, without a toggle (TRA-169)", (t) => {
  const { store, tripId, vienna } = plan(t);
  for (const [name, page, sunday] of [["in a trip", tripPage(store, tripId, vienna), true], ["in Destinations", destinationPage(store, vienna, true), false]]) {
    const [church, ...others] = churches(page);
    assert.deepEqual([church.label, church.toggle, others], ["Church in Vienna", undefined, []], "its Church page " + name + " has nothing to open or close");
    assert.equal(shown(within(church.section).find((node) => node.type === "h4")), "Church");
    assert.match(shown(church.section), /St\. Stephen's Cathedral.*10:15 AM/, "its saved church shows " + name);
    assert.equal(shown(church.section).includes("Sunday, May 2, 2027"), sunday, sunday ? "with the stay's Sunday" : "without Sunday dates, which come from a trip");
  }
});
