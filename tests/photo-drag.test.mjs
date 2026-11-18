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

// TRA-126: the actual photo editors, run with a small hook harness that keeps their state between renders, as React
// does, given drag events as a browser dispatches them. No browser is involved: `matchMedia` says whether the main
// pointer is a mouse or trackpad, or a finger, as on phones and tablets.
function load(file, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}

/** A browser window whose main pointer is a mouse or trackpad (`mouse`), or isn't. */
function browser(mouse) {
  const listeners = new Set();
  return {
    listeners,
    matchMedia(query) {
      assert.equal(query, "(hover: hover) and (pointer: fine)", "photos drag only where the main pointer hovers and points precisely");
      return {
        matches: mouse,
        addEventListener(type, listener) { assert.equal(type, "change"); listeners.add(listener); },
        removeEventListener(type, listener) { assert.equal(type, "change"); listeners.delete(listener); },
      };
    },
  };
}

/** A host element's text. */
const text = (node) => node === null || node === undefined || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props.children);
/** A drag event as a browser dispatches it, recording what the handler does with it. */
function dragEvent(fields = {}) {
  return {
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
    dataTransfer: { effectAllowed: "uninitialized", dropEffect: "none", data: {}, setData(type, value) { this.data[type] = value; } },
    ...fields,
  };
}

/** The editor for an idea's or church's photos, as `subject`. */
const ideaEditor = (subject, name, imageKind) => ({
  file: "candidate-gallery.tsx", name: "CandidateGalleryEditor", owner: "candidate", main: "main", subject, imageKind,
  saved: (images, mainImageId) => ({ id: randomUUID(), name, images, mainImageId }),
});
const editors = {
  destination: {
    file: "destination-gallery.tsx", name: "DestinationGalleryEditor", owner: "destination", main: "primary",
    saved: (images, mainImageId) => ({ id: randomUUID(), city: "Vienna, State of Vienna, Austria", cityFromSuggestion: true, images, mainImageId }),
  },
  hotel: ideaEditor("hotel", "Hotel Sacher"),
  activity: ideaEditor("activity", "Schönbrunn Palace tour"),
  restaurant: ideaEditor("restaurant", "Figlmüller"),
  church: ideaEditor("church", "St. Stephen's Cathedral", "church"),
};

/** A saved destination, hotel or church with `count` photos, the one at `main` (from 1) its primary or main photo. */
function saved(kind, count, main = 1) {
  const images = Array.from({ length: count }, () => ({ id: randomUUID(), version: randomUUID() }));
  return editors[kind].saved(images, images[main - 1]?.id ?? null);
}

