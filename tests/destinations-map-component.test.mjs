import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as destinationsMap from "../src/lib/destinations-map.ts";
import { createLocationSearch } from "../src/lib/location-search.ts";
import { createStore } from "../src/lib/store.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import { cssRules } from "./css-rules.mjs";
import { newItem } from "./budget-fixtures.mjs";

// TRA-180: the Destinations page's map, from the real components with a small hook harness. The section asks the real
// route, with a real store and a stand-in for Open-Meteo; the map itself draws with a stand-in for Leaflet; and the page
// is the real planner. No browser or server is involved.
const compile = (path, jsx = true) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
}).outputText;
/** A module's exports, run in its own realm, importing with `require` and using `globals`. */
function load(path, require, globals = {}) {
  const exports = {};
  runInNewContext(compile(path), { exports, require, ...globals });
  return exports;
}
/** A `require` that gives only `modules`. */
const only = (modules) => (name) => {
  if (!(name in modules)) throw new Error("Unexpected component import: " + name);
  return modules[name];
};
const jsx = (type, props, key) => ({ type, props, key });
const runtime = { jsx, jsxs: jsx, Fragment: "fragment" };
const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
// A CSS module's class names are their own names, and an icon is its name. Values from a component are copied into this
// test's realm to compare.
const styles = new Proxy({}, { get: (_target, name) => name });
const icons = new Proxy({}, { get: (_target, name) => name });
const copy = (value) => JSON.parse(JSON.stringify(value));
const unchanged = (previous, deps) => previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]));
const settle = () => new Promise((resolve) => setImmediate(resolve));

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
    /** Unmounts: every effect cleans up, and the next render mounts afresh. */
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
      slots.length = 0;
    },
  };
}

// Open-Meteo's places for the names the stand-in knows.
const openMeteo = {
  Vienna: { id: 2761369, name: "Vienna", latitude: 48.20849, longitude: 16.37208, country_code: "AT", admin1: "Vienna", country: "Austria" },
  Salzburg: { id: 2766824, name: "Salzburg", latitude: 47.79941, longitude: 13.04399, country_code: "AT", admin1: "Salzburg", country: "Austria" },
  Graz: { id: 2778067, name: "Graz", latitude: 47.06667, longitude: 15.45, country_code: "AT", admin1: "Styria", country: "Austria" },
  Innsbruck: { id: 2775220, name: "Innsbruck", latitude: 47.26266, longitude: 11.39454, country_code: "AT", admin1: "Tyrol", country: "Austria" },
  Linz: { id: 2772400, name: "Linz", latitude: 48.30639, longitude: 14.28611, country_code: "AT", admin1: "Upper Austria", country: "Austria" },
};
const VIENNA = [openMeteo.Vienna.latitude, openMeteo.Vienna.longitude];
const SALZBURG = [openMeteo.Salzburg.latitude, openMeteo.Salzburg.longitude];
const GRAZ = [openMeteo.Graz.latitude, openMeteo.Graz.longitude];

/**
 * The owner's Austria trip to Vienna and Salzburg, shared with a friend, an Alps trip to Salzburg too, and Graz, Atlantis
 * and Vienna, Austria in no trip, the last of which is found where Vienna is.
 */
function plan(t) {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const owner = store.authorizeAccount("owner@example.com");
  const friend = store.authorizeAccount("friend@example.com");
  const save = (account, input) => store.applyMutation(account.id, input).id;
  const trip = (name) => save(owner, { type: "trip.save", ...newItem(), name, dateLabel: "", homeCity: "Wooster, OH", travelers: 2, notes: "" });
  const destinationOf = (stopId) => store.getSnapshot().stops.find((stop) => stop.id === stopId).destinationId;
  const austria = trip("Austria"), alps = trip("Alps");
  const ids = {
    austria,
    vienna: destinationOf(save(owner, { type: "stop.add", tripId: austria, city: "Vienna" })),
    salzburg: destinationOf(save(owner, { type: "stop.add", tripId: austria, city: "Salzburg" })),
    graz: save(owner, { type: "destination.create", city: "Graz" }),
    atlantis: save(owner, { type: "destination.create", city: "Atlantis" }),
    wien: save(owner, { type: "destination.create", city: "Vienna, Austria" }),
  };
  save(owner, { type: "stop.add", tripId: alps, city: "Salzburg" });
  save(owner, { type: "trip.share", tripId: austria, email: "friend@example.com" });
  return { store, owner, friend, save, ids };
}

