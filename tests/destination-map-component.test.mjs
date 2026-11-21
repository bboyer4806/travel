import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as destinationMap from "../src/lib/destination-map.ts";
import { cssRules } from "./css-rules.mjs";

// Run the destination map's components with a small hook harness and stand-ins for fetch and Leaflet: no browser or
// server is involved (TRA-130).
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const jsx = (type, props) => ({ type, props });
const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
// A CSS module's class names are their own names. Values from a component are copied into this test's realm to compare.
const styles = new Proxy({}, { get: (_target, name) => name });
const copy = (value) => JSON.parse(JSON.stringify(value));
const unchanged = (previous, deps) => previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]));
const settle = () => new Promise((resolve) => setImmediate(resolve));
// The address of an idea's or church's photo thumbnail, from the gallery itself (TRA-152). Its module's other imports go unused here.
const gallery = { exports: {} };
runInNewContext(compile("../src/components/candidate-gallery.tsx"), { exports: gallery.exports, require: () => new Proxy({}, { get: () => () => null }) });
const { thumbnailUrl } = gallery.exports;

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
      useMemo(make, deps) {
        const index = cursor++;
        if (!unchanged(slots[index], deps)) slots[index] = { deps, value: make() };
        return slots[index].value;
      },
      useId: () => "id",
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
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
      slots.length = 0;
    },
  };
}

