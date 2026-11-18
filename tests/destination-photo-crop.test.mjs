import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as galleryDraft from "../src/lib/gallery-draft.ts";
import * as imageLimits from "../src/lib/image-limits.ts";
import * as photoFocus from "../src/lib/photo-focus.ts";
import * as uuid from "../src/lib/uuid.ts";

const { CENTERED, draggedFocus, objectPosition } = photoFocus;

test("a dragged photo follows the pointer the way it overflows its frame, as far as its edges, the same at any frame size (TRA-53)", () => {
  // A 16:10 photo is taller than the 16:7 frame, so it moves up and down only: 150 pixels of it are hidden in an 800 × 350 frame.
  const photo = { width: 1600, height: 1000 };
  const desktop = { width: 800, height: 350 };
  assert.deepEqual(draggedFocus(CENTERED, 0, 0, desktop, photo), CENTERED);
  assert.deepEqual(draggedFocus(CENTERED, 123, -30, desktop, photo), { focusX: 50, focusY: 70 }, "dragging it up shows more of its bottom, and sideways does nothing");
  assert.deepEqual(draggedFocus(CENTERED, 0, 45, desktop, photo), { focusX: 50, focusY: 20 });
  assert.deepEqual(draggedFocus(CENTERED, 0, 400, desktop, photo), { focusX: 50, focusY: 0 }, "it stops at its top edge");
  assert.deepEqual(draggedFocus(CENTERED, 0, -400, desktop, photo), { focusX: 50, focusY: 100 }, "and at its bottom edge");
  assert.deepEqual(draggedFocus({ focusX: 50, focusY: 20 }, 0, -1, desktop, photo), { focusX: 50, focusY: 20.7 }, "to a tenth of a percent");
  // On a phone, the same drag across the same share of the frame gives the same focal point.
  assert.deepEqual(draggedFocus(CENTERED, 0, -12, { width: 320, height: 140 }, photo), { focusX: 50, focusY: 70 });
  // A panorama wider than 16:7 moves sideways only.
  assert.deepEqual(draggedFocus(CENTERED, -200, 90, desktop, { width: 3200, height: 700 }), { focusX: 75, focusY: 50 });
  // A photo of the frame's own shape has nothing hidden, and doesn't move.
  assert.deepEqual(draggedFocus({ focusX: 30, focusY: 60 }, 80, 80, desktop, { width: 1600, height: 700 }), { focusX: 30, focusY: 60 });
  assert.equal(objectPosition({ focusX: 12.5, focusY: 0 }), "12.5% 0%");
  assert.deepEqual(photoFocus.photoFocus({}), CENTERED, "a new photo is centered");
});

// The destination photo editor, run with a small hook harness that keeps its state between renders, as React does, given
// pointer events as a browser dispatches them for a mouse or a finger. No browser is involved.
function load(file, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}

/** A host element's text. */
const text = (node) => node === null || node === undefined || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props.children);
/** A 16:10 photo, of which the 800 × 350 frame hides 150 pixels, top and bottom together. */
const PHOTO = { width: 1600, height: 1000 };
const FRAME = { width: 800, height: 350 };

