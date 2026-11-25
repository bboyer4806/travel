import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as coordinates from "../src/lib/coordinates.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import * as types from "../src/lib/types.ts";
import * as uuid from "../src/lib/uuid.ts";
import { addDestination, candidateInput, setup, tripInput } from "./budget-fixtures.mjs";
import { contrast, cssRules } from "./css-rules.mjs";

// TRA-161: each activity's card in a destination's Activities carousel has a Must do star, filled when the activity is
// Must do and outlined otherwise. Selecting it saves the activity's Must do at once, as the Activities page's Must do
// does, without showing the activity's details, and a save that fails leaves it as saved, with the error.
// TRA-181: each hotel's and restaurant's card has the same star, and hotels have Must do on their page and in their
// editor, as activities and restaurants do. Must do is a planning priority, not a rating: marking an idea chooses no
// hotel, includes nothing in a budget, and changes no price or order.

function load(file, require, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, ...globals });
  return exports;
}
const element = (type, props) => ({ type, props });
/** The form data the planner reads from an editor's form: the stand-in form's fields, by name. */
class FormData {
  constructor(form) { this.fields = { ...form.fields }; }
  get(name) { return name in this.fields ? this.fields[name] : null; }
  has(name) { return name in this.fields; }
  getAll(name) { return name in this.fields ? [this.fields[name]] : []; }
}

/**
 * A planner page for its owner, rendered by the planner from what the store gives it, `read`, with its Hotels,
 * Activities and Restaurants sections or idea list and React's state kept between renders, so their controls can be
 * used. Its saves are made by the store, unless a test gives the next one's answer. No browser or server is involved.
 */