/**
 * The Destinations map's route answering as `account`, with `fetcher` standing in for Open-Meteo. Its lookups are kept as
 * a server keeps them.
 */
function destinationsMapRoute(store, account, fetcher) {
  const exports = {};
  const imports = {
    "@/auth": { currentAccount: async () => account, signedOutResponse: () => Response.json({ error: "Please sign in." }, { status: 401 }) },
    "@/lib/destinations-map": destinationsMap,
    "@/lib/location-search": { locatePlaces: createLocationSearch({ fetcher }).locatePlaces },
    "@/lib/store": { getDestinationsOverview: (accountId) => store.getDestinationsOverview(accountId) },
  };
  new Function("require", "exports", compile("../src/app/api/destinations-map/route.ts", false))(only(imports), exports);
  return () => exports.GET(new Request("http://localhost:3000/api/destinations-map"));
}

/** The destinations the Destinations page gives its map, as `account` sees them, with whose each shared one is. */
function pageDestinations(store, account) {
  const { data, access } = store.getDestinationsOverview(account.id);
  return data.destinations.map(({ id, city, cityFromSuggestion }) => ({ id, city, cityFromSuggestion, sharedBy: access[id].role === "editor" ? access[id].owner.name ?? access[id].owner.email : null }));
}

/**
 * The Destinations page's Map section as `account` sees it, with the store's destinations and the IDs its search shows,
 * every one until `search` says otherwise. Its requests go to the real route, whose Open-Meteo answers as `respond` says,
 * by name, or throws for an outage.
 */
function mapSection(store, account, respond = (name) => openMeteo[name]) {
  const lookups = [], requests = [];
  const route = destinationsMapRoute(store, account, async (url) => {
    const name = url.searchParams.get("name");
    lookups.push(name);
    const place = await respond(name);
    return Response.json(place ? { results: [place] } : {});
  });
  const { react, render } = hooks();
  const { default: DestinationsMap } = load("../src/components/destinations-map.tsx", only({
    react,
    "react/jsx-runtime": runtime,
    // The map itself loads only in a browser, so the section shows whatever `dynamic` gives it.
    "next/dynamic": { default: () => "DestinationsMapCanvas" },
    "next/link": { default: "Link" },
    "lucide-react": icons,
    "@/lib/destinations-map": destinationsMap,
    "./destinations-map.module.css": { default: styles },
  }), {
    fetch: async (url) => { requests.push(url); return route(); },
    AbortController,
  });
  let shown = null, tree;
  const show = () => {
    const destinations = pageDestinations(store, account);
    tree = render(DestinationsMap, { destinations, shown: shown ?? destinations.map((item) => item.id) });
  };
  const find = (predicate) => nodes(tree).filter(predicate);
  show();
  return {
    lookups, requests,
    tree: () => tree,
    /** Renders again once every request so far has been answered, as React does after each change of state. */
    async update() {
      for (let round = 0; round < 10; round++) { show(); await settle(); }
      show();
    },
    /** Shows only the destinations with these IDs, as a search does, or every one again with null. */
    search(ids) { shown = ids; show(); },
    canvas: () => find((node) => node.type === "DestinationsMapCanvas")[0],
    /** Each destination the map is given, as where it was found and its name. */
    mapped() { const canvas = this.canvas(); return canvas ? copy(canvas.props.destinations).map((item) => [item.position, item.name]) : []; },
    /** The IDs of the destinations the map is given. */
    ids() { return copy(this.canvas().props.destinations).map((item) => item.id); },
    message: () => text(find((node) => node.type === "p" && node.props.className === "message")[0]) || undefined,
    status: () => text(find((node) => node.props?.role === "status")[0]),
    /** Not on the map's destinations, each as where its link goes, its name, and why it isn't on the map. */
    unmapped: () => find((node) => node.type === "li").map((item) => {
      const link = nodes(item).find((node) => node.type === "Link");
      return [link.props.href, text(link), text(nodes(item).find((node) => node.props?.className === "reason"))];
    }),
    button: (label) => find((node) => node.type === "button" && text(node) === label)[0],
    toggle: () => find((node) => node.props?.className === "toggle")[0],
  };
}

