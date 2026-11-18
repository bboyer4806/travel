import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as galleryDraft from "../src/lib/gallery-draft.ts";
import * as imageLimits from "../src/lib/image-limits.ts";
import * as uuid from "../src/lib/uuid.ts";

// TRA-136: the actual Church section, church details and idea gallery, run with a small hook harness that keeps their
// state between renders, as React does, given pointer events as a browser dispatches them. No browser is involved, and
// the harness has no fetch, so a save attempt would fail the test.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}

/** A host element's text. */
const text = (node) => node === null || node === undefined || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props.children);
const hasClass = (node, className) => String(node.props.className ?? "").split(" ").includes(className);
/** The host elements inside a host element, with what the components inside it rendered, in a list of this test's own. */
function inside(node) {
  const walk = (child) => !child || typeof child !== "object" ? [] : Array.isArray(child) ? [...child].flatMap(walk)
    : typeof child.type === "function" ? walk(child.rendered) : [child, ...walk(child.props.children)];
  return walk(node.props.children);
}

/** What `view` returns, given the church components and the idea gallery, rendered again after each change, keeping state. */
function harness(view) {
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
      useRef(initial) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = { current: initial };
        return hooks[index];
      },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    // Add image by URL (TRA-139), tested in image-by-url.test.mjs, stands in as an element showing what the editor gives it.
    "./image-by-url": { AddImageByUrl: (props) => ({ type: "AddImageByUrl", props }) },
    "@/lib/gallery-draft": galleryDraft, "@/lib/image-limits": imageLimits, "@/lib/uuid": uuid,
  };
  const require = (name) => {
    // A CSS module's class names are their own names.
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (!(name in modules)) throw new Error("Unexpected component import: " + name);
    return modules[name];
  };
  modules["./focus-after"] = load("../src/components/focus-after.ts", require);
  modules["./photo-browsing"] = load("../src/components/photo-browsing.tsx", require);
  modules["./photo-drag"] = load("../src/components/photo-drag.ts", require);
  modules["./candidate-gallery"] = load("../src/components/candidate-gallery.tsx", require);
  const components = { ...load("../src/components/churches.tsx", require), CandidateGallery: modules["./candidate-gallery"].CandidateGallery };
  /** The host elements an element renders to, rendering each component once, in order, so its hooks keep their places. Each component's element keeps what it rendered. */
  const hosts = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(hosts);
    if (typeof node.type === "function") return hosts(node.rendered = node.type(node.props));
    return [node, ...hosts(node.props.children)];
  };
  const render = () => { cursor = 0; nodes = hosts(view(components)); };
  render();
  return { nodes: () => nodes, render };
}

/** A pointer event on a gallery's main photo: one finger, unless `fields` say otherwise. */
const pointer = (x, y, fields = {}) => ({ pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, ...fields });

/** The `number`th gallery `ui` shows (from 1): its parts, the photo it shows, and browsing it. */
function gallery(ui, number = 1) {
  const parts = () => {
    const group = ui.nodes().filter((node) => hasClass(node, "gallery"))[number - 1];
    const contents = inside(group);
    const byClass = (className) => contents.filter((node) => hasClass(node, className));
    return { group, contents, byClass, hero: byClass("hero")[0], thumbnails: byClass("thumbnail"), arrow: (direction) => byClass(direction).find((node) => node.type === "button") };
  };
  /** Dispatches pointer events to the main photo's frame, each a handler's name and its event, then renders. */
  const dispatch = (...events) => {
    for (const [handler, event] of events) parts().hero.props[handler](event);
    ui.render();
  };
  return {
    parts,
    dispatch,
    /** The photo shown: its number in its alt text, its ID from its address, the counter, the pressed thumbnail, and whether it is marked main. */
    shown() {
      const { contents, byClass, thumbnails } = parts();
      const image = contents.find((node) => node.type === "img");
      return {
        alt: image.props.alt,
        id: image.props.src.split("?")[0].split("/").at(-1),
        count: text(byClass("count")[0]),
        pressed: thumbnails.flatMap((thumbnail, index) => thumbnail.props["aria-pressed"] ? [index + 1] : []),
        main: byClass("mainBadge").length === 1,
      };
    },
    press(direction) { parts().arrow(direction).props.onClick(); ui.render(); },
    view(photo) { parts().thumbnails[photo - 1].props.onClick(); ui.render(); },
    /** Moves `type` across the main photo, `across` pixels to the right (or left, below 0) and `down` pixels down, then lifts it. */
    swipe(across, { down = 0, type = "touch" } = {}) {
      dispatch(["onPointerDown", pointer(200, 100, { pointerType: type })], ["onPointerUp", pointer(200 + across, 100 + down, { pointerType: type })]);
    },
  };
}

/** A saved church named `name` with `count` photos, the one at `main` (from 1) its main photo. Church photos have no focal point. */
function savedChurch(count, main = 1, name = "St. Stephen's Cathedral") {
  const images = Array.from({ length: count }, () => ({ id: randomUUID(), version: randomUUID() }));
  return { id: randomUUID(), destinationId: randomUUID(), name, address: "Stephansplatz 3, Vienna", denomination: "Roman Catholic", url: "https://example.com/stephansdom", massTimes: [{ id: randomUUID(), day: "Sunday", time: "10:15 AM" }], images, mainImageId: images[main - 1]?.id ?? null };
}

