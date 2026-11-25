import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as coordinates from "../src/lib/coordinates.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as galleryDraft from "../src/lib/gallery-draft.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import * as types from "../src/lib/types.ts";
import * as uuid from "../src/lib/uuid.ts";
import { addDestination, candidateInput, setup } from "./budget-fixtures.mjs";
import { cssRules } from "./css-rules.mjs";

// TRA-160: an activity's details, opened from its destination's Activities carousel or map, step through the
// destination's activities with Previous and Next, or a swipe, without closing, in the order the carousel shows them. So
// does its editor opened from them, which keeps each activity's unsaved changes until they're saved or canceled or the
// dialog closes. Hotels, restaurants and churches are unchanged.

function load(file, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}
const element = (type, props, key) => ({ type, props, key });
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text, screen-reader text included. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");
/** The form data the planner reads from a form: a copy of the stand-in form's fields when it is read, by name. */
class FormData {
  constructor(form) { this.fields = { ...form.fields }; }
  get(name) { return name in this.fields ? this.fields[name] : null; }
  has(name) { return name in this.fields; }
  getAll(name) { return name in this.fields ? [this.fields[name]] : []; }
}

/**
 * A planner page for the trip's owner, with React's state kept between renders, its saves made by the store, and a way
 * to use it. `stopId` and `category` open a destination's idea page instead of the trip's page. Its carousels stand in
 * as a button for each idea, in the order the real carousels show them, and its photo, link and location editors as
 * elements showing what the editor gives them. No browser or server is involved.
 */
