import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as destinationLabel from "../src/lib/destination-label.ts";
import { cssRules } from "./css-rules.mjs";

// TRA-162: Access's tables, run with a small hook harness that keeps each table's state between renders, as React does.
// No browser or server is involved; what the store gives the page is tested in access-overview.test.mjs.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}

/** The text an element shows, with what the components inside it rendered. */
const text = (node) => node === null || node === undefined || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("")
  : text(typeof node.type === "function" ? node.rendered : node.props.children);
const hasClass = (node, className) => String(node.props.className ?? "").split(" ").includes(className);
/** The host elements inside a host element, with what the components inside it rendered. */
function inside(node) {
  const walk = (child) => !child || typeof child !== "object" ? [] : Array.isArray(child) ? [...child].flatMap(walk)
    : typeof child.type === "function" ? walk(child.rendered) : [child, ...walk(child.props.children)];
  return walk(node.props.children);
}

/** Access for `overview`, rendered again after each change, keeping each table's state. */
function harness(overview) {
  const hooks = [];
  let cursor = 0, nodes = [];
  const element = (type, props) => ({ type, props });
  const modules = {
    "react": {
      useState(initial) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], (value) => { hooks[index] = value; }];
      },
      useId() { const index = cursor++; return hooks[index] ??= "heading-" + index; },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    // Next.js's Link stands in as the element it is given, so its address can be read.
    "next/link": { default: "Link" },
    "@/lib/destination-label": destinationLabel,
  };
  const require = (name) => {
    // A CSS module's class names are their own names.
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (!(name in modules)) throw new Error("Unexpected component import: " + name);
    return modules[name];
  };
  modules["@/components/trip-sharing"] = load("../src/components/trip-sharing.tsx", require);
  const { default: AccessChart } = load("../src/components/access-chart.tsx", require);
  const hosts = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(hosts);
    if (typeof node.type === "function") return hosts(node.rendered = node.type(node.props));
    return [node, ...hosts(node.props.children)];
  };
  const render = () => { cursor = 0; nodes = hosts({ type: AccessChart, props: { overview } }); };
  render();
  /** One table's section, by its heading: what it shows, and searching and sorting it as someone would. */
  const section = (heading) => {
    const parts = () => {
      const found = nodes.find((node) => node.type === "section" && inside(node).some((child) => child.type === "h2" && text(child) === heading));
      return { section: found, contents: inside(found) };
    };
    const find = (predicate) => parts().contents.filter(predicate);
    return {
      parts,
      heading: () => find((node) => node.type === "h2")[0],
      count: () => text(find((node) => hasClass(node, "count-pill"))[0]),
      search: () => find((node) => node.type === "input")[0],
      table: () => find((node) => node.type === "table")[0],
      sortHeader: () => find((node) => node.type === "th" && node.props["aria-sort"] !== undefined)[0],
      columns: () => find((node) => node.type === "th" && node.props.scope === "col").map(text),
      /** Each row: its name and the address it opens, its owner, everyone listed with access, and its note, if any. */
      rows: () => find((node) => node.type === "tr" && inside(node).some((child) => child.type === "td")).map((row) => {
        const cells = inside(row).filter((child) => child.type === "td");
        const link = inside(row).find((child) => child.type === "Link");
        return {
          name: text(link), href: link.props.href, owner: text(cells[0]),
          people: inside(cells[1]).filter((child) => child.type === "li").map(text),
          note: text(inside(cells[1]).find((child) => hasClass(child, "note"))),
        };
      }),
      empty: () => text(find((node) => hasClass(node, "empty-state")).flatMap(inside).find((node) => node.type === "h3")),
      buttons: () => find((node) => node.type === "button"),
      type(value) { this.search().props.onChange({ target: { value } }); render(); },
      sort() { find((node) => hasClass(node, "sort"))[0].props.onClick(); render(); },
      clear() { find((node) => node.type === "button" && text(node) === "Clear search")[0].props.onClick(); render(); },
    };
  };
  return { nodes: () => nodes, trips: section("Trips"), destinations: section("Destinations") };
}

