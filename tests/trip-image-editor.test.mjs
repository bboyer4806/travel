import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as imageLimits from "../src/lib/image-limits.ts";
import * as photoFocus from "../src/lib/photo-focus.ts";
import * as tripImageDraft from "../src/lib/trip-image-draft.ts";

// TRA-133: the trip editor's headline image, with a crop of its own for the trip's card and for its page's banner.
const { CENTERED, cropStyle, draggedFocus, MAX_PHOTO_ZOOM, UNCROPPED } = photoFocus;
const { createTripImageDraft, tripImageChanged, tripImageForm } = tripImageDraft;

test("zooming in lets a photo be dragged every way it then overflows its frame, as far as its edges", () => {
  // A 16:10 photo in a 3:1 banner of 600 × 200 covers it at 600 × 375, so only 175 pixels are hidden, top and bottom together.
  const photo = { width: 1600, height: 1000 };
  const banner = { width: 600, height: 200 };
  assert.deepEqual(draggedFocus(CENTERED, -60, 35, banner, photo), { focusX: 50, focusY: 30 }, "unzoomed, it moves up and down only");
  assert.deepEqual(draggedFocus(CENTERED, -60, 35, banner, photo, 1), draggedFocus(CENTERED, -60, 35, banner, photo), "a zoom of 1 is the uncropped photo");
  // Zoomed twice, it is 1200 × 750: 600 pixels hidden across and 550 up and down.
  assert.deepEqual(draggedFocus(CENTERED, -60, 55, banner, photo, 2), { focusX: 60, focusY: 40 });
  assert.deepEqual(draggedFocus(CENTERED, 1000, -1000, banner, photo, 2), { focusX: 0, focusY: 100 }, "it stops at its edges");
  // The same drag across the same share of a smaller frame gives the same crop, as on a phone.
  assert.deepEqual(draggedFocus(CENTERED, -30, 27.5, { width: 300, height: 100 }, photo, 2), { focusX: 60, focusY: 40 });
  assert.equal(MAX_PHOTO_ZOOM, 3);
  assert.deepEqual(UNCROPPED, { focusX: 50, focusY: 50, zoom: 1 });
  // The photo is zoomed about its focal point, which object-position puts at the same place in the frame.
  assert.deepEqual(cropStyle({ focusX: 25, focusY: 75.5, zoom: 1.5 }), { objectPosition: "25% 75.5%", transform: "scale(1.5)", transformOrigin: "25% 75.5%" });
  assert.deepEqual(cropStyle(UNCROPPED), { objectPosition: "50% 50%", transform: "scale(1)", transformOrigin: "50% 50%" });
});

const saved = () => ({ version: randomUUID(), card: { focusX: 20, focusY: 80, zoom: 1.5 }, banner: { focusX: 60, focusY: 30, zoom: 2 } });
const file = (name = "trip.jpg", type = "image/jpeg", size = 9) => new File(["x".repeat(size)], name, { type });

test("a trip image draft sends only what changed: a new file with its crops, the saved image's new crops, or its removal", () => {
  const image = saved();
  assert.equal(createTripImageDraft(null), null);
  const draft = createTripImageDraft(image);
  assert.deepEqual(draft, image);
  assert.deepEqual([tripImageChanged(null, null), tripImageChanged(draft, image), tripImageForm(draft, image), tripImageForm(null, null)], [false, false, undefined, undefined]);
  for (const changed of [{ ...draft, card: { ...draft.card, zoom: 2 } }, { ...draft, banner: { ...draft.banner, focusX: 61 } }]) {
    assert.equal(tripImageChanged(changed, image), true);
    const form = tripImageForm(changed, image);
    assert.deepEqual([...form.keys()], ["crops"]);
    assert.deepEqual(JSON.parse(form.get("crops")), { version: image.version, card: changed.card, banner: changed.banner }, "new crops name the image they are for");
  }
  const removal = tripImageForm(null, image);
  assert.deepEqual([...removal.entries()], [["removeImage", "true"]]);
  const added = { file: file(), card: UNCROPPED, banner: { focusX: 10, focusY: 90, zoom: 3 } };
  for (const before of [null, image]) {
    assert.equal(tripImageChanged(added, before), true);
    const form = tripImageForm(added, before);
    assert.deepEqual([...form.keys()], ["image", "crops"]);
    assert.equal(form.get("image").name, "trip.jpg");
    assert.deepEqual(JSON.parse(form.get("crops")), { card: added.card, banner: added.banner }, "a new image's crops name no saved one");
  }
});