/** The photo editor for `destination`'s photos, whose changes replace its draft as the planner's do. */
function harness(destination) {
  const hooks = [];
  let cursor = 0, nodes = [], draft = galleryDraft.createGalleryDraft(destination), disabled = false;
  const changes = [], captured = [];
  const element = (type, props, key) => ({ type, props, key });
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
      useId: () => "photos",
      useEffect() {},
      useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "@/lib/destination-label": destinationLabel, "@/lib/gallery-draft": galleryDraft, "@/lib/image-limits": imageLimits, "@/lib/photo-focus": photoFocus, "@/lib/uuid": uuid,
  };
  const require = (name) => {
    // A CSS module's class names are their own names.
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (!(name in modules)) throw new Error("Unexpected component import: " + name);
    return modules[name];
  };
  modules["./focus-after"] = load("../src/components/focus-after.ts", require);
  modules["./photo-browsing"] = load("../src/components/photo-browsing.tsx", require);
  // A mouse or trackpad, so photos can also be dragged into order.
  const window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
  modules["./photo-drag"] = load("../src/components/photo-drag.ts", require, { window });
  const Editor = load("../src/components/destination-gallery.tsx", require).DestinationGalleryEditor;
  /** The host elements an element renders to, rendering each component once, in order, so its hooks keep their places. */
  const hosts = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(hosts);
    if (typeof node.type === "function") return hosts(node.type(node.props));
    return [node, ...hosts(node.props.children)];
  };
  const render = () => { cursor = 0; nodes = hosts({ type: Editor, props: { destination, draft, disabled, onChange: (next) => { changes.push(next); draft = next; } } }); };
  const byClass = (className) => nodes.filter((node) => String(node.props.className ?? "").split(" ").includes(className));
  const button = (label) => nodes.find((node) => node.type === "button" && (node.props["aria-label"] === label || text(node) === label));
  /** The crop frame, as the browser lays it out: the photo inside, with its size, which the pointer is captured to. */
  const target = (photo, frame) => {
    const image = { naturalWidth: photo.width, naturalHeight: photo.height, getBoundingClientRect: () => ({ ...frame }) };
    return { querySelector(selector) { assert.equal(selector, "img"); return image; }, setPointerCapture(id) { captured.push(id); } };
  };
  render();
  return {
    changes, captured, button,
    draft: () => draft,
    form: () => galleryDraft.galleryForm(draft, destination),
    cards: () => byClass("editPhoto"),
    frame: () => byClass("cropFrame")[0],
    title: () => text(byClass("cropTitle")[0]),
    status: () => text(byClass("status")[0]),
    /** Each photo shown, in order: its ID from its source (none for a new photo before it loads), and where its crop is centered. */
    photos: () => nodes.filter((node) => node.type === "img").map((node) => [node.props.src?.match(/^\/api\/destination-images\/[^/]+\/([^/?]+)/)[1], node.props.style.objectPosition]),
    /** Each photo's source, in order. */
    sources: () => nodes.filter((node) => node.type === "img").map((node) => node.props.src),
    /** A pointer event on the crop frame, for a photo of `photo` size in a frame of `frame` size. */
    pointer(type, fields = {}, photo = PHOTO, frame = FRAME) {
      const handler = { down: "onPointerDown", move: "onPointerMove", up: "onPointerUp", cancel: "onPointerCancel" }[type];
      byClass("cropFrame")[0].props[handler]({ pointerId: 1, clientX: 0, clientY: 0, ...fields, currentTarget: target(photo, frame) });
      render();
    },
    /** Drags the photo in the crop editor from (100, 100) by `dx` and `dy`, then lets go. */
    drag(dx, dy, pointerId = 1) {
      this.pointer("down", { pointerId, clientX: 100, clientY: 100 });
      this.pointer("move", { pointerId, clientX: 100 + dx, clientY: 100 + dy });
      this.pointer("up", { pointerId });
    },
    click(label) { button(label).props.onClick({ currentTarget: {} }); render(); },
    choose(files) { nodes.find((node) => node.type === "input" && node.props.type === "file").props.onChange({ currentTarget: { files, value: "" } }); render(); },
    setDisabled(value) { disabled = value; render(); },
  };
}

/** A saved destination with photos at the given saved focal points, the second one primary when there is one. */
function saved(...points) {
  const images = points.map(([focusX, focusY]) => ({ id: randomUUID(), version: randomUUID(), focusX, focusY }));
  return { id: randomUUID(), city: "Vienna, State of Vienna, Austria", cityFromSuggestion: true, images, mainImageId: (images[1] ?? images[0]).id };
}
const shown = (destination, number, position) => [destination.images[number - 1].id, position];

