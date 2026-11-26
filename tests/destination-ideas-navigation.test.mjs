import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as coordinates from "../src/lib/coordinates.ts";
import * as estimatedTime from "../src/lib/estimated-time.ts";
import * as galleryDraft from "../src/lib/gallery-draft.ts";
import * as imageLimits from "../src/lib/image-limits.ts";
import * as photoSizes from "../src/lib/photo-sizes.ts";
import * as money from "../src/lib/money.ts";
import * as types from "../src/lib/types.ts";
import * as uuid from "../src/lib/uuid.ts";

// TRA-127: a destination's actual idea carousels, run with a small hook harness that keeps state and refs between renders
// and runs effects after them, as React does. Each carousel's list is a stand-in that scrolls at once, without smooth
// scrolling or snapping, and a stand-in ResizeObserver measures it when a test says the browser would. No browser is involved.
function load(file, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}

/** How wide `cards` are together: 200 pixels each with 14 between, as on wider screens. */
const cardsWidth = (cards) => cards * 200 + (cards - 1) * 14;

/** A carousel's list holding `cards`, `width` pixels wide. It scrolls at once, within its range, and records each scroll the carousel asks for. */
function scroller(cards, width) {
  const listeners = new Set();
  const list = {
    clientWidth: width, scrollWidth: Math.max(width, cardsWidth(cards)), scrollLeft: 0, scrolls: [],
    addEventListener(type, listener) { if (type === "scroll") listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); },
    scrollBy(options) { list.scrolls.push(["scrollBy", { ...options }]); list.move(list.scrollLeft + options.left); },
    scrollTo(options) { list.scrolls.push(["scrollTo", { ...options }]); list.move(options.left); },
    /** Scrolls to `left`, within the list's range, as swiping or scrolling also does, and tells its scroll listeners. */
    move(left) { list.scrollLeft = Math.min(Math.max(left, 0), list.scrollWidth - list.clientWidth); for (const listener of listeners) listener(); },
    resize(newWidth) { list.clientWidth = newWidth; list.scrollWidth = Math.max(newWidth, cardsWidth(cards)); list.move(list.scrollLeft); },
  };
  return list;
}

/**
 * A destination's Hotels, Activities and Restaurants showing `ideas`, or with `churches`, its Churches showing them
 * (TRA-182), with each carousel's list `width` pixels wide.
 */
function harness(ideas, width, churches) {
  const hooks = [];
  const observers = new Set();
  const calls = [];
  let cursor = 0, nodes = [], effects = [];
  const element = (type, props) => ({ type, props });
  const modules = {
    "react": {
      useState(initial) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = { current: initial };
        return hooks[index];
      },
      useId() { return "id" + cursor++; },
      // Runs after a render that changes its dependencies, once that render's refs are set, cleaning up its last run first.
      useEffect(effect, dependencies) {
        const index = cursor++;
        const last = hooks[index];
        if (last && dependencies.every((dependency, at) => Object.is(dependency, last.dependencies[at]))) return;
        effects.push(() => { last?.cleanup?.(); hooks[index] = { dependencies, cleanup: effect() }; });
      },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "next/link": { default: "a" }, "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    // Add image by URL (TRA-139), tested in image-by-url.test.mjs, stands in as an element showing what the editor gives it.
    "./image-by-url": { AddImageByUrl: (props) => ({ type: "AddImageByUrl", props }) },
    "@/lib/coordinates": coordinates, "@/lib/estimated-time": estimatedTime, "@/lib/gallery-draft": galleryDraft, "@/lib/image-limits": imageLimits, "@/lib/photo-sizes": photoSizes, "@/lib/money": money, "@/lib/types": types, "@/lib/uuid": uuid,
  };
  const require = (name) => {
    // A CSS module's class names are their own names.
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (!(name in modules)) throw new Error("Unexpected component import: " + name);
    return modules[name];
  };
  modules["./focus-after"] = load("../src/components/focus-after.ts", require);
  modules["./file-preview"] = load("../src/components/file-preview.ts", require);
  modules["./photo-browsing"] = load("../src/components/photo-browsing.tsx", require);
  modules["./photo-drag"] = load("../src/components/photo-drag.ts", require);
  modules["./candidate-gallery"] = load("../src/components/candidate-gallery.tsx", require);
  modules["./research-links"] = load("../src/components/research-links.tsx", require);
  modules["./restaurant-types"] = load("../src/components/restaurant-types.tsx", require);
  modules["./place-location"] = load("../src/components/place-location.tsx", require);
  class ResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  }
  modules["./destination-ideas"] = load("../src/components/destination-ideas.tsx", require, { ResizeObserver });
  const { DestinationIdeas } = modules["./destination-ideas"];
  const { ChurchSection } = load("../src/components/churches.tsx", require);
  const view = churches ? { type: ChurchSection, props: {
    churches, label: "Vienna", href: "/destinations/vienna/church", hideId: "church-visibility-vienna", busy: false,
    onAdd: () => calls.push(["add", "church"]), onHide: () => calls.push(["hide"]), onView: (item) => calls.push(["view", item.id]), like: () => null,
  } } : { type: DestinationIdeas, props: {
    ideas, city: "Vienna", pages: "/destinations/vienna", busy: false,
    onView: (item) => calls.push(["view", item.id]), onAdd: (category) => calls.push(["add", category]), onBudgetEdit: (category) => calls.push(["budget", category]),
    like: () => null,
  } };
  /** The host elements an element renders to, rendering each component once, in order, so its hooks keep their places. */
  const hosts = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(hosts);
    if (typeof node.type === "function") return hosts(node.type(node.props));
    return [node, ...hosts(node.props.children)];
  };
  /** Renders the sections, gives each new list its stand-in, then runs the effects the render calls for. */
  const render = () => {
    cursor = 0;
    effects = [];
    nodes = hosts(view);
    for (const node of nodes) if (node.type === "ul" && node.props.ref && !node.props.ref.current) node.props.ref.current = scroller([node.props.children].flat().length, width);
    for (const effect of effects) effect();
  };
  /** The carousel of the section named `name`: its Previous arrow, its list and its Next arrow, or nothing without ideas. */
  const carousel = (name) => {
    const start = nodes.findIndex((node) => node.type === "section" && node.props["aria-label"] === name);
    const end = nodes.findIndex((node, index) => index > start && node.type === "section");
    const box = nodes.slice(start, end === -1 ? undefined : end).find((node) => String(node.props.className).split(" ").includes("carousel"));
    if (!box) return undefined;
    const [previous, track, next] = box.props.children;
    return { previous, list: track.props.ref.current, next };
  };
  /** Delivers the browser's measurements to each carousel watching its list's size. */
  const measure = () => { for (const observer of [...observers]) observer.callback([], observer); render(); };
  render();
  return {
    calls, carousel, measure,
    /** The label of each of the carousel's arrows, and whether it is unavailable. */
    arrows(name) { const { previous, next } = carousel(name); return [[previous.props["aria-label"], previous.props.disabled], [next.props["aria-label"], next.props.disabled]]; },
    /** Selects the carousel's Previous or Next arrow. */
    press(name, direction) { carousel(name)[direction].props.onClick(); render(); },
    /** Swipes or scrolls the carousel's list to `left`. */
    swipe(name, left) { carousel(name).list.move(left); render(); },
    /** Resizes every list to `newWidth`, as resizing a window or turning a phone does, and measures them. */
    resize(newWidth) { for (const name of ["Hotels", "Activities", "Restaurants"]) carousel(name)?.list.resize(newWidth); measure(); },
  };
}