// The trip editor's headline image, run with a small hook harness that keeps its state between renders and runs its
// effects after each one, as React does, given events as a browser dispatches them. No browser is involved.
function load(file, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}
/** A host element's text. */
const text = (node) => node === null || node === undefined || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props.children);
/** A 16:10 photo, and the frames the browser lays the previews out in: a 2:1 card and a 3:1 banner. */
const PHOTO = { width: 1600, height: 1000 };
const FRAMES = { card: { width: 320, height: 160 }, banner: { width: 600, height: 200 } };

/** The editor for `trip`'s headline image, whose changes replace its draft as the planner's do. */
function harness(trip) {
  const hooks = [], effects = [], changes = [], captured = [], focused = [];
  let cursor = 0, nodes = [], draft = createTripImageDraft(trip?.image ?? null), disabled = false;
  const element = (type, props, key) => ({ type, props, key });
  // The elements components hold refs to, which stay the same element from render to render, as the browser's do.
  const domElements = new Map();
  const domElement = (node) => {
    const key = node.props.id ?? node.type;
    if (!domElements.has(key)) domElements.set(key, { listeners: {}, clicks: 0, matches: () => false, addEventListener(type, listener) { this.listeners[type] = listener; }, removeEventListener(type) { delete this.listeners[type]; }, click() { this.clicks++; }, focus() { focused.push(text(this.node)); } });
    const dom = domElements.get(key);
    dom.node = node;
    if (node.type === "input" && node.props.type === "range") dom.value = String(node.props.value);
    return dom;
  };
  const document = { activeElement: null, body: {} };
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
      useId: () => "image",
      useEffect(effect, deps) {
        const index = cursor++;
        const previous = hooks[index];
        if (previous === undefined || deps === undefined || deps.some((dep, at) => !Object.is(dep, previous[at]))) effects.push(effect);
        hooks[index] = deps ?? [];
      },
      // An effect event always runs the latest render's function.
      useEffectEvent(callback) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = { latest: callback, call: (...args) => hooks[index].latest(...args) };
        hooks[index].latest = callback;
        return hooks[index].call;
      },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "@/lib/image-limits": imageLimits, "@/lib/photo-focus": photoFocus, "@/lib/trip-image-draft": tripImageDraft,
  };
  const require = (name) => {
    // A CSS module's class names are their own names.
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (!(name in modules)) throw new Error("Unexpected component import: " + name);
    return modules[name];
  };
  modules["./focus-after"] = load("../src/components/focus-after.ts", require, { document });
  const URL = { createObjectURL: (blob) => "blob:" + blob.name, revokeObjectURL() {} };
  const Editor = load("../src/components/trip-image.tsx", require, { URL }).TripImageEditor;
  /** The host elements an element renders to, rendering each component once, in order, so its hooks keep their places. */
  const hosts = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(hosts);
    if (typeof node.type === "function") return hosts(node.type(node.props));
    if (node.props.ref) node.props.ref.current = domElement(node);
    return [node, ...hosts(node.props.children)];
  };
  const render = () => {
    cursor = 0;
    nodes = hosts({ type: Editor, props: { trip, draft, disabled, onChange: (next) => { changes.push(next); draft = next; } } });
    for (const effect of effects.splice(0)) effect();
  };
  const byClass = (className) => nodes.filter((node) => String(node.props.className ?? "").split(" ").includes(className));
  const button = (label) => nodes.find((node) => node.type === "button" && text(node) === label);
  const preview = (frame) => {
    const at = nodes.findIndex((node) => node.props["aria-labelledby"] === `image-${frame}-title`);
    return at < 0 ? undefined : hosts(nodes[at]);
  };
  render();
  return {
    changes, captured, focused, button,
    /** The draft, as plain objects of this test's own, since those the component makes have its context's prototypes. */
    draft: () => draft && { ...draft, card: { ...draft.card }, banner: { ...draft.banner } },
    form: () => tripImageForm(draft, trip?.image ?? null),
    status: () => text(byClass("status")[0]),
    error: () => text(byClass("error")[0]),
    titles: () => byClass("previewTitle").map(text),
    /** Each preview's image as shown: its source, as the browser has it, and its style. */
    image(frame) {
      const image = (preview(frame) ?? []).find((node) => node.type === "img");
      return image && { src: image.props.src ?? domElements.get("img")?.src, alt: image.props.alt, style: image.props.style };
    },
    zoomShown: (frame) => text(nodes.find((node) => node.type === "output" && node.props.htmlFor === `image-${frame}-zoom`)),
    slider: (frame) => nodes.find((node) => node.props.id === `image-${frame}-zoom`),
    /** A pointer event on a preview's frame, for the 16:10 photo in that frame's laid-out size. */
    pointer(frame, type, fields = {}) {
      const handler = { down: "onPointerDown", move: "onPointerMove", up: "onPointerUp", cancel: "onPointerCancel" }[type];
      const image = { naturalWidth: PHOTO.width, naturalHeight: PHOTO.height, offsetWidth: FRAMES[frame].width, offsetHeight: FRAMES[frame].height };
      const currentTarget = { querySelector(selector) { assert.equal(selector, "img"); return image; }, setPointerCapture(id) { captured.push(id); } };
      byClass("frame").find((node) => node.props.className.includes(frame)).props[handler]({ pointerId: 1, clientX: 0, clientY: 0, ...fields, currentTarget });
      render();
    },
    /** Drags a preview's image from (100, 100) by `dx` and `dy`, without letting go. */
    hold(frame, dx, dy) {
      this.pointer(frame, "down", { clientX: 100, clientY: 100 });
      this.pointer(frame, "move", { clientX: 100 + dx, clientY: 100 + dy });
    },
    drag(frame, dx, dy) { this.hold(frame, dx, dy); this.pointer(frame, "up"); },
    /** Moves a preview's zoom slider to `zoom`, and lets it go unless `hold`, when the browser fires its `change`. */
    zoom(frame, zoom, hold = false) {
      this.slider(frame).props.onChange({ currentTarget: { value: String(zoom) } });
      render();
      if (hold) return;
      domElements.get(`image-${frame}-zoom`).listeners.change();
      render();
    },
    click(label) { button(label).props.onClick(); render(); },
    choose(files) {
      const input = nodes.find((node) => node.type === "input" && node.props.type === "file");
      input.props.onChange({ currentTarget: { files, value: "C:\\fakepath\\" + files[0]?.name } });
      render();
    },
    fileInput: () => domElements.get("input"),
    setDisabled(value) { disabled = value; render(); },
  };
}

