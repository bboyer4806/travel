import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as imageLimits from "../src/lib/image-limits.ts";

// TRA-139: Add image by URL, run with a small hook harness that keeps its state between renders, runs its effects after
// each one and their cleanups when they change or their component goes, as React does. No browser is involved.
function load(file, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}
/** A host element's text. */
const text = (node) => node === null || node === undefined || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props.children);
/** Lets the component's awaited download finish, as the browser's event loop would. */
const later = async () => { for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve)); };

/** Travel's answers: an image, an error as the route sends it, or a response a proxy might send instead. */
const image = (bytes = "jpeg bytes", type = "image/jpeg") => ({ ok: true, status: 200, json: async () => { throw new Error("not JSON"); }, blob: async () => new Blob([bytes], { type }) });
const refused = (status, error) => ({ ok: false, status, json: async () => ({ error }), blob: async () => new Blob([JSON.stringify({ error })]) });
const notJson = (status) => ({ ok: false, status, json: async () => { throw new SyntaxError("Unexpected token <"); }, blob: async () => new Blob(["<html>"]) });

/**
 * Add image by URL as a photo editor shows it, labelled `label`. Each download Travel is asked for waits until the test
 * answers it, or until it is stopped. `onAdd` records each file and accepts it unless `accept` says otherwise; `accept`
 * may also turn the field's button off, as an editor whose photos it fills does.
 */
function harness({ label = "Add image by URL", disabled = false, accept = () => true } = {}) {
  const hooks = [], effects = [], focused = [], added = [], downloads = [], objectUrls = [];
  let cursor = 0, nodes = [];
  const element = (type, props, key) => ({ type, props, key });
  // The elements the component holds refs to, the same element from render to render, as the browser's are.
  const domElements = new Map();
  // The field's button sits among its editor's controls, the first of which still on stands for them here.
  const neighbor = { focus() { focused.push("the editor's next control"); } };
  const domElement = (node) => {
    const key = node.props.id ?? (text(node) || node.type);
    if (!domElements.has(key)) domElements.set(key, { focus() { focused.push(text(this.node)); }, parentElement: { querySelector(selector) { assert.equal(selector, "button:not(:disabled)"); return neighbor; } } });
    const dom = domElements.get(key);
    dom.node = node;
    dom.disabled = Boolean(node.props.disabled);
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
      useId: () => "url",
      useEffect(effect, deps) {
        const index = cursor++;
        const previous = hooks[index];
        hooks[index] = { deps, cleanup: previous?.cleanup };
        if (previous === undefined || deps === undefined || deps.some((dep, at) => !Object.is(dep, previous.deps[at]))) {
          effects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = effect(); });
        }
      },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "@/lib/image-limits": imageLimits,
  };
  const require = (name) => {
    // A CSS module's class names are their own names.
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (!(name in modules)) throw new Error("Unexpected component import: " + name);
    return modules[name];
  };
  modules["./focus-after"] = load("../src/components/focus-after.ts", require, { document });
  /** The browser's URL, whose object URLs for previews are recorded, with whether each was revoked. */
  class BrowserURL extends URL {
    static createObjectURL(file) { objectUrls.push({ file, url: `blob:preview-${objectUrls.length + 1}`, revoked: false }); return objectUrls.at(-1).url; }
    static revokeObjectURL(url) { objectUrls.find((entry) => entry.url === url).revoked = true; }
  }
  const fetch = (path, init) => new Promise((resolve, reject) => {
    // Plain objects of this test's own, since those the component makes have its context's prototypes.
    const download = { path, method: init.method, headers: { ...init.headers }, body: JSON.parse(init.body), signal: init.signal, answer: resolve, fail: reject };
    downloads.push(download);
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" })));
  });
  const component = load("../src/components/image-by-url.tsx", require, { URL: BrowserURL, File, AbortController, fetch });
  const { AddImageByUrl } = component;
  let props = { label, disabled, onAdd: (file) => { added.push(file); return accept(file, { disable: () => { props = { ...props, disabled: true }; } }); } };
  /** The host elements an element renders to, rendering each component once, in order, so its hooks keep their places. */
  const hosts = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(hosts);
    if (typeof node.type === "function") return hosts(node.type(node.props));
    if (node.props.ref) node.props.ref.current = domElement(node);
    return [node, ...hosts(node.props.children)];
  };
  let shown = true;
  const render = () => {
    cursor = 0;
    nodes = shown ? hosts({ type: AddImageByUrl, props }) : [];
    // Hooks past the last one used belong to a component no longer shown, the preview: its effects clean up.
    for (const hook of hooks.splice(cursor)) hook?.cleanup?.();
    for (const effect of effects.splice(0)) effect();
  };
  const button = (name) => nodes.find((node) => node.type === "button" && text(node) === name);
  const input = () => nodes.find((node) => node.type === "input");
  render();
  return {
    component, added, downloads, focused, objectUrls, button,
    toggle: () => nodes[1],
    panel: () => nodes.find((node) => node.props.role === "group"),
    input,
    error: () => text(nodes.find((node) => node.props.role === "alert")),
    status: () => text(nodes.find((node) => node.props.role === "status")),
    preview: () => nodes.find((node) => node.type === "img"),
    previewSource: () => domElements.get("img")?.src,
    click(name) { button(name).props.onClick({}); render(); },
    type(value) { input().props.onChange({ currentTarget: { value } }); render(); },
    /** Presses `key` in the address, returning whether the editor's form would still see it. */
    press(key) { let prevented = false; input().props.onKeyDown({ key, preventDefault() { prevented = true; } }); render(); return !prevented; },
    /** Answers the latest download with `response`, or fails it as a dropped connection does, then shows the outcome. */
    async answer(response, download = downloads.at(-1)) {
      if (response === "dropped") download.fail(new TypeError("Failed to fetch"));
      else download.answer(response);
      await later();
      render();
    },
    setDisabled(value) { props = { ...props, disabled: value }; render(); },
    /** The editor closes, taking the field with it. */
    unmount() { shown = false; render(); },
  };
}