/** The photo editor for `kind`, editing `item`'s photos, whose changes replace its draft as the planner's do. */
function harness(kind, item, { mouse = true, disabled = false } = {}) {
  const editor = editors[kind];
  const window = browser(mouse);
  const hooks = [];
  let cursor = 0, nodes = [], draft = galleryDraft.createGalleryDraft(item);
  const changes = [];
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
      useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
        assert.equal(getServerSnapshot(), false, "a page rendered on the server has no draggable photos");
        const unsubscribe = subscribe(() => {});
        assert.equal(window.listeners.size, 1, "it follows the main pointer changing, as when a keyboard with a trackpad attaches");
        unsubscribe();
        assert.equal(window.listeners.size, 0);
        return getSnapshot();
      },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    // Add image by URL (TRA-139), tested in image-by-url.test.mjs, stands in as an element showing what the editor gives it.
    "./image-by-url": { AddImageByUrl: (props) => ({ type: "AddImageByUrl", props }) },
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
  modules["./photo-drag"] = load("../src/components/photo-drag.ts", require, { window });
  const Editor = load(`../src/components/${editor.file}`, require)[editor.name];
  const props = { [editor.owner]: item, subject: editor.subject, imageKind: editor.imageKind, disabled };
  /** The host elements an element renders to, rendering each component once, in order, so its hooks keep their places. */
  const hosts = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(hosts);
    if (typeof node.type === "function") return hosts(node.type(node.props));
    return [node, ...hosts(node.props.children)];
  };
  const render = () => { cursor = 0; nodes = hosts({ type: Editor, props: { ...props, draft, onChange: (next) => { changes.push(next); draft = next; } } }); };
  const byClass = (className) => nodes.filter((node) => String(node.props.className ?? "").split(" ").includes(className));
  const cards = () => byClass("editPhoto");
  const card = (number) => cards()[number - 1];
  /** A photo's picture, which it is dragged by. */
  const picture = (node) => [node.props.children].flat(Infinity).find((child) => child?.props?.className === "preview");
  const button = (label) => nodes.find((node) => node.type === "button" && (node.props["aria-label"] === label || text(node) === label));
  render();
  return {
    changes, cards, picture, button,
    draft: () => draft,
    form: () => galleryDraft.galleryForm(draft, item),
    /** The photos' IDs, in the order the editor shows them. */
    order: () => cards().map((node) => node.key),
    /** Each photo's part in a drag: "dragged", "before" or "after" the photo it would go next to, or none. */
    marks: () => cards().map((node) => node.props["data-drag"]),
    hint: () => text(byClass("hint")[0]),
    status: () => text(byClass("status")[0]),
    start(number) { const event = dragEvent(); picture(card(number)).props.onDragStart(event); render(); return event; },
    over(number) { const event = dragEvent(); card(number).props.onDragOver(event); render(); return event; },
    /** The pointer leaves photo `number`'s card for `inside` it, as its picture, or for outside it. */
    leave(number, inside) { card(number).props.onDragLeave(dragEvent({ currentTarget: { contains: () => inside }, relatedTarget: {} })); render(); },
    drop(number) { const event = dragEvent(); card(number).props.onDrop(event); render(); return event; },
    /** The drag of photo `id` ends: after its drop, or cancelled with Escape or by letting go away from the photos. */
    end(id) { picture(cards().find((node) => node.key === id)).props.onDragEnd(dragEvent()); render(); },
    choose(files) { nodes.find((node) => node.type === "input" && node.props.type === "file").props.onChange({ currentTarget: { files, value: "" } }); render(); },
    click(label) { button(label).props.onClick({ currentTarget: {} }); render(); },
    error: () => text(byClass("error")[0]),
    /** Add image by URL as the editor offers it (TRA-139): its label and whether it is unavailable. */
    byUrl: () => { const { label, disabled } = nodes.find((node) => node.type === "AddImageByUrl").props; return { label, disabled }; },
    /** Uses an image previewed in Add image by URL, returning whether the editor took it. */
    addByUrl(file) { const taken = nodes.find((node) => node.type === "AddImageByUrl").props.onAdd(file); render(); return taken; },
  };
}

for (const kind of Object.keys(editors)) {
  test(`with a mouse or trackpad, a ${kind} photo dragged onto another takes its place at once, keeping the ${editors[kind].main} photo (TRA-126)`, () => {
    const item = saved(kind, 3, 2);
    const [a, b, c] = item.images.map((image) => image.id);
    const editor = harness(kind, item);
    assert.ok(editor.cards().every((node) => editor.picture(node).props.draggable === true), "each photo is dragged by its picture");
    assert.match(editor.hint(), kind === "destination" ? /show first and drag photos or use Move left or Move right to arrange the gallery\./ : /show first and drag photos to arrange them\./);

    const start = editor.start(1);
    assert.equal(start.dataTransfer.effectAllowed, "move");
    assert.deepEqual(start.dataTransfer.data, { "application/x-travel-photo": a }, "it carries no text, so dropping it in a text field changes nothing");
    assert.deepEqual(editor.marks(), ["dragged", undefined, undefined], "the photo being dragged is marked");
    const over = editor.over(3);
    assert.equal(over.defaultPrevented, true, "a photo can be dropped on another");
    assert.equal(over.dataTransfer.dropEffect, "move");
    assert.deepEqual(editor.marks(), ["dragged", undefined, "after"], "the last photo shows the dragged photo going after it");
    editor.leave(3, true);
    assert.deepEqual(editor.marks(), ["dragged", undefined, "after"], "moving over the picture inside a photo's card keeps its mark");
    editor.leave(3, false);
    assert.deepEqual(editor.marks(), ["dragged", undefined, undefined], "leaving the photo removes its mark");
    editor.over(3);
    assert.equal(editor.drop(3).defaultPrevented, true);
    assert.deepEqual(editor.order(), [b, c, a], "the photos show in their new order as soon as it is dropped");
    assert.deepEqual(editor.marks(), [undefined, undefined, undefined]);
    assert.equal(editor.draft().mainImageId, b, `the ${editors[kind].main} photo stays the same photo`);
    assert.deepEqual(editor.draft().removedIds, [], "no photo is removed");
    assert.deepEqual(JSON.parse(editor.form().get("gallery")).order, [b, c, a], "saving sends the new order");
    assert.ok(editor.button("Undo photo changes"), "the new order can be undone before saving");
    assert.match(editor.status(), /Photo changes will be applied when you save this/);
    editor.end(a);
    assert.deepEqual([editor.order(), editor.changes.length], [[b, c, a], 1], "the drag ending after its drop changes nothing more");

    // The last photo dragged onto the first goes before it, here back to the saved order.
    editor.start(3);
    editor.over(1);
    assert.deepEqual(editor.marks(), ["before", undefined, "dragged"]);
    editor.drop(1);
    assert.deepEqual(editor.order(), [a, b, c]);
    assert.equal(editor.form(), undefined, "photos dragged back into the saved order change nothing");
    assert.equal(editor.button("Undo photo changes"), undefined);
  });
}