const vienna = { id: "vienna", city: "Vienna, Vienna, Austria", cityFromSuggestion: true };
const saved = [
  { id: "h1", category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4" },
  { id: "h2", category: "hotels", name: "Hotel Nowhere", address: "" },
  { id: "a1", category: "activities", name: "Albertina", address: "" },
  { id: "r1", category: "restaurants", name: "Figlmüller", address: "" },
  { id: "c1", category: "churches", name: "St. Stephen's Cathedral", address: "Stephansplatz 3" },
];
const found = (latitude, longitude) => ({ status: "found", latitude, longitude, label: "Found at " + latitude });

/**
 * The map section for a destination's places. `respond` answers each request with the places' statuses by ID, as
 * `[area, statuses]`, or throws for an outage. Answers carry each place's current key unless a status gives its own.
 */
function destinationMapSection(respond, places = saved) {
  const { react, render } = hooks();
  const requests = [], viewed = [];
  const Canvas = () => null;
  const loaded = { exports: {} };
  runInNewContext(compile("../src/components/destination-map.tsx"), {
    exports: loaded.exports,
    require(name) {
      const modules = {
        react,
        "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
        "next/dynamic": { default: () => Canvas },
        "lucide-react": { ChevronDown: "chevron" },
        "@/lib/destination-label": destinationLabel,
        "@/lib/destination-map": destinationMap,
        "./destination-map-symbols": { PlaceSymbol: "symbol" },
        "./destination-map.module.css": { default: styles },
      };
      if (!(name in modules)) throw new Error("Unexpected component import: " + name);
      return modules[name];
    },
    fetch: async (url) => {
      requests.push(url);
      const [area, statuses] = await respond(requests.length);
      const places = Object.fromEntries(props.places.filter((place) => place.id in statuses).map((place) => [place.id, { key: destinationMap.placeKey(props.destination.city, place), ...statuses[place.id] }]));
      return Response.json({ area, places });
    },
    AbortController,
  });
  let props = { destination: vienna, places, onView: (place) => viewed.push(place.id) }, tree;
  const show = () => { tree = render(loaded.exports.default, props); };
  const find = (predicate) => nodes(tree).filter(predicate);
  show();
  return {
    requests, viewed,
    /** Renders again once every request so far has been answered, as React does after each state change. */
    async update(changes = {}) {
      props = { ...props, ...changes };
      for (let round = 0; round < 10; round++) { show(); await settle(); }
      show();
    },
    /** The IDs of the places on the map's markers, by marker. */
    markers: () => copy(find((node) => node.type === Canvas).flatMap((node) => node.props.markers.map((marker) => marker.places.map((place) => place.id)))),
    canvas: () => find((node) => node.type === Canvas)[0],
    position: (index) => copy(find((node) => node.type === Canvas)[0].props.markers[index].position),
    /** Not on the map's places, as each category's heading and each place's name and reason. */
    unmapped: () => find((node) => node.type === "h6" || node.type === "li").map(text),
    message: () => find((node) => node.type === "p" && node.props.className === "message").map(text)[0],
    status: () => text(find((node) => node.props?.role === "status")[0]),
    checkbox: (label) => find((node) => node.type === "label" && text(node).includes(label)).flatMap((node) => nodes(node).filter((child) => child.type === "input"))[0],
    button: (label) => find((node) => node.type === "button" && text(node).startsWith(label)),
    tree: () => tree,
  };
}

test("every category shows by default, and any combination of checkboxes filters the markers and Not on the map alike", async () => {
  const map = destinationMapSection(() => ["found", { h1: found(48.204, 16.369), h2: { status: "missing" }, a1: found(48.2046, 16.3682), r1: { status: "ambiguous" }, c1: found(48.2086, 16.3731) }]);
  assert.equal(map.message(), "Finding Vienna, Austria’s places…", "the destination shows as its card does");
  assert.equal(map.status(), "Finding places on the map…");
  await map.update();
  assert.deepEqual(map.requests, ["/api/destination-map/vienna"]);
  assert.equal(map.status(), "");
  assert.deepEqual(destinationMap.MAP_CATEGORIES.map((category) => map.checkbox(destinationMap.MAP_CATEGORY_LABELS[category]).props.checked), [true, true, true, true]);
  assert.deepEqual(map.markers(), [["h1"], ["a1"], ["c1"]]);
  assert.deepEqual(map.unmapped(), ["Hotels", "Hotel NowhereNo place nearby has this name.View details for Hotel Nowhere", "Restaurants", "FiglmüllerMore than one place nearby matches.View details for Figlmüller"]);
  // Unchecking hotels and restaurants leaves activities and churches, on the map and in the list.
  map.checkbox("Hotels").props.onChange();
  map.checkbox("Restaurants").props.onChange();
  await map.update();
  assert.deepEqual(map.markers(), [["a1"], ["c1"]]);
  assert.deepEqual(map.unmapped(), []);
  map.checkbox("Activities").props.onChange();
  map.checkbox("Churches").props.onChange();
  map.checkbox("Restaurants").props.onChange();
  await map.update();
  // With no marker left, a message replaces the map, and Not on the map still lists what it can't show.
  assert.equal(map.canvas(), undefined);
  assert.equal(map.message(), "None of the selected places can be shown on the map yet.");
  assert.deepEqual(map.unmapped(), ["Restaurants", "FiglmüllerMore than one place nearby matches.View details for Figlmüller"]);
  map.checkbox("Restaurants").props.onChange();
  await map.update();
  assert.equal(map.message(), "Select a category to see its places on the map.");
  assert.deepEqual(map.unmapped(), []);
  // Filtering never looks places up again.
  assert.equal(map.requests.length, 1);
});

test("View details, on a marker or under Not on the map, opens the place's details", async () => {
  const map = destinationMapSection(() => ["found", { h1: found(48.204, 16.369), h2: { status: "missing" }, a1: { status: "missing" }, r1: { status: "missing" }, c1: { status: "missing" } }]);
  await map.update();
  for (const button of map.button("View details")) button.props.onClick();
  assert.deepEqual(map.viewed, ["h2", "a1", "r1", "c1"]);
  map.canvas().props.onView(map.canvas().props.markers[0].places[0]);
  assert.equal(map.viewed.at(-1), "h1");
});

test("places still waiting their turn are asked for again until each is answered, and an outage offers Try again", async () => {
  const answers = [
    ["found", { h1: found(48.204, 16.369), h2: { status: "pending" }, a1: { status: "pending" }, r1: { status: "pending" }, c1: { status: "pending" } }],
    // The hotel, found already, is pending again, as when the server restarted and looks it up anew.
    ["found", { h1: { status: "pending" }, h2: { status: "missing" }, a1: found(48.2046, 16.3682), r1: { status: "unavailable" }, c1: { status: "pending" } }],
    ["found", { h1: found(48.204, 16.369), h2: { status: "missing" }, a1: found(48.2046, 16.3682), r1: { status: "unavailable" }, c1: { status: "unavailable" } }],
  ];
  let markersWhileWaiting;
  const map = destinationMapSection(async (count) => {
    // What the map shows once the second answer is in, while the third is asked for.
    if (count === 3) { await settle(); markersWhileWaiting = map.markers(); }
    if (count > answers.length) throw new Error("Offline");
    return answers[count - 1];
  });
  await map.update();
  assert.equal(map.requests.length, 3, "asked again for the places still waiting");
  // The hotel found first stayed on the map while its second answer waited.
  assert.deepEqual(markersWhileWaiting, [["h1"], ["a1"]]);
  assert.deepEqual(map.markers(), [["h1"], ["a1"]]);
  assert.equal(map.status(), "");
  assert.deepEqual(map.unmapped(), ["Hotels", "Hotel NowhereNo place nearby has this name.View details for Hotel Nowhere", "Restaurants", "FiglmüllerCouldn't be looked up right now.View details for Figlmüller", "Churches", "St. Stephen's CathedralCouldn't be looked up right now.View details for St. Stephen's Cathedral"]);
  // Trying again while offline keeps every place already found.
  map.button("Try again")[0].props.onClick();
  await map.update();
  assert.equal(map.requests.length, 4);
  assert.deepEqual(map.markers(), [["h1"], ["a1"]]);
  assert.equal(map.button("Try again").length, 1);
});

test("an added, edited or removed place is looked up again, and its marker moves or goes, never twice", async () => {
  const positions = { h1: found(48.204, 16.369), h2: { status: "missing" }, a1: found(48.2046, 16.3682), r1: { status: "missing" }, c1: found(48.2086, 16.3731), n1: found(48.2104, 16.3656) };
  let moved = false;
  const map = destinationMapSection(() => ["found", { ...positions, ...(moved && { h1: found(48.2005, 16.3725) }) }]);
  await map.update();
  assert.deepEqual(map.markers(), [["h1"], ["a1"], ["c1"]]);
  // The hotel's address changes, the church is deleted and a restaurant is added.
  const edited = [{ ...saved[0], address: "Kärntner Ring 1" }, saved[1], saved[2], saved[3], { id: "n1", category: "restaurants", name: "Café Central", address: "" }];
  moved = true;
  await map.update({ places: edited });
  assert.equal(map.requests.length, 2);
  assert.deepEqual(map.markers(), [["h1"], ["a1"], ["n1"]]);
  assert.deepEqual(map.position(0), [48.2005, 16.3725], "the hotel at its new address, and not at its old one");
  const ids = map.markers().flat();
  assert.equal(new Set(ids).size, ids.length);
  // A saved change that doesn't change what a place is looked up by asks for nothing.
  await map.update({ places: edited.map((place) => ({ ...place })) });
  assert.equal(map.requests.length, 2);
});

test("a destination with nothing saved, or that the map can't find, says so instead of showing an empty map", async () => {
  const empty = destinationMapSection(() => { throw new Error("Nothing to ask for"); }, []);
  await empty.update();
  assert.equal(empty.message(), "Save a hotel, activity, restaurant or church for Vienna, Austria to see it on the map.");
  assert.deepEqual(empty.requests, []);
  const nowhere = destinationMapSection(() => ["missing", Object.fromEntries(saved.map((place) => [place.id, { status: "missing" }]))]);
  await nowhere.update();
  assert.equal(nowhere.message(), "The map can’t find Vienna, Austria itself, so it can’t look up its places.");
  // Every place is listed, without reasons of its own.
  assert.deepEqual(nowhere.unmapped().filter((line) => !destinationMap.MAP_CATEGORIES.some((category) => destinationMap.MAP_CATEGORY_LABELS[category] === line)), saved.map((place) => place.name + "View details for " + place.name));
});

/** The map itself, `height` pixels tall, with a stand-in for Leaflet that records its markers, popups and framing. */
function mapCanvas(height = 340) {
  const { react, render } = hooks();
  const calls = [], markers = [];
  const document = { body: { name: "body" }, activeElement: null };
  const focusable = (name) => ({ name, focus(options) { document.activeElement = this; calls.push(["focus", name, { ...options }]); }, setAttribute(key, value) { this[key] = value; } });
  const instance = { on() {}, remove() {}, getSize: () => ({ x: 640, y: height }), fitBounds: (bounds, options) => calls.push(["fitBounds", Array.from(bounds, (position) => [...position]), options.maxZoom]) };
  const group = { addTo() { return this; }, clearLayers() { markers.length = 0; } };
  const L = {
    map: () => instance,
    tileLayer: () => ({ addTo() { return this; } }),
    layerGroup: () => group,
    latLngBounds: (positions) => positions,
    divIcon: (options) => options,
    marker(position, options) {
      const handlers = {};
      const element = focusable("marker " + options.title.split("\n")[0]);
      // The popup's element, which Leaflet marks as scrolled when its content is taller than the map has room for (TRA-152).
      const container = { contains: (node) => node === content.button || node === content.close, querySelector: (selector) => selector === ".leaflet-popup-scrolled" && marker.scrolled ? {} : null };
      let content;
      const marker = {
        position, options, element, handlers, open: false, scrolled: false,
        on(name, handler) { handlers[name] = handler; return this; },
        bindPopup(popup, popupOptions) { content = popup; this.popup = popup; this.popupOptions = popupOptions; return this; },
        addTo() { markers.push(this); return this; },
        getElement: () => element,
        getPopup: () => ({ getElement: () => container, update: () => calls.push(["update", element.name]) }),
        openPopup() { this.open = true; handlers.popupopen?.(); },
        closePopup() { this.open = false; handlers.popupclose?.(); },
      };
      return marker;
    },
  };
  const loaded = { exports: {} };
  runInNewContext(compile("../src/components/destination-map-canvas.tsx"), {
    exports: loaded.exports,
    require(name) {
      const modules = {
        react,
        "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
        "react-dom": { createPortal: (child, container) => ({ type: "portal", props: { container, children: child } }) },
        leaflet: { default: L },
        "leaflet/dist/leaflet.css": {},
        "@/lib/destination-map": destinationMap,
        "./candidate-gallery": { thumbnailUrl },
        "./destination-map-symbols": { PlaceSymbol: "symbol", GroupSymbol: "group" },
        "./destination-map.module.css": { default: styles },
      };
      if (!(name in modules)) throw new Error("Unexpected component import: " + name);
      return modules[name];
    },
    document: {
      ...document,
      get body() { return document.body; },
      get activeElement() { return document.activeElement; },
      // Each popup has its View details, and Leaflet's close button, both able to take focus.
      createElement() {
        const listeners = {};
        const popup = { button: focusable("View details"), close: focusable("close"), listeners, addEventListener: (type, listener) => { listeners[type] = listener; }, removeEventListener: (type) => { delete listeners[type]; }, querySelector: () => popup.button };
        return popup;
      },
    },
  });
  return { calls, markers, document, render: (props) => render(loaded.exports.default, props) };
}

const sacher = { key: "48.20406,16.36949", position: [48.20406, 16.36949], places: [
  { id: "h1", category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4", found: "Hotel Sacher, 4, Philharmonikerstraße" },
  { id: "r2", category: "restaurants", name: "Café Sacher", address: "Philharmonikerstraße 4", found: "Hotel Sacher, 4, Philharmonikerstraße" },
] };
const albertina = { key: "48.20462,16.36818", position: [48.20462, 16.36818], places: [{ id: "a1", category: "activities", name: "Albertina", address: "", found: "Albertina, Vienna" }] };

test("each marker names its places, and its popup shows each place's name and category with View details", () => {
  const map = mapCanvas();
  const viewed = [];
  const tree = map.render({ markers: [sacher, albertina], onView: (place) => viewed.push(place.id) });
  assert.deepEqual(map.markers.map((marker) => marker.element["aria-label"]), ["Hotel: Hotel Sacher; Restaurant: Café Sacher", "Activity: Albertina"]);
  assert.equal(map.markers[1].options.title, "Activity: Albertina\nShown at Albertina, Vienna");
  assert.ok(map.markers.every((marker) => marker.options.keyboard));
  const portals = nodes(tree).filter((node) => node.type === "portal");
  // Places at one position share a marker, which shows how many.
  assert.deepEqual(portals.slice(0, 2).map((portal) => portal.props.children.type), ["group", "symbol"]);
  const popups = portals.slice(2);
  assert.equal(popups[0].props.container, map.markers[0].popup);
  assert.deepEqual(nodes(popups[0]).filter((node) => node.type === "li").map(text), ["Hotel SacherHotelView details for Hotel Sacher", "Café SacherRestaurantView details for Café Sacher"]);
  for (const button of nodes(tree).filter((node) => node.type === "button")) button.props.onClick();
  assert.deepEqual(viewed, ["h1", "r2", "a1"]);
});

test("Space opens a marker's popup as Enter does, its View details takes focus, and Escape returns focus to the marker", () => {
  const map = mapCanvas();
  map.render({ markers: [albertina], onView() {} });
  const [marker] = map.markers;
  let prevented = false;
  marker.handlers.keydown({ originalEvent: { key: "x", preventDefault() { prevented = true; } } });
  assert.equal(marker.open, false);
  marker.handlers.keydown({ originalEvent: { key: " ", preventDefault() { prevented = true; } } });
  assert.ok(marker.open && prevented);
  assert.deepEqual(map.calls.filter(([name]) => name === "focus"), [["focus", "View details", { preventScroll: true }]]);
  // Leaflet handles Escape only while the map itself has focus, so the popup handles it.
  let escaped = false;
  marker.popup.listeners.keydown({ key: "Escape", preventDefault() { escaped = true; } });
  assert.ok(!marker.open && escaped);
  assert.deepEqual(map.calls.filter(([name]) => name === "focus").at(-1), ["focus", "marker Activity: Albertina", { preventScroll: true }]);
  // Closed with focus elsewhere, as when another marker is selected, the popup leaves focus where it is.
  marker.openPopup();
  map.document.activeElement = { name: "another marker" };
  marker.closePopup();
  assert.equal(map.document.activeElement.name, "another marker");
});

test("the map frames its markers when their positions change, and leaves zoom and panning alone otherwise", () => {
  const map = mapCanvas();
  const markers = [sacher, albertina];
  map.render({ markers, onView() {} });
  assert.deepEqual(map.calls.filter(([name]) => name === "fitBounds"), [["fitBounds", [[48.20406, 16.36949], [48.20462, 16.36818]], 16]]);
  map.render({ markers: markers.map((marker) => ({ ...marker })), onView() {} });
  assert.equal(map.calls.filter(([name]) => name === "fitBounds").length, 1);
  map.render({ markers: [albertina], onView() {} });
  assert.deepEqual(map.calls.filter(([name]) => name === "fitBounds").at(-1), ["fitBounds", [[48.20462, 16.36818]], 16]);
  assert.equal(map.markers.length, 1, "markers from before are cleared");
});

// TRA-150: places with saved coordinates, exact or approximate.
const coordinated = (latitude, longitude, accuracy = "exact", review = false) => ({ latitude, longitude, accuracy, review });
const placed = [
  { id: "h1", category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4", coordinates: coordinated(48.20406, 16.36949) },
  { id: "h2", category: "hotels", name: "Leopoldstadt apartment", address: "Address withheld", coordinates: coordinated(48.2167, 16.3958, "approximate") },
  { id: "a1", category: "activities", name: "Albertina", address: "", coordinates: null },
  { id: "a2", category: "activities", name: "Melk Abbey", address: "", coordinates: coordinated(48.22842, 15.33437) },
  { id: "c1", category: "churches", name: "St. Stephen's Cathedral", address: "Stephansplatz 1", coordinates: coordinated(48.20857, 16.37307, "exact", true) },
];

test("places with saved coordinates show at once, only the others are looked up, and coordinates waiting for review say why a place isn't shown", async () => {
  const map = destinationMapSection(() => ["found", { a1: found(48.2046, 16.3682), c1: { status: "missing" } }], placed);
  // Before the answer, the places with coordinates are already on the map, and the rest are being found.
  assert.deepEqual(map.markers(), [["h1"], ["h2"], ["a2"]]);
  assert.equal(map.status(), "Finding places on the map…");
  await map.update();
  assert.equal(map.requests.length, 1);
  assert.deepEqual(map.markers(), [["h1"], ["h2"], ["a1"], ["a2"]]);
  assert.deepEqual(map.position(3), [48.22842, 15.33437], "Melk Abbey, beyond 50 km, where its coordinates are");
  assert.deepEqual(map.unmapped(), ["Churches", "St. Stephen's CathedralIts address changed after its coordinates were saved, so they wait to be checked in its editor. No place nearby has its address or name.View details for St. Stephen's Cathedral"]);
  // The approximate rental's dashed ring is explained below the map.
  const notes = () => nodes(map.tree()).filter((node) => node.props?.className === "note").map(text);
  assert.deepEqual(notes(), ["A dashed ring marks a place shown at approximate coordinates, not at a verified address."]);
  // Their checkboxes filter them as they do every place.
  map.checkbox("Hotels").props.onChange();
  await map.update();
  assert.deepEqual(map.markers(), [["a1"], ["a2"]]);
  assert.deepEqual(notes(), [], "with no approximate place shown, nothing explains the ring");
  assert.equal(map.requests.length, 1, "filtering looks nothing up");
});

test("a destination whose places all have coordinates asks for no lookup, and places them even where the destination can't be found", async () => {
  const all = destinationMapSection(() => { throw new Error("Nothing to ask for"); }, placed.filter((place) => place.coordinates && !place.coordinates.review));
  await all.update();
  assert.deepEqual(all.requests, []);
  assert.deepEqual(all.markers(), [["h1"], ["h2"], ["a2"]]);
  assert.equal(all.status(), "");
  assert.deepEqual(all.unmapped(), []);
  // Where the destination itself can't be found, the others are listed without reasons of their own, but coordinates waiting for review still say so.
  const nowhere = destinationMapSection(() => ["missing", { a1: { status: "missing" }, c1: { status: "missing" } }], placed);
  await nowhere.update();
  assert.deepEqual(nowhere.markers(), [["h1"], ["h2"], ["a2"]]);
  assert.deepEqual(nowhere.unmapped(), ["Activities", "AlbertinaView details for Albertina", "Churches", "St. Stephen's CathedralIts address changed after its coordinates were saved, so they wait to be checked in its editor.View details for St. Stephen's Cathedral"]);
});

test("an approximate place's marker, tooltip and popup say it is approximate, and never name an address", () => {
  const map = mapCanvas();
  const rental = { key: "48.2167,16.3958", position: [48.2167, 16.3958], places: [{ ...placed[1], found: null, approximate: true }] };
  const shared = { key: "48.20406,16.36949", position: [48.20406, 16.36949], places: [{ ...placed[0], found: null, approximate: false }, { id: "r1", category: "restaurants", name: "Café Sacher", address: "Philharmonikerstraße 4", coordinates: null, found: "Hotel Sacher, 4, Philharmonikerstraße", approximate: false }] };
  const roughly = { key: "48.21,16.39", position: [48.21, 16.39], places: [{ ...placed[1], id: "h3", found: null, approximate: true }, { ...placed[1], id: "h4", name: "Second apartment", found: null, approximate: true }] };
  const tree = map.render({ markers: [rental, shared, roughly], onView() {} });
  assert.deepEqual(map.markers.map((marker) => marker.element["aria-label"]), [
    "Hotel: Leopoldstadt apartment (approximate location)",
    "Hotel: Hotel Sacher; Restaurant: Café Sacher",
    "Hotel: Leopoldstadt apartment (approximate location); Hotel: Second apartment (approximate location)",
  ]);
  assert.equal(map.markers[0].options.title, "Hotel: Leopoldstadt apartment (approximate location)\nShown at its approximate coordinates");
  assert.equal(map.markers[1].options.title, "Hotel: Hotel Sacher\nShown at its saved coordinates\nRestaurant: Café Sacher\nShown at Hotel Sacher, 4, Philharmonikerstraße");
  // The symbol has its dashed ring only when every place on it is approximate.
  const symbols = nodes(tree).filter((node) => node.type === "portal").slice(0, 3).map((portal) => [portal.props.children.type, portal.props.children.props.approximate]);
  assert.deepEqual(symbols, [["symbol", true], ["group", false], ["group", true]]);
  const popups = nodes(tree).filter((node) => node.type === "portal").slice(3);
  assert.deepEqual(nodes(popups[0]).filter((node) => node.type === "li").map(text), ["Leopoldstadt apartmentHotel · Approximate locationView details for Leopoldstadt apartment"]);
  assert.deepEqual(nodes(popups[1]).filter((node) => node.type === "li").map(text), ["Hotel SacherHotelView details for Hotel Sacher", "Café SacherRestaurantView details for Café Sacher"]);
});

// TRA-152: each place's primary photo in its marker's popup.
const lobby = { id: "photo-lobby", version: "v1" };
const nave = { id: "photo-nave", version: "v2" };
/** What an entry in a popup shows, in order: its photo's address when it has one, then each other part's type. */
const parts = (entry) => [entry.props.children].flat(Infinity).filter((child) => child && typeof child === "object").map((child) => child.type === "img" ? child.props.src : child.type);

test("each place's popup shows its own primary photo at the top, above its name and category, and a place without one has no frame (TRA-152)", () => {
  const map = mapCanvas();
  const viewed = [];
  // The hotel and its restaurant share a marker, only the hotel with a photo, and the cathedral has its own marker and photo.
  const shared = { ...sacher, places: [{ ...sacher.places[0], photo: lobby }, { ...sacher.places[1], photo: null }] };
  const cathedral = { key: "48.20857,16.37307", position: [48.20857, 16.37307], places: [{ id: "c1", category: "churches", name: "St. Stephen's Cathedral", address: "Stephansplatz 3", found: "St. Stephen's Cathedral, 3, Stephansplatz", photo: nave }] };
  const tree = map.render({ markers: [shared, { ...albertina, places: [{ ...albertina.places[0], photo: null }] }, cathedral], onView: (place) => viewed.push(place.id) });
  const popups = nodes(tree).filter((node) => node.type === "portal").slice(3);
  const entries = (popup) => nodes(popup).filter((node) => node.type === "li");
  // Each photo is its own place's thumbnail, from an idea's or a church's photos, before its details.
  assert.deepEqual(popups.map((popup) => entries(popup).map(parts)), [
    [["/api/candidate-images/h1/photo-lobby/thumbnail?v=v1", "strong", "span", "button"], ["strong", "span", "button"]],
    [["strong", "span", "button"]],
    [["/api/church-images/c1/photo-nave/thumbnail?v=v2", "strong", "span", "button"]],
  ]);
  assert.equal(thumbnailUrl("h1", lobby, "candidate"), "/api/candidate-images/h1/photo-lobby/thumbnail?v=v1", "the gallery's own thumbnail address");
  // The name follows the photo, so it is decorative, and every popup is rendered before it opens, so the photo loads only once shown.
  const [photo] = nodes(popups[0]).filter((node) => node.type === "img");
  assert.deepEqual(copy(photo.props), { className: "popupPhoto", src: "/api/candidate-images/h1/photo-lobby/thumbnail?v=v1", alt: "", loading: "lazy", decoding: "async" });
  // The names, categories and View details are as they were.
  assert.deepEqual(entries(popups[0]).map(text), ["Hotel SacherHotelView details for Hotel Sacher", "Café SacherRestaurantView details for Café Sacher"]);
  assert.deepEqual(entries(popups[2]).map(text), ["St. Stephen's CathedralChurchView details for St. Stephen's Cathedral"]);
  for (const button of nodes(tree).filter((node) => node.type === "button")) button.props.onClick();
  assert.deepEqual(viewed, ["h1", "r2", "a1", "c1"]);
});

test("a popup taller than its map has room for scrolls within it, on a desktop's map and a phone's, measured again with its scrollbar (TRA-152)", () => {
  // Leaflet's margins, border and tip, and 16 px from the map's edges above and below, take 80 px of the map's height.
  for (const [height, maxHeight] of [[340, 260], [280, 200]]) {
    const map = mapCanvas(height);
    map.render({ markers: [sacher, albertina], onView() {} });
    assert.deepEqual(copy(map.markers.map((marker) => marker.popupOptions)), [sacher, albertina].map(() => ({ maxWidth: 280, maxHeight, autoPanPadding: [16, 16] })), height + " px");
  }
  // Leaflet measures a popup's width before it knows the popup scrolls, so one that scrolls is measured again, with its
  // scrollbar, before its View details takes focus. One that fits isn't.
  const map = mapCanvas();
  map.render({ markers: [sacher, albertina], onView() {} });
  const [group, single] = map.markers;
  group.scrolled = true;
  group.openPopup();
  single.openPopup();
  assert.deepEqual(map.calls.filter(([name]) => name === "update" || name === "focus").map(([name, target]) => [name, target]), [["update", "marker Hotel: Hotel Sacher"], ["focus", "View details"], ["focus", "View details"]]);
});

test("every popup photo fills the same 2:1 frame, cropped rather than stretched, smaller on phones, with its place's details wrapping to its width (TRA-152)", () => {
  const rules = cssRules("../src/components/destination-map.module.css");
  const rule = (selector) => rules.filter(([selectors]) => selectors === selector).map(([, declarations]) => declarations);
  // The frame's width is set for desktops and tablets, then for phones' smaller maps.
  assert.deepEqual(rule(".popupPlaces").map((declarations) => declarations["--photo-width"]), ["240px", "180px"]);
  const [photo] = rule(".popupPhoto");
  assert.deepEqual([photo.width, photo["aspect-ratio"], photo["object-fit"]], ["var(--photo-width)", "2 / 1", "cover"]);
  assert.deepEqual(rule(".popupPhoto ~ *"), [{ "max-width": "var(--photo-width)" }]);
  // A popup that scrolls keeps its content where Leaflet's margins put it, inset within the scrolling area by the room View
  // details' focus ring takes: its 2 px outline, 4 px outside the button.
  const [scrolled] = rule(".frame :global(.leaflet-popup-scrolled)");
  const [[, leaflet]] = cssRules("../node_modules/leaflet/dist/leaflet.css").filter(([selector]) => selector === ".leaflet-popup-content");
  const sides = (value) => value.split(" ").map((side) => parseFloat(side));
  assert.equal(scrolled.padding, "6px");
  assert.deepEqual(sides(scrolled.margin).map((side) => side + 6), sides(leaflet.margin));
});

test("a place's new primary photo reaches its marker's popup without looking anything up again (TRA-152)", async () => {
  const places = saved.map((place) => ({ ...place, coordinates: null, photo: null }));
  const map = destinationMapSection(() => ["found", { h1: found(48.204, 16.369), h2: { status: "missing" }, a1: found(48.2046, 16.3682), r1: { status: "missing" }, c1: found(48.2086, 16.3731) }], places);
  await map.update();
  const photos = () => copy(map.canvas().props.markers.flatMap((marker) => marker.places.map((place) => [place.id, place.photo])));
  assert.deepEqual(photos(), [["h1", null], ["a1", null], ["c1", null]]);
  await map.update({ places: places.map((place) => place.id === "h1" ? { ...place, photo: lobby } : place.id === "c1" ? { ...place, photo: nave } : place) });
  assert.deepEqual(photos(), [["h1", lobby], ["a1", null], ["c1", nave]]);
  assert.equal(map.requests.length, 1, "photos aren't looked up");
});
