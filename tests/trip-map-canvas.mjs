import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as photoFocus from "../src/lib/photo-focus.ts";
import * as tripMap from "../src/lib/trip-map.ts";

// The trip map itself (TRA-143, TRA-175), from the real map component, with a small hook harness, a stand-in for Leaflet
// that records each marker and the listeners on it, a stand-in page that records focus, and a clock the test moves. No
// browser or server is involved.
function load(path, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}
const jsx = (type, props, key) => ({ type, props, key });
export const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
export const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
// A CSS module's class names are their own names.
const styles = new Proxy({}, { get: (_target, name) => name });
const unchanged = (previous, deps) => previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]));
// The address of a photo's thumbnail, from the destination gallery itself. Its module's other imports go unused here.
const unused = new Proxy({}, { get: () => () => null });
export const { thumbnailUrl } = load("../src/components/destination-gallery.tsx", () => unused);

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
      attach(tree);
      for (const run of pending) run();
      return tree;
    },
  };
}

/**
 * The trip's map of `layout`, 600 by 378 pixels unless `size` says otherwise, in a stand-in page whose elements record
 * being scrolled to and focused. Each position in the layout is the point the stand-in's map draws it at, as [y, x] in
 * pixels from its top left corner.
 */
export function mapCanvas(layout, size = { x: 600, y: 378 }) {
  const markers = [], mapEvents = {}, page = {}, timers = new Map(), keyListeners = [];
  let now = 0, lastTimer = 0, offset = { x: 0, y: 0 }, rendered = new Map(), tree;
  const document = {
    activeElement: null,
    createElement: () => ({}),
    getElementById: (id) => page[id] ??= { visits: 0, scrollIntoView() { this.visits++; }, focus(options) { this.focusOptions = options; document.activeElement = this; } },
    addEventListener: (type, listener) => keyListeners.push(listener),
    removeEventListener: (type, listener) => keyListeners.splice(keyListeners.indexOf(listener), 1),
  };
  // Focusing an element records how, and makes it the page's focused element.
  const focusable = (element) => Object.assign(element, { focus(options) { this.focusOptions = options; document.activeElement = this; } });
  const { react, render } = hooks((rendering) => {
    // React sets each ref to its element, the same one while it stays rendered, and to null once it's gone. A
    // destination's preview measures 200 pixels wide, and 132 tall with a photo or 36 with its name alone, and a
    // connection's popup 240 wide, and 48 tall with its route and View details, and 20 more for each detail.
    const withRefs = nodes(rendering).filter((node) => node.props?.ref);
    const measure = (node) => node.props.className === "popup" ? { offsetWidth: 240, offsetHeight: 48 + 20 * nodes(node).filter((child) => child.type === "dt").length }
      : { offsetWidth: 200, offsetHeight: nodes(node).some((child) => child.type === "img") ? 132 : 36 };
    const next = new Map(withRefs.map((node) => [node.key, rendered.get(node.key) ?? {
      ref: node.props.ref, ...measure(node), style: {}, button: focusable({}),
      contains(other) { return other === this || other === this.button; },
      querySelector(selector) { assert.equal(selector, "button"); return this.button; },
    }]));
    // As in a browser, focus on an element that's removed goes to the page itself.
    for (const [key, element] of rendered) {
      if (next.has(key)) continue;
      element.ref.current = null;
      if (element.contains(document.activeElement)) document.activeElement = null;
    }
    for (const node of withRefs) node.props.ref.current = next.get(node.key);
    rendered = next;
  });
  const instance = {
    on(names, handler) { for (const name of names.split(" ")) mapEvents[name] = handler; },
    remove() {}, fitBounds() {},
    getSize: () => size,
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
      const element = focusable({ attributes: {}, listeners: {}, focusVisible: false,
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); },
        matches(selector) { assert.equal(selector, ":focus-visible"); return this.focusVisible; } });
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
      "lucide-react": { ArrowRight: "ArrowRight" },
      "@/components/destination-gallery": { thumbnailUrl },
      "@/components/transportation-icons": { TransportationIcons: "TransportationIcons", transportationLabel: (method) => method },
      "@/components/trip-map-symbols": { MarkerSymbol: "symbol", TransportationBadge: "badge" },
      "@/lib/photo-focus": photoFocus,
      "@/lib/transportation-methods": { transportationIcons: () => ["plane"] },
      "@/lib/trip-map": tripMap,
      "./trip-map.module.css": { default: styles },
    };
    if (!(name in modules)) throw new Error("Unexpected component import: " + name);
    return modules[name];
  }, {
    document,
    matchMedia: () => ({ matches: false }),
    setTimeout: (run, delay) => { timers.set(++lastTimer, { run, at: now + delay }); return lastTimer; },
    clearTimeout: (id) => timers.delete(id),
  });
  // Renders again, as React does after each change of state.
  const update = () => { tree = render(loaded.default, { layout }); };
  const markerFor = (label) => markers.find((item) => item.element.attributes["aria-label"] === label);
  const previewNode = () => nodes(tree).find((node) => node.props?.className === "preview");
  const popupNode = () => nodes(tree).find((node) => node.props?.className === "popup");
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
    /** Selects a marker with a click or tap, after Leaflet tells the map, as it does for every click on it. */
    click(label) {
      mapEvents.preclick();
      markerFor(label).handlers.click();
      update();
    },
    /** Presses a key on a marker, and whether its default was prevented. */
    press(label, key) {
      let prevented = false;
      markerFor(label).handlers.keydown({ originalEvent: { key, preventDefault() { prevented = true; } } });
      update();
      return prevented;
    },
    /** The pointer reaching or leaving the preview. */
    hoverPreview(entering) {
      previewNode().props[entering ? "onPointerEnter" : "onPointerLeave"]();
      update();
    },
    previewElement: () => previewNode().props.ref.current,
    /** The pointer reaching or leaving the popup. */
    hoverPopup(entering) {
      popupNode().props[entering ? "onPointerEnter" : "onPointerLeave"]();
      update();
    },
    /** The keyboard reaching View details in the popup. */
    focusPopup() {
      const element = popupNode().props.ref.current;
      element.button.focus();
      popupNode().props.onFocus();
      update();
    },
    popupElement: () => popupNode().props.ref.current,
    /** Selects View details in the popup. */
    viewDetails() {
      nodes(popupNode()).find((node) => node.type === "button").props.onClick();
      update();
    },
    activeElement: () => document.activeElement,
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
    /** Leaflet's event as the map starts or stops moving, with where it moves the map's places, or as it's clicked. */
    mapEvent(name, moved = offset) {
      offset = moved;
      mapEvents[name]();
      update();
    },
    /** Draws the map again with a new layout, as when the trip's saved data changes. */
    redraw(next) {
      layout = next;
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
    /**
     * The connections' popups shown, as people see them: the transportation's icons and the route, each saved detail with
     * its name, View details as screen readers hear it, how screen readers know the popup, and where it is.
     */
    popups: () => nodes(tree).filter((node) => node.props?.className === "popup").map((node) => {
      const title = nodes(node).find((child) => child.props?.className === "popupTitle");
      const list = nodes(node).find((child) => child.type === "dl");
      const { style } = node.props.ref.current;
      return {
        icons: nodes(title).find((child) => child.type === "TransportationIcons").props.method,
        route: text(nodes(title).find((child) => child.type === "strong")),
        details: list ? nodes(list).filter((child) => child.type === "div").map((row) => [text(nodes(row).find((child) => child.type === "dt")), text(nodes(row).find((child) => child.type === "dd"))]) : [],
        button: text(nodes(node).find((child) => child.type === "button")),
        role: node.props.role,
        labelledBy: node.props["aria-labelledby"] === title.props.id,
        describedBy: list ? node.props["aria-describedby"] === list.props.id : node.props["aria-describedby"],
        left: style.left, top: style.top,
      };
    }),
    /** The routes of the popups shown. */
    opened() { return this.popups().map((popup) => popup.route); },
  };
}