test("the map is open when the page opens, with every destination the account can open on it once, and its heading closes and reopens it", async (t) => {
  const { store, owner, ids } = plan(t);
  const map = mapSection(store, owner);
  assert.equal(map.status(), "Finding destinations on the map…");
  assert.equal(map.message(), "Finding your destinations…");
  await map.update();
  assert.deepEqual(map.requests, ["/api/destinations-map"]);
  assert.equal(map.status(), "");
  // Salzburg, in two trips, is on the map once, Vienna and Vienna, Austria are each where they were found, and Atlantis is listed.
  assert.deepEqual(map.mapped(), [[GRAZ, "Graz"], [SALZBURG, "Salzburg"], [VIENNA, "Vienna"], [VIENNA, "Vienna, Austria"]]);
  assert.deepEqual(map.ids(), [ids.graz, ids.salzburg, ids.vienna, ids.wien]);
  assert.deepEqual(map.unmapped(), [["/destinations/" + ids.atlantis, "Atlantis", "No place was found by this name."]]);
  assert.equal(map.button("Try again"), undefined, "nothing to try again");
  assert.deepEqual(map.lookups.toSorted(), ["Atlantis", "Graz", "Salzburg", "Vienna"]);

  // The heading names the section and controls it.
  const toggle = map.toggle();
  const heading = nodes(map.tree()).find((node) => node.type === "h3");
  assert.equal(text(heading), "Map");
  assert.equal(map.tree().props["aria-labelledby"], heading.props.id);
  const content = () => nodes(map.tree()).find((node) => node.props?.id === map.toggle().props["aria-controls"]);
  assert.equal(toggle.props["aria-expanded"], true);
  toggle.props.onClick();
  await map.update();
  assert.equal(map.toggle().props["aria-expanded"], false);
  assert.equal(content().props.hidden, true);
  assert.equal(content().props.children, false, "nothing shows while it is closed");
  map.toggle().props.onClick();
  await map.update();
  assert.equal(content().props.hidden, false);
  assert.equal(map.mapped().length, 4, "with every destination");
  assert.deepEqual(map.requests, ["/api/destinations-map"], "closing and reopening looks nothing up");
});

test("the search filters the map's markers and Not on the map, and clearing it shows every destination again, without looking anything up again", async (t) => {
  const { store, owner, ids } = plan(t);
  const map = mapSection(store, owner);
  await map.update();
  map.search([ids.salzburg]);
  assert.deepEqual(map.mapped(), [[SALZBURG, "Salzburg"]], "the map frames what the search shows");
  assert.deepEqual(map.unmapped(), []);
  // A search for one of the two names for Vienna shows that one alone.
  map.search([ids.atlantis, ids.wien]);
  assert.deepEqual(map.mapped(), [[VIENNA, "Vienna, Austria"]]);
  assert.deepEqual(map.unmapped(), [["/destinations/" + ids.atlantis, "Atlantis", "No place was found by this name."]]);
  map.search([ids.atlantis]);
  assert.equal(map.canvas(), undefined);
  assert.equal(map.message(), "None of these destinations can be shown on the map yet.");
  map.search([]);
  assert.equal(map.message(), "No destinations match that search.");
  assert.deepEqual(map.unmapped(), []);
  map.search(null);
  assert.equal(map.mapped().length, 4);
  assert.equal(map.unmapped().length, 1);
  await map.update();
  assert.deepEqual(map.requests, ["/api/destinations-map"]);
  assert.equal(map.lookups.length, 4);
});