function plannerPage(store, read) {
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
    useCallback: (callback) => callback,
    // A transition finishes at once, and effects, which run only in a browser, don't run.
    useTransition: () => [false, (work) => work()],
    useEffect: () => {},
  };
  const sent = [];
  const answers = [];
  // Whether a save has asked for the page to load again, as a saved change does.
  let refreshed = false;
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() { refreshed = true; } }), unstable_isUnrecognizedActionError: () => false },
    // The page's save: the answer a test gives, or the store's as the signed-in owner, which refuses a change with its
    // message, as the save action does. Each change sent is kept as this file's object, so it compares as any other.
    "@/app/actions": {
      async mutatePlanner(mutation) {
        sent.push({ ...mutation });
        if (answers.length) return answers.shift()();
        try { return { ok: true, ...store.applyMutation(mutation) }; } catch (error) {
          if (error.name === "ValidationError") return { ok: false, error: error.message };
          throw error;
        }
      },
    },
    // An editor's saves keep saved coordinates and give a new idea its ID, as in the browser.
    "@/lib/budget": budget, "@/lib/coordinates": coordinates, "@/lib/destination-label": destinationLabel, "@/lib/money": money,
    "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort, "@/lib/types": types, "@/lib/uuid": uuid,
  };
  // Every other module is one the idea sections and their saves don't need: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  // A CSS module's class names are their own names.
  const require = (name) => name.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : modules[name] ?? unused;
  modules["@/components/focus-after"] = modules["./focus-after"] = load("../src/components/focus-after.ts", require);
  modules["./photo-browsing"] = load("../src/components/photo-browsing.tsx", require);
  // An activity's details step to its destination's others (TRA-160), in a body that holds what they show.
  modules["@/components/activity-steps"] = load("../src/components/activity-steps.tsx", require);
  modules["@/components/destination-ideas"] = load("../src/components/destination-ideas.tsx", require);
  modules["@/components/candidate-list"] = load("../src/components/candidate-list.tsx", require);
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", require, { FormData });
  let props;
  let shown;
  /**
   * The page as it renders now, from what the store gave it when the page last loaded. It renders twice, as React
   * renders again at once when the page changes its state while rendering, as it does on loading the page again.
   */
  const show = () => { for (let pass = 0; pass < 2; pass++) { cursor = 0; shown = render(PlannerApp(props)); } };
  /** Loads the page again, as after a saved change or a refresh. */
  const reload = () => { props = read(); show(); };
  reload();
  const all = () => shown.flatMap(within);
  const dialog = () => all().find((node) => node.type === "dialog");
  const starButtons = () => all().filter((node) => node.props.className === "star");
  return {
    sent, all, reload, starButtons,
    /** Each star on the page, in order, by its name and whether it is pressed. */
    stars: () => starButtons().map((star) => [star.type, star.props["aria-label"], star.props["aria-pressed"]]),
    star: (name) => all().find((node) => node.type === "button" && node.props["aria-label"] === "Must do for " + name),
    /** Each Must do toggle on an idea page's cards, in order, as screen readers hear it, and whether it is pressed. */
    toggles: () => all().filter((node) => String(node.props.className).split(" ").includes("must-do")).map((toggle) => [text(toggle), toggle.props["aria-pressed"]]),
    toggle: (name) => all().find((node) => String(node.props.className).split(" ").includes("must-do") && text(node).endsWith(" for " + name)),
    /** The card that shows an idea's details, by the idea's name. */
    card: (name) => all().find((node) => node.props.className === "card" && text(within(node).find((part) => part.props.className === "name")) === name),
    /** A button on the page, outside any dialog, by its text, screen-reader text included. */
    button: (label) => all().find((node) => node.type === "button" && text(node) === label),
    /** The open dialog's title, or undefined without one. */
    dialog: () => dialog() && text(within(dialog()).find((node) => node.type === "h2")),
    /** A button in the open dialog, by its text. */
    dialogButton: (label) => within(dialog()).find((node) => node.type === "button" && text(node) === label),
    /** What an idea's details show for `label`. */
    detail: (label) => text(within(dialog()).find((node) => node.type === "div" && node.props.children[0]?.type === "dt" && text(node.props.children[0]) === label).props.children[1]),
    field: (name) => within(dialog()).find((node) => node.type === "input" && node.props.name === name),
    /** The message a saved change shows, or undefined without one. */
    message: () => { const toast = all().find((node) => node.props.role === "status" && node.props.className === "toast"); return toast && text(toast); },
    /** The error a failed change shows on the page, or undefined without one. */
    error: () => { const toast = all().find((node) => node.props.role === "alert" && node.props.className === "toast error-toast"); return toast && text(toast); },
    /** Selects a control, as a click, a tap, or Enter or Space on it does. */
    select(control) { control.props.onClick({ currentTarget: control }); show(); },
    /**
     * Submits the open editor with each field as it was rendered, but for `changes`: text typed into a field, or whether
     * a checkbox is checked, by name.
     */
    submit(changes = {}) {
      const form = within(dialog()).find((node) => node.type === "form");
      const fields = {};
      for (const node of within(form)) {
        if ((node.type !== "input" && node.type !== "textarea") || !node.props.name || node.props.disabled) continue;
        const { name } = node.props;
        if (node.props.type === "checkbox") { if (name in changes ? changes[name] : node.props.defaultChecked) fields[name] = "on"; }
        else fields[name] = name in changes ? changes[name] : node.props.defaultValue ?? "";
      }
      form.props.onSubmit({ preventDefault() {}, currentTarget: { fields } });
      show();
    },
    /** Answers the next save with what `answer` returns or throws, without saving it. */
    answerNext(answer) { answers.push(answer); },
    /** Waits for the save in progress to finish, then shows the page, loaded again if the save asked for that. */
    async settle() {
      await new Promise((resolve) => setImmediate(resolve));
      if (refreshed) { refreshed = false; reload(); } else show();
    },
  };
}
/** A trip's page for its owner, as `/trips/<trip ID>` loads it. */
const tripPage = (store, tripId) => plannerPage(store, () => {
  const { data, access, library } = store.getTripSnapshot(tripId);
  return { initialData: data, access: { [tripId]: access }, library, tripId };
});
/** A destination's Hotels, Activities or Restaurants page in a trip, as `/trips/<trip ID>/destinations/<stop ID>/<category>` loads it. */
const ideasPage = (store, tripId, stopId, category) => plannerPage(store, () => {
  const { data, access } = store.getTripSnapshot(tripId, stopId);
  return { initialData: data, access: { [tripId]: access }, tripId, stopId, category };
});
/** A destination's page in Destinations, as `/destinations/<destination ID>` loads it. */
const destinationPage = (store, destinationId) => plannerPage(store, () => {
  const { data, access } = store.getDestinationSnapshot(destinationId);
  return { initialData: data, destinationAccess: { [destinationId]: access }, destinationId };
});
/** An element as the browser has it: host elements with their children rendered, and text, each component and fragment rendered in its place. */
function render(node) {
  if (Array.isArray(node)) return [...node].flatMap(render);
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node !== "object") return [String(node)];
  if (typeof node.type === "function") return render(node.type(node.props));
  if (node.type === "fragment") return render(node.props.children);
  return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
}
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");

