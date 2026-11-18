import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as photoFocus from "../src/lib/photo-focus.ts";
import * as tripMap from "../src/lib/trip-map.ts";

// TRA-143: the trip map's destination previews, from the real map component, with a small hook harness, a stand-in for
// Leaflet that records each marker and the listeners on it, and a clock the test moves. No browser or server is involved.
function load(path, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}
const jsx = (type, props, key) => ({ type, props, key });
const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
// A CSS module's class names are their own names.
const styles = new Proxy({}, { get: (_target, name) => name });
const unchanged = (previous, deps) => previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]));
// The address of a photo's thumbnail, from the destination gallery itself. Its module's other imports go unused here.
const unused = new Proxy({}, { get: () => () => null });
const { thumbnailUrl } = load("../src/components/destination-gallery.tsx", () => unused);

/** Hooks that keep their state between renders. After each render, `attach` sets refs, then changed effects run in order. */
function hooks(attach) {
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
  };
}

const PHOTO = "0b6f1c2e-6f5a-4b7e-9a51-3c4d5e6f7a8b";
const photo = { destinationId: "vienna-id", id: PHOTO, version: "v2", focusX: 20, focusY: 80 };
const marker = (key, kind, position, label, details = {}) => ({ key, kind, position, label, number: null, target: key, found: label, photo: null, ...details });
/**
 * A trip from Wooster by way of Frankfurt to Vienna, with a primary photo, and Salzburg, without photos. Each position is
 * the point the stand-in's map draws it at, as [y, x] in pixels from its top left corner.
 */
const layout = {
  markers: [
    marker("departure", "roundTrip", [40, 60], "Wooster, OH", { target: "connection-out" }),
    marker("itinerary-out-fra", "layover", [120, 150], "Frankfurt (FRA)"),
    marker("itinerary-out-lunch", "stop", [140, 170], "Lunch in Frankfurt"),
    marker("destination-vienna", "destination", [250, 300], "Vienna, Austria", { number: 1, found: "Vienna, Vienna, Austria", photo }),
    marker("destination-salzburg", "destination", [30, 590], "Salzburg", { number: 2 }),
  ],
  lines: [{ id: "out", points: [[40, 60], [250, 300]], badge: [110, 140], method: "Flight", from: "Wooster, OH", to: "Vienna, Austria", target: "connection-out" }],
  unmapped: [],
};
const VIENNA = "Destination 1: Vienna, Austria", SALZBURG = "Destination 2: Salzburg";