test("a destination shared with the account is on its map, named for whose it is when the account saved the same city, and an outage offers Try again, keeping what was found", async (t) => {
  const { store, friend, save, ids } = plan(t);
  const own = save(friend, { type: "destination.create", city: "Vienna" });
  let offline = false;
  const map = mapSection(store, friend, (name) => {
    if (offline) throw new Error("Offline");
    return openMeteo[name];
  });
  await map.update();
  // The shared trip's Vienna and Salzburg, and the friend's own Vienna; never the owner's destinations in no shared trip.
  // The two Viennas are in the cards' order, by their IDs.
  const viennas = pageDestinations(store, friend).filter((item) => item.city === "Vienna").map((item) => item.id);
  assert.deepEqual(viennas.toSorted(), [ids.vienna, own].toSorted());
  assert.deepEqual(map.mapped(), [[SALZBURG, "Salzburg"], ...viennas.map((id) => [VIENNA, id === own ? "Vienna" : "Vienna, shared by owner@example.com"])]);
  assert.deepEqual(map.ids(), [ids.salzburg, ...viennas]);

  // Graz is added to the friend's destinations while the lookups can't be made: what was found stays, and Graz is listed.
  offline = true;
  save(friend, { type: "destination.create", city: "Graz" });
  const graz = pageDestinations(store, friend).find((item) => item.city === "Graz").id;
  await map.update();
  assert.equal(map.requests.length, 2);
  assert.equal(map.mapped().length, 3, "Salzburg and both Viennas stay");
  assert.deepEqual(map.unmapped(), [["/destinations/" + graz, "Graz", "Couldn't be looked up right now."]]);
  offline = false;
  map.button("Try again").props.onClick();
  await map.update();
  assert.equal(map.requests.length, 3);
  assert.deepEqual(map.mapped()[0], [GRAZ, "Graz"]);
  assert.deepEqual(map.unmapped(), []);
  assert.equal(map.button("Try again"), undefined);
});

test("a destination added, renamed or deleted is looked up again, a renamed one never shown where its old city was, and access the account loses takes its destinations away", async (t) => {
  const { store, owner, friend, save, ids } = plan(t);
  const map = mapSection(store, owner);
  await map.update();
  save(owner, { type: "destination.save", id: ids.graz, city: "Innsbruck" });
  save(owner, { type: "destination.create", city: "Linz" });
  store.applyMutation(owner.id, { type: "destination.delete", id: ids.atlantis });
  // While the new cities are looked up, Innsbruck isn't shown at Graz.
  map.search(null);
  assert.equal(map.status(), "Finding destinations on the map…");
  assert.ok(!map.mapped().some(([, name]) => name === "Innsbruck" || name === "Graz"));
  await map.update();
  assert.equal(map.requests.length, 2);
  assert.deepEqual(map.mapped(), [
    [[openMeteo.Innsbruck.latitude, openMeteo.Innsbruck.longitude], "Innsbruck"],
    [[openMeteo.Linz.latitude, openMeteo.Linz.longitude], "Linz"],
    [SALZBURG, "Salzburg"],
    [VIENNA, "Vienna"],
    [VIENNA, "Vienna, Austria"],
  ]);
  assert.deepEqual(map.unmapped(), [], "Atlantis is gone");
  // A save that changes no city, as a tagline's, looks nothing up.
  save(owner, { type: "destination.save", id: ids.vienna, tagline: "Coffee houses" });
  await map.update();
  assert.equal(map.requests.length, 2);

  // Once the trip stops being shared, the friend's page loads without its destinations, and its map shows none of them.
  const friendMap = mapSection(store, friend);
  await friendMap.update();
  assert.equal(friendMap.mapped().length, 2);
  save(owner, { type: "trip.unshare", tripId: ids.austria, email: "friend@example.com" });
  await friendMap.update();
  assert.equal(friendMap.canvas(), undefined);
  assert.equal(friendMap.message(), "Add a destination to see it on the map.");
  assert.equal(friendMap.requests.length, 1, "nothing to look up");
});

test("with no destinations, the map says so and looks nothing up", async (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const map = mapSection(store, store.authorizeAccount("owner@example.com"));
  await map.update();
  assert.equal(map.message(), "Add a destination to see it on the map.");
  assert.equal(map.status(), "");
  assert.deepEqual(map.requests, []);
});

/**
 * The map itself, 640 pixels wide and `height` tall, with a stand-in for Leaflet that records its markers, popups and
 * framing, a stand-in router that records where it goes, and a stand-in page that records focus. The stand-in's map draws
 * a degree as 2^zoom pixels across, and framing it zooms it to `framedZoom`, unless a test zooms it with `zoomTo`.
 */