function plannerPage(store, tripId, { stopId, category } = {}) {
  const slots = [];
  let cursor = 0;
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
  const icons = new Proxy({}, { get: (_, name) => "icon:" + String(name) });
  // Every other module is one these pages don't need here: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  const require = (modules) => (name) => name.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : modules[name] ?? unused;
  const shared = { react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" }, "lucide-react": icons };
  const ideas = load("../src/components/destination-ideas.tsx", require({ ...shared, "@/lib/money": money }));
  const steps = load("../src/components/activity-steps.tsx", require({ ...shared,
    "./focus-after": load("../src/components/focus-after.ts", require(shared)), "./photo-browsing": load("../src/components/photo-browsing.tsx", require(shared)) }));
  const sent = [];
  const modules = {
    ...shared,
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), unstable_isUnrecognizedActionError: () => false },
    // The page's save, made by the store as the signed-in owner, with each change it sends kept.
    "@/app/actions": { mutatePlanner: async (mutation, imageForm) => { sent.push({ mutation, imageForm }); return { ok: true, ...store.applyMutation(mutation) }; } },
    "@/components/destination-ideas": { ...ideas, DestinationIdeas: ({ ideas: saved, onView, onAdd }) => element("carousels", { children: [
      ...["hotels", "activities", "restaurants"].flatMap((kind) => ideas.carouselOrder(saved.filter((item) => item.category === kind)))
        .map((item) => element("button", { type: "button", onClick: () => onView(item), children: ["View " + item.name] })),
      element("button", { type: "button", onClick: () => onAdd("activities"), children: ["Add activity"] }),
    ] }) },
    "@/components/activity-steps": steps,
    "@/components/candidate-list": { default: (props) => element("candidate-list", props) },
    "@/components/candidate-gallery": { CandidateGalleryEditor: (props) => element("gallery-editor", props) },
    "@/components/research-links": { ResearchLinksEditor: (props) => element("links-editor", props), ResearchLinks: () => null },
    "@/components/place-location": { PlaceLocationFields: (props) => element("place-location", props) },
    "@/lib/budget": budget, "@/lib/coordinates": coordinates, "@/lib/destination-label": destinationLabel, "@/lib/gallery-draft": galleryDraft,
    "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort, "@/lib/types": types, "@/lib/uuid": uuid,
  };
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", require(modules), { FormData });

  // What has been typed into the open editor's fields since its fields were last rendered afresh, by name, as the
  // browser keeps it in each field until React renders new ones in their place.
  let typed = {};
  let fieldsKey;
  let shown;
  /** The fields a form's elements hold: what was typed into each, or what it was rendered with. */
  function fieldsOf(form) {
    const fields = {};
    for (const node of within(form)) {
      if ((node.type !== "input" && node.type !== "textarea") || !node.props.name || node.props.disabled) continue;
      const { name } = node.props;
      if (node.props.type === "checkbox") { if (name in typed ? typed[name] : node.props.defaultChecked) fields[name] = "on"; }
      else fields[name] = name in typed ? typed[name] : node.props.defaultValue ?? "";
    }
    return fields;
  }
  /** An element as the browser has it: host elements with their children rendered, and each component and fragment rendered in its place. */
  function render(node) {
    if (Array.isArray(node)) return [...node].flatMap(render);
    if (node === null || node === undefined || typeof node === "boolean") return [];
    if (typeof node !== "object") return [String(node)];
    if (typeof node.type === "function") {
      // A component's key keys what it renders, which React renders afresh when the key changes.
      const rendered = render(node.type(node.props));
      if (node.key != null && rendered.length === 1 && typeof rendered[0] === "object") rendered[0].key ??= node.key;
      return rendered;
    }
    if (node.type === "fragment") return render(node.props.children);
    const host = { type: node.type, key: node.key, props: { ...node.props, children: render(node.props.children) } };
    // A form's ref is a stand-in form whose fields are what its elements hold when they're read.
    if (host.props.ref) host.props.ref.current = host.type === "form" ? { get fields() { return fieldsOf(host); } } : host;
    return [host];
  }
  let props;
  /** The page as it renders now. It renders twice, as React renders again at once when the page changes its state while rendering. */
  const show = () => {
    for (let pass = 0; pass < 2; pass++) { cursor = 0; shown = render(PlannerApp(props)); }
    // Fields rendered afresh, under a new key, hold only what they were rendered with.
    const body = shown.flatMap(within).find((node) => node.props.className === "form-grid dialog-body");
    if (body?.key !== fieldsKey || !body) typed = {};
    fieldsKey = body?.key;
  };
  /** Loads the page again, as it does after a save. */
  const reload = () => { const { data, access } = store.getTripSnapshot(tripId, stopId); props = { initialData: data, access: { [tripId]: access }, tripId, stopId, category }; show(); };
  reload();
  const all = () => shown.flatMap(within);
  const dialog = () => all().find((node) => node.type === "dialog" && node.props.className === "editor-dialog");
  const page = {
    sent,
    all,
    show,
    reload,
    /** The open dialog's title, or undefined without one. */
    title: () => { const open = dialog(); return open && text(within(open).find((node) => node.type === "h2")); },
    /** A button by its text: in the dialog on top, while one is open, as the page beneath is inert, or on the page. */
    button: (label) => { const top = all().filter((node) => node.type === "dialog").at(-1); return (top ? within(top) : all()).find((node) => node.type === "button" && text(node) === label); },
    /** Previous and Next, with the place between them, or undefined without them. */
    steps: () => {
      const bar = all().find((node) => node.props.className === "steps");
      return bar && { previous: within(bar).find((node) => text(node) === "Previous activity"), next: within(bar).find((node) => text(node) === "Next activity"), place: text(within(bar).find((node) => node.type === "p")), bar };
    },
    /** The open dialog's scrolling body. */
    body: () => within(dialog()).find((node) => typeof node.props.className === "string" && node.props.className.includes("dialog-body")),
    field: (name) => all().find((node) => (node.type === "input" || node.type === "textarea") && node.props.name === name),
    /** What one of the open editor's fields shows: what was typed into it since it was rendered afresh, or what it was rendered with. */
    value: (name) => name in typed ? typed[name] : page.field(name).props.defaultValue,
    /** Whether one of the open editor's checkboxes shows checked. */
    checked: (name) => name in typed ? typed[name] : page.field(name).props.defaultChecked,
    /** An element standing in for the editor's photos, links or location fields, by its type. */
    part: (type) => all().find((node) => node.type === type),
    click(button) { assert.ok(button, "the button is shown"); assert.notEqual(button.props.disabled, true, "the button is enabled"); button.props.onClick({ currentTarget: button }); show(); },
    /** The X at the top of the dialog on top, which closes it. */
    close() { page.click(within(all().filter((node) => node.type === "dialog").at(-1)).find((node) => node.type === "button" && node.props["aria-label"] === "Close")); },
    /** Changes what the editor's photos or links editor holds, as it does on a change. */
    change(type, value) { page.part(type).props.onChange(value); show(); },
    /** Types into one of the open editor's fields, or checks or unchecks a checkbox with true or false. */
    type(name, value) { assert.ok(page.field(name), name + " is shown"); typed[name] = value; },
    /** A sideways or other move across the dialog's body, from `from` to `to` as [x, y], by a pointer of `pointerType`, starting on photos or not. */
    swipe(from, to, { pointerType = "touch", onPhotos = false } = {}) {
      const body = page.body();
      const target = { closest: (selector) => selector === "[data-photos]" && onPhotos ? {} : null };
      body.props.onPointerDown?.({ isPrimary: true, pointerType, pointerId: 7, clientX: from[0], clientY: from[1], target });
      body.props.onPointerUp?.({ pointerId: 7, clientX: to[0], clientY: to[1] });
      show();
    },
    /** Submits the open editor as its fields hold it, waits for its save, and loads the page again. */
    async save() {
      const form = all().find((node) => node.type === "form");
      form.props.onSubmit({ preventDefault() {}, currentTarget: form.props.ref.current });
      await new Promise((resolve) => setImmediate(resolve));
      reload();
    },
  };
  return page;
}