test("Add image by URL opens a field for an image's address, which takes focus, without a request until Preview", () => {
  const field = harness();
  assert.deepEqual([field.toggle().type, text(field.toggle()), field.toggle().props["aria-expanded"], field.toggle().props["aria-controls"]], ["button", "Add image by URL", false, undefined]);
  assert.equal(field.panel(), undefined, "the field starts closed");
  field.click("Add image by URL");
  assert.deepEqual([field.toggle().props["aria-expanded"], field.toggle().props["aria-controls"], field.panel().props.id, field.panel().props["aria-label"]], [true, "url-panel", "url-panel", "Add image by URL"]);
  const address = field.input();
  assert.deepEqual([address.props.id, address.props.autoFocus], ["url-address", true], "the address takes focus as it appears");
  assert.deepEqual([address.props.type, address.props.inputMode, address.props.autoComplete, address.props.spellCheck, address.props.placeholder], ["text", "url", "off", false, "https://"]);
  assert.match(text(field.panel()), /The address of the image itself, not of the page it's on: a JPEG, PNG, or WebP image up to 5 MB\. Travel saves its own copy\./);
  assert.equal(field.button("Use this image"), undefined, "nothing to use yet");
  // Previewing nothing asks for an address and asks Travel for nothing.
  field.click("Preview");
  assert.equal(field.error(), "Enter the image's web address.");
  assert.equal(address.props["aria-describedby"], "url-hint");
  assert.equal(field.input().props["aria-describedby"], "url-hint url-error", "the address is described by its error");
  assert.equal(field.downloads.length, 0);
  // Its button closes it again, focusing it.
  field.click("Add image by URL");
  assert.deepEqual([field.panel(), field.focused.at(-1)], [undefined, "Add image by URL"]);
});

test("Preview, or Enter in the address, shows the downloaded image, and Use this image gives it to the editor as a chosen file", async () => {
  const field = harness();
  field.click("Add image by URL");
  field.type("  https://upload.example.org/photos/Eiffel%20Tower.jpg?width=1600  ");
  assert.equal(field.press("a"), true, "other keys are typed as usual");
  assert.equal(field.press("Enter"), false, "Enter previews the image instead of saving the editor");
  const [download] = field.downloads;
  assert.deepEqual([download.path, download.method, download.headers, download.body], ["/api/image-url", "POST", { "Content-Type": "application/json" }, { url: "https://upload.example.org/photos/Eiffel%20Tower.jpg?width=1600" }]);
  assert.equal(field.status(), "Downloading the image…");
  await field.answer(image("jpeg bytes"));
  assert.equal(field.status(), "Check the image, then choose Use this image.", "the status says the image is here");
  assert.deepEqual([field.preview().props.alt, field.previewSource()], ["Preview of the image at this address", "blob:preview-1"]);
  const shown = field.objectUrls[0].file;
  assert.deepEqual([shown.name, shown.type, await shown.text()], ["Eiffel Tower.jpg", "image/jpeg", "jpeg bytes"], "the file is named for its address, as a chosen file has its name");
  assert.deepEqual(field.focused, [], "focus stays where it is, which may be anywhere by the time the image comes");
  field.click("Use this image");
  assert.deepEqual(field.added, [shown], "the editor gets the file previewed");
  assert.equal(field.panel(), undefined, "the field closes once the editor adds it");
  assert.equal(field.focused.at(-1), "Add image by URL");
  assert.equal(field.objectUrls[0].revoked, true, "the preview's object URL is released");
  // Opening it again starts empty.
  field.click("Add image by URL");
  assert.deepEqual([field.input().props.value, field.preview(), field.error()], ["", undefined, ""]);
});

test("an image the editor refuses stays in the field, where Cancel discards it", async () => {
  const field = harness({ accept: () => false });
  field.click("Add image by URL");
  field.type("https://images.example.com/large.png");
  field.click("Preview");
  await field.answer(image("png bytes", "image/png"));
  field.click("Use this image");
  assert.equal(field.added.length, 1);
  assert.ok(field.panel() && field.preview(), "the editor says why; the image stays to cancel");
  field.click("Cancel");
  assert.deepEqual([field.panel(), field.focused.at(-1), field.objectUrls[0].revoked], [undefined, "Add image by URL", true]);
});

test("Travel's refusal shows as it says, and an answer without one, or a dropped connection, says the image couldn't be downloaded", async () => {
  const field = harness();
  field.click("Add image by URL");
  field.type("https://example.com/gallery");
  field.click("Preview");
  await field.answer(refused(422, "This address isn't a JPEG, PNG or WebP image: its server says it is text/html."));
  assert.deepEqual([field.error(), field.preview(), field.button("Use this image"), field.status()], ["This address isn't a JPEG, PNG or WebP image: its server says it is text/html.", undefined, undefined, ""]);
  field.click("Preview");
  assert.equal(field.error(), "", "previewing again clears the error");
  await field.answer(refused(401, "Your session has ended. Sign in again to continue."));
  assert.equal(field.error(), "Your session has ended. Sign in again to continue.");
  for (const answer of [notJson(502), notJson(413), "dropped"]) {
    field.click("Preview");
    await field.answer(answer);
    assert.equal(field.error(), "Travel couldn't download this image. Check your connection and try again.", String(answer.status ?? answer));
  }
  assert.equal(field.downloads.length, 5);
});

test("a changed address, another Preview, Cancel or closing the editor stops a download on its way, whose answer then shows nothing", async () => {
  const field = harness();
  field.click("Add image by URL");
  field.type("https://images.example.com/first.jpg");
  field.click("Preview");
  field.click("Preview");
  const [first, second] = field.downloads;
  assert.deepEqual([first.signal.aborted, second.signal.aborted], [true, false], "the second Preview stops the first");
  await field.answer(image("first"), first);
  assert.equal(field.preview(), undefined, "a stopped download's image never shows");
  await field.answer(image("second"), second);
  assert.equal(await field.objectUrls[0].file.text(), "second");
  // Changing the address forgets the image shown, so the image used is always the address's.
  field.type("https://images.example.com/third.jpg");
  assert.deepEqual([field.preview(), field.button("Use this image"), field.objectUrls[0].revoked], [undefined, undefined, true]);
  field.click("Preview");
  field.type("https://images.example.com/fourth.jpg");
  assert.deepEqual([field.downloads[2].signal.aborted, field.status()], [true, ""], "typing stops the download on its way");
  field.click("Preview");
  field.click("Cancel");
  assert.equal(field.downloads[3].signal.aborted, true, "Cancel stops it");
  field.click("Add image by URL");
  field.type("https://images.example.com/fifth.jpg");
  field.click("Preview");
  field.unmount();
  assert.equal(field.downloads[4].signal.aborted, true, "closing the editor stops it");
});

test("while the editor can't take an image, as while it saves or once its photos are full, Add image by URL and Use this image are unavailable", async () => {
  const field = harness({ label: "Replace image by URL" });
  field.click("Replace image by URL");
  field.type("https://images.example.com/a.webp");
  field.click("Preview");
  await field.answer(image("webp", "image/webp"));
  field.setDisabled(true);
  assert.deepEqual([field.toggle().props.disabled, field.button("Use this image").props.disabled, field.button("Cancel").props.disabled], [true, true, undefined], "Cancel still closes the field");
  field.setDisabled(false);
  assert.deepEqual([field.toggle().props.disabled, field.button("Use this image").props.disabled], [false, false]);
});

test("an image added by URL is named for the last part of its address, or its host", () => {
  const { imageName } = harness().component;
  assert.equal(imageName("https://upload.example.org/wikipedia/commons/a/a8/Tour%20Eiffel.jpg?download=1#top"), "Tour Eiffel.jpg");
  assert.equal(imageName("http://images.example.com/photos/"), "photos");
  assert.equal(imageName("https://images.example.com/"), "images.example.com");
  assert.equal(imageName("https://images.example.com/%E0%A4%A.jpg"), "%E0%A4%A.jpg", "a name that isn't valid percent-encoding shows as written");
});

test("once an image fills the editor's photos, closing the field focuses the editor's next control, as its button turns off", async () => {
  const field = harness({ accept: (file, editor) => { editor.disable(); return true; } });
  field.click("Add image by URL");
  field.type("https://images.example.com/tenth.png");
  field.click("Preview");
  await field.answer(image("png", "image/png"));
  field.click("Use this image");
  assert.deepEqual([field.panel(), field.toggle().props.disabled, field.focused], [undefined, true, ["the editor's next control"]]);
});