function mapCanvas(height = 380) {
  const calls = [], markers = [], pushed = [], mapEvents = {};
  let zoom, framedZoom = 6, redraws = 0, props, tree;
  const document = { body: { name: "body" }, activeElement: null };
  // Focusing an element records how, and makes it the page's focused element.
  const focusable = (name) => ({
    name, listeners: {},
    focus(options) { calls.push(["focus", name, { ...options }]); document.activeElement = this; },
    setAttribute(key, value) { this[key] = value; },
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); },
  });
  const instance = {
    on(names, handler) { for (const name of names.split(" ")) mapEvents[name] = handler; },
    remove() {},
    getSize: () => ({ x: 640, y: height }),
    getZoom: () => zoom,
    fitBounds(bounds, options) {
      calls.push(["fitBounds", Array.from(bounds, (position) => [...position]), options.maxZoom]);
      zoom = framedZoom;
    },
  };
  const group = { addTo() { return this; }, clearLayers() { redraws++; markers.length = 0; } };
  const L = {
    map: () => instance,
    tileLayer: () => ({ addTo() { return this; } }),
    layerGroup: () => group,
    latLngBounds: (positions) => positions,
    latLng: ([lat, lng]) => ({ lat, lng }),
    CRS: { EPSG3857: { latLngToPoint: ({ lat, lng }, at) => ({ x: lng * 2 ** at, y: -lat * 2 ** at }) } },
    divIcon: (options) => options,
    marker(position, options) {
      const handlers = {};
      const element = focusable("marker " + options.title.split("\n")[0]);
      let content;
      const container = { contains: (node) => node === content?.link, querySelector: () => null };
      return {
        position, options, element, handlers, open: false,
        on(name, handler) { handlers[name] = handler; return this; },
        bindPopup(popup, popupOptions) { content = popup; this.popup = popup; this.popupOptions = popupOptions; return this; },
        addTo() { markers.push(this); return this; },
        getElement: () => element,
        getPopup: () => ({ getElement: () => container, update: () => calls.push(["update"]) }),
        openPopup() { this.open = true; handlers.popupopen?.(); },
        closePopup() { this.open = false; handlers.popupclose?.(); },
      };
    },
  };
  const router = { push: (href) => pushed.push(href) };
  const { react, render, unmount } = hooks();
  const { default: DestinationsMapCanvas } = load("../src/components/destinations-map-canvas.tsx", only({
    react,
    "react/jsx-runtime": runtime,
    "react-dom": { createPortal: (child, container, key) => ({ type: "portal", props: { container, children: child }, key }) },
    leaflet: { default: L },
    "leaflet/dist/leaflet.css": {},
    "next/link": { default: "Link" },
    "next/navigation": { useRouter: () => router },
    "lucide-react": icons,
    "@/lib/destinations-map": destinationsMap,
    "./destinations-map.module.css": { default: styles },
  }), {
    document: {
      get body() { return document.body; },
      get activeElement() { return document.activeElement; },
      // Each popup has its first link, which takes focus as it opens.
      createElement() {
        const listeners = {};
        const node = { link: focusable("first link"), listeners, addEventListener: (type, listener) => { listeners[type] = listener; }, removeEventListener: (type) => { delete listeners[type]; },
          querySelector: (selector) => { assert.equal(selector, "a"); return node.link; } };
        return node;
      },
    },
  });
  // Renders until what changed in its effects shows, as React renders again after each change of state.
  const update = () => { for (let pass = 0; pass < 3; pass++) tree = render(DestinationsMapCanvas, props); };
  const marker = (label) => markers.find((item) => item.element["aria-label"] === label) ?? assert.fail("No marker " + label);
  return {
    calls, markers, pushed, document,
    render(next) { props = next; update(); },
    unmount,
    marker,
    /** The markers' names for screen readers. */
    labels: () => markers.map((item) => item.element["aria-label"]),
    redraws: () => redraws,
    /** Zooms the map, as its buttons, a double-click or pinching do, which Leaflet tells once the zoom ends. */
    zoomTo(next) { zoom = next; mapEvents.zoomend(); update(); },
    set framedZoom(next) { framedZoom = next; },
    /** What's drawn in a marker: its symbol, or a shared marker's popup. */
    drawn: (container) => nodes(tree).find((node) => node.type === "portal" && node.props.container === container).props.children,
    /** Presses a key on a marker, or in its popup when `inPopup`, and whether its default was prevented. */
    press(label, key, inPopup = false) {
      let prevented = false;
      const event = { key, preventDefault() { prevented = true; } };
      if (inPopup) marker(label).popup.listeners.keydown(event);
      else marker(label).handlers.keydown?.({ originalEvent: event });
      return prevented;
    },
  };
}
const mapped = (id, name, position, found = name + ", Austria") => ({ id, name, position, found });
const vienna = mapped("vienna", "Vienna", VIENNA);
const salzburg = mapped("salzburg", "Salzburg", SALZBURG);
const graz = mapped("graz", "Graz", GRAZ, "Graz, Styria, Austria");