/** What a gallery of `owner`'s photos shows on photo `number` (from 1). */
function photo(owner, number) {
  const { images, mainImageId } = owner;
  const several = images.length > 1;
  return { alt: `${owner.name}, photo ${number}`, id: images[number - 1].id, count: several ? `${number} / ${images.length}` : "", pressed: several ? [number] : [], main: images[number - 1].id === mainImageId };
}

/** A destination's Church section listing `churches`, as its card and Church page show it, recording what its controls ask for in `calls`. */
const section = (churches, calls = []) => ({ ChurchOptions }) => ({ type: ChurchOptions, props: { items: churches, headingLevel: 5, busy: false, onAdd: () => calls.push(["add"]), onEdit: (item) => calls.push(["edit", item.id]), onDelete: (item) => calls.push(["delete", item.id]) } });
/** A church's details, as its marker on the destination map opens them (TRA-130). */
const details = (church) => ({ ChurchDetails }) => ({ type: ChurchDetails, props: { item: church } });

test("a church without photos keeps its card and details as they were, with no gallery or empty frame (TRA-136)", () => {
  const church = savedChurch(0);
  const card = harness(section([church])).nodes();
  assert.deepEqual(card.filter((node) => node.type === "img" || hasClass(node, "gallery") || hasClass(node, "hero")), [], "no photo, gallery or frame");
  assert.deepEqual(card.filter((node) => node.type === "button").map((node) => node.props["aria-label"]), ["Edit St. Stephen's Cathedral", "Delete St. Stephen's Cathedral"], "only the card's own controls");
  const sheet = harness(details(church)).nodes();
  const photos = sheet.findIndex((node) => node.type === "dt" && text(node) === "Church photos");
  assert.deepEqual([sheet[photos + 1].type, text(sheet[photos + 1])], ["dd", "Not added"]);
});

test("a church with one photo shows it as before, on its card and in its details, with no arrows, thumbnails, counter or swiping (TRA-136)", () => {
  const church = savedChurch(1);
  for (const view of [section([church]), details(church)]) {
    const photos = gallery(harness(view));
    const { group, contents, hero } = photos.parts();
    assert.deepEqual([group.props.role, group.props["aria-label"]], ["group", "Photos of St. Stephen's Cathedral"]);
    assert.deepEqual(contents.filter((node) => node.type === "button"), [], "no arrows or thumbnails");
    assert.deepEqual(photos.shown(), photo(church, 1));
    assert.deepEqual(Object.keys(hero.props).sort(), ["children", "className"], "the main photo has no swiping, and the browser handles every touch on it, as before");
  }
});

test("a church with two or more photos has Previous and Next on its main photo, named for the church, before its thumbnails (TRA-136)", () => {
  for (const count of [2, 3, 10]) {
    const photos = gallery(harness(section([savedChurch(count)])));
    const { contents, hero, thumbnails, arrow } = photos.parts();
    const [previous, next] = [arrow("previous"), arrow("next")];
    assert.deepEqual([previous.props.type, previous.props.className, previous.props["aria-label"]], ["button", "arrow previous", "Previous photo of St. Stephen's Cathedral"]);
    assert.deepEqual([next.props.type, next.props.className, next.props["aria-label"]], ["button", "arrow next", "Next photo of St. Stephen's Cathedral"]);
    assert.deepEqual([previous.props.children.type, previous.props.children.props["aria-hidden"]], ["icon:ChevronLeft", "true"], "each arrow is named by its label alone");
    assert.deepEqual([next.props.children.type, next.props.children.props["aria-hidden"]], ["icon:ChevronRight", "true"]);
    assert.ok(inside(hero).includes(previous) && inside(hero).includes(next), "both arrows are on the main photo");
    assert.ok(contents.indexOf(previous) < contents.indexOf(next) && contents.indexOf(next) < contents.indexOf(thumbnails[0]), "keyboard focus reaches Previous, then Next, then the thumbnails");
    assert.deepEqual(thumbnails.map((thumbnail) => thumbnail.props["aria-label"]), Array.from({ length: count }, (_, index) => `View photo ${index + 1} of St. Stephen's Cathedral${index === 0 ? " (main photo)" : ""}`));
    assert.deepEqual({ ...hero.props.style }, { touchAction: "pan-y pinch-zoom" }, "sideways moves on the main photo swipe, while the page still scrolls up and down and zooms");
  }
});

