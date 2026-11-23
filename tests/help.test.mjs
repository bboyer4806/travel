import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as help from "../src/lib/help.ts";

const { NOT_FOUND_HELP, pageHelp } = help;
const IDEA_PAGES = ["hotels", "activities", "restaurants", "church"];

/** Every page's route, as Next.js names it, from the app's page.tsx files. */
function appRoutes() {
  const app = fileURLToPath(new URL("../src/app", import.meta.url));
  const routes = [];
  (function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(directory, entry.name));
      else if (entry.name === "page.tsx") routes.push("/" + relative(app, directory).split(sep).filter(Boolean).join("/"));
    }
  })(app);
  return routes;
}

/** Addresses that open `route`: one for each idea page a `[category]` names, with an ID for every other `[segment]`. */
function addresses(route) {
  const sample = route.replace(/\[(?!category\])[^\]]+\]/g, "6f0c2d9e-1b7a-4c55-9d1e-0a8b7c6d5e4f");
  return route.endsWith("/[category]") ? IDEA_PAGES.map((page) => sample.replace("[category]", page)) : [sample];
}

test("every signed-in page has its own Help, of at most six short points", () => {
  const routes = appRoutes();
  assert.ok(routes.includes("/login") && routes.includes("/trips/[tripId]/destinations/[stopId]/[category]"), "the app's pages are found");
  const shown = new Set();
  for (const route of routes.filter((route) => route !== "/login")) {
    for (const address of addresses(route)) {
      const found = pageHelp(address);
      assert.notEqual(found, NOT_FOUND_HELP, address + " has Help of its own");
      shown.add(found);
    }
  }
  for (const { title, points } of [...shown, NOT_FOUND_HELP]) {
    assert.ok(title.trim(), "a title");
    assert.ok(points.length >= 1 && points.length <= 6, title + " has one to six points");
    assert.equal(new Set(points).size, points.length, title + "'s points are distinct");
    for (const point of points) assert.ok(point.trim() && point.length <= 160, title + ": a short point: " + point);
  }
  assert.equal(new Set([...shown].map((item) => item.title)).size, shown.size, "each page's Help has its own title");
});

test("Help is found by the page's route, the same for a destination's idea pages in a trip and in Destinations", () => {
  const titles = {
    "/": "All trips",
    "/trips/t1": "Trip",
    "/trips/t1/": "Trip",
    "/trips/t1/destinations/s1/hotels": "Hotels",
    "/trips/t1/destinations/s1/activities": "Activities",
    "/trips/t1/destinations/s1/restaurants": "Restaurants",
    "/trips/t1/destinations/s1/church": "Church",
    "/destinations": "Destinations",
    "/destinations/d1": "Destination",
    "/destinations/d1/hotels": "Hotels",
    "/destinations/d1/church": "Church",
    "/access": "Access",
    "/whats-new": "What's new",
    "/ai": "AI assistants",
    "/ai/authorize": "Connect an AI assistant",
    "/ai/proposals/p1": "Proposal",
  };
  for (const [address, title] of Object.entries(titles)) assert.equal(pageHelp(address).title, title, address);
  // A destination's idea pages are the same page in a trip and in Destinations.
  assert.equal(pageHelp("/trips/t1/destinations/s1/restaurants"), pageHelp("/destinations/d1/restaurants"));
});

test("an address no page has is the not-found page", () => {
  for (const address of ["/trips", "/trip/t1", "/trips/t1/destinations/s1", "/trips/t1/destinations/s1/spa", "/destinations/d1/constructor",
    "/destinations/d1/__proto__", "/destinations/d1/hotels/extra", "/ai/proposals", "/whats-new/1", "/access/t1", "/login/help"]) {
    assert.equal(pageHelp(address), NOT_FOUND_HELP, address);
  }
});