test("selecting a destination's marker with a click, a tap, Enter or Space opens its page, and its label and tooltip name it", () => {
  const map = mapCanvas();
  map.render({ destinations: [vienna, salzburg] });
  assert.deepEqual(map.labels(), ["Vienna", "Salzburg"]);
  const marker = map.marker("Vienna");
  assert.equal(marker.options.keyboard, true, "the keyboard reaches it");
  assert.equal(marker.options.title, "Vienna\nShown at Vienna, Austria");
  assert.deepEqual(copy(marker.options.icon.iconSize), [30, 30]);
  assert.equal(map.drawn(marker.options.icon.html).props.className, "symbol");
  marker.handlers.click();
  assert.deepEqual(map.pushed, ["/destinations/vienna"]);
  assert.equal(map.press("Salzburg", "Enter"), true);
  assert.equal(map.press("Salzburg", " "), true, "Space doesn't scroll the page");
  assert.deepEqual(map.pushed, ["/destinations/vienna", "/destinations/salzburg", "/destinations/salzburg"]);
  assert.equal(map.press("Salzburg", "a"), false);
  assert.equal(map.pushed.length, 3, "other keys do nothing");
  assert.equal(map.marker("Salzburg").popup, undefined, "no popup");
});

test("destinations found at one place share a marker, each reached from its popup, which takes focus as it opens, and Escape closes it and returns focus to the marker", () => {
  const map = mapCanvas();
  const wien = mapped("wien", "Vienna, Austria", VIENNA), theirs = mapped("theirs", "Vienna, shared by Smoke Owner", VIENNA, "Vienna, Vienna, Austria");
  map.render({ destinations: [vienna, wien, theirs, salzburg] });
  map.zoomTo(18);
  assert.deepEqual(map.labels(), ["3 destinations: Vienna; Vienna, Austria; Vienna, shared by Smoke Owner", "Salzburg"], "however far in the map zooms");
  const marker = map.marker("3 destinations: Vienna; Vienna, Austria; Vienna, shared by Smoke Owner");
  assert.deepEqual(copy(marker.position), VIENNA);
  assert.equal(marker.options.title, "Vienna\nVienna, Austria\nVienna, shared by Smoke Owner", "its tooltip names them");
  assert.equal(text(map.drawn(marker.options.icon.html)), "3", "its symbol counts them");
  // Its popup links to each one's page, named as on the map.
  const list = map.drawn(marker.popup);
  assert.equal(list.props["aria-label"], "3 destinations here");
  assert.deepEqual(nodes(list).filter((node) => node.type === "Link").map((link) => [link.props.href, text(link)]),
    [["/destinations/vienna", "Vienna"], ["/destinations/wien", "Vienna, Austria"], ["/destinations/theirs", "Vienna, shared by Smoke Owner"]]);
  assert.equal(marker.popupOptions.maxHeight, 380 - 48 - 32, "a tall popup scrolls within the map");
  // Leaflet opens it on a click, a tap or Enter, so only Space is the map's to handle, and nothing goes to a page.
  assert.equal(map.press(marker.element["aria-label"], "Enter"), false);
  assert.equal(map.press(marker.element["aria-label"], " "), true);
  assert.equal(marker.open, true);
  assert.deepEqual(map.calls.at(-1), ["focus", "first link", { preventScroll: true }]);
  assert.equal(map.press(marker.element["aria-label"], "Escape", true), true);
  assert.equal(marker.open, false);
  assert.deepEqual(map.calls.at(-1), ["focus", marker.element.name, { preventScroll: true }]);
  assert.deepEqual(map.pushed, []);
});

