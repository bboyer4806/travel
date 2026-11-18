import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { airportByCode } from "../src/lib/airports.ts";
import { airportSuggestions } from "../src/lib/location-search.ts";

// Run the actual map components with small hook harnesses: no browser, Leaflet or server is involved (TRA-132).
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const jsx = (type, props) => ({ type, props });
const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
// A CSS module's class names are their own names. Values from a component are copied into this test's realm to compare.
const styles = new Proxy({}, { get: (_target, name) => name });
const unchanged = (previous, deps) => previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]));

/** Hooks that keep their state between renders, running effects after each render whose dependencies changed. */
function hooks() {
  const slots = [];
  let cursor = 0, pending = [];
  const effect = (run, deps) => {
    const index = cursor++;
    const previous = slots[index];
    if (unchanged(previous, deps)) return;
    pending.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: run() }; });
  };
  return {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = value; }];
      },
      useRef: (initial) => slots[cursor++] ??= { current: initial },
      useMemo(make, deps) {
        const index = cursor++;
        if (!unchanged(slots[index], deps)) slots[index] = { deps, value: make() };
        return slots[index].value;
      },
      useEffect: effect,
      useLayoutEffect: effect,
    },
    render(component, props) {
      cursor = 0;
      pending = [];
      const tree = component(props);
      for (const run of pending) run();
      return tree;
    },
    /** Unmounts: every effect cleans up, and the next render mounts afresh. */
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
      slots.length = 0;
    },
  };
}

/** The map's airport search. `respond` answers the location search for each code it is asked for. */
function airportSearch(respond) {
  const { react, render } = hooks();
  const requests = [], selected = [];
  const loaded = { exports: {} };
  runInNewContext(compile("../src/components/trip-map-airport-search.tsx"), {
    exports: loaded.exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return { Plane: "plane", Search: "search" };
      if (name === "./trip-map.module.css") return { default: styles };
      throw new Error("Unexpected component import: " + name);
    },
    fetch: async (url) => { requests.push(url); return respond(new URL(url, "http://localhost").searchParams.get("code")); },
    AbortController,
  });
  let tree;
  const show = () => { tree = render(loaded.exports.default, { onSelect: (position) => selected.push([...position]) }); };
  const find = (predicate) => nodes(tree).find(predicate);
  show();
  return {
    requests,
    selected,
    /** Types into the search and waits for its answer. */
    async type(value) {
      find((node) => node.type === "input").props.onChange({ target: { value } });
      show();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      show();
    },
    /** The airport found, as its button shows it: its name and code, and where it is. */
    airport() {
      const button = find((node) => node.type === "button");
      return button ? [...button.props.children[1].props.children].map((line) => line.props.children) : null;
    },
    select() { find((node) => node.type === "button").props.onClick(); show(); },
    status: () => find((node) => node.props?.role === "status").props.children,
  };
}

const answers = (code) => ({ ok: true, json: async () => ({ locations: airportSuggestions(code) }) });

test("the map's airport search finds an airport by its code in any letter case, and only selecting it centers the map (TRA-132)", async () => {
  const search = airportSearch(answers);
  assert.equal(search.status(), "");
  for (const text of ["cle", "CLE", "Cle "]) {
    await search.type(text);
    assert.deepEqual(search.airport(), ["Cleveland Hopkins International Airport (CLE)", "Cleveland, United States"], text);
  }
  assert.deepEqual(search.requests, ["/api/locations?code=CLE"], "every letter case is one search");
  assert.deepEqual(search.selected, [], "typing alone never moves the map");
  search.select();
  const cle = airportByCode("CLE");
  assert.deepEqual(search.selected, [[cle.latitude, cle.longitude]]);
  assert.equal(search.status(), "The map is centered on Cleveland Hopkins International Airport (CLE).");
  // An airport anywhere in the world, whatever the map shows.
  await search.type("hnd");
  assert.match(search.status(), /^Found Tokyo Haneda .*\(HND\)\. Select it to center the map\.$/);
  search.select();
  const hnd = airportByCode("HND");
  assert.deepEqual(search.selected.at(-1), [hnd.latitude, hnd.longitude]);
});