/**
 * Vienna, with four activities in this saved order, two included in the budget, its carousel showing the included ones
 * first: Prater, Schönbrunn, Opera, Belvedere. It also has two hotels and two restaurants, and the trip visits Salzburg,
 * with an activity of its own, and Graz, with only one.
 */
function vienna(t) {
  const { store, tripId } = setup(t);
  const viennaId = addDestination(store, tripId, { city: "Vienna" });
  const salzburg = addDestination(store, tripId, { city: "Salzburg" });
  const graz = addDestination(store, tripId, { city: "Graz" });
  const add = (destinationId, category, name, overrides = {}) => store.applyMutation(candidateInput(destinationId, category, { name, included: false, ...overrides })).id;
  const ids = {
    opera: add(viennaId, "activities", "Opera", { notes: "Standing room", links: [{ id: "c2a7a4f6-6b8e-4c1e-9a52-3f4d2a1b0c9d", url: "https://www.wiener-staatsoper.at", description: "Tickets" }], url: "https://www.wiener-staatsoper.at" }),
    prater: add(viennaId, "activities", "Prater", { included: true }),
    belvedere: add(viennaId, "activities", "Belvedere", { price: "20" }),
    schonbrunn: add(viennaId, "activities", "Schönbrunn", { included: true }),
    hotel: add(viennaId, "hotels", "Hotel Sacher"),
    imperial: add(viennaId, "hotels", "Hotel Imperial"),
    cafe: add(viennaId, "restaurants", "Café Central"),
    figlmuller: add(viennaId, "restaurants", "Figlmüller"),
    mirabell: add(salzburg, "activities", "Mirabell Gardens"),
    schlossberg: add(graz, "activities", "Schlossberg"),
  };
  return { store, tripId, viennaId, ids };
}
const saved = (store, id) => store.getSnapshot().candidates.find((item) => item.id === id);