test("Add image shows the image in a card and a banner preview, each cropped on its own, as an unsaved change", () => {
  const editor = harness({ id: randomUUID(), image: null });
  assert.deepEqual([editor.titles(), editor.button("Remove image"), editor.button("Undo image changes"), editor.status(), editor.form()], [[], undefined, undefined, "", undefined], "a trip without one shows only Add image");
  editor.click("Add image");
  assert.equal(editor.fileInput().clicks, 1, "Add image opens the device's file picker");
  const photo = file();
  editor.choose([photo]);
  assert.deepEqual(editor.draft(), { file: photo, card: UNCROPPED, banner: UNCROPPED }, "a new image starts uncropped");
  assert.deepEqual(editor.titles(), ["Trip card", "Trip page banner"]);
  for (const frame of ["card", "banner"]) assert.deepEqual(editor.image(frame).style, cropStyle(UNCROPPED));
  assert.equal(editor.image("card").src, "blob:trip.jpg", "the preview shows the chosen file itself");
  assert.equal(editor.image("banner").alt, "Headline image as the trip page banner shows it");
  assert.ok(editor.button("Replace image") && editor.button("Remove image"));
  assert.equal(editor.button("Undo image changes"), undefined, "with nothing saved, Remove image is the way back");
  assert.equal(editor.status(), "Image changes will be saved with the trip.");

  // Dragging the card's image shows it moving at once, and puts it in the draft when the drag ends.
  const before = editor.changes.length;
  editor.hold("card", -40, 20);
  assert.deepEqual(editor.captured, [1], "the pointer is captured, so the drag goes on outside the frame");
  // The 16:10 photo covers the 320 × 160 card at 320 × 200, hiding 40 pixels up and down: a drag 20 pixels down shows its top.
  assert.deepEqual(editor.image("card").style, cropStyle({ focusX: 50, focusY: 0, zoom: 1 }));
  assert.equal(editor.changes.length, before, "nothing goes in the draft during the drag");
  editor.pointer("card", "move", { pointerId: 2, clientX: 400, clientY: 400 });
  assert.deepEqual(editor.image("card").style, cropStyle({ focusX: 50, focusY: 0, zoom: 1 }), "another finger moves nothing");
  editor.pointer("card", "up");
  assert.deepEqual(editor.draft().card, { focusX: 50, focusY: 0, zoom: 1 });
  assert.deepEqual(editor.draft().banner, UNCROPPED, "the banner keeps its own crop");

  // The banner's slider zooms it in about its focal point, shown at once and in the draft once let go.
  editor.zoom("banner", 2, true);
  assert.deepEqual([editor.image("banner").style, editor.zoomShown("banner"), editor.slider("banner").props["aria-valuetext"]], [cropStyle({ ...UNCROPPED, zoom: 2 }), "200%", "200%"]);
  assert.deepEqual(editor.draft().banner, UNCROPPED, "nothing goes in the draft while the slider moves");
  editor.zoom("banner", 2);
  assert.deepEqual(editor.draft().banner, { ...UNCROPPED, zoom: 2 });
  assert.deepEqual(editor.draft().card, { focusX: 50, focusY: 0, zoom: 1 }, "the card keeps its own crop");
  // Zoomed in, the 16:10 photo also moves sideways in the 3:1 banner.
  editor.drag("banner", -60, 55);
  assert.deepEqual(editor.draft().banner, { focusX: 60, focusY: 40, zoom: 2 });
  assert.equal(editor.zoomShown("card"), "100%");

  const form = editor.form();
  assert.equal(form.get("image"), photo, "the file itself is sent, for the server to prepare");
  assert.deepEqual(JSON.parse(form.get("crops")), { card: { focusX: 50, focusY: 0, zoom: 1 }, banner: { focusX: 60, focusY: 40, zoom: 2 } });

  editor.click("Remove image");
  assert.deepEqual([editor.draft(), editor.titles(), editor.form(), editor.status()], [null, [], undefined, ""], "removing a new image leaves nothing to save");
  assert.deepEqual(editor.focused, ["Add image"], "focus moves to Add image");
});