test("Adjust crop shows a photo in the main photo's shape, moves it as it is dragged, and Apply keeps it as an unsaved change (TRA-53)", () => {
  const destination = saved([50, 50], [50, 50], [30, 60]);
  const [a, b, c] = destination.images.map((image) => image.id);
  const editor = harness(destination);
  assert.deepEqual(editor.photos(), [shown(destination, 1, "50% 50%"), shown(destination, 2, "50% 50%"), shown(destination, 3, "30% 60%")], "each photo's card keeps its focal point in view");
  assert.deepEqual(editor.sources(), destination.images.map((image) => `/api/destination-images/${destination.id}/${image.id}/thumbnail?v=${image.version}`), "each photo's card shows its thumbnail (TRA-89)");
  for (const number of [1, 2, 3]) assert.equal(text(editor.button(`Adjust crop of photo ${number}`)), "Adjust crop", "each photo has Adjust crop");

  editor.click("Adjust crop of photo 2");
  assert.equal(editor.title(), "Adjust crop of photo 2");
  assert.deepEqual([editor.cards().length, editor.button("Add photos"), editor.button("Move photo 1 right")], [0, undefined, undefined], "the crop editor takes the photos' place");
  assert.deepEqual(editor.photos(), [shown(destination, 2, "50% 50%")], "it shows the photo on its focal point");
  assert.deepEqual(editor.sources(), [`/api/destination-images/${destination.id}/${b}?v=${destination.images[1].version}`], "the crop editor shows the photo itself, as large as the main photo (TRA-89)");
  assert.deepEqual(Object.keys(editor.frame().props).toSorted(), ["children", "className", "onPointerCancel", "onPointerDown", "onPointerMove", "onPointerUp"], "the frame can't be dragged into another photo's place");

  editor.pointer("down", { clientX: 100, clientY: 100 });
  assert.deepEqual(editor.captured, [1], "the pointer is captured, so the drag goes on outside the frame");
  editor.pointer("move", { clientX: 160, clientY: 70 });
  assert.deepEqual(editor.photos(), [shown(destination, 2, "50% 70%")], "the photo moves up with the pointer at once, and only the way it overflows the frame");
  editor.pointer("move", { pointerId: 2, clientX: 100, clientY: 400 });
  assert.deepEqual(editor.photos(), [shown(destination, 2, "50% 70%")], "another finger moves nothing");
  editor.pointer("move", { clientX: 100, clientY: 55 });
  assert.deepEqual(editor.photos(), [shown(destination, 2, "50% 80%")], "it moves from where the drag started");
  editor.pointer("up");
  editor.pointer("move", { clientX: 100, clientY: 400 });
  assert.deepEqual(editor.photos(), [shown(destination, 2, "50% 80%")], "letting go ends the drag");
  assert.equal(editor.changes.length, 0, "dragging changes the draft only once applied");

  editor.click("Apply");
  assert.equal(editor.frame(), undefined, "Apply closes the crop editor");
  assert.deepEqual(editor.photos(), [shown(destination, 1, "50% 50%"), shown(destination, 2, "50% 80%"), shown(destination, 3, "30% 60%")]);
  assert.deepEqual([editor.draft().images.map((image) => image.id), editor.draft().mainImageId, editor.draft().removedIds], [[a, b, c], b, []], "it changes no photo's order or the primary photo");
  assert.deepEqual(JSON.parse(editor.form().get("gallery")), { addIds: [], removeIds: [], mainImageId: b, focus: [{ id: b, focusX: 50, focusY: 80 }] }, "saving the destination saves it");
  assert.match(editor.status(), /Photo changes will be applied when you save this destination\./);
  assert.ok(editor.button("Undo photo changes"));
});