test("destinations whose markers would cover each other at the map's zoom share one, and zooming in sets them apart, drawing them again only when that changes", () => {
  const map = mapCanvas();
  // Framed around Austria, each city has its own marker.
  map.render({ destinations: [graz, salzburg, vienna] });
  assert.deepEqual(map.labels(), ["Graz", "Salzburg", "Vienna"]);
  const drawn = map.redraws();
  // Zoomed out, Graz and Vienna, 23 pixels apart, would cover each other, so they share Graz's marker, and Salzburg, 40
  // pixels from Graz, keeps its own.
  map.zoomTo(4);
  assert.deepEqual(map.labels(), ["2 destinations: Graz; Vienna", "Salzburg"]);
  assert.deepEqual(copy(map.marker("2 destinations: Graz; Vienna").position), GRAZ);
  assert.equal(map.redraws(), drawn + 1);
  // Farther out, every one would.
  map.zoomTo(1);
  assert.deepEqual(map.labels(), ["3 destinations: Graz; Salzburg; Vienna"]);
  // Zooming in again sets them apart, and zooming where nothing changes draws nothing again.
  map.zoomTo(6);
  const apart = map.redraws();
  map.zoomTo(9);
  assert.deepEqual(map.labels(), ["Graz", "Salzburg", "Vienna"]);
  assert.equal(map.redraws(), apart);
  assert.equal(map.calls.filter(([name]) => name === "fitBounds").length, 1, "zooming never frames the map again");

  // A map framed far out, as around destinations on several continents, shares markers from the start.
  const world = mapCanvas();
  world.framedZoom = 1;
  world.render({ destinations: [graz, salzburg, vienna, mapped("portland", "Portland, Oregon", [45.52345, -122.67621], "Portland, Oregon, United States")] });
  assert.deepEqual(world.labels(), ["3 destinations: Graz; Salzburg; Vienna", "Portland, Oregon"]);
});

test("the map frames its destinations when it opens and whenever their positions change, as when the search changes, and nothing else moves it", () => {
  const map = mapCanvas();
  map.render({ destinations: [vienna, salzburg] });
  assert.deepEqual(map.calls, [["fitBounds", [VIENNA, SALZBURG], 11]]);
  // Drawn again with the same positions, as when a search matches the same destinations, the map keeps its zoom and position.
  map.render({ destinations: [{ ...salzburg }, { ...vienna }] });
  assert.equal(map.calls.length, 1);
  map.render({ destinations: [salzburg] });
  assert.deepEqual(map.calls.at(-1), ["fitBounds", [SALZBURG], 11], "a search's one destination, as close as a trip's map frames a place");
  map.render({ destinations: [vienna, salzburg, graz] });
  assert.deepEqual(map.calls.at(-1), ["fitBounds", [VIENNA, SALZBURG, GRAZ], 11]);
  // Closed and reopened, the map frames its destinations again.
  map.unmount();
  map.render({ destinations: [vienna, salzburg, graz] });
  assert.deepEqual(map.calls.map(([name]) => name), ["fitBounds", "fitBounds", "fitBounds", "fitBounds"]);
});

/**
 * The Destinations page as `account` sees it, rendered by the planner from what the store gives `/destinations`, with
 * React's state kept between renders so its search can be typed in. Its map keeps what the page gives it and draws a
 * placeholder in its place.
 */
