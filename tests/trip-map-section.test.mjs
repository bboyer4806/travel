import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { airportByCode, airportName } from "../src/lib/airports.ts";
import { createLocationSearch } from "../src/lib/location-search.ts";
import * as tripMap from "../src/lib/trip-map.ts";
import { setup, tripInput } from "./budget-fixtures.mjs";

// TRA-144 and TRA-145: the trip map without its airport search or instructions, from the real map components with a
// small hook harness. The section asks the real trip map route, with a stand-in for Open-Meteo, and the map itself
// draws with a stand-in for Leaflet. No browser or server is involved.
const compile = (path, jsx) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
}).outputText;
/** A module's exports, run in its own realm with only `modules` to import and `globals` to use. */
function load(path, modules, globals = {}) {
  const exports = {};
  runInNewContext(compile(path, true), {
    exports,
    require(name) {
      if (!(name in modules)) throw new Error("Unexpected component import: " + name);
      return modules[name];
    },
    ...globals,
  });
  return exports;
}
const jsx = (type, props, key) => ({ type, props, key });
const runtime = { jsx, jsxs: jsx, Fragment: "fragment" };
const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const texts = (node) => typeof node === "string" ? [node] : !node || typeof node !== "object" ? [] : [node.props?.children].flat(Infinity).flatMap(texts);
// A CSS module's class names are their own names, and an icon is its name.
const styles = new Proxy({}, { get: (_target, name) => name });
const icons = new Proxy({}, { get: (_target, name) => name });
// Values made in a component's realm, copied into this test's to compare.
const copy = (value) => JSON.parse(JSON.stringify(value));
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
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef: (initial) => slots[cursor++] ??= { current: initial },
      useId() { const index = cursor++; return slots[index] ??= ":r" + index + ":"; },
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