test("an activity's details step through its destination's activities in the order its carousel shows them, and stop at either end (TRA-160)", (t) => {
  const { store, tripId } = vienna(t);
  const page = plannerPage(store, tripId);
  page.click(page.button("View Opera"));
  assert.equal(page.title(), "Opera");
  assert.equal(page.steps().place, "3 of 4: Opera", "its place, naming it for screen readers");
  page.click(page.steps().previous);
  assert.deepEqual([page.title(), page.steps().place], ["Schönbrunn", "2 of 4: Schönbrunn"]);
  page.click(page.steps().previous);
  assert.deepEqual([page.title(), page.steps().place], ["Prater", "1 of 4: Prater"]);
  assert.deepEqual([page.steps().previous.props.disabled, page.steps().next.props.disabled], [true, false], "Previous is disabled on the first");
  for (const name of ["Schönbrunn", "Opera", "Belvedere"]) { page.click(page.steps().next); assert.equal(page.title(), name); }
  assert.deepEqual([page.steps().place, page.steps().previous.props.disabled, page.steps().next.props.disabled], ["4 of 4: Belvedere", false, true], "Next is disabled on the last");
  // The details show the activity stepped to, and their Edit edits it.
  assert.ok(page.all().some((node) => node.type === "dd" && text(node) === "$20" + "Total for the whole party for this activity."), "Belvedere's price");
  page.click(page.button("Edit"));
  assert.equal(page.value("name"), "Belvedere");
  assert.deepEqual(page.sent, [], "stepping saves nothing");
});

test("Previous and Next are Travel's buttons, named for screen readers, and each activity's details start at the top (TRA-160)", (t) => {
  const { store, tripId, ids } = vienna(t);
  const page = plannerPage(store, tripId);
  page.click(page.button("View Prater"));
  const { previous, next, place, bar } = page.steps();
  for (const button of [previous, next]) assert.deepEqual([button.props.type, button.props.className], ["button", "button secondary small"]);
  assert.deepEqual(previous.props.children.map((child) => typeof child === "string" ? child : [child.type, child.props["aria-hidden"] ?? child.props.className]), [["icon:ChevronLeft", "true"], "Previous", ["span", "sr-only"]]);
  assert.deepEqual(next.props.children.map((child) => typeof child === "string" ? child : [child.type, child.props["aria-hidden"] ?? child.props.className]), ["Next", ["span", "sr-only"], ["icon:ChevronRight", "true"]]);
  assert.equal(within(bar).find((node) => node.type === "p").props["aria-live"], "polite", "screen readers hear each step");
  assert.equal(place, "1 of 4: Prater");
  // The bar comes between the title and the details, which are keyed to the activity, so React renders each one's
  // afresh, scrolled to the top.
  const parts = within(page.all().find((node) => node.type === "dialog")).filter((node) => node.props.className === "dialog-heading" || node.props.className === "steps" || node.props.className === "dialog-body");
  assert.deepEqual(parts.map((node) => node.props.className), ["dialog-heading", "steps", "dialog-body"]);
  assert.equal(page.body().key, ids.prater);
  page.click(page.steps().next);
  assert.equal(page.body().key, ids.schonbrunn);
});

test("swiping an activity's details steps too, but not on its photos, with a mouse, or up and down, and past either end it does nothing (TRA-160)", (t) => {
  const { store, tripId } = vienna(t);
  const page = plannerPage(store, tripId);
  page.click(page.button("View Prater"));
  assert.equal(page.body().props.style.touchAction, "pan-y pinch-zoom", "the page still scrolls up and down and zooms");
  page.swipe([300, 200], [200, 210]);
  assert.equal(page.title(), "Schönbrunn", "to the left, the next");
  page.swipe([200, 200], [300, 190]);
  assert.equal(page.title(), "Prater", "to the right, the previous");
  page.swipe([200, 200], [300, 190]);
  assert.equal(page.title(), "Prater", "nothing before the first");
  for (const [from, to, options, why] of [
    [[300, 200], [200, 210], { onPhotos: true }, "a swipe on its photos is theirs"],
    [[300, 200], [200, 210], { pointerType: "mouse" }, "a mouse doesn't swipe"],
    [[300, 200], [250, 300], {}, "a move more down than across scrolls"],
    [[300, 200], [270, 200], {}, "a short move isn't a swipe"],
  ]) { page.swipe(from, to, options); assert.equal(page.title(), "Prater", why); }
  for (let step = 0; step < 3; step++) page.swipe([300, 200], [200, 200]);
  assert.equal(page.title(), "Belvedere");
  page.swipe([300, 200], [200, 200]);
  assert.equal(page.title(), "Belvedere", "nothing after the last");
  assert.deepEqual(page.sent, []);
});

