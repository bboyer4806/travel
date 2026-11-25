import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as destinationMap from "../src/lib/destination-map.ts";
import * as tripMap from "../src/lib/trip-map.ts";
import { cssRules } from "./css-rules.mjs";

// Run the destination map's components with a small hook harness and stand-ins for fetch and Leaflet: no browser or
// server is involved (TRA-130).
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const jsx = (type, props, key) => ({ type, props, key });
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

/**
 * Hooks that keep their state between renders, running effects after each render whose dependencies changed. After each
 * render, `attach` sets refs, as React does before effects run.
 */
function hooks(attach = () => {}) {
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
      attach(tree);
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

/**
 * The map itself, 640 pixels wide and `height` tall, with a stand-in for Leaflet that records its markers, popups and
 * framing, a stand-in page that records focus and the keys listened for, and a clock the test moves. A marker's position
 * is where the stand-in draws it, as [y, x] in pixels from the map's top left corner, once the map has moved by `offset`.
 */
function mapCanvas(height = 340) {
  const calls = [], markers = [], mapEvents = {}, keyListeners = [], timers = new Map();
  let now = 0, lastTimer = 0, offset = { x: 0, y: 0 }, rendered = new Map(), props, tree;
  const { react, render } = hooks((rendering) => {
    // React sets each ref to its element, the same one while it stays rendered, and to null once it's gone. A preview
    // measures 200 pixels wide, and for each place 40 tall, or 140 with its photo, up to its CSS's limit of the map's
    // height less 16 pixels.
    const withRefs = nodes(rendering).filter((node) => node.props?.ref);
    const measure = (node) => node.props.className !== "preview" ? {} : { offsetWidth: 200,
      offsetHeight: Math.min(height - 16, nodes(node).filter((child) => child.type === "li").reduce((sum, entry) => sum + (nodes(entry).some((child) => child.type === "img") ? 140 : 40), 0)) };
    const next = new Map(withRefs.map((node) => [node.key, rendered.get(node.key) ?? { ref: node.props.ref, ...measure(node), style: {}, contains(other) { return other === this; } }]));
    for (const [key, element] of rendered) if (!next.has(key)) element.ref.current = null;
    for (const node of withRefs) node.props.ref.current = next.get(node.key);
    rendered = next;
  });
  const document = { body: { name: "body" }, activeElement: null };
  // Focusing an element records how, and, as in a browser, blurs the element that had focus, then focuses it.
  const focusable = (name) => ({
    name, listeners: {}, focusVisible: false,
    focus(options) {
      calls.push(["focus", name, { ...options }]);
      const previous = document.activeElement;
      if (previous === this) return;
      for (const listener of previous?.listeners?.blur ?? []) listener({});
      document.activeElement = this;
      for (const listener of this.listeners.focus ?? []) listener({});
    },
    setAttribute(key, value) { this[key] = value; },
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); },
    matches(selector) { assert.equal(selector, ":focus-visible"); return this.focusVisible; },
  });
  const instance = {
    on(names, handler) { for (const name of names.split(" ")) mapEvents[name] = handler; },
    remove() {},
    getSize: () => ({ x: 640, y: height }),
    fitBounds: (bounds, options) => calls.push(["fitBounds", Array.from(bounds, (position) => [...position]), options.maxZoom]),
    latLngToContainerPoint: ([y, x]) => ({ x: x + offset.x, y: y + offset.y }),
  };
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
        "@/lib/trip-map": tripMap,
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
      addEventListener: (type, listener) => { assert.equal(type, "keydown"); keyListeners.push(listener); },
      removeEventListener: (type, listener) => keyListeners.splice(keyListeners.indexOf(listener), 1),
    },
    setTimeout: (run, delay) => { timers.set(++lastTimer, { run, at: now + delay }); return lastTimer; },
    clearTimeout: (id) => timers.delete(id),
  });
  // Renders again, as React does after each change of state.
  const update = () => { tree = render(loaded.exports.default, props); return tree; };
  const markerFor = (label) => markers.find((item) => item.element["aria-label"] === label);
  const previewNode = () => nodes(tree).find((node) => node.props?.className === "preview");
  return {
    calls, markers, document,
    render(next) { props = next; return update(); },
    tree: () => tree,
    marker: markerFor,
    /** Dispatches a DOM event to the marker labeled `label`. */
    fire(label, type, event = {}) {
      for (const listener of markerFor(label).element.listeners[type] ?? []) listener(event);
      update();
    },
    /** Focuses a marker, by keyboard when `visible`, as `:focus-visible` tells, or by a click or tap. */
    focus(label, visible) {
      markerFor(label).element.focusVisible = visible;
      markerFor(label).element.focus();
      update();
    },
    /** The keyboard leaving the marker labeled `label` for the rest of the page. */
    blur(label) {
      document.activeElement = document.body;
      this.fire(label, "blur");
    },
    /** The pointer reaching or leaving the preview. */
    hoverPreview(entering) {
      previewNode().props[entering ? "onPointerEnter" : "onPointerLeave"]();
      update();
    },
    previewElement: () => previewNode().props.ref.current,
    key(key) {
      for (const listener of [...keyListeners]) listener({ key });
      update();
    },
    listening: () => keyListeners.length,
    /** Moves the clock on, running each timer that comes due. */
    wait(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); }
      update();
    },
    /** Leaflet's event as the map starts or stops moving, with where it moves the map's markers. */
    mapEvent(name, moved = offset) {
      offset = moved;
      mapEvents[name]();
      update();
    },
    /** Leaflet opening or closing a marker's popup, as a click, tap or Enter on it does, or a click elsewhere on the map. */
    popup(label, open) {
      markerFor(label)[open ? "openPopup" : "closePopup"]();
      update();
    },
    /** Presses a key on a marker, or in its popup when `inPopup`, and whether its default was prevented. */
    press(label, key, inPopup = false) {
      let prevented = false;
      const event = { key, preventDefault() { prevented = true; } };
      if (inPopup) markerFor(label).popup.listeners.keydown(event);
      else markerFor(label).handlers.keydown({ originalEvent: event });
      update();
      return prevented;
    },
    /**
     * The previews shown, as people see them: each place's photo's address, or null, name and category, how screen readers
     * and the keyboard know the preview, and where it is.
     */
    previews: () => nodes(tree).filter((node) => node.props?.className === "preview").map((node) => {
      const { style } = node.props.ref.current;
      return {
        places: nodes(node).filter((child) => child.type === "li").map((entry) => [nodes(entry).find((child) => child.type === "img")?.props.src ?? null,
          text(nodes(entry).find((child) => child.type === "strong")), text(nodes(entry).find((child) => child.props?.className === "previewCategory"))]),
        hidden: node.props["aria-hidden"], tabIndex: node.props.tabIndex, left: style.left, top: style.top,
      };
    }),
    /** The names of the places each preview shown has. */
    shown() { return this.previews().map((preview) => preview.places.map(([, name]) => name)); },
  };
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