/** `count` saved ideas of `category`, none chosen for the budget and without photos, in their saved order. */
const saved = (category, count) => Array.from({ length: count }, (_, position) => ({
  id: randomUUID(), destinationId: "vienna", category, position, mustDo: false, name: `Idea ${position + 1}`, priceCents: null,
  address: "", url: "", notes: "", included: false, links: [], images: [], mainImageId: null, restaurantTypes: [],
}));
const working = (subject) => [["Previous " + subject, false], ["Next " + subject, false]];
const unavailable = (subject) => [["Previous " + subject, true], ["Next " + subject, true]];

test("an idea carousel's arrows wait to be measured, then loop: Next at the end returns to the start and Previous at the start goes to the end (TRA-127)", () => {
  const ideas = saved("hotels", 8);
  const before = structuredClone(ideas);
  const page = harness(ideas, 640);
  assert.deepEqual(page.arrows("Hotels"), unavailable("hotels"), "until the list is measured, neither arrow works");
  page.measure();
  assert.deepEqual(page.arrows("Hotels"), working("hotels"), "at the start, both arrows work");
  const { list } = page.carousel("Hotels");
  const end = cardsWidth(8) - 640;
  // Between the ends, each arrow scrolls the list's width, as before. Each scroll leaves its behavior to the list's CSS,
  // which scrolls smoothly unless people reduce motion.
  for (const [direction, scroll, left] of [
    ["next", ["scrollBy", { left: 640 }], 640], ["next", ["scrollBy", { left: 640 }], end], ["next", ["scrollTo", { left: 0 }], 0],
    ["previous", ["scrollTo", { left: end }], end], ["previous", ["scrollBy", { left: -640 }], end - 640], ["previous", ["scrollBy", { left: -640 }], 0],
    ["previous", ["scrollTo", { left: end }], end],
  ]) {
    const from = list.scrollLeft;
    list.scrolls.length = 0;
    page.press("Hotels", direction);
    assert.deepEqual([list.scrolls, list.scrollLeft], [[scroll], left], `${direction} from ${from}`);
    assert.deepEqual(page.arrows("Hotels"), working("hotels"), `both arrows still work at ${left}`);
  }
  assert.deepEqual(ideas, before, "browsing changes no idea, its order or its selection");
  assert.deepEqual(page.calls, [], "and opens no details or editor");
});