test("Reset to center and Cancel change only the crop being adjusted, and the crop editor opens on the applied focal point (TRA-53)", () => {
  const destination = saved([20, 80], [50, 50]);
  const [a] = destination.images.map((image) => image.id);
  const editor = harness(destination);
  editor.click("Adjust crop of photo 1");
  assert.deepEqual(editor.photos(), [shown(destination, 1, "20% 80%")], "it opens on the saved focal point");
  editor.click("Reset to center");
  assert.deepEqual(editor.photos(), [shown(destination, 1, "50% 50%")], "Reset to center shows the photo centered");
  editor.click("Cancel");
  assert.deepEqual([editor.frame(), editor.changes.length, editor.form()], [undefined, 0, undefined], "Cancel discards the crop and changes nothing");
  assert.deepEqual(editor.photos()[0], shown(destination, 1, "20% 80%"));

  editor.click("Adjust crop of photo 1");
  assert.deepEqual(editor.photos(), [shown(destination, 1, "20% 80%")]);
  editor.drag(0, 30);
  editor.click("Apply");
  editor.click("Adjust crop of photo 1");
  assert.deepEqual(editor.photos(), [shown(destination, 1, "20% 60%")], "it opens on the applied focal point");
  editor.drag(0, -60);
  assert.deepEqual(editor.photos(), [shown(destination, 1, "20% 100%")]);
  editor.click("Cancel");
  assert.deepEqual(editor.photos()[0], shown(destination, 1, "20% 60%"), "Cancel keeps the focal point applied before");
  assert.deepEqual(JSON.parse(editor.form().get("gallery")).focus, [{ id: a, focusX: 20, focusY: 60 }]);

  editor.click("Adjust crop of photo 1");
  editor.click("Reset to center");
  editor.click("Apply");
  assert.deepEqual(JSON.parse(editor.form().get("gallery")).focus, [{ id: a, focusX: 50, focusY: 50 }], "an applied reset centers the saved photo when the destination is saved");
  editor.click("Undo photo changes");
  assert.deepEqual([editor.photos()[0], editor.form()], [shown(destination, 1, "20% 80%"), undefined], "Undo photo changes restores the saved focal point");
});

test("photos keep their applied focal points as they are moved and chosen as the primary photo (TRA-53)", () => {
  const destination = saved([50, 50], [50, 50]);
  const [a, b] = destination.images.map((image) => image.id);
  const editor = harness(destination);
  editor.click("Adjust crop of photo 1");
  editor.drag(0, 45);
  editor.click("Apply");
  editor.click("Move photo 1 right");
  assert.deepEqual(editor.photos(), [shown(destination, 2, "50% 50%"), shown(destination, 1, "50% 20%")], "a moved photo keeps its focal point");
  editor.click("Adjust crop of photo 2");
  assert.equal(editor.title(), "Adjust crop of photo 2", "the crop editor names the photo by its place");
  assert.deepEqual(editor.photos(), [shown(destination, 1, "50% 20%")]);
  editor.click("Cancel");
  const sent = JSON.parse(editor.form().get("gallery"));
  assert.deepEqual([sent.order, sent.focus, sent.mainImageId], [[b, a], [{ id: a, focusX: 50, focusY: 20 }], b]);
});

test("a new photo starts centered in the crop editor, and its applied focal point is saved with it (TRA-53)", () => {
  const destination = saved([50, 50]);
  const editor = harness(destination);
  editor.choose([new File(["new photo"], "new.png", { type: "image/png" })]);
  const added = editor.draft().images[1];
  editor.click("Adjust crop of photo 2");
  assert.deepEqual(editor.photos(), [[undefined, "50% 50%"]], "a new photo starts centered");
  // A panorama, wider than the frame, moves sideways.
  editor.pointer("down", { clientX: 100, clientY: 100 }, { width: 3200, height: 700 });
  editor.pointer("move", { clientX: 300, clientY: 100 }, { width: 3200, height: 700 });
  editor.pointer("up");
  editor.click("Apply");
  assert.deepEqual(editor.photos()[1], [undefined, "25% 50%"]);
  const form = editor.form();
  assert.deepEqual(JSON.parse(form.get("gallery")), { addIds: [added.id], removeIds: [], mainImageId: destination.mainImageId, focus: [{ id: added.id, focusX: 25, focusY: 50 }] });
  assert.equal(form.get(`image:${added.id}`), added.file, "the photo itself is sent unchanged");
});

test("while the destination saves, the crop editor's controls are disabled and dragging moves nothing (TRA-53)", () => {
  const destination = saved([50, 50]);
  const editor = harness(destination);
  editor.click("Adjust crop of photo 1");
  editor.setDisabled(true);
  for (const label of ["Reset to center", "Cancel", "Apply"]) assert.equal(editor.button(label).props.disabled, true, `${label} is disabled`);
  editor.drag(0, 30);
  assert.deepEqual([editor.photos(), editor.captured], [[shown(destination, 1, "50% 50%")], []]);
  editor.setDisabled(false);
  editor.drag(0, 30);
  assert.deepEqual(editor.photos(), [shown(destination, 1, "50% 30%")], "after saving fails, the crop can be adjusted again");
});