test("hotels', restaurants' and other destinations' details step only where there is more than one activity (TRA-160)", (t) => {
  const { store, tripId } = vienna(t);
  const page = plannerPage(store, tripId);
  for (const name of ["Hotel Sacher", "Café Central", "Schlossberg"]) {
    page.click(page.button("View " + name));
    assert.equal(page.title(), name);
    assert.equal(page.steps(), undefined, name + " has no Previous or Next");
    assert.deepEqual([page.body().props.onPointerDown, page.body().props.style], [undefined, undefined], name + " doesn't swipe");
    page.click(page.button("Close"));
  }
  // Salzburg has two activities, its own; Vienna's aren't among them.
  store.applyMutation(candidateInput(store.getTripSnapshot(tripId).data.candidates.find((item) => item.name === "Mirabell Gardens").destinationId, "activities", { name: "Hohensalzburg", included: false }));
  const salzburg = plannerPage(store, tripId);
  salzburg.click(salzburg.button("View Mirabell Gardens"));
  assert.equal(salzburg.steps().place, "1 of 2: Mirabell Gardens");
  salzburg.click(salzburg.steps().next);
  assert.equal(salzburg.title(), "Hohensalzburg");
  assert.equal(salzburg.steps().next.props.disabled, true);
});

test("an activity's editor opened from its details steps too, keeping each activity's unsaved changes, and saves only the one saved (TRA-160)", async (t) => {
  const { store, tripId, ids } = vienna(t);
  const page = plannerPage(store, tripId);
  page.click(page.button("View Belvedere"));
  page.click(page.button("Edit"));
  assert.deepEqual([page.title(), page.steps().place], ["Edit activity", "4 of 4: Belvedere"]);
  page.type("name", "Upper Belvedere");
  page.type("notes", "The Kiss");
  page.type("mustDo", true);
  const link = { id: "0b8f0e9e-2b0c-4c7a-8d1f-6e5a4b3c2d1e", url: "https://www.belvedere.at", description: "Tickets" };
  page.change("links-editor", [link]);
  const photo = new File(["photo"], "kiss.png", { type: "image/png" });
  const photos = { images: [{ id: "4e0f7c2a-9d3b-4a8e-b1c6-5f2e7d9a0b3c", file: photo }], removedIds: [], mainImageId: "4e0f7c2a-9d3b-4a8e-b1c6-5f2e7d9a0b3c" };
  page.change("gallery-editor", photos);
  page.click(page.steps().previous);

  // Opera's editor shows Opera as saved.
  assert.deepEqual([page.title(), page.steps().place], ["Edit activity", "3 of 4: Opera"]);
  assert.deepEqual(["name", "notes", "price"].map(page.value), ["Opera", "Standing room", "12.25"]);
  assert.equal(page.checked("mustDo"), false);
  assert.deepEqual(page.part("links-editor").props.links, saved(store, ids.opera).links);
  assert.deepEqual(page.part("gallery-editor").props.draft, galleryDraft.createGalleryDraft(saved(store, ids.opera)));
  assert.equal(page.part("place-location").props.draft, undefined);
  page.type("price", "45");

  // Belvedere's comes back as it was left, photos and links included.
  page.click(page.steps().next);
  assert.deepEqual(["name", "notes", "price"].map(page.value), ["Upper Belvedere", "The Kiss", "20.00"]);
  assert.deepEqual([page.checked("mustDo"), page.checked("included")], [true, false]);
  assert.deepEqual(page.part("links-editor").props.links, [link]);
  assert.equal(page.part("gallery-editor").props.draft, photos);
  assert.deepEqual([page.part("place-location").props.draft.get("name"), page.part("place-location").props.address], ["Upper Belvedere", ""], "its location fields get the draft, with the saved address to check it against");
  assert.deepEqual(page.sent, [], "stepping saves nothing");

  await page.save();
  assert.equal(page.sent.length, 1);
  const [{ mutation, imageForm }] = page.sent;
  assert.deepEqual([mutation.type, mutation.id, mutation.name, mutation.notes, mutation.mustDo, mutation.included, mutation.links], ["candidate.save", ids.belvedere, "Upper Belvedere", "The Kiss", true, false, [link]]);
  assert.equal(imageForm.get("image:" + photos.images[0].id).name, "kiss.png", "with its new photo");
  assert.equal(page.title(), "Upper Belvedere", "saving returns to its details");
  assert.equal(saved(store, ids.opera).priceCents, 1225, "Opera's draft isn't saved");

  // Opera's draft is still kept: its details show what is saved, and its editor what was left in it.
  page.click(page.steps().previous);
  assert.equal(page.title(), "Opera");
  page.click(page.button("Edit"));
  assert.equal(page.value("price"), "45");
  // Cancel discards it, and returns to the details.
  page.click(page.button("Cancel"));
  assert.equal(page.title(), "Opera");
  page.click(page.button("Edit"));
  assert.equal(page.value("price"), "12.25");
  assert.equal(page.sent.length, 1);
});