const olivia = { email: "owner@example.com", name: "Olivia Owner" };
const eddie = { email: "eddie@example.com", name: "Eddie Editor" };
const fran = { email: "fran@example.com", name: null };
const gina = { email: "gina@example.com", name: "Gina Guest" };
/** What the store gives Olivia's Access: her trips and Gina's trip shared with her, in alphabetical order. */
const overview = () => ({
  trips: [
    { id: "t1", name: "Alps by train", role: "owner", owner: olivia, sharedWith: [] },
    { id: "t2", name: "Kyoto in autumn", role: "editor", owner: gina, sharedWith: [olivia] },
    { id: "t3", name: "Portugal", role: "owner", owner: olivia, sharedWith: [eddie, fran] },
  ],
  destinations: [
    { id: "d1", city: "Kyoto", cityFromSuggestion: false, role: "editor", owner: gina, sharedWith: [olivia] },
    { id: "d2", city: "Lisbon", cityFromSuggestion: false, role: "owner", owner: olivia, sharedWith: [eddie, fran] },
    // A city suggestion's label shows shorter than the city saved for it (TRA-76).
    { id: "d3", city: "Paris, Île-de-France, France", cityFromSuggestion: true, role: "owner", owner: olivia, sharedWith: [] },
  ],
});
const named = (member) => member.name ? member.name + member.email : member.email;

test("Access shows a table of trips and one of destinations, each name opening its page, with its owner and everyone listed with access", () => {
  const ui = harness(overview());
  assert.equal(text(ui.nodes().find((node) => node.type === "h1")), "Access");
  for (const [table, column] of [[ui.trips, "Trip"], [ui.destinations, "Destination"]]) {
    assert.deepEqual(table.columns(), [column, "Owner", "Who has access"]);
    // The table is named by its section's heading.
    assert.equal(table.table().props["aria-labelledby"], table.heading().props.id);
  }
  assert.deepEqual([ui.trips.count(), ui.destinations.count()], ["3", "3"]);
  assert.deepEqual(ui.trips.rows(), [
    { name: "Alps by train", href: "/trips/t1", owner: named(olivia), people: [named(olivia)], note: "" },
    // Someone else's: only its owner sees who else has access.
    { name: "Kyoto in autumn", href: "/trips/t2", owner: named(gina), people: [named(gina), named(olivia)], note: "Only its owner sees who else has access." },
    // Fran hasn't signed in yet, so has only her email.
    { name: "Portugal", href: "/trips/t3", owner: named(olivia), people: [named(olivia), named(eddie), named(fran)], note: "" },
  ]);
  assert.deepEqual(ui.destinations.rows(), [
    { name: "Kyoto", href: "/destinations/d1", owner: named(gina), people: [named(gina), named(olivia)], note: "Only its owner sees who else has access." },
    { name: "Lisbon", href: "/destinations/d2", owner: named(olivia), people: [named(olivia), named(eddie), named(fran)], note: "" },
    { name: "Paris, France", href: "/destinations/d3", owner: named(olivia), people: [named(olivia)], note: "" },
  ]);
});

test("each table's search finds its rows by name, ignoring letter case, a destination by its whole saved city too", () => {
  const ui = harness(overview());
  ui.trips.type("PORT");
  assert.deepEqual(ui.trips.rows().map((row) => row.name), ["Portugal"]);
  // Each table searches on its own.
  assert.deepEqual(ui.destinations.rows().map((row) => row.name), ["Kyoto", "Lisbon", "Paris, France"]);
  ui.destinations.type("île-de");
  assert.deepEqual(ui.destinations.rows().map((row) => row.name), ["Paris, France"]);
  // Searching names, not people: an email finds nothing, and says so, with a way back.
  ui.trips.type("eddie@example.com");
  assert.deepEqual(ui.trips.rows(), []);
  assert.equal(ui.trips.empty(), "No trips match that search.");
  ui.trips.clear();
  assert.equal(ui.trips.search().props.value, "");
  assert.deepEqual(ui.trips.rows().map((row) => row.name), ["Alps by train", "Kyoto in autumn", "Portugal"]);
});