// The Help overlay itself, run with a small hook harness that keeps each component's state, refs and effects between
// renders, as React does. The dialog is a stand-in that, like a browser's, fires its close event when it closes.
const compiled = ts.transpileModule(readFileSync(new URL("../src/components/help.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(initialPath) {
  class Element { focus() { this.focused = true; } }
  const opener = new Element();
  let pathname = initialPath, current, cursor = 0, provided = new Map(), stateChanges = 0;
  const effects = [];
  const react = {
    createContext: (value) => { const context = { value }; context.Provider = { context }; return context; },
    useContext: (context) => provided.has(context) ? provided.get(context) : context.value,
    useState(initial) {
      const hooks = current.hooks, index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value) => { stateChanges++; hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useRef(initial) { const hooks = current.hooks, index = cursor++; return hooks[index] ??= { current: initial }; },
    useEffect(effect, deps) {
      const hooks = current.hooks, index = cursor++, previous = hooks[index];
      if (previous && deps.every((dep, position) => Object.is(dep, previous.deps[position]))) return;
      effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: effect() }; });
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === "next/navigation") return { usePathname: () => pathname };
      if (name === "lucide-react") return { X: "close-icon" };
      if (name === "@/lib/help") return help;
      throw new Error("Unexpected component import: " + name);
    },
    HTMLElement: Element,
    document: { activeElement: opener },
  });
  const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { if (!this.open) return; this.open = false; find((node) => node.type === "dialog").props.onClose(); },
    getBoundingClientRect: () => ({ left: 100, right: 500, top: 50, bottom: 400 }),
  };
  const provider = { hooks: [] };
  let tree;
  /** Renders a component as React would, then runs the effects whose dependencies changed. */
  function render(component, props, instance) {
    current = instance; cursor = 0;
    const output = component(props);
    while (effects.length) effects.shift()();
    return output;
  }
  function renderProvider() {
    tree = render(exports.default, { children: null }, provider);
    provided = new Map(nodes(tree).filter((node) => node.type?.context).map((node) => [node.type.context, node.props.value]));
    find((node) => node.type === "dialog").props.ref.current = dialog;
  }
  function find(predicate) { return nodes(tree).find(predicate); }
  const text = (node) => [node.props.children].flat().join("");
  renderProvider();
  return {
    dialog, opener, exports,
    renderProvider,
    get stateChanges() { return stateChanges; },
    navigate(path) { pathname = path; renderProvider(); },
    title: () => text(find((node) => node.type === "h2")),
    points: () => nodes(tree).filter((node) => node.type === "li").map(text),
    /** A Help button where the page puts one, in the navigation or an editor's heading. */
    button(props = {}) { return render(exports.HelpButton, { className: "nav-link", children: "Help", ...props }, { hooks: [] }); },
    close() { find((node) => node.props?.["aria-label"] === "Close help").props.onClick(); },
    click(target, clientX, clientY) { find((node) => node.type === "dialog").props.onClick({ target, clientX, clientY }); },
    /** The not-found page's marker, shown until `hide` runs its cleanup. */
    showNotFound() {
      const instance = { hooks: [] };
      render(exports.NotFoundHelp, {}, instance);
      renderProvider();
      return () => { for (const hook of instance.hooks) hook?.cleanup?.(); renderProvider(); };
    },
    /** Renders `component` outside HelpProvider, as the layout renders pages for someone signed out. */
    outside(component, props) {
      const inside = provided;
      provided = new Map();
      try { return render(component, props, { hooks: [] }); } finally { provided = inside; }
    },
  };
}

test("Help shows \"Help:\" and the page's name above its points, following the page shown", () => {
  const ui = harness("/trips/t1");
  assert.equal(ui.title(), "Help: Trip");
  assert.deepEqual(ui.points(), pageHelp("/trips/t1").points);
  ui.navigate("/destinations/d1/church");
  assert.equal(ui.title(), "Help: Church");
  assert.deepEqual(ui.points(), pageHelp("/destinations/d1/church").points);
});

test("Help opens above the page from its button and closes with X, Escape or the backdrop, returning focus to its button", () => {
  const ui = harness("/");
  const button = ui.button();
  assert.equal(button.type, "button");
  assert.equal(button.props.type, "button");
  button.props.onClick();
  assert.equal(ui.dialog.open, true);
  ui.close();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.opener.focused, true, "X returns focus to the Help button");

  ui.opener.focused = false;
  ui.button().props.onClick();
  // Escape: the browser closes the dialog itself.
  ui.dialog.close();
  assert.equal(ui.opener.focused, true, "Escape returns focus to the Help button");

  ui.opener.focused = false;
  ui.button().props.onClick();
  ui.click(ui.dialog, 300, 200);
  ui.click({ tagName: "LI" }, 300, 200);
  // A click from the keyboard reports no position.
  ui.click({ tagName: "LI" }, 0, 0);
  assert.equal(ui.dialog.open, true, "clicks inside Help keep it open");
  ui.click(ui.dialog, 40, 200);
  assert.equal(ui.dialog.open, false, "a click on the backdrop closes it");
  assert.equal(ui.opener.focused, true);
  assert.equal(ui.stateChanges, 0, "opening and closing Help changes nothing on the page or in an editor");
});

test("an editor's Help waits while it saves, as its X does", () => {
  const ui = harness("/trips/t1");
  assert.equal(ui.button({ className: "text-button", disabled: true }).props.disabled, true);
  assert.equal(ui.button({ className: "text-button", disabled: false }).props.disabled, false);
});

test("on the not-found page, Help describes it rather than the page its address names", () => {
  const ui = harness("/trips/no-longer-shared");
  assert.equal(ui.title(), "Help: Trip");
  const hide = ui.showNotFound();
  assert.equal(ui.title(), "Help: Page not found");
  assert.deepEqual(ui.points(), NOT_FOUND_HELP.points);
  hide();
  assert.equal(ui.title(), "Help: Trip");
});

test("Help opens only on signed-in pages, and the not-found page signed out has no Help to tell", () => {
  const ui = harness("/");
  assert.throws(() => ui.outside(ui.exports.HelpButton, { className: "nav-link", children: "Help" }), /only on signed-in pages/);
  ui.outside(ui.exports.NotFoundHelp, {});
  ui.renderProvider();
  assert.equal(ui.title(), "Help: All trips");
});