test("an activity's editor keeps the estimated time typed in it with its other unsaved changes while stepping, and saves only its own (TRA-170)", async (t) => {
  const { store, tripId, viennaId, ids } = vienna(t);
  store.applyMutation(candidateInput(viennaId, "activities", { id: ids.opera, name: "Opera", included: false, notes: "Standing room", url: "https://www.wiener-staatsoper.at", estimatedMinutes: 90 }));
  const page = plannerPage(store, tripId);
  page.click(page.button("View Belvedere"));
  page.click(page.button("Edit"));
  assert.equal(page.value("estimatedMinutes"), "", "Belvedere has none saved");
  page.type("estimatedMinutes", "150");
  page.click(page.steps().previous);
  assert.deepEqual([page.steps().place, page.value("estimatedMinutes")], ["3 of 4: Opera", "90"], "Opera's editor shows Opera's saved time");
  page.type("estimatedMinutes", "45");
  page.click(page.steps().next);
  assert.equal(page.value("estimatedMinutes"), "150", "Belvedere's comes back as it was left");
  await page.save();
  assert.deepEqual(page.sent.map(({ mutation }) => [mutation.id, mutation.estimatedMinutes]), [[ids.belvedere, 150]], "saving sends only the activity shown, its time as a number");
  assert.deepEqual([saved(store, ids.belvedere).estimatedMinutes, saved(store, ids.opera).estimatedMinutes], [150, 90], "Opera's draft isn't saved");
});

test("closing an activity's dialog, or deleting from it, forgets every draft it kept (TRA-160)", async (t) => {
  const { store, tripId, ids } = vienna(t);
  const page = plannerPage(store, tripId);
  page.click(page.button("View Opera"));
  page.click(page.button("Edit"));
  page.type("name", "Opera tour");
  page.click(page.steps().next);
  page.close();
  assert.equal(page.title(), undefined);
  page.click(page.button("View Opera"));
  page.click(page.button("Edit"));
  assert.equal(page.value("name"), "Opera", "closing forgot it");

  page.type("name", "Opera tour");
  page.click(page.steps().next);
  page.click(page.button("Delete"));
  assert.equal(page.title(), "Edit activity", "the confirmation opens above the editor");
  page.click(page.button("Delete"));
  await new Promise((resolve) => setImmediate(resolve));
  page.reload();
  assert.equal(page.title(), undefined, "deleting closes the dialog");
  assert.equal(saved(store, ids.belvedere), undefined, "Belvedere is deleted");
  assert.equal(saved(store, ids.opera).name, "Opera", "Opera's draft isn't saved");
  page.click(page.button("View Opera"));
  assert.equal(page.steps().place, "3 of 3: Opera");
  page.click(page.button("Edit"));
  assert.equal(page.value("name"), "Opera", "deleting forgot it");
});