test("a photo dropped on itself, a drag cancelled, or something else dragged in changes nothing (TRA-126)", () => {
  const item = saved("hotel", 3);
  const order = item.images.map((image) => image.id);
  const editor = harness("hotel", item);
  assert.equal(editor.over(2).defaultPrevented, false, "files or text dragged in from elsewhere aren't taken");
  assert.equal(editor.drop(2).defaultPrevented, false);
  editor.start(2);
  editor.over(2);
  assert.deepEqual(editor.marks(), [undefined, "dragged", undefined], "a photo over its own place shows nowhere to go");
  editor.drop(2);
  editor.start(1);
  editor.over(2);
  assert.deepEqual(editor.marks(), ["dragged", "after", undefined]);
  editor.end(order[0]);
  assert.deepEqual(editor.marks(), [undefined, undefined, undefined], "Escape, or letting go away from the photos, ends the drag");
  assert.deepEqual([editor.order(), editor.changes.length, editor.form()], [order, 0, undefined]);
});

test("new photos are dragged among saved ones before saving, and Undo photo changes restores the saved order (TRA-126)", () => {
  const item = saved("activity", 2);
  const [a, b] = item.images.map((image) => image.id);
  const editor = harness("activity", item);
  editor.choose([new File(["new photo"], "new.png", { type: "image/png" })]);
  const [added] = editor.draft().images.filter((image) => image.file);
  assert.deepEqual(editor.order(), [a, b, added.id]);
  assert.equal(editor.picture(editor.cards()[2]).props.draggable, true, "a new photo drags like a saved one");
  editor.start(3);
  editor.over(1);
  editor.drop(1);
  assert.deepEqual(editor.order(), [added.id, a, b]);
  const sent = JSON.parse(editor.form().get("gallery"));
  assert.deepEqual([sent.addIds, sent.order, sent.mainImageId], [[added.id], [added.id, a, b], a]);
  editor.click("Undo photo changes");
  assert.deepEqual(editor.order(), [a, b], "Undo photo changes restores the saved photos in their saved order");
  assert.equal(editor.form(), undefined);
});

for (const kind of Object.keys(editors)) {
  test(`on phones and tablets, and while saving, ${kind} photos can't be dragged and the editor is unchanged (TRA-126)`, () => {
    for (const options of [{ mouse: false }, { mouse: true, disabled: true }]) {
      const item = saved(kind, 3);
      const [a, b, c] = item.images.map((image) => image.id);
      const editor = harness(kind, item, options);
      for (const node of editor.cards()) {
        const picture = editor.picture(node);
        assert.deepEqual(Object.keys(node.props).toSorted(), ["children", "className"], "a photo's card takes no drops");
        assert.deepEqual(Object.keys(picture.props).toSorted(), ["children", "className"], "a photo's picture isn't draggable");
      }
      if (options.disabled) {
        assert.match(editor.hint(), /drag photos/, "while saving, the hint stays as it was");
        continue;
      }
      assert.equal(editor.hint(), kind === "destination"
        ? "Add up to 10 photos. Choose a primary photo to show first and use Move left or Move right to arrange the gallery.JPEG, PNG, or WebP, up to 5 MB each and 15 MB of new photos per save."
        : "Add up to 10 photos. Choose one main photo to show first.JPEG, PNG, or WebP, up to 5 MB each and 15 MB of new photos per save.");
      if (kind !== "destination") {
        assert.equal(editor.button("Move photo 1 right"), undefined, "idea and church editors keep their controls");
        continue;
      }
      // A destination's Move left and Move right still arrange its photos.
      editor.click("Move photo 1 right");
      assert.deepEqual(editor.order(), [b, a, c]);
      editor.click("Move photo 3 left");
      assert.deepEqual(editor.order(), [b, c, a]);
    }
  });
}