/**
 * A trip visiting Vienna and Salzburg. Vienna has a chosen hotel and another, two activities and a restaurant, one of the
 * activities and the restaurant Must do. Salzburg has an activity.
 */
function trip(t) {
  const { store, tripId } = setup(t);
  const vienna = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const salzburg = addDestination(store, tripId, { city: "Salzburg", nights: 2 });
  const save = (destinationId, category, name, overrides = {}) => store.applyMutation(candidateInput(destinationId, category, { name, included: false, ...overrides })).id;
  const ideas = {
    imperial: save(vienna, "hotels", "Hotel Imperial", { price: "1800", included: true }),
    sacher: save(vienna, "hotels", "Hotel Sacher", { price: "1500" }),
    opera: save(vienna, "activities", "Opera"),
    palace: save(vienna, "activities", "Palace", { mustDo: true }),
    figlmuller: save(vienna, "restaurants", "Figlmüller", { mustDo: true }),
    fortress: save(salzburg, "activities", "Fortress"),
  };
  return { store, tripId, vienna, ideas };
}
const mustDo = (store, tripId, id) => store.getTripSnapshot(tripId).data.candidates.find((item) => item.id === id).mustDo;
/** Everything saved, but each idea's Must do. */
const withoutMustDo = (snapshot) => ({ ...snapshot, candidates: snapshot.candidates.map((item) => ({ ...item, mustDo: null })) });

test("every hotel's, activity's and restaurant's card on a trip's page has a Must do star beside it, filled and pressed for Must do (TRA-161, TRA-181)", (t) => {
  const { store, tripId } = trip(t);
  const page = tripPage(store, tripId);
  // Vienna's Hotels, Activities and Restaurants, then Salzburg's, each carousel in its order: the chosen hotel first.
  assert.deepEqual(page.stars(), [
    ["button", "Must do for Hotel Imperial", false], ["button", "Must do for Hotel Sacher", false],
    ["button", "Must do for Opera", false], ["button", "Must do for Palace", true],
    ["button", "Must do for Figlmüller", true], ["button", "Must do for Fortress", false],
  ]);
  for (const name of ["Hotel Imperial", "Hotel Sacher", "Opera", "Palace", "Figlmüller", "Fortress"]) {
    const star = page.star(name);
    assert.deepEqual([star.props.type, star.props.disabled], ["button", false]);
    // A star alone, hidden from screen readers, which hear the control's name and whether it is pressed.
    assert.deepEqual(star.props.children.map((icon) => [icon.type, icon.props.fill, icon.props["aria-hidden"]]), [["icon:Star", star.props["aria-pressed"] ? "currentColor" : "none", "true"]]);
    // Beside its card rather than in it, so it never selects the card. The idea's Like follows, beside the card too (TRA-31).
    const card = page.card(name);
    const [shown, shownStar, like] = page.all().find((node) => node.type === "li" && node.props.children.includes(star)).props.children;
    assert.deepEqual([shown, shownStar, like.props.className], [card, star, "likeSlot"]);
    assert.ok(!within(card).includes(star));
  }
});

test("selecting an activity's star marks it Must do at once, without opening anything, and its details and editor show it (TRA-161)", async (t) => {
  const { store, tripId, ideas } = trip(t);
  const page = tripPage(store, tripId);
  page.select(page.star("Opera"));
  assert.deepEqual(page.sent, [{ type: "candidate.mustDo", id: ideas.opera, mustDo: true }], "saved at once, with no Save or confirmation");
  assert.equal(page.dialog(), undefined, "neither its details nor its editor opens");
  // While it saves, it shows what is saved and can't be selected again.
  assert.deepEqual([page.star("Opera").props["aria-pressed"], page.star("Opera").props.disabled], [false, true]);
  await page.settle();
  assert.deepEqual(page.stars().map(([, , pressed]) => pressed), [false, false, true, true, true, false]);
  assert.equal(page.star("Opera").props.disabled, false);
  assert.equal(page.message(), "Marked as must do.");
  assert.equal(mustDo(store, tripId, ideas.opera), true);
  // Refreshing the page shows it as saved.
  page.reload();
  assert.equal(page.star("Opera").props["aria-pressed"], true);

  // Its card still shows its details, which say so, as its editor does.
  page.select(page.card("Opera"));
  assert.equal(page.dialog(), "Opera");
  assert.equal(page.detail("Must do"), "Yes");
  page.select(page.dialogButton("Edit"));
  assert.equal(page.dialog(), "Edit activity");
  assert.equal(page.field("mustDo").props.defaultChecked, true);
  page.select(page.dialogButton("Cancel"));
  page.select(page.dialogButton("Close"));
  assert.equal(page.dialog(), undefined);

  // Selecting it again removes it.
  page.select(page.star("Opera"));
  assert.deepEqual(page.sent.at(-1), { type: "candidate.mustDo", id: ideas.opera, mustDo: false });
  await page.settle();
  assert.deepEqual(page.stars().map(([, , pressed]) => pressed), [false, false, false, true, true, false]);
  assert.equal(page.message(), "Must do removed.");
  assert.equal(mustDo(store, tripId, ideas.opera), false);
  page.select(page.card("Opera"));
  assert.equal(page.detail("Must do"), "No");
  assert.equal(page.sent.length, 2, "showing details and the editor saves nothing");
});