test("the map's airport search says when no airport has a code, asks for a code, and says when it can't search (TRA-132)", async () => {
  const search = airportSearch((code) => code === "XYZ" ? { ok: false, json: async () => ({ error: "Unavailable" }) } : answers(code));
  await search.type("zzz");
  assert.equal(search.airport(), null);
  assert.equal(search.status(), "No airport has the code ZZZ.");
  for (const text of ["KCLE", "Cleveland", "CL"]) {
    await search.type(text);
    assert.equal(search.status(), "Enter an airport’s three-letter code.", text);
  }
  await search.type("xyz");
  assert.equal(search.status(), "Airport search is unavailable right now.");
  await search.type("");
  assert.equal(search.status(), "");
  assert.deepEqual(search.requests, ["/api/locations?code=ZZZ", "/api/locations?code=XYZ"], "only codes are searched");
  assert.deepEqual(search.selected, []);
});

/** The map itself, with a stand-in for Leaflet that records how it frames and centers the map. */
function mapCanvas() {
  const { react, render, unmount } = hooks();
  const calls = [];
  let center = { lat: 0, lng: 0 };
  const instance = { on() {}, remove() {}, getCenter: () => center, fitBounds: () => calls.push(["fitBounds"]),
    setView: (position, zoom, options) => calls.push(["setView", [...position], zoom, { ...options }]) };
  const layer = () => ({ addTo() { return this; }, clearLayers() {} });
  const L = { map: () => instance, tileLayer: layer, layerGroup: layer, latLngBounds: (positions) => positions };
  const loaded = { exports: {} };
  runInNewContext(compile("../src/components/trip-map-canvas.tsx"), {
    exports: loaded.exports,
    require(name) {
      const modules = {
        react,
        "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
        "react-dom": { createPortal: (child) => child },
        leaflet: { default: L },
        "leaflet/dist/leaflet.css": {},
        "@/components/destination-gallery": {},
        "@/components/transportation-icons": {},
        "@/components/trip-map-symbols": {},
        "@/lib/photo-focus": {},
        "@/lib/transportation-methods": {},
        "@/lib/trip-map": {},
        "./trip-map.module.css": { default: styles },
      };
      if (!(name in modules)) throw new Error("Unexpected component import: " + name);
      return modules[name];
    },
    document: { createElement: () => ({}) },
  });
  return {
    calls,
    render: (props) => render(loaded.exports.default, props),
    unmount,
    /** Pans the map so its center is at this longitude. */
    pan(lng) { center = { lat: 0, lng }; },
  };
}

test("selecting an airport centers the map on it, where the journey is drawn, and reopening the map frames the trip (TRA-132)", () => {
  const map = mapCanvas();
  const layout = { markers: [], lines: [], unmapped: [] };
  map.render({ layout, focus: null });
  assert.deepEqual(map.calls.map(([name]) => name), ["fitBounds"]);
  map.calls.length = 0;
  // A trip across the Pacific draws Tokyo west of Los Angeles, past -180°, so the map centers on that Tokyo.
  map.pan(-160);
  const haneda = [35.5497, 139.787];
  map.render({ layout, focus: haneda });
  assert.deepEqual(map.calls, [["setView", [35.5497, 139.787 - 360], 12, { animate: false }]]);
  map.render({ layout, focus: haneda });
  assert.equal(map.calls.length, 1, "drawing again without a new selection leaves the map where it is");
  map.pan(0);
  map.render({ layout, focus: [...haneda] });
  assert.deepEqual(map.calls.at(-1), ["setView", haneda, 12, { animate: false }], "selecting the airport again centers on it again");
  // Closed and reopened with that selection, the map frames the trip instead.
  map.unmount();
  map.calls.length = 0;
  map.render({ layout, focus: haneda });
  assert.deepEqual(map.calls.map(([name]) => name), ["fitBounds"]);
});