test("each table is A to Z until its first column's heading turns it Z to A and back, with what it shows searched", () => {
  const ui = harness(overview());
  const names = (table) => table.rows().map((row) => row.name);
  assert.equal(ui.trips.sortHeader().props["aria-sort"], "ascending");
  assert.ok(inside(ui.trips.sortHeader()).some((node) => node.type === "icon:ArrowDownAZ"));
  ui.trips.sort();
  assert.equal(ui.trips.sortHeader().props["aria-sort"], "descending");
  assert.ok(inside(ui.trips.sortHeader()).some((node) => node.type === "icon:ArrowDownZA"));
  assert.deepEqual(names(ui.trips), ["Portugal", "Kyoto in autumn", "Alps by train"]);
  // The other table keeps its own order.
  assert.deepEqual(names(ui.destinations), ["Kyoto", "Lisbon", "Paris, France"]);
  ui.trips.type("o");
  assert.deepEqual(names(ui.trips), ["Portugal", "Kyoto in autumn"]);
  ui.trips.sort();
  assert.equal(ui.trips.sortHeader().props["aria-sort"], "ascending");
  assert.deepEqual(names(ui.trips), ["Kyoto in autumn", "Portugal"]);
  ui.destinations.sort();
  assert.deepEqual(names(ui.destinations), ["Paris, France", "Lisbon", "Kyoto"]);
});

test("Access changes nothing: its only controls search, sort and clear a search", () => {
  const ui = harness(overview());
  ui.trips.type("nothing like it");
  const controls = ui.nodes().filter((node) => ["button", "input", "select", "textarea", "form"].includes(node.type));
  // Trips found nothing, so offer to clear the search in place of its table; Destinations' heading sorts it.
  assert.deepEqual(controls.map((node) => node.type === "input" ? node.props["aria-label"] : node.type === "button" ? text(node) : node.type),
    ["Search trips", "Clear search", "Search destinations", "Destination"]);
  assert.ok(controls.every((node) => node.type !== "button" || node.props.type === "button"), "no button submits anything");
});

test("an account with nothing shared or saved sees each table say so, without a search or table", () => {
  const ui = harness({ trips: [], destinations: [] });
  for (const [table, empty] of [[ui.trips, "No trips yet."], [ui.destinations, "No destinations yet."]]) {
    assert.equal(table.empty(), empty);
    assert.equal(table.search(), undefined);
    assert.equal(table.table(), undefined);
    assert.equal(table.count(), "0");
  }
});

test("a table too wide for a phone scrolls sideways within its own box, emails whole, and the header's links fit (TRA-162)", () => {
  const styles = "../src/components/access-chart.module.css";
  const rule = (file, selector) => cssRules(file).filter(([selectors]) => selectors.split(",").some((part) => part.trim() === selector)).map(([, declarations, atRule]) => ({ declarations, atRule }));
  assert.deepEqual(rule(styles, ".scroll"), [{ declarations: { "overflow-x": "auto" }, atRule: null }]);
  assert.equal(rule(styles, ".table td *")[0].declarations["overflow-wrap"], "normal");
  assert.equal(rule(styles, ".sort")[0].declarations["min-height"], "44px");
  // With Access, the owner's header has six links: on phones up to 440px wide, smaller labels and closer spacing fit them.
  const globals = "../src/app/globals.css";
  assert.deepEqual(rule(globals, ".site-header nav").filter(({ atRule }) => atRule === "@media(max-width:440px)").map(({ declarations }) => declarations), [{ gap: "6px" }]);
  assert.deepEqual(rule(globals, ".site-header .nav-link").filter(({ atRule }) => atRule === "@media(max-width:440px)").map(({ declarations }) => declarations), [{ "font-size": "12px" }]);
});
