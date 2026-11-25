import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as galleryDraft from "../src/lib/gallery-draft.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as imageLimits from "../src/lib/image-limits.ts";
import * as photoSizes from "../src/lib/photo-sizes.ts";
import * as photoFocus from "../src/lib/photo-focus.ts";
import * as uuid from "../src/lib/uuid.ts";

// TRA-123: the actual destination gallery, run with a small hook harness that keeps its state between renders, as
// React does. No browser is involved, and the harness has no fetch, so a save attempt would fail the test.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}

/** Whether `target` is `node` or inside it, including what the components inside it rendered. */
const contains = (node, target) => node === target || (!!node && typeof node === "object" && [typeof node.type === "function" ? node.rendered : node.props.children].flat(Infinity).some((child) => contains(child, target)));
/** A host element's text. */
const text = (node) => node === null || node === undefined || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props.children);

function harness(destination) {
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
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    // Add image by URL (TRA-139), tested in image-by-url.test.mjs, stands in as an element showing what the editor gives it.
    "./image-by-url": { AddImageByUrl: (props) => ({ type: "AddImageByUrl", props }) },
    "@/lib/gallery-draft": galleryDraft, "@/lib/destination-label": destinationLabel, "@/lib/image-limits": imageLimits, "@/lib/photo-sizes": photoSizes, "@/lib/photo-focus": photoFocus, "@/lib/uuid": uuid,
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
  const { DestinationGallery } = load("../src/components/destination-gallery.tsx", require);
  /**
   * The host elements an element renders to, rendering each component once, in order, so its hooks keep their places.
   * Each component's element keeps what it rendered.
   */
  const hosts = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(hosts);
    if (typeof node.type === "function") return hosts(node.rendered = node.type(node.props));
    return [node, ...hosts(node.props.children)];
  };
  const render = () => { cursor = 0; nodes = hosts({ type: DestinationGallery, props: { destination } }); };
  const byClass = (className) => nodes.filter((node) => String(node.props.className ?? "").split(" ").includes(className));
  const arrow = (direction) => byClass(direction).find((node) => node.type === "button");
  const thumbnails = () => byClass("thumbnail");
  render();
  return {
    arrow,
    hosts: () => nodes,
    /** Where the main photo's crop is centered, and each thumbnail's (TRA-53). */
    positions() {
      const [hero, ...thumbnails] = nodes.filter((node) => node.type === "img");
      return { hero: hero.props.style.objectPosition, thumbnails: thumbnails.map((node) => node.props.style.objectPosition) };
    },
    /** The photo shown: its number in its alt text, its ID from its source, the counter, the pressed thumbnail, and whether it is marked primary. */
    shown() {
      const [hero] = nodes.filter((node) => node.type === "img");
      return {
        alt: hero.props.alt,
        id: hero.props.src.split("/").at(-1).split("?")[0],
        count: text(byClass("count")[0]),
        pressed: thumbnails().flatMap((thumbnail, index) => thumbnail.props["aria-pressed"] ? [index + 1] : []),
        primary: byClass("mainBadge").length === 1,
      };
    },
    press(direction) { arrow(direction).props.onClick(); render(); },
    view(number) { thumbnails()[number - 1].props.onClick(); render(); },
  };
}

/** A saved destination whose city was chosen from a suggestion, with `count` centered photos, the one at `primary` (from 1) primary. */
function savedDestination(count, primary = 1) {
  const images = Array.from({ length: count }, () => ({ id: randomUUID(), version: randomUUID(), focusX: 50, focusY: 50 }));
  return { id: randomUUID(), city: "Vienna, State of Vienna, Austria", cityFromSuggestion: true, images, mainImageId: images[primary - 1]?.id ?? null };
}

/** What a gallery of `destination` shows on photo `number` (from 1). */
function photo(destination, number) {
  const { images, mainImageId } = destination;
  const several = images.length > 1;
  return { alt: `Vienna, Austria, photo ${number}`, id: images[number - 1].id, count: several ? `${number} / ${images.length}` : "", pressed: several ? [number] : [], primary: images[number - 1].id === mainImageId };
}