// TRA-150: places with saved coordinates, exact or approximate. TRA-163: the map shows them there when their addresses
// aren't found, or they have none.
const coordinated = (latitude, longitude, accuracy = "exact", review = false) => ({ latitude, longitude, accuracy, review });
const placed = [
  { id: "h1", category: "hotels", name: "Hotel Sacher", address: "Philharmonikerstraße 4", coordinates: coordinated(48.20406, 16.36949) },
  { id: "h2", category: "hotels", name: "Leopoldstadt apartment", address: "Address withheld", coordinates: coordinated(48.2167, 16.3958, "approximate") },
  { id: "a1", category: "activities", name: "Albertina", address: "", coordinates: null },
  { id: "a2", category: "activities", name: "Melk Abbey", address: "", coordinates: coordinated(48.22842, 15.33437) },
  { id: "c1", category: "churches", name: "St. Stephen's Cathedral", address: "Stephansplatz 1", coordinates: coordinated(48.20857, 16.37307, "exact", true) },
];

test("a place with coordinates waits for its address's answer and shows where it is found, or else at its coordinates, while one without an address shows at them at once (TRA-163)", async () => {
  const map = destinationMapSection(() => ["found", { h1: found(48.2041, 16.3695), h2: { status: "missing" }, a1: found(48.2046, 16.3682), c1: { status: "missing" } }], placed);
  // Before the answer, only Melk Abbey, with coordinates and no address, is on the map, and the rest are being found.
  assert.deepEqual(map.markers(), [["a2"]]);
  assert.equal(map.status(), "Finding places on the map…");
  await map.update();
  assert.equal(map.requests.length, 1);
  assert.deepEqual(map.markers(), [["h1"], ["h2"], ["a1"], ["a2"]]);
  assert.deepEqual(map.position(0), [48.2041, 16.3695], "the hotel where its address was found, not at its coordinates");
  assert.deepEqual(map.position(1), [48.2167, 16.3958], "the rental, whose address wasn't found, at its coordinates");
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
  map.checkbox("Hotels").props.onChange();
  // New coordinates for the hotel look nothing up, and it stays where its address was found.
  await map.update({ places: placed.map((place) => place.id === "h1" ? { ...place, coordinates: coordinated(48.2, 16.37) } : place) });
  assert.equal(map.requests.length, 1);
  assert.deepEqual(map.position(0), [48.2041, 16.3695]);
  // Removing them looks it up again, by its address and name.
  await map.update({ places: placed.map((place) => place.id === "h1" ? { ...place, coordinates: null } : place) });
  assert.equal(map.requests.length, 2);
  assert.deepEqual(map.position(0), [48.2041, 16.3695]);
});