test("Previous and Next step through a church's photos in saved order and loop, keeping the counter, thumbnails and Main photo in step (TRA-136)", () => {
  const church = savedChurch(3, 2);
  const saved = structuredClone(church);
  const calls = [];
  const photos = gallery(harness(section([church], calls)));
  assert.deepEqual(photos.shown(), photo(church, 2), "the gallery opens on its main photo");
  for (const [direction, number] of [["next", 3], ["next", 1], ["next", 2], ["previous", 1], ["previous", 3], ["previous", 2]]) {
    photos.press(direction);
    assert.deepEqual(photos.shown(), photo(church, number), `${direction} shows photo ${number}`);
  }
  // Thumbnails still choose a photo, and the arrows continue from it.
  photos.view(1);
  assert.deepEqual(photos.shown(), photo(church, 1));
  photos.press("previous");
  assert.deepEqual(photos.shown(), photo(church, 3));
  const pair = savedChurch(2);
  const two = gallery(harness(section([pair])));
  for (const [direction, number] of [["next", 2], ["next", 1], ["previous", 2], ["previous", 1]]) {
    two.press(direction);
    assert.deepEqual(two.shown(), photo(pair, number), `with two photos, ${direction} shows photo ${number}`);
  }
  assert.deepEqual(church, saved, "browsing changes no photo, their order, the main photo or any other church detail");
  assert.deepEqual(calls, [], "browsing opens no editor and deletes nothing");
});

test("swiping a church's main photo to the left shows the next photo and to the right the previous, looping as the arrows do (TRA-136)", () => {
  const church = savedChurch(3, 2);
  const saved = structuredClone(church);
  const calls = [];
  const photos = gallery(harness(section([church], calls)));
  for (const [across, number] of [[-80, 3], [-80, 1], [120, 3], [40, 2], [-40, 3]]) {
    photos.swipe(across);
    assert.deepEqual(photos.shown(), photo(church, number), `a ${across} pixel swipe shows photo ${number}`);
  }
  photos.swipe(-90, { down: 30 });
  assert.deepEqual(photos.shown(), photo(church, 1), "a swipe more sideways than down counts");
  photos.swipe(90, { type: "pen" });
  assert.deepEqual(photos.shown(), photo(church, 3), "a pen swipes as a finger does");
  // Thumbnails and arrows continue from the photo a swipe shows, and swipes from theirs.
  photos.press("next");
  photos.swipe(-80);
  assert.deepEqual(photos.shown(), photo(church, 2));
  assert.deepEqual(church, saved, "swiping changes no photo, their order, the main photo or any other church detail");
  assert.deepEqual(calls, [], "swiping opens no editor and deletes nothing");
});

test("a church's main photo doesn't swipe for a short or mostly vertical move, a mouse, a second finger, or a touch the browser takes (TRA-136)", () => {
  const church = savedChurch(3);
  const photos = gallery(harness(section([church])));
  photos.swipe(-39);
  photos.swipe(39);
  photos.swipe(-60, { down: 90 });
  photos.swipe(60, { down: -60 });
  photos.swipe(-200, { type: "mouse" });
  // The browser took the touch to scroll or zoom the page.
  photos.dispatch(["onPointerDown", pointer(200, 100)], ["onPointerCancel", pointer(150, 100)], ["onPointerUp", pointer(100, 100)]);
  // A second finger touched, as for a pinch.
  const second = { pointerId: 2, isPrimary: false };
  photos.dispatch(["onPointerDown", pointer(200, 100)], ["onPointerDown", pointer(260, 100, second)], ["onPointerUp", pointer(100, 100)], ["onPointerUp", pointer(160, 100, second)]);
  assert.deepEqual(photos.shown(), photo(church, 1), "the main photo still shows the photo it opened on");
});

test("each church's photos browse on their own (TRA-136)", () => {
  const first = savedChurch(3), second = savedChurch(2, 2, "Votivkirche");
  const ui = harness(section([first, second]));
  gallery(ui, 1).press("next");
  gallery(ui, 2).swipe(-80);
  assert.deepEqual(gallery(ui, 1).shown(), photo(first, 2));
  assert.deepEqual(gallery(ui, 2).shown(), photo(second, 1));
  assert.equal(gallery(ui, 2).parts().arrow("next").props["aria-label"], "Next photo of Votivkirche");
});

test("a church's details, from its destination's map, browse its photos the same way (TRA-136)", () => {
  const church = savedChurch(3);
  const photos = gallery(harness(details(church)));
  assert.deepEqual(photos.shown(), photo(church, 1));
  assert.equal(photos.parts().arrow("previous").props["aria-label"], "Previous photo of St. Stephen's Cathedral");
  photos.press("previous");
  assert.deepEqual(photos.shown(), photo(church, 3));
  photos.swipe(-80);
  assert.deepEqual(photos.shown(), photo(church, 1));
});

test("hotel, activity and restaurant galleries keep their thumbnails, with no arrows or swiping (TRA-136)", () => {
  const idea = { ...savedChurch(3), name: "Hotel Sacher" };
  const photos = gallery(harness(({ CandidateGallery }) => ({ type: CandidateGallery, props: { candidate: idea } })));
  const { byClass, hero } = photos.parts();
  assert.deepEqual(byClass("arrow"), [], "no arrows");
  assert.deepEqual(Object.keys(hero.props).sort(), ["children", "className"], "no swiping");
  photos.view(3);
  assert.deepEqual(photos.shown(), photo(idea, 3), "thumbnails choose the photo shown, as before");
  assert.match(photos.parts().contents.find((node) => node.type === "img").props.src, /^\/api\/candidate-images\//);
});