test("adding an activity, a hotel's editor, and an activity's editor from its idea page don't step (TRA-160)", (t) => {
  const { store, tripId, viennaId } = vienna(t);
  const page = plannerPage(store, tripId);
  page.click(page.button("Add activity"));
  assert.deepEqual([page.title(), page.steps()], ["Add activity", undefined]);
  page.click(page.button("Cancel"));
  page.click(page.button("View Hotel Sacher"));
  page.click(page.button("Edit"));
  assert.deepEqual([page.title(), page.steps()], ["Edit hotel", undefined]);
  page.click(page.button("Cancel"));
  // A destination's Activities page lists its activities in their saved order, and its pencil opens an editor alone.
  const activities = plannerPage(store, tripId, { stopId: viennaId, category: "activities" });
  const list = activities.part("candidate-list");
  assert.deepEqual(list.props.items.map((item) => item.name), ["Opera", "Prater", "Belvedere", "Schönbrunn"]);
  list.props.onEdit(list.props.items[0]);
  activities.show();
  assert.deepEqual([activities.title(), activities.value("name"), activities.steps()], ["Edit activity", "Opera", undefined]);
});

test("an activity included from its editor moves to its new place in the carousel's order, and its steps follow (TRA-160)", async (t) => {
  const { store, tripId } = vienna(t);
  const page = plannerPage(store, tripId);
  page.click(page.button("View Belvedere"));
  assert.equal(page.steps().place, "4 of 4: Belvedere");
  page.click(page.button("Edit"));
  page.type("included", true);
  await page.save();
  // The included activities come first, in their saved order: Prater, Belvedere, Schönbrunn, then Opera.
  assert.deepEqual([page.title(), page.steps().place], ["Belvedere", "2 of 4: Belvedere"]);
  page.click(page.steps().next);
  assert.equal(page.title(), "Schönbrunn");
});

test("Previous and Next stay in view between the title and what scrolls, with the heading's sides, as 44px targets on touchscreens (TRA-160)", () => {
  const file = "../src/components/activity-steps.module.css";
  const rules = (selector) => cssRules(file).filter(([selectors]) => selectors === selector).map(([, declarations, atRule]) => [atRule, declarations]);
  const [[, steps], [phones, narrow]] = rules(".steps");
  assert.deepEqual([steps.flex, steps.display, steps["justify-content"], steps.padding, steps["border-bottom"]], ["none", "flex", "space-between", "10px 27px", "1px solid var(--line)"]);
  assert.deepEqual([phones, narrow.padding], ["@media(max-width:540px)", "10px 20px"]);
  // The dialog's heading and body have the same sides at both widths.
  const globals = cssRules("../src/app/globals.css");
  const sides = (selector, atRule) => globals.find(([selectors, , at]) => selectors === selector && at === atRule)[1].padding.split(" ")[1];
  assert.deepEqual([sides(".dialog-heading", null), sides(".dialog-heading", "@media(max-width:540px)")], ["27px", "20px"]);
  assert.deepEqual(rules(".steps :global(.button)"), [["@media(pointer:coarse)", { "min-height": "44px" }]]);
  // Nothing in the bar has a width of its own, so it never reaches past a phone's screen (TRA-157).
  for (const [, declarations] of cssRules(file)) for (const property of ["width", "min-width"]) assert.equal(declarations[property], undefined);
});

/** A component module run with `modules` for what it imports, and anything else rendering, and returning, nothing. */
function component(file, modules, globals = {}) {
  const unused = new Proxy({}, { get: () => () => null });
  return load(file, (name) => name.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : modules[name] ?? unused, globals);
}
const jsxRuntime = { jsx: element, jsxs: element, Fragment: "fragment" };
const lucide = new Proxy({}, { get: (_, name) => "icon:" + String(name) });