test("selecting a hotel's or restaurant's star marks it Must do at once, or removes it, and its details and editor show it (TRA-181)", async (t) => {
  const { store, tripId, ideas } = trip(t);
  const before = store.getSnapshot();
  const page = tripPage(store, tripId);
  page.select(page.star("Hotel Sacher"));
  assert.deepEqual(page.sent, [{ type: "candidate.mustDo", id: ideas.sacher, mustDo: true }], "saved at once, with no Save or confirmation");
  assert.equal(page.dialog(), undefined, "neither its details nor its editor opens");
  // While it saves, it shows what is saved, and no star can be selected.
  assert.equal(page.star("Hotel Sacher").props["aria-pressed"], false);
  assert.ok(page.starButtons().every((star) => star.props.disabled));
  await page.settle();
  assert.deepEqual(page.stars().map(([, name, pressed]) => [name, pressed]), [
    ["Must do for Hotel Imperial", false], ["Must do for Hotel Sacher", true], ["Must do for Opera", false],
    ["Must do for Palace", true], ["Must do for Figlmüller", true], ["Must do for Fortress", false],
  ], "it stays after the chosen hotel, and every other star is as it was");
  assert.ok(page.starButtons().every((star) => star.props.disabled === false));
  assert.equal(page.message(), "Marked as must do.");
  assert.equal(mustDo(store, tripId, ideas.sacher), true);
  // It chose nothing: the chosen hotel, every price, selection and place in a list, and so the budget, are as they were.
  assert.deepEqual(withoutMustDo(store.getSnapshot()), withoutMustDo(before));
  assert.deepEqual(budget.calculateBudget(store.getSnapshot(), tripId), budget.calculateBudget(before, tripId));
  page.reload();
  assert.equal(page.star("Hotel Sacher").props["aria-pressed"], true, "refreshing shows it as saved");

  // Its card shows its details, which say so, beside its budget choice, as its editor does.
  page.select(page.card("Hotel Sacher"));
  assert.equal(page.dialog(), "Hotel Sacher");
  assert.deepEqual([page.detail("Must do"), page.detail("Choose this hotel for the budget")], ["Yes", "No"]);
  page.select(page.dialogButton("Edit"));
  assert.equal(page.dialog(), "Edit hotel");
  assert.deepEqual([page.field("mustDo").props.defaultChecked, page.field("included").props.defaultChecked], [true, false]);
  page.select(page.dialogButton("Cancel"));
  page.select(page.dialogButton("Close"));

  // A Must do restaurant's star removes it the same way.
  page.select(page.star("Figlmüller"));
  assert.deepEqual(page.sent.at(-1), { type: "candidate.mustDo", id: ideas.figlmuller, mustDo: false });
  await page.settle();
  assert.equal(page.star("Figlmüller").props["aria-pressed"], false);
  assert.equal(page.message(), "Must do removed.");
  assert.equal(mustDo(store, tripId, ideas.figlmuller), false);
  page.select(page.card("Figlmüller"));
  assert.equal(page.detail("Must do"), "No");
  // And selecting it again marks it.
  page.select(page.dialogButton("Close"));
  page.select(page.star("Figlmüller"));
  await page.settle();
  assert.deepEqual([page.star("Figlmüller").props["aria-pressed"], mustDo(store, tripId, ideas.figlmuller)], [true, true]);
  assert.equal(page.sent.length, 3, "showing details and the editor saves nothing");
});