test("swiping or scrolling an idea carousel to either end never loops, and its arrows continue from where it stopped (TRA-127)", () => {
  const page = harness(saved("activities", 8), 640);
  page.measure();
  const { list } = page.carousel("Activities");
  const end = cardsWidth(8) - 640;
  for (const left of [end, 0, end]) page.swipe("Activities", left);
  assert.deepEqual([list.scrolls, list.scrollLeft], [[], end], "reaching either end by swiping or scrolling scrolls nothing more");
  assert.deepEqual(page.arrows("Activities"), working("activities"));
  // A list can stop a fraction of a pixel from either end, which counts as the end.
  for (const [left, direction, scroll] of [
    [end, "previous", ["scrollBy", { left: -640 }]], [end - 0.5, "next", ["scrollTo", { left: 0 }]], [0.5, "previous", ["scrollTo", { left: end }]],
    [300, "next", ["scrollBy", { left: 640 }]], [300, "previous", ["scrollBy", { left: -640 }]],
  ]) {
    page.swipe("Activities", left);
    list.scrolls.length = 0;
    page.press("Activities", direction);
    assert.deepEqual(list.scrolls, [scroll], `${direction} from ${left}`);
  }
});

test("an idea carousel whose cards all fit keeps both arrows unavailable, and resizing it updates them (TRA-127)", () => {
  const empty = harness([], 640);
  empty.measure();
  assert.deepEqual(["Hotels", "Activities", "Restaurants"].map(empty.carousel), [undefined, undefined, undefined], "a section without ideas has no carousel");
  // One card, three that exactly fit, and three a pixel over, which is rounding.
  for (const [count, width] of [[1, 640], [3, cardsWidth(3)], [3, cardsWidth(3) - 1]]) {
    const page = harness(saved("restaurants", count), width);
    page.measure();
    assert.deepEqual(page.arrows("Restaurants"), unavailable("restaurants"), `${count} cards fit ${width} pixels`);
  }
  const page = harness(saved("restaurants", 3), 640);
  page.measure();
  page.resize(400);
  assert.deepEqual(page.arrows("Restaurants"), working("restaurants"), "once the cards overflow a narrower list, both arrows work");
  page.press("Restaurants", "next");
  page.press("Restaurants", "next");
  assert.deepEqual(page.carousel("Restaurants").list.scrolls, [["scrollBy", { left: 400 }], ["scrollTo", { left: 0 }]], "to the end, then back to the start");
  page.resize(640);
  assert.deepEqual(page.arrows("Restaurants"), unavailable("restaurants"), "and once they fit again, neither does");
});

test("a destination's Hotels, Activities and Restaurants carousels each loop on their own (TRA-127)", () => {
  const page = harness([...saved("hotels", 8), ...saved("activities", 5), ...saved("restaurants", 12)], 640);
  page.measure();
  for (const name of ["Hotels", "Activities", "Restaurants"]) {
    assert.deepEqual(page.arrows(name), working(name.toLowerCase()));
    page.press(name, "previous");
  }
  assert.deepEqual(["Hotels", "Activities", "Restaurants"].map((name) => page.carousel(name).list.scrolls), [8, 5, 12].map((cards) => [["scrollTo", { left: cardsWidth(cards) - 640 }]]),
    "each Previous went from the start of its own list to its end");
});

/** `count` saved churches of a destination, without photos. */
const savedChurches = (count) => Array.from({ length: count }, (_, position) => ({
  id: randomUUID(), destinationId: "vienna", name: `Church ${position + 1}`, address: "", denomination: "", url: "", massTimes: [], images: [], mainImageId: null, coordinates: null,
}));

test("a destination's Churches carousel loops as its ideas' carousels do, and swiping or scrolling stops at either end (TRA-182)", () => {
  const churches = savedChurches(8);
  const before = structuredClone(churches);
  const page = harness([], 640, churches);
  const section = "Churches in Vienna";
  assert.deepEqual(page.arrows(section), unavailable("churches"), "until the list is measured, neither arrow works");
  page.measure();
  assert.deepEqual(page.arrows(section), working("churches"), "at the start, both arrows work");
  const { list } = page.carousel(section);
  const end = cardsWidth(8) - 640;
  for (const [direction, scroll, left] of [
    ["next", ["scrollBy", { left: 640 }], 640], ["next", ["scrollBy", { left: 640 }], end], ["next", ["scrollTo", { left: 0 }], 0],
    ["previous", ["scrollTo", { left: end }], end], ["previous", ["scrollBy", { left: -640 }], end - 640],
  ]) {
    const from = list.scrollLeft;
    list.scrolls.length = 0;
    page.press(section, direction);
    assert.deepEqual([list.scrolls, list.scrollLeft], [[scroll], left], `${direction} from ${from}`);
    assert.deepEqual(page.arrows(section), working("churches"), `both arrows still work at ${left}`);
  }
  list.scrolls.length = 0;
  for (const left of [0, end]) page.swipe(section, left);
  assert.deepEqual([list.scrolls, list.scrollLeft], [[], end], "swiping or scrolling to either end scrolls nothing more");
  assert.deepEqual(churches, before, "browsing changes no church or its order");
  assert.deepEqual(page.calls, [], "and opens no details");
  const few = harness([], 640, savedChurches(2));
  few.measure();
  assert.deepEqual(few.arrows(section), unavailable("churches"), "churches that all fit leave both arrows unavailable");
});