function destinationsPage(store, account) {
  const slots = [];
  let cursor = 0;
  const element = (type, props) => ({ type, props });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(current) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current };
      return slots[index];
    },
    useId: () => "id-" + cursor++,
    // A transition finishes at once, and effects, which run only in a browser, don't run.
    useTransition: () => [false, (work) => work()],
    useEffect: () => {},
  };
  const maps = [];
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" }, "lucide-react": icons,
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "@/lib/destination-label": destinationLabel, "@/lib/trip-sort": tripSort,
    "@/components/destinations-map": { default: (props) => { maps.push(props); return element("destinations-map", {}); } },
  };
  // Every other module is one the page's list doesn't need: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  const require = (name) => name.endsWith(".module.css") ? styles : modules[name] ?? unused;
  modules["@/components/trip-sharing"] = load("../src/components/trip-sharing.tsx", require);
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", require);
  const { data, access } = store.getDestinationsOverview(account.id);
  const props = { initialData: data, destinationAccess: access, destinationList: true };
  /** An element as the browser has it: host elements with their children rendered, and text, each component rendered in its place. */
  const render = (node) => {
    if (Array.isArray(node)) return node.flatMap(render);
    if (node === null || node === undefined || typeof node === "boolean") return [];
    if (typeof node !== "object") return [String(node)];
    if (typeof node.type === "function") return render(node.type(node.props));
    return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
  };
  const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
  let page;
  const show = () => { cursor = 0; page = render(PlannerApp(props)).flatMap(within); };
  show();
  return {
    maps,
    /** The Saved destinations section's parts, in order: its heading, the map, and the cards or what shows instead. */
    parts: () => [...page.find((node) => node.props.className === "trips-section").props.children].map((child) => child.type === "destinations-map" ? child.type : child.props.className),
    /** The names on the cards shown. */
    cards: () => [...page].filter((node) => node.type === "article").map((card) => text(within(card).find((node) => node.type === "h3"))),
    /** Types in the search. */
    search(value) {
      page.find((node) => node.props["aria-label"] === "Search destinations").props.onChange({ target: { value } });
      show();
    },
  };
}
test("the page shows the map below Saved destinations' heading and search and above the cards, given every destination and those the search shows", (t) => {
  const { store, friend, save, ids } = plan(t);
  save(friend, { type: "destination.create", city: "Vienna" });
  const page = destinationsPage(store, friend);
  assert.deepEqual(page.parts(), ["section-heading", "destinations-map", "trip-grid"]);
  const own = pageDestinations(store, friend).find((item) => item.sharedBy === null).id;
  const given = () => copy(page.maps.at(-1));
  const byId = (list) => list.toSorted((a, b) => a.id.localeCompare(b.id));
  // The shared trip's destinations, named for their owner, and the friend's own, in the cards' order.
  assert.deepEqual(byId(given().destinations), byId([
    { id: ids.salzburg, city: "Salzburg", cityFromSuggestion: false, sharedBy: "owner@example.com" },
    { id: ids.vienna, city: "Vienna", cityFromSuggestion: false, sharedBy: "owner@example.com" },
    { id: own, city: "Vienna", cityFromSuggestion: false, sharedBy: null },
  ]));
  assert.deepEqual(given().destinations.map((item) => item.city), ["Salzburg", "Vienna", "Vienna"]);
  assert.deepEqual(given().shown, given().destinations.map((item) => item.id));
  // Searching for a trip's name, as for a city, shows the same destinations on the cards and the map.
  page.search("salz");
  assert.deepEqual(given().shown, [ids.salzburg]);
  assert.deepEqual(page.cards(), ["Salzburg"]);
  page.search("nowhere");
  assert.deepEqual(given().shown, []);
  assert.deepEqual(page.parts(), ["section-heading", "destinations-map", "empty-state"]);
  page.search("");
  assert.deepEqual(given().shown, given().destinations.map((item) => item.id));
  assert.equal(given().destinations.length, 3, "every destination, whatever the search");
});

test("with no destinations, the page still shows the map, above the empty list", (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const page = destinationsPage(store, store.authorizeAccount("owner@example.com"));
  assert.deepEqual(page.parts(), ["section-heading", "destinations-map", "empty-state home-empty"]);
  assert.deepEqual(copy(page.maps.at(-1)), { destinations: [], shown: [] });
});

test("the map is shorter on phones, its links are easy to select, and those in a popup aren't Leaflet's blue", () => {
  const rules = cssRules("../src/components/destinations-map.module.css");
  const rule = (selector, atRule = null) => rules.find(([shown, , media]) => shown === selector && media === atRule)?.[1] ?? assert.fail(selector);
  assert.equal(rule(".frame").height, "380px");
  assert.equal(rule(".frame", "@media(max-width:540px)").height, "300px");
  assert.equal(rule(".toggle")["min-height"], "44px");
  assert.deepEqual([rule(".unmapped li a")["min-height"], rule(".unmapped li a")["max-width"]], ["32px", "100%"]);
  // Leaflet colors links in the map with `.leaflet-container a`, so the popup's links need a more specific rule.
  const popupLink = rule(".frame .popupList a");
  assert.deepEqual([popupLink.color, popupLink["min-height"]], ["var(--ink)", "32px"]);
});