test("an idea's photos are marked as keeping sideways swipes for themselves, wherever they show (TRA-160)", () => {
  const react = { useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }), useEffect() {}, useId: () => "id" };
  const { CandidateGallery } = component("../src/components/candidate-gallery.tsx", { react, "react/jsx-runtime": jsxRuntime, "lucide-react": lucide,
    "./photo-browsing": component("../src/components/photo-browsing.tsx", { react, "react/jsx-runtime": jsxRuntime, "lucide-react": lucide }) });
  const prater = { id: "4b9e2f0a-7c1d-4e8b-9a3f-2d6c5b4a3e1f", name: "Prater", images: [{ id: "a1", version: "1", widths: null }, { id: "a2", version: "1", widths: null }], mainImageId: "a1" };
  for (const browse of [false, true]) {
    const gallery = CandidateGallery({ candidate: prater, frame: [[null, "504px"]], browse });
    const root = gallery.type(gallery.props);
    assert.deepEqual([root.props.role, root.props["aria-label"], root.props["data-photos"]], ["group", "Photos of Prater", true]);
  }
});

test("a step that reaches either end moves focus to the other button, and other steps leave it where it is (TRA-160)", () => {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useRef(current) { const index = cursor++; if (!(index in slots)) slots[index] = { current }; return slots[index]; },
    // Effects run once the buttons show the step, as React runs them after updating the page.
    useEffect(effect) { effects.push(effect); },
  };
  const document = { body: {}, activeElement: null };
  const focusAfter = component("../src/components/focus-after.ts", { react }, { document });
  const { ActivitySteps } = component("../src/components/activity-steps.tsx", { react, "react/jsx-runtime": jsxRuntime, "lucide-react": lucide, "./focus-after": focusAfter,
    "./photo-browsing": component("../src/components/photo-browsing.tsx", { react, "react/jsx-runtime": jsxRuntime, "lucide-react": lucide }) });
  // Stand-ins for the two buttons in the browser: each disabled as rendered, focused when it takes focus, and finding
  // the enabled one beside it, as their shared parent does.
  const focused = [];
  const buttons = ["previous", "next"].map((name) => ({ name, disabled: false, focus() { focused.push(name); document.activeElement = this; }, matches(selector) { return selector === ":disabled" && this.disabled; } }));
  const parent = { querySelector: (selector) => selector === "button:not(:disabled)" ? buttons.find((button) => !button.disabled) : null };
  for (const button of buttons) button.parentElement = parent;
  let index = 1;
  let tree;
  const render = () => {
    cursor = 0; effects = [];
    tree = ActivitySteps({ index, count: 3, name: "Opera", disabled: false, onStep: (step) => { index += step; } });
    [buttons[0].disabled, buttons[1].disabled] = [tree.props.children[0].props.disabled, tree.props.children[2].props.disabled];
    for (const effect of effects) effect();
  };
  const press = (position) => { document.activeElement = buttons[position]; tree.props.children[position * 2].props.onClick({ currentTarget: buttons[position] }); render(); };
  render();
  press(1);
  assert.deepEqual([index, buttons[1].disabled, focused], [2, true, ["previous"]], "at the last, Next is disabled and Previous takes focus");
  press(0);
  assert.deepEqual([index, focused], [1, ["previous"]], "Previous keeps focus while it can step again");
  press(0);
  assert.deepEqual([index, buttons[0].disabled, focused], [0, true, ["previous", "next"]], "at the first, Next takes focus");
});

test("an idea's details stay as wide as their dialog however many photos it has, so only its thumbnails scroll sideways (TRA-160)", () => {
  // A grid's own column would be as wide as a long row of thumbnails, widening every detail past the dialog's edge (TRA-157).
  const details = cssRules("../src/components/destination-ideas.module.css").filter(([selector]) => selector === ".details");
  assert.deepEqual(details.map(([, declarations, atRule]) => [atRule, declarations.display, declarations["grid-template-columns"]]), [[null, "grid", "minmax(0, 1fr)"]]);
  const thumbnails = cssRules("../src/components/candidate-gallery.module.css").find(([selector]) => selector === ".thumbnails")[1];
  assert.deepEqual([thumbnails["max-width"], thumbnails["overflow-x"]], ["100%", "auto"]);
});