test("a saved image can be cropped anew, replaced or removed, and Undo image changes restores it", () => {
  const trip = { id: randomUUID(), image: saved() };
  const editor = harness(trip);
  const src = `/api/trip-images/${trip.id}?v=${trip.image.version}`;
  assert.deepEqual([editor.image("card"), editor.image("banner").style], [{ src, alt: "Headline image as the trip card shows it", style: cropStyle(trip.image.card) }, cropStyle(trip.image.banner)], "each preview shows the saved image with its saved crop");
  assert.deepEqual([editor.zoomShown("card"), editor.zoomShown("banner"), editor.form(), editor.status()], ["150%", "200%", undefined, ""]);

  editor.drag("banner", 0, 0);
  assert.equal(editor.changes.length, 0, "a click without a drag changes nothing");
  editor.zoom("card", 1);
  assert.deepEqual(JSON.parse(editor.form().get("crops")), { version: trip.image.version, card: { ...trip.image.card, zoom: 1 }, banner: trip.image.banner }, "new crops name the saved image");
  assert.ok(editor.button("Undo image changes"));
  editor.click("Undo image changes");
  assert.deepEqual([editor.draft(), editor.form(), editor.focused], [trip.image, undefined, ["Replace image"]]);

  editor.choose([file("other.png", "image/png")]);
  assert.deepEqual([editor.draft().card, editor.draft().banner, editor.image("card").src], [UNCROPPED, UNCROPPED, "blob:other.png"], "a replacement starts uncropped");
  assert.equal(editor.form().get("image").name, "other.png");

  editor.click("Remove image");
  assert.deepEqual([...editor.form().entries()], [["removeImage", "true"]]);
  assert.deepEqual([editor.titles(), editor.status()], [[], "Image changes will be saved with the trip."]);
  assert.ok(editor.button("Add image"));
  editor.click("Undo image changes");
  assert.deepEqual(editor.draft(), trip.image);
});

test("a file that isn't a JPEG, PNG or WebP image up to 5 MB is refused at once, keeping the draft", () => {
  const trip = { id: randomUUID(), image: saved() };
  const editor = harness(trip);
  for (const [refused, message] of [
    [file("trip.gif", "image/gif"), "Choose a JPEG, PNG, or WebP image."],
    [file("trip.png", "image/png", 0), "That image is empty. Choose another image."],
    [file("trip.webp", "image/webp", imageLimits.MAX_IMAGE_UPLOAD_BYTES + 1), "Choose an image up to 5 MB."],
  ]) {
    editor.choose([refused]);
    assert.equal(editor.error(), `${message} Your previous image has been kept.`);
    assert.deepEqual([editor.draft(), editor.changes.length], [trip.image, 0]);
  }
  editor.choose([file("trip.webp", "image/webp", imageLimits.MAX_IMAGE_UPLOAD_BYTES)]);
  assert.equal(editor.error(), "", "an accepted file clears the error");
  const empty = harness({ id: randomUUID(), image: null });
  empty.choose([file("trip.txt", "text/plain")]);
  assert.deepEqual([empty.error(), empty.draft()], ["Choose a JPEG, PNG, or WebP image.", null]);
});

test("while the trip saves, the image's controls are disabled and dragging moves nothing", () => {
  const trip = { id: randomUUID(), image: saved() };
  const editor = harness(trip);
  editor.setDisabled(true);
  for (const label of ["Replace image", "Remove image"]) assert.equal(editor.button(label).props.disabled, true, `${label} is disabled`);
  assert.equal(editor.slider("card").props.disabled, true);
  editor.drag("card", 50, 50);
  assert.deepEqual([editor.captured, editor.changes.length, editor.image("card").style], [[], 0, cropStyle(trip.image.card)]);
  editor.setDisabled(false);
  editor.drag("card", 0, -10);
  assert.notDeepEqual(editor.draft().card, trip.image.card, "after a failed save, the crop can be adjusted again");
});