/** The trip's map, 600 by 378 pixels, in a stand-in page whose elements record being scrolled to and focused. */
function mapCanvas() {
  const markers = [], mapEvents = {}, page = {}, timers = new Map(), keyListeners = [];
  let now = 0, lastTimer = 0, offset = { x: 0, y: 0 }, rendered = new Map(), tree;
  const { react, render } = hooks((rendering) => {
    // React sets each ref to its element, the same one while it stays rendered, and to null once it's gone. The preview
    // measures 200 pixels wide, and 132 tall with a photo or 36 with its name alone.
    const withRefs = nodes(rendering).filter((node) => node.props?.ref);
    const next = new Map(withRefs.map((node) => [node.key, rendered.get(node.key) ?? { ref: node.props.ref, offsetWidth: 200, offsetHeight: nodes(node).some((child) => child.type === "img") ? 132 : 36, style: {}, contains(other) { return other === this; } }]));
    for (const [key, element] of rendered) if (!next.has(key)) element.ref.current = null;
    for (const node of withRefs) node.props.ref.current = next.get(node.key);
    rendered = next;
  });
  const instance = {
    on(names, handler) { for (const name of names.split(" ")) mapEvents[name] = handler; },
    remove() {}, fitBounds() {},
    getSize: () => ({ x: 600, y: 378 }),
    latLngToContainerPoint: ([y, x]) => ({ x: x + offset.x, y: y + offset.y }),
  };
  const L = {
    map: () => instance,
    tileLayer: () => ({ addTo() { return this; } }),
    layerGroup: () => ({ addTo() { return this; }, clearLayers() { markers.length = 0; } }),
    latLngBounds: (positions) => positions,
    polyline: () => ({ addTo() { return this; } }),
    divIcon: (options) => options,
    marker(position, options) {
      const element = { attributes: {}, listeners: {}, focusVisible: false,
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); },
        matches(selector) { assert.equal(selector, ":focus-visible"); return this.focusVisible; } };
      const handlers = {};
      return { position, options, element, handlers, on(name, handler) { handlers[name] = handler; return this; }, addTo() { markers.push(this); return this; }, getElement: () => element };
    },
  };
  const loaded = load("../src/components/trip-map-canvas.tsx", (name) => {
    const modules = {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
      "react-dom": { createPortal: (children, container, key) => ({ type: "portal", props: { container, children }, key }) },
      leaflet: { default: L },
      "leaflet/dist/leaflet.css": {},
      "@/components/destination-gallery": { thumbnailUrl },
      "@/components/transportation-icons": { transportationLabel: (method) => method },
      "@/components/trip-map-symbols": { MarkerSymbol: "symbol", TransportationBadge: "badge" },
      "@/lib/photo-focus": photoFocus,
      "@/lib/transportation-methods": { transportationIcons: () => ["plane"] },
      "@/lib/trip-map": tripMap,
      "./trip-map.module.css": { default: styles },
    };
    if (!(name in modules)) throw new Error("Unexpected component import: " + name);
    return modules[name];
  }, {
    document: {
      createElement: () => ({}),
      getElementById: (id) => page[id] ??= { visits: 0, scrollIntoView() { this.visits++; }, focus(options) { this.focusOptions = options; } },
      addEventListener: (type, listener) => keyListeners.push(listener),
      removeEventListener: (type, listener) => keyListeners.splice(keyListeners.indexOf(listener), 1),
    },
    matchMedia: () => ({ matches: false }),
    setTimeout: (run, delay) => { timers.set(++lastTimer, { run, at: now + delay }); return lastTimer; },
    clearTimeout: (id) => timers.delete(id),
  });
  // Renders again, as React does after each change of state.
  const update = () => { tree = render(loaded.default, { layout, focus: null }); };
  const markerFor = (label) => markers.find((item) => item.element.attributes["aria-label"] === label);
  const previewNode = () => nodes(tree).find((node) => node.props?.className === "preview");
  update();
  return {
    markers,
    page,
    marker: markerFor,
    /** Dispatches a DOM event to the marker labeled `label`. */
    fire(label, type, event = {}) {
      for (const listener of markerFor(label).element.listeners[type] ?? []) listener(event);
      update();
    },
    /** Focuses a marker, by keyboard when `visible`, as `:focus-visible` tells, or by a click or tap. */
    focus(label, visible) {
      markerFor(label).element.focusVisible = visible;
      this.fire(label, "focus");
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
    /** Leaflet's event as the map starts or stops moving, with where it moves the map's places. */
    mapEvent(name, moved = offset) {
      offset = moved;
      mapEvents[name]();
      update();
    },
    /** The previews shown, as people see them: the name, the photo's address, description and crop, and where it is. */
    previews: () => nodes(tree).filter((node) => node.props?.className === "preview").map((node) => {
      const image = nodes(node).find((child) => child.type === "img");
      const { style } = node.props.ref.current;
      return { name: text(nodes(node).find((child) => child.type === "strong")), photo: image ? { src: image.props.src, alt: image.props.alt, position: image.props.style.objectPosition } : null,
        hidden: node.props["aria-hidden"], left: style.left, top: style.top };
    }),
    shown() { return this.previews().map((preview) => preview.name); },
  };
}

test("hovering a destination's marker previews its name and primary photo, cropped as saved, above the marker (TRA-143)", () => {
  const map = mapCanvas();
  assert.deepEqual(map.previews(), []);
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.previews(), [{
    name: "Vienna, Austria",
    // The thumbnail the destination's gallery shows, cropped around its focal point. The name follows, so it is decorative.
    photo: { src: "/api/destination-images/vienna-id/" + PHOTO + "/thumbnail?v=v2", alt: "", position: "20% 80%" },
    // Screen readers have the destination's name from the marker's label, so the preview, which repeats it, is hidden.
    hidden: "true",
    // Centered 6 pixels above the 30-pixel marker at 300, 250.
    left: "200px", top: "97px",
  }]);
  assert.equal(map.previews()[0].photo.src, thumbnailUrl("vienna-id", photo));
});

test("a destination without photos previews its name alone, below its marker near the map's top and inside its edge (TRA-143)", () => {
  const map = mapCanvas();
  map.fire(SALZBURG, "pointerenter", { pointerType: "mouse" });
  // With no room above the marker at 590, 30, the name, 36 pixels tall, goes below it, 8 pixels inside the map's right edge.
  assert.deepEqual(map.previews(), [{ name: "Salzburg", photo: null, hidden: "true", left: "392px", top: "51px" }]);
});

test("the preview stays while the pointer moves between the marker and the preview, and closes a moment after it leaves both (TRA-143)", () => {
  const map = mapCanvas();
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  // Leaving the marker for the preview, across the gap between them.
  map.fire(VIENNA, "pointerleave");
  map.wait(150);
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.hoverPreview(true);
  map.wait(5000);
  assert.deepEqual(map.shown(), ["Vienna, Austria"], "open as long as the pointer is on the preview");
  // Back to the marker, then away from both.
  map.hoverPreview(false);
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  map.wait(5000);
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.fire(VIENNA, "pointerleave");
  map.wait(199);
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.wait(1);
  assert.deepEqual(map.shown(), [], "closed once the pointer has been off both for 200 ms");
  // A quick move straight from the marker onto the preview: React tells the preview first, then the marker hears of it.
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  map.hoverPreview(true);
  map.fire(VIENNA, "pointerleave", { relatedTarget: map.previewElement() });
  map.wait(5000);
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.hoverPreview(false);
  map.wait(200);
  assert.deepEqual(map.shown(), []);
  // From one destination's marker straight to another's, the preview follows at once and stays.
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  map.fire(VIENNA, "pointerleave");
  map.fire(SALZBURG, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), ["Salzburg"]);
  map.wait(5000);
  assert.deepEqual(map.shown(), ["Salzburg"]);
});