test("if saving a star fails, it stays as saved, the error shows and nothing says it saved (TRA-161, TRA-181)", async (t) => {
  const { store, tripId, ideas } = trip(t);
  const page = tripPage(store, tripId);
  // Refused by the store, for an activity and a hotel removed in another tab after this page loaded.
  store.applyMutation({ type: "candidate.delete", id: ideas.opera });
  store.applyMutation({ type: "candidate.delete", id: ideas.sacher });
  const before = store.getSnapshot();
  for (const name of ["Opera", "Hotel Sacher"]) {
    page.select(page.star(name));
    await page.settle();
    assert.equal(page.star(name).props["aria-pressed"], false, name);
    assert.equal(page.error(), "This item no longer exists or isn't shared with you. Please refresh and try again.");
    assert.equal(page.message(), undefined);
  }
  // Without an answer, as when the connection drops while it saves: an activity's and a restaurant's.
  for (const name of ["Palace", "Figlmüller"]) {
    page.answerNext(() => { throw new TypeError("Failed to fetch"); });
    page.select(page.star(name));
    await page.settle();
    assert.equal(page.star(name).props["aria-pressed"], true, name + " is still Must do, as saved");
    assert.equal(page.error(), "We couldn't confirm that your changes were saved. Please try again.");
    assert.equal(page.message(), undefined);
  }
  assert.deepEqual(store.getSnapshot(), before, "nothing was saved");
  assert.ok(page.starButtons().every((star) => star.props.disabled === false), "each can be selected again");
});

test("a hotel's editor has Must do, checked as saved, so saving its other changes keeps its star, and a new hotel can start Must do (TRA-181)", async (t) => {
  const { store, tripId, ideas } = trip(t);
  store.applyMutation({ type: "candidate.mustDo", id: ideas.sacher, mustDo: true });
  const page = tripPage(store, tripId);
  page.select(page.card("Hotel Sacher"));
  page.select(page.dialogButton("Edit"));
  assert.equal(page.dialog(), "Edit hotel");
  // The checkbox activities and restaurants have, enabled and checked as saved, apart from choosing the hotel.
  const checkbox = page.field("mustDo");
  assert.deepEqual([checkbox.props.type, checkbox.props.defaultChecked, checkbox.props.disabled], ["checkbox", true, false]);
  assert.equal(text(page.all().find((node) => node.type === "label" && node.props.children.includes(checkbox))), "Must doA planning priority. Budget inclusion and list order stay separate.");
  page.submit({ name: "Hotel Sacher Wien", notes: "Ask for a courtyard room" });
  await page.settle();
  const [saved] = page.sent;
  assert.deepEqual([saved.type, saved.id, saved.name, saved.notes, saved.mustDo, saved.included], ["candidate.save", ideas.sacher, "Hotel Sacher Wien", "Ask for a courtyard room", true, false]);
  assert.equal(page.dialog(), "Hotel Sacher Wien", "saving returns to its details");
  assert.equal(page.detail("Must do"), "Yes", "saving its other changes keeps its star");
  assert.equal(mustDo(store, tripId, ideas.sacher), true);
  page.select(page.dialogButton("Close"));
  assert.equal(page.star("Hotel Sacher Wien").props["aria-pressed"], true);

  // Unchecking it removes it, as its star does, and the star shows that.
  page.select(page.card("Hotel Sacher Wien"));
  page.select(page.dialogButton("Edit"));
  page.submit({ mustDo: false });
  await page.settle();
  assert.deepEqual([page.sent.at(-1).mustDo, mustDo(store, tripId, ideas.sacher)], [false, false]);
  page.select(page.dialogButton("Close"));
  assert.equal(page.star("Hotel Sacher Wien").props["aria-pressed"], false);

  // A new hotel's Must do starts unchecked, and checking it adds the hotel as Must do, without choosing it.
  page.select(page.all().find((node) => node.type === "button" && text(node) === "Add hotel in Vienna"));
  assert.equal(page.dialog(), "Add a hotel");
  assert.equal(page.field("mustDo").props.defaultChecked, false);
  page.submit({ name: "Hotel Bristol", mustDo: true });
  await page.settle();
  const bristol = store.getTripSnapshot(tripId).data.candidates.find((item) => item.name === "Hotel Bristol");
  assert.deepEqual([bristol.category, bristol.mustDo, bristol.included], ["hotels", true, false]);
  assert.deepEqual(page.stars().slice(0, 3).map(([, name, pressed]) => [name, pressed]), [["Must do for Hotel Imperial", false], ["Must do for Hotel Sacher Wien", false], ["Must do for Hotel Bristol", true]], "last, after the chosen hotel");
});