test("a destination gallery shows Previous and Next over its main photo only with two or more photos (TRA-123)", () => {
  assert.deepEqual(harness(savedDestination(0)).hosts(), [], "a destination without photos shows no gallery");
  const one = savedDestination(1);
  const single = harness(one);
  assert.deepEqual(single.hosts().filter((node) => node.type === "button"), [], "one photo has no arrows or thumbnails");
  assert.deepEqual(single.shown(), photo(one, 1));
  for (const count of [2, 3, 10]) {
    const gallery = harness(savedDestination(count));
    const [previous, next] = [gallery.arrow("previous"), gallery.arrow("next")];
    assert.deepEqual([previous.props.type, previous.props.className, previous.props["aria-label"]], ["button", "arrow previous", "Previous photo of Vienna, Austria"]);
    assert.deepEqual([next.props.type, next.props.className, next.props["aria-label"]], ["button", "arrow next", "Next photo of Vienna, Austria"]);
    assert.deepEqual([previous.props.children.type, previous.props.children.props["aria-hidden"]], ["icon:ChevronLeft", "true"], "each arrow is named by its label alone");
    assert.deepEqual([next.props.children.type, next.props.children.props["aria-hidden"]], ["icon:ChevronRight", "true"]);
    const nodes = gallery.hosts();
    const hero = nodes.find((node) => node.props.className === "hero");
    assert.ok(contains(hero, previous) && contains(hero, next), "both arrows are in the main photo's container");
    assert.ok(nodes.indexOf(previous) < nodes.indexOf(next) && nodes.indexOf(next) < nodes.findIndex((node) => node.props.className === "thumbnails"), "keyboard focus reaches Previous, then Next, then the thumbnails");
  }
});

test("Previous and Next step through the photos in saved order and loop, keeping the counter, thumbnails and Primary photo in step (TRA-123)", () => {
  const destination = savedDestination(3, 2);
  const saved = structuredClone(destination);
  const gallery = harness(destination);
  assert.deepEqual(gallery.shown(), photo(destination, 2), "the gallery opens on its primary photo");
  for (const [direction, number] of [["next", 3], ["next", 1], ["next", 2], ["previous", 1], ["previous", 3], ["previous", 2]]) {
    gallery.press(direction);
    assert.deepEqual(gallery.shown(), photo(destination, number), `${direction} shows photo ${number}`);
  }
  // Thumbnails still choose a photo, and the arrows continue from it.
  gallery.view(1);
  assert.deepEqual(gallery.shown(), photo(destination, 1));
  gallery.press("previous");
  assert.deepEqual(gallery.shown(), photo(destination, 3));
  gallery.view(2);
  gallery.press("next");
  assert.deepEqual(gallery.shown(), photo(destination, 3));
  assert.deepEqual(destination, saved, "browsing changes no photo order, primary photo or other destination detail");
});

test("in a two-photo gallery, Previous and Next each show the other photo (TRA-123)", () => {
  const destination = savedDestination(2);
  const gallery = harness(destination);
  assert.deepEqual(gallery.shown(), photo(destination, 1));
  for (const [direction, number] of [["next", 2], ["next", 1], ["previous", 2], ["previous", 1]]) {
    gallery.press(direction);
    assert.deepEqual(gallery.shown(), photo(destination, number), `${direction} shows photo ${number}`);
  }
});

test("the main photo and thumbnails keep each photo's focal point in view, whichever photo is shown (TRA-53)", () => {
  const destination = savedDestination(3, 2);
  Object.assign(destination.images[0], { focusX: 10, focusY: 90 });
  Object.assign(destination.images[1], { focusX: 50, focusY: 25.5 });
  const gallery = harness(destination);
  const thumbnails = ["10% 90%", "50% 25.5%", "50% 50%"];
  assert.deepEqual(gallery.positions(), { hero: "50% 25.5%", thumbnails }, "the primary photo opens on its focal point");
  for (const [direction, hero] of [["next", "50% 50%"], ["next", "10% 90%"], ["previous", "50% 50%"]]) {
    gallery.press(direction);
    assert.deepEqual(gallery.positions(), { hero, thumbnails }, `${direction} shows the next photo on its own focal point`);
  }
  gallery.view(1);
  assert.deepEqual(gallery.positions(), { hero: "10% 90%", thumbnails });
});