/** The trip map route, answering for the trip's owner, with `fetcher` standing in for Open-Meteo. */
function tripMapRoute(store, fetcher) {
  const exports = {};
  const imports = {
    "@/auth": { currentAccount: async () => ({ id: "owner" }), signedOutResponse: () => Response.json({ error: "Please sign in." }, { status: 401 }) },
    "@/lib/location-search": { locatePlaces: createLocationSearch({ fetcher }).locatePlaces },
    "@/lib/store": { getTripSnapshot: (_accountId, tripId) => store.getTripSnapshot(tripId) },
    "@/lib/trip-map": tripMap,
  };
  new Function("require", "exports", compile("../src/app/api/trip-map/[tripId]/route.ts"))((name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports);
  return (url) => exports.GET(new Request(new URL(url, "http://localhost:3000")), { params: Promise.resolve({ tripId: url.split("/").at(-1) }) });
}

const entry = (kind, place) => ({ id: randomUUID(), kind, place, arrival: "", departure: "", notes: "" });
const legSave = (id, method, itinerary = []) => ({ type: "leg.save", id, method, price: "", departure: "", arrival: "", url: "", notes: "", itinerary });
// Open-Meteo's places for the names the stand-in knows. Airports are never asked for.
const openMeteo = {
  Vienna: { id: 2761369, name: "Vienna", latitude: 48.2085, longitude: 16.3721, country_code: "AT", admin1: "Vienna", country: "Austria" },
  Melk: { id: 2771335, name: "Melk", latitude: 48.2269, longitude: 15.3439, country_code: "AT", admin1: "Lower Austria", country: "Austria" },
  Salzburg: { id: 2766824, name: "Salzburg", latitude: 47.7994, longitude: 13.0440, country_code: "AT", admin1: "Salzburg", country: "Austria" },
};

/**
 * A trip's Map section, open as a trip's page opens it, for a trip saved from Chicago O'Hare, as ORD, by way of a
 * layover saved as PHL to Vienna, then by train past a stop at Melk to Salzburg, and home to CLE. Waits for its places.
 */
async function openTripMap(t) {
  const { store, tripId } = setup(t, tripInput({ name: "Austria", homeCity: "ORD", returnCity: "CLE" }));
  const vienna = store.applyMutation({ type: "stop.add", tripId, city: "Vienna" }).id;
  const salzburg = store.applyMutation({ type: "stop.add", tripId, city: "Salzburg" }).id;
  const leg = (from, to) => store.getSnapshot().legs.find((item) => item.tripId === tripId && item.fromId === from && item.toId === to).id;
  store.applyMutation(legSave(leg(null, vienna), "Flight", [entry("layover", "PHL")]));
  store.applyMutation(legSave(leg(vienna, salzburg), "Train", [entry("stop", "Melk")]));
  store.applyMutation(legSave(leg(salzburg, null), "Flight"));
  const journey = tripMap.tripJourney(store.getTripSnapshot(tripId).data, tripId);

  const lookups = [], requests = [], answers = [];
  const route = tripMapRoute(store, async (url) => {
    const name = url.searchParams.get("name");
    lookups.push(name);
    return Response.json(openMeteo[name] ? { results: [openMeteo[name]] } : {});
  });
  const { react, render } = hooks();
  const { default: TripMap } = load("../src/components/trip-map.tsx", {
    react,
    "react/jsx-runtime": runtime,
    // The map itself loads only in a browser, so the section shows whatever `dynamic` gives it.
    "next/dynamic": { default: () => "TripMapCanvas" },
    "lucide-react": icons,
    "@/lib/trip-map": tripMap,
    "./trip-map-symbols": { MapLegend: "MapLegend" },
    "./trip-map.module.css": { default: styles },
  }, {
    fetch: async (url) => {
      requests.push(url);
      const response = await route(url);
      answers.push(await response.clone().json());
      return response;
    },
    AbortController,
  });
  const show = () => render(TripMap, { tripId, journey });
  const status = (tree) => nodes(tree).find((node) => node.props?.role === "status").props.children;
  let tree = show();
  for (let i = 0; i < 100 && status(tree) !== ""; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    tree = show();
  }
  assert.equal(status(tree), "", "the trip's places are found");
  return { tree, show, tripId, journey, lookups, requests, answers };
}

test("the trip map has no airport search, and only the trip's own places are looked up (TRA-144)", async (t) => {
  const { tree, tripId, requests } = await openTripMap(t);
  // What the open section shows, in order, with nothing above the map, nor anything to type in or choose.
  const content = [...nodes(tree).find((node) => node.type === "fragment").props.children].filter(Boolean);
  assert.deepEqual(content.map((node) => node.type === "MapLegend" ? node.type : node.props.className), ["frame", "MapLegend", "status", "credit"]);
  assert.deepEqual(nodes(tree).filter((node) => ["input", "label", "button"].includes(node.type)).map((node) => node.props.className), ["toggle"], "only the heading's toggle");
  // The section asks only for the trip's places, never for an airport by its code.
  assert.deepEqual(requests, ["/api/trip-map/" + tripId]);
  // The map is given its layout alone.
  const frame = content.find((node) => node.props.className === "frame");
  assert.equal(frame.props.children.type, "TripMapCanvas");
  assert.deepEqual(Object.keys(frame.props.children.props), ["layout"]);
});

test("a saved airport code such as ORD is still shown at its airport, with every destination, stop, layover and connection (TRA-144)", async (t) => {
  const { tree, journey, lookups, answers } = await openTripMap(t);
  const canvas = nodes(tree).find((node) => node.type === "TripMapCanvas");
  const layout = copy(canvas.props.layout);
  // The map shows the layout of the places the trip map route found, as before.
  assert.deepEqual(layout, copy(tripMap.mapLayout(journey, answers[0].places)));
  assert.deepEqual(copy(nodes(tree).find((node) => node.type === "MapLegend").props.layout), layout, "and its key matches");
  const atAirport = (code) => {
    const airport = airportByCode(code);
    return [[airport.latitude, airport.longitude], airportName(airport)];
  };
  const at = (name, label) => [[openMeteo[name].latitude, openMeteo[name].longitude], label];
  assert.deepEqual(layout.markers.map(({ kind, label, number, position, found }) => [kind, label, number, position, found]), [
    ["departure", "ORD", null, ...atAirport("ORD")],
    ["layover", "PHL", null, ...atAirport("PHL")],
    ["destination", "Vienna", 1, ...at("Vienna", "Vienna, Austria")],
    ["stop", "Melk", null, ...at("Melk", "Melk, Lower Austria, Austria")],
    ["destination", "Salzburg", 2, ...at("Salzburg", "Salzburg, Austria")],
    ["return", "CLE", null, ...atAirport("CLE")],
  ]);
  assert.equal(atAirport("ORD")[1], "Chicago O'Hare International Airport (ORD)");
  assert.deepEqual(layout.lines.map(({ method, from, to, points }) => [method, from, to, points.length]), [
    ["Flight", "ORD", "Vienna", 3],
    ["Train", "Vienna", "Salzburg", 3],
    ["Flight", "Salzburg", "CLE", 2],
  ]);
  assert.deepEqual(layout.unmapped, []);
  assert.equal(nodes(tree).some((node) => node.props?.className === "unmapped"), false, "nothing is listed under Not on the map");
  // Airport codes need no lookup: only the names are looked up.
  assert.deepEqual(lookups.sort(), ["Melk", "Salzburg", "Vienna"]);
});

test("the map follows its heading directly, with no instructions, at the page's section spacing (TRA-145)", async (t) => {
  const { tree } = await openTripMap(t);
  const [heading, content] = tree.props.children;
  // Above the map are only the section's label and its heading.
  assert.deepEqual(texts(heading), ["THE WHOLE JOURNEY", "The map"]);
  assert.equal(content.props.children.props.children[0].props.className, "frame");
  // Without the instructions' styles, nothing changes the heading's spacing, so the map sits below it as each other
  // section's content sits below its heading.
  assert.doesNotMatch(readFileSync(new URL("../src/components/trip-map.module.css", import.meta.url), "utf8"), /\.help\b|section-heading/);
});

test("the map's heading still closes and reopens it (TRA-145)", async (t) => {
  const { tree, show } = await openTripMap(t);
  const toggle = (tree) => nodes(tree).find((node) => node.props?.className === "toggle");
  const content = (tree) => nodes(tree).find((node) => node.props?.id === toggle(tree).props["aria-controls"]);
  assert.equal(toggle(tree).props["aria-expanded"], true);
  toggle(tree).props.onClick();
  const closed = show();
  assert.equal(toggle(closed).props["aria-expanded"], false);
  assert.equal(content(closed).props.hidden, true);
  assert.equal(content(closed).props.children, false, "nothing shows while it is closed");
  toggle(closed).props.onClick();
  const reopened = show();
  assert.equal(toggle(reopened).props["aria-expanded"], true);
  assert.equal(content(reopened).props.hidden, false);
  assert.equal(nodes(content(reopened)).find((node) => node.type === "TripMapCanvas").props.layout.markers.length, 6, "with every place");
});

/** The map itself, with a stand-in for Leaflet that records each time something frames or centers the map. */
function mapCanvas() {
  const { react, render, unmount } = hooks();
  const calls = [];
  const instance = {
    on() {}, remove() {},
    fitBounds: (bounds, options) => calls.push(["fitBounds", bounds.map((position) => [...position]), options.maxZoom]),
    setView: () => calls.push(["setView"]), panTo: () => calls.push(["panTo"]), flyTo: () => calls.push(["flyTo"]),
  };
  const layer = () => ({ addTo() { return this; }, clearLayers() {} });
  const element = () => ({ setAttribute() {}, addEventListener() {} });
  const L = {
    map: () => instance, tileLayer: layer, layerGroup: layer, polyline: layer,
    latLngBounds: (positions) => positions,
    divIcon: (options) => options,
    marker: () => ({ addTo() { return this; }, on() { return this; }, getElement: element }),
  };
  const { default: TripMapCanvas } = load("../src/components/trip-map-canvas.tsx", {
    react,
    "react/jsx-runtime": runtime,
    "react-dom": { createPortal: (child) => child },
    leaflet: { default: L },
    "leaflet/dist/leaflet.css": {},
    "@/components/destination-gallery": {},
    "@/components/transportation-icons": { transportationLabel: (method) => method },
    "@/components/trip-map-symbols": icons,
    "@/lib/photo-focus": {},
    "@/lib/transportation-methods": { transportationIcons: () => ["plane"] },
    "@/lib/trip-map": tripMap,
    "./trip-map.module.css": { default: styles },
  }, { document: { createElement: () => ({}) } });
  return { calls, render: (props) => render(TripMapCanvas, props), unmount };
}

test("the map frames the trip when it opens and when its places change, and nothing else moves it (TRA-144)", () => {
  const map = mapCanvas();
  const marker = (key, kind, position, number = null) => ({ key, kind, position, label: key, number, target: key, found: key, photo: null });
  const layout = (...markers) => ({ markers, lines: [{ id: "out", points: markers.map((item) => item.position), badge: markers[0].position, method: "Flight", from: "ORD", to: "Vienna", target: "connection-out" }], unmapped: [] });
  const ord = marker("ORD", "departure", [41.9786, -87.9048]), vienna = marker("Vienna", "destination", [48.2085, 16.3721], 1);
  map.render({ layout: layout(ord, vienna) });
  assert.deepEqual(map.calls, [["fitBounds", [[41.9786, -87.9048], [48.2085, 16.3721]], 11]]);
  // Drawn again with the same places, as when the rest of the trip changes, the map keeps its zoom and position.
  map.render({ layout: layout(ord, vienna) });
  assert.equal(map.calls.length, 1);
  // New places frame the trip again.
  const salzburg = marker("Salzburg", "destination", [47.7994, 13.044], 2);
  map.render({ layout: layout(ord, vienna, salzburg) });
  assert.deepEqual(map.calls.at(-1), ["fitBounds", [[41.9786, -87.9048], [48.2085, 16.3721], [47.7994, 13.044]], 11]);
  // Closed and reopened, the map frames the trip.
  map.unmount();
  map.render({ layout: layout(ord, vienna, salzburg) });
  assert.deepEqual(map.calls.map(([name]) => name), ["fitBounds", "fitBounds", "fitBounds"], "only framing the trip moves the map");
});