test("a destination whose places with coordinates have no addresses asks for no lookup, and places with coordinates show at them where the destination or their addresses can't be found (TRA-163)", async () => {
  const unaddressed = placed.filter((place) => place.coordinates && !place.coordinates.review).map((place) => ({ ...place, address: "" }));
  const all = destinationMapSection(() => { throw new Error("Nothing to ask for"); }, unaddressed);
  await all.update();
  assert.deepEqual(all.requests, []);
  assert.deepEqual(all.markers(), [["h1"], ["h2"], ["a2"]]);
  assert.equal(all.status(), "");
  assert.deepEqual(all.unmapped(), []);
  // Where the destination itself can't be found, places with coordinates are at them, and the others are listed without
  // reasons of their own, though coordinates waiting for review still say so.
  const nowhere = destinationMapSection(() => ["missing", Object.fromEntries(["h1", "h2", "a1", "c1"].map((id) => [id, { status: "missing" }]))], placed);
  await nowhere.update();
  assert.deepEqual(nowhere.markers(), [["h1"], ["h2"], ["a2"]]);
  assert.deepEqual(nowhere.position(0), [48.20406, 16.36949]);
  assert.deepEqual(nowhere.unmapped(), ["Activities", "AlbertinaView details for Albertina", "Churches", "St. Stephen's CathedralIts address changed after its coordinates were saved, so they wait to be checked in its editor.View details for St. Stephen's Cathedral"]);
  // When the lookups can't be made, places with coordinates are at them too, and the others wait for Try again.
  const offline = destinationMapSection(() => { throw new Error("Offline"); }, placed);
  await offline.update();
  assert.deepEqual(offline.markers(), [["h1"], ["h2"], ["a2"]]);
  assert.deepEqual(offline.unmapped(), ["Activities", "AlbertinaCouldn't be looked up right now.View details for Albertina", "Churches", "St. Stephen's CathedralIts address changed after its coordinates were saved, so they wait to be checked in its editor. Couldn't be looked up right now.View details for St. Stephen's Cathedral"]);
  assert.equal(offline.button("Try again").length, 1);
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

// TRA-188: each marker's preview of its places, as the trip map previews a destination (TRA-143). Each position is the
// point the stand-in's map draws the marker at, as [y, x] in pixels from the map's top left corner.
const facade = { id: "photo-facade", version: "v4" };
const crypt = { id: "photo-crypt", version: "v3" };
const at = (id, category, name, photo, details = {}) => ({ id, category, name, address: "", coordinates: null, found: name + ", Vienna", approximate: false, photo, ...details });
const sacherWien = { key: "sacher", position: [250, 300], places: [at("h1", "hotels", "Hotel Sacher Wien", lobby)] };
const central = { key: "central", position: [30, 600], places: [at("r1", "restaurants", "Café Central", null)] };
// A hotel, a tour, a café shown at approximate coordinates and the cathedral share a marker, all but the café with a photo.
const stephansplatz = { key: "stephansplatz", position: [170, 320], places: [
  at("h2", "hotels", "Hotel Stephansdom", facade),
  at("a2", "activities", "Catacombs tour", crypt),
  at("r2", "restaurants", "Café Dom", null, { found: null, approximate: true }),
  at("c1", "churches", "St. Stephen's Cathedral", nave),
] };
const SACHER = "Hotel: Hotel Sacher Wien", CENTRAL = "Restaurant: Café Central";
const STEPHANSPLATZ = "Hotel: Hotel Stephansdom; Activity: Catacombs tour; Restaurant: Café Dom (approximate location); Church: St. Stephen's Cathedral";
/** The map of Hotel Sacher, Café Central and Stephansplatz, 640 by 340 pixels. */
const previewMap = () => {
  const map = mapCanvas();
  map.render({ markers: [sacherWien, central, stephansplatz], onView() {} });
  return map;
};

test("hovering a marker previews its place's primary photo, the thumbnail its popup shows, with its name and category, above the marker (TRA-188)", () => {
  const map = previewMap();
  assert.deepEqual(map.previews(), []);
  // Every marker has a preview, and keeps its label and tooltip.
  assert.deepEqual(map.markers.map((marker) => [marker.element["aria-label"], Object.keys(marker.element.listeners)]), [SACHER, CENTRAL, STEPHANSPLATZ].map((label) => [label, ["pointerenter", "pointerleave", "focus", "blur"]]));
  assert.equal(map.marker(SACHER).options.title, SACHER + "\nShown at Hotel Sacher Wien, Vienna");
  map.fire(SACHER, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.previews(), [{
    places: [["/api/candidate-images/h1/photo-lobby/thumbnail?v=v1", "Hotel Sacher Wien", "Hotel"]],
    // Screen readers hear the place in the marker's label, so the preview, which repeats it, is hidden from them, and the
    // keyboard never stops on it.
    hidden: "true", tabIndex: -1,
    // Centered 6 pixels above the 30-pixel marker at 300, 250, 200 pixels wide and 140 tall with its photo.
    left: "200px", top: "89px",
  }]);
  // The same photo the marker's popup shows, decorative since the place's name follows it, loaded once the preview shows.
  const popup = nodes(map.tree()).find((node) => node.type === "portal" && node.props.container === map.marker(SACHER).popup);
  const [popupPhoto] = nodes(popup).filter((node) => node.type === "img");
  const [photo] = nodes(nodes(map.tree()).find((node) => node.props?.className === "preview")).filter((node) => node.type === "img");
  assert.equal(photo.props.src, popupPhoto.props.src);
  assert.deepEqual(copy(photo.props), { className: "previewPhoto", src: popupPhoto.props.src, alt: "", decoding: "async" });
});

test("a place without photos previews its name and category alone, below its marker near the map's top and inside its edge (TRA-188)", () => {
  const map = previewMap();
  map.fire(CENTRAL, "pointerenter", { pointerType: "pen" });
  // With no room above the marker at 600, 30, the preview, 40 pixels tall, goes below it, 8 pixels inside the map's right edge.
  assert.deepEqual(map.previews(), [{ places: [[null, "Café Central", "Restaurant"]], hidden: "true", tabIndex: -1, left: "432px", top: "51px" }]);
});

test("places sharing a marker each show in its preview with their own photos and categories, and one taller than the map fills its height beside the marker and scrolls (TRA-188)", () => {
  const map = previewMap();
  map.fire(STEPHANSPLATZ, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.previews(), [{
    // In the marker's order, a church's photo from its own gallery, and the café, at approximate coordinates, without one.
    // Like every place's, the café's preview names no address.
    places: [
      ["/api/candidate-images/h2/photo-facade/thumbnail?v=v4", "Hotel Stephansdom", "Hotel"],
      ["/api/candidate-images/a2/photo-crypt/thumbnail?v=v3", "Catacombs tour", "Activity"],
      [null, "Café Dom", "Restaurant"],
      ["/api/church-images/c1/photo-nave/thumbnail?v=v2", "St. Stephen's Cathedral", "Church"],
    ],
    // 460 pixels of places, limited to the map's 340 less 16, from 8 pixels below its top. With room neither above nor
    // below the marker at 320, 170, it goes 6 pixels to the right of it, as a connection's popup does on the trip map
    // (TRA-175), rather than over the marker, where it would take the click meant for the marker.
    hidden: "true", tabIndex: -1, left: "341px", top: "8px",
  }]);
  assert.equal(map.previewElement().offsetHeight, 324);
  // Near the map's right edge, it goes to the left of the marker instead.
  const east = mapCanvas();
  east.render({ markers: [{ ...stephansplatz, position: [170, 520] }], onView() {} });
  east.fire(STEPHANSPLATZ, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(east.previews().map((preview) => [preview.left, preview.top]), [["299px", "8px"]]);
});

test("a preview is the trip map's size, smaller on phones, scrolls within the map's margins, and is above the markers and below the map's controls (TRA-188)", () => {
  const rules = cssRules("../src/components/destination-map.module.css");
  const rule = (selector) => rules.filter(([selectors]) => selectors === selector).map(([, declarations, atRule]) => [atRule, declarations]);
  const [[, preview], [phone, phonePreview]] = rule(".preview");
  const trip = cssRules("../src/components/trip-map.module.css").filter(([selectors]) => selectors === ".preview").map(([, declarations]) => declarations.width);
  assert.deepEqual([preview.width, phonePreview.width], trip, "200 pixels wide, and 160 on phones, as the trip map's");
  assert.equal(phone, "@media(max-width:540px)");
  // As tall as the map less the 8 pixels previewPosition keeps from its top and bottom edges, scrolling what is taller.
  assert.deepEqual([preview["max-height"], preview["overflow-y"]], ["calc(100% - 16px)", "auto"]);
  assert.deepEqual(tripMap.popupPosition({ x: 320, y: 170 }, { width: 200, height: 340 - 16 }, { width: 640, height: 340 }, { width: 30, height: 30 }), { x: 341, y: 8 });
  // Above Leaflet's panes, its markers and popups among them, and below its zoom buttons and credit.
  const leaflet = cssRules("../node_modules/leaflet/dist/leaflet.css");
  const zIndex = (selector) => Number(leaflet.find(([selectors, declarations]) => selectors.split(",").map((part) => part.trim()).includes(selector) && "z-index" in declarations)[1]["z-index"]);
  assert.ok(zIndex(".leaflet-pane") < Number(preview["z-index"]) && Number(preview["z-index"]) < zIndex(".leaflet-top"));
  // Every photo fills the same 2:1 frame, cropped rather than stretched, and names wrap within the preview.
  const [[, photo]] = rule(".previewPhoto");
  assert.deepEqual([photo.width, photo["aspect-ratio"], photo["object-fit"]], ["100%", "2 / 1", "cover"]);
  assert.equal(rule(".previewName")[0][1]["overflow-wrap"], "anywhere");
});

test("the preview stays while the pointer moves between the marker and the preview, and closes a moment after it leaves both (TRA-188)", () => {
  const map = previewMap();
  map.fire(SACHER, "pointerenter", { pointerType: "mouse" });
  // Leaving the marker for the preview, across the gap between them.
  map.fire(SACHER, "pointerleave");
  map.wait(150);
  assert.deepEqual(map.shown(), [["Hotel Sacher Wien"]]);
  map.hoverPreview(true);
  map.wait(5000);
  assert.deepEqual(map.shown(), [["Hotel Sacher Wien"]], "open as long as the pointer is on the preview");
  // Back to the marker, then away from both.
  map.hoverPreview(false);
  map.fire(SACHER, "pointerenter", { pointerType: "mouse" });
  map.wait(5000);
  assert.deepEqual(map.shown(), [["Hotel Sacher Wien"]]);
  map.fire(SACHER, "pointerleave");
  map.wait(199);
  assert.deepEqual(map.shown(), [["Hotel Sacher Wien"]]);
  map.wait(1);
  assert.deepEqual(map.shown(), [], "closed once the pointer has been off both for 200 ms");
  // A quick move straight from the marker onto the preview: React tells the preview first, then the marker hears of it.
  map.fire(SACHER, "pointerenter", { pointerType: "mouse" });
  map.hoverPreview(true);
  map.fire(SACHER, "pointerleave", { relatedTarget: map.previewElement() });
  map.wait(5000);
  assert.deepEqual(map.shown(), [["Hotel Sacher Wien"]]);
  map.hoverPreview(false);
  map.wait(200);
  assert.deepEqual(map.shown(), []);
  // From one marker straight to another, the preview follows at once and stays.
  map.fire(SACHER, "pointerenter", { pointerType: "mouse" });
  map.fire(SACHER, "pointerleave");
  map.fire(CENTRAL, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), [["Café Central"]]);
  map.wait(5000);
  assert.deepEqual(map.shown(), [["Café Central"]]);
});

test("the keyboard reaching a marker previews it without opening its popup, until the keyboard moves on or Escape closes it (TRA-188)", () => {
  const map = previewMap();
  // A click or tap focuses the marker too, on its way to its popup, without a preview.
  map.focus(SACHER, false);
  assert.deepEqual(map.shown(), []);
  map.blur(SACHER);
  map.focus(SACHER, true);
  assert.deepEqual(map.previews().map((preview) => [preview.places.map(([, name]) => name), preview.left, preview.top]), [[["Hotel Sacher Wien"], "200px", "89px"]], "the same preview as hovering shows");
  assert.equal(map.marker(SACHER).open, false);
  map.blur(SACHER);
  map.focus(CENTRAL, true);
  assert.deepEqual(map.shown(), [["Café Central"]]);
  map.blur(CENTRAL);
  assert.deepEqual(map.shown(), []);
  // Escape closes it with the keyboard still on the marker, opening nothing. Other keys don't.
  map.focus(SACHER, true);
  map.key("Shift");
  assert.deepEqual(map.shown(), [["Hotel Sacher Wien"]]);
  map.key("Escape");
  assert.deepEqual(map.shown(), []);
  assert.equal(map.marker(SACHER).open, false);
  assert.equal(map.document.activeElement, map.marker(SACHER).element);
  assert.equal(map.listening(), 0, "Escape is listened for only while a preview shows");
  // Escape closes a hovered preview too, which shows again once the pointer comes back.
  map.fire(CENTRAL, "pointerenter", { pointerType: "mouse" });
  map.key("Escape");
  assert.deepEqual(map.shown(), []);
  map.fire(CENTRAL, "pointerleave");
  map.fire(CENTRAL, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), [["Café Central"]]);
});

test("while the map moves, as when Leaflet brings a marker the keyboard reaches into view, the preview waits for it (TRA-188)", () => {
  const map = previewMap();
  // Leaflet starts moving the map as the marker takes focus, before the map's own listener hears of it.
  map.mapEvent("movestart");
  map.focus(SACHER, true);
  assert.deepEqual(map.shown(), []);
  // Once it stops, the preview shows above the marker where the map moved it.
  map.mapEvent("moveend", { x: -100, y: 50 });
  assert.deepEqual(map.previews().map((preview) => [preview.left, preview.top]), [["100px", "139px"]]);
  map.mapEvent("zoomstart");
  assert.deepEqual(map.shown(), []);
  map.mapEvent("moveend", { x: 0, y: 0 });
  assert.deepEqual(map.previews().map((preview) => [preview.left, preview.top]), [["200px", "89px"]]);
});

test("touch shows no preview, and opening a marker's popup, by click, tap, Enter or Space, closes the preview, none showing until it closes (TRA-188)", () => {
  const map = previewMap();
  map.fire(SACHER, "pointerenter", { pointerType: "touch" });
  assert.deepEqual(map.shown(), [], "a tap has no hover");
  // A click on a marker whose preview shows opens its popup as before, which closes the preview.
  map.fire(SACHER, "pointerenter", { pointerType: "mouse" });
  map.popup(SACHER, true);
  assert.ok(map.marker(SACHER).open);
  assert.deepEqual(map.shown(), []);
  assert.equal(map.document.activeElement.name, "View details", "the popup takes focus as before");
  // While it is open, neither the pointer nor the keyboard shows a preview, which would cover it.
  map.fire(SACHER, "pointerleave");
  map.fire(CENTRAL, "pointerenter", { pointerType: "mouse" });
  map.focus(STEPHANSPLATZ, true);
  assert.deepEqual(map.shown(), []);
  map.fire(CENTRAL, "pointerleave");
  map.popup(SACHER, false);
  assert.deepEqual(map.shown(), []);
  // Once it closes, the pointer reaching a marker shows its preview again.
  map.fire(CENTRAL, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), [["Café Central"]]);
  map.fire(CENTRAL, "pointerleave");
  map.wait(200);
  // Space, as Enter, opens the popup of a marker the keyboard previews, and closes the preview.
  map.blur(STEPHANSPLATZ);
  map.focus(SACHER, true);
  assert.deepEqual(map.shown(), [["Hotel Sacher Wien"]]);
  assert.ok(map.press(SACHER, " "));
  assert.ok(map.marker(SACHER).open);
  assert.deepEqual(map.shown(), []);
  // Escape in the popup closes it and returns focus to the marker, as before, which shows no preview then.
  assert.ok(map.press(SACHER, "Escape", true));
  assert.ok(!map.marker(SACHER).open);
  assert.equal(map.document.activeElement, map.marker(SACHER).element);
  assert.deepEqual(map.shown(), []);
  assert.equal(map.listening(), 0);
  // The keyboard moving on and back previews it again.
  map.blur(SACHER);
  map.focus(SACHER, true);
  assert.deepEqual(map.shown(), [["Hotel Sacher Wien"]]);
});

test("drawing the markers again, as when a checkbox hides or shows places, closes the preview until the pointer or keyboard comes back (TRA-188)", () => {
  const map = previewMap();
  map.fire(SACHER, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), [["Hotel Sacher Wien"]]);
  // Unchecking Hotels removes the hotel's marker, and its preview with it.
  map.render({ markers: [central], onView() {} });
  assert.deepEqual(map.shown(), []);
  assert.equal(map.listening(), 0);
  // Checking Hotels again draws every marker anew, without a preview until the pointer reaches one.
  const redrawn = [sacherWien, central, stephansplatz].map((marker) => ({ ...marker }));
  map.render({ markers: redrawn, onView() {} });
  assert.deepEqual(map.shown(), []);
  map.fire(SACHER, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), [["Hotel Sacher Wien"]]);
  // The same for the keyboard's preview: a redraw, as when a place's lookup answers, closes it.
  map.fire(SACHER, "pointerleave");
  map.wait(200);
  map.focus(CENTRAL, true);
  assert.deepEqual(map.shown(), [["Café Central"]]);
  map.render({ markers: redrawn.map((marker) => ({ ...marker })), onView() {} });
  assert.deepEqual(map.shown(), []);
  assert.equal(map.listening(), 0);
});