test("a destination's Move left and Move right still arrange photos alongside dragging (TRA-126)", () => {
  const item = saved("destination", 3);
  const [a, b, c] = item.images.map((image) => image.id);
  const editor = harness("destination", item);
  editor.click("Move photo 2 left");
  assert.deepEqual(editor.order(), [b, a, c]);
  editor.start(1);
  editor.over(3);
  editor.drop(3);
  assert.deepEqual(editor.order(), [a, c, b]);
  editor.click("Move photo 3 left");
  assert.deepEqual(editor.order(), [a, b, c]);
  assert.equal(editor.form(), undefined);
});

for (const kind of Object.keys(editors)) {
  test(`a ${kind}'s photo editor offers Add image by URL, whose image it adds as it adds a chosen file (TRA-139)`, () => {
    const item = saved(kind, 2, 2);
    const [a, b] = item.images.map((image) => image.id);
    const editor = harness(kind, item);
    assert.deepEqual(editor.byUrl(), { label: "Add image by URL", disabled: false });
    // A refused image keeps the draft and says why, as a refused file does.
    assert.equal(editor.addByUrl(new File(["gif"], "a.gif", { type: "image/gif" })), false);
    assert.deepEqual([editor.error(), editor.changes.length], ["Choose JPEG, PNG, or WebP photos. Your previous selections have been kept.", 0]);
    const added = new File(["downloaded"], "Tour Eiffel.jpg", { type: "image/jpeg" });
    assert.equal(editor.addByUrl(added), true);
    const photo = editor.draft().images.at(-1);
    assert.deepEqual([editor.order(), photo.file, editor.draft().mainImageId, editor.error()], [[a, b, photo.id], added, b, ""], `it goes last, keeping the ${editors[kind].main} photo`);
    assert.equal(editor.status(), `Photo changes will be applied when you save this ${kind}.`);
    const sent = JSON.parse(editor.form().get("gallery"));
    assert.deepEqual([sent.addIds, editor.form().get(`image:${photo.id}`)], [[photo.id], added], "saving uploads it with the editor's other new photos");
    // It is dragged, chosen as the main photo and removed as every new photo is.
    editor.start(3);
    editor.over(1);
    editor.drop(1);
    assert.deepEqual(editor.order(), [photo.id, a, b]);
    editor.click(`Remove photo 1 (${added.name})`);
    assert.deepEqual(editor.order(), [a, b]);
    assert.equal(editor.form(), undefined, "removing it leaves nothing to save");
  });
}

test("a full gallery offers Add image by URL only once a photo is removed, and refuses more photos than a save takes (TRA-139)", () => {
  const editor = harness("hotel", saved("hotel", imageLimits.MAX_CANDIDATE_IMAGES));
  assert.deepEqual(editor.byUrl(), { label: "Add image by URL", disabled: true });
  assert.equal(editor.addByUrl(new File(["x"], "x.png", { type: "image/png" })), false);
  assert.equal(editor.error(), "Keep up to 10 photos. Remove a photo before adding more. Your previous selections have been kept.");
  editor.click("Remove photo 10");
  assert.deepEqual(editor.byUrl(), { label: "Add image by URL", disabled: false });
  // New photos, chosen or added by URL, share one save's limit.
  const roomy = harness("destination", saved("destination", 1));
  roomy.choose([new File([new Uint8Array(imageLimits.MAX_IMAGE_UPLOAD_BYTES)], "big.jpg", { type: "image/jpeg" }), new File([new Uint8Array(imageLimits.MAX_IMAGE_UPLOAD_BYTES)], "bigger.jpg", { type: "image/jpeg" })]);
  assert.equal(roomy.addByUrl(new File([new Uint8Array(imageLimits.MAX_IMAGE_UPLOAD_BYTES)], "third.jpg", { type: "image/jpeg" })), true, "15 MB of new photos fit");
  assert.equal(roomy.addByUrl(new File(["1"], "fourth.jpg", { type: "image/jpeg" })), false);
  assert.equal(roomy.error(), "Add up to 15 MB of new photos at a time. Save these photos before adding more. Your previous selections have been kept.");
});