test("a hotel's Must do on the Hotels page saves at once, like an activity's and a restaurant's, and every page shows the same star (TRA-181)", async (t) => {
  const { store, tripId, vienna, ideas } = trip(t);
  // A second trip visits Vienna, sharing its hotels, activities and restaurants.
  const second = store.applyMutation(tripInput({ name: "Vienna again" })).id;
  store.applyMutation({ type: "stop.visit", tripId: second, destinationId: vienna });
  const secondStop = store.getTripSnapshot(second).data.stops.find((item) => item.destinationId === vienna).id;
  const hotels = ideasPage(store, tripId, vienna, "hotels");
  // Each hotel's card has Must do, named for screen readers by its hotel, as on the Activities and Restaurants pages.
  assert.deepEqual(hotels.toggles(), [["Mark as must do for Hotel Imperial", false], ["Mark as must do for Hotel Sacher", false]]);
  assert.deepEqual(ideasPage(store, tripId, vienna, "restaurants").toggles(), [["Must do for Figlmüller", true]]);
  assert.deepEqual(ideasPage(store, tripId, vienna, "activities").toggles(), [["Mark as must do for Opera", false], ["Must do for Palace", true]]);
  hotels.select(hotels.toggle("Hotel Sacher"));
  assert.deepEqual(hotels.sent, [{ type: "candidate.mustDo", id: ideas.sacher, mustDo: true }], "saved at once, with no Save or confirmation");
  assert.ok(hotels.all().filter((node) => String(node.props.className).split(" ").includes("must-do")).every((toggle) => toggle.props.disabled), "no Must do can be selected while it saves");
  await hotels.settle();
  assert.deepEqual(hotels.toggles(), [["Mark as must do for Hotel Imperial", false], ["Must do for Hotel Sacher", true]], "it keeps its place in the list");
  assert.equal(hotels.message(), "Marked as must do.");
  // Choosing the hotel and marking it are separate: the chosen hotel stays chosen.
  const chosen = store.getTripSnapshot(tripId).data.candidates.filter((item) => item.category === "hotels" && item.included).map((item) => item.name);
  assert.deepEqual(chosen, ["Hotel Imperial"]);

  // Both trips' pages and the destination's page in Destinations show the same saved star.
  const starOf = (page) => page.star("Hotel Sacher").props["aria-pressed"];
  assert.deepEqual([starOf(tripPage(store, tripId)), starOf(tripPage(store, second)), starOf(destinationPage(store, vienna))], [true, true, true]);
  // Removing it from the destination's page removes it everywhere.
  const library = destinationPage(store, vienna);
  library.select(library.star("Hotel Sacher"));
  assert.deepEqual(library.sent, [{ type: "candidate.mustDo", id: ideas.sacher, mustDo: false }]);
  await library.settle();
  assert.equal(starOf(library), false);
  assert.deepEqual([starOf(tripPage(store, tripId)), starOf(tripPage(store, second))], [false, false]);
  assert.deepEqual(ideasPage(store, second, secondStop, "hotels").toggles(), [["Mark as must do for Hotel Imperial", false], ["Mark as must do for Hotel Sacher", false]]);
});

test("the star sits at the top right of its card's photo, in a circle that keeps it clear on any photo, with a 44-pixel target on touchscreens (TRA-161)", () => {
  const rules = cssRules("../src/components/destination-ideas.module.css");
  const rule = (selector, atRule = null) => rules.find(([selectors, , at]) => selectors === selector && at === atRule)?.[1];
  assert.equal(rule(".track > li").position, "relative", "placed on its own card");
  const star = rule(".star");
  assert.deepEqual([star.position, star.top, star.right, star.width, star.height, star["border-radius"], star.background], ["absolute", "8px", "8px", "36px", "36px", "50%", "var(--white)"]);
  assert.deepEqual(rule(".star", "@media(pointer:coarse)"), { width: "44px", height: "44px" });
  // Outlined in Travel's gray, and filled in its orange for Must do, each at least 3:1 against the circle, as WCAG asks of
  // what identifies a control and its state.
  const root = cssRules("../src/app/globals.css").find(([selector]) => selector === ":root")[1];
  const color = (value) => root[/^var\((--[a-z-]+)\)$/.exec(value)[1]];
  const pressed = rule('.star[aria-pressed="true"]');
  assert.deepEqual([star.color, pressed.color], ["var(--muted)", "var(--orange)"]);
  for (const shown of [star.color, pressed.color]) assert.ok(contrast(color(shown), color(star.background)) >= 3, shown);
});