test("the keyboard reaching a destination's marker previews it until the keyboard moves on or Escape closes it (TRA-143)", () => {
  const map = mapCanvas();
  // A click or tap focuses the marker too, on its way to the destination, without a preview.
  map.focus(VIENNA, false);
  assert.deepEqual(map.shown(), []);
  map.fire(VIENNA, "blur");
  map.focus(VIENNA, true);
  assert.deepEqual(map.previews().map((preview) => [preview.name, preview.left, preview.top]), [["Vienna, Austria", "200px", "97px"]], "the same preview as hovering shows");
  map.fire(VIENNA, "blur");
  map.focus(SALZBURG, true);
  assert.deepEqual(map.shown(), ["Salzburg"]);
  map.fire(SALZBURG, "blur");
  assert.deepEqual(map.shown(), []);
  // Escape closes it with the keyboard still on the marker. Other keys don't.
  map.focus(VIENNA, true);
  map.key("Shift");
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.key("Escape");
  assert.deepEqual(map.shown(), []);
  assert.equal(map.listening(), 0, "Escape is listened for only while a preview shows");
  // Escape closes a hovered preview too, which shows again once the pointer comes back.
  map.fire(SALZBURG, "pointerenter", { pointerType: "mouse" });
  map.key("Escape");
  assert.deepEqual(map.shown(), []);
  map.fire(SALZBURG, "pointerleave");
  map.fire(SALZBURG, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), ["Salzburg"]);
});

test("while the map moves, as when Leaflet brings a marker the keyboard reaches into view, the preview waits for it (TRA-143)", () => {
  const map = mapCanvas();
  // Leaflet starts moving the map as the marker takes focus, before the map's own listener hears of it.
  map.mapEvent("movestart");
  map.focus(VIENNA, true);
  assert.deepEqual(map.shown(), []);
  // Once it stops, the preview shows above the marker where the map moved it.
  map.mapEvent("moveend", { x: -100, y: 50 });
  assert.deepEqual(map.previews().map((preview) => [preview.left, preview.top]), [["100px", "147px"]]);
  map.mapEvent("zoomstart");
  assert.deepEqual(map.shown(), []);
  map.mapEvent("moveend", { x: 0, y: 0 });
  assert.deepEqual(map.previews().map((preview) => [preview.left, preview.top]), [["200px", "97px"]]);
});

test("touch shows no preview, and selecting a destination's marker goes to its card as before (TRA-143)", () => {
  const map = mapCanvas();
  map.fire(VIENNA, "pointerenter", { pointerType: "touch" });
  assert.deepEqual(map.shown(), [], "a tap has no hover");
  const card = () => map.page["destination-vienna"];
  map.marker(VIENNA).handlers.click();
  assert.equal(card().visits, 1);
  assert.equal(card().focusOptions.preventScroll, true);
  let prevented = 0;
  for (const key of ["Enter", " "]) map.marker(VIENNA).handlers.keydown({ originalEvent: { key, preventDefault() { prevented++; } } });
  assert.deepEqual([card().visits, prevented], [3, 2]);
  // A pen hovers as a mouse does, and selecting the marker while its preview shows still goes to the card.
  map.fire(VIENNA, "pointerenter", { pointerType: "pen" });
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.marker(VIENNA).handlers.click();
  assert.equal(card().visits, 4);
});

test("only destinations' markers have previews: the trip's ends, layovers, stops and transportation are as they were (TRA-143)", () => {
  const map = mapCanvas();
  assert.deepEqual(map.markers.map((item) => [item.element.attributes["aria-label"], Object.keys(item.element.listeners)]), [
    ["Departure and return: Wooster, OH", []],
    ["Layover: Frankfurt (FRA)", []],
    ["Stop along the way: Lunch in Frankfurt", []],
    [VIENNA, ["pointerenter", "pointerleave", "focus", "blur"]],
    [SALZBURG, ["pointerenter", "pointerleave", "focus", "blur"]],
    ["Flight from Wooster, OH to Vienna, Austria", []],
  ]);
  // A destination's marker still names, in its tooltip, the place the map found for it.
  assert.equal(map.marker(VIENNA).options.title, VIENNA + "\nShown at Vienna, Vienna, Austria");
  assert.ok(map.markers.every((item) => item.options.keyboard && item.options.interactive));
});
