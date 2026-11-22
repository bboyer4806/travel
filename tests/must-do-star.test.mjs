import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as types from "../src/lib/types.ts";
import { addDestination, candidateInput, setup } from "./budget-fixtures.mjs";
import { contrast, cssRules } from "./css-rules.mjs";

// TRA-161: each activity's card in a destination's Activities carousel has a Must do star, filled when the activity is
// Must do and outlined otherwise. Selecting it saves the activity's Must do at once, as the Activities page's Must do
// does, without showing the activity's details, and a save that fails leaves it as saved, with the error.

function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
const element = (type, props) => ({ type, props });

/**
 * A trip's page for its owner, rendered by the planner from what the store gives `/trips/<trip ID>`, with its Hotels,
 * Activities and Restaurants sections and React's state kept between renders, so their controls can be used. Its saves
 * are made by the store, unless a test gives the next one's answer. No browser or server is involved.
 */
function tripPage(store, tripId) {
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
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/types": types,
  };
  // Every other module is one the idea sections and their saves don't need: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  // A CSS module's class names are their own names.
  const require = (name) => name.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : modules[name] ?? unused;
  modules["@/components/focus-after"] = load("../src/components/focus-after.ts", require);
  modules["@/components/destination-ideas"] = load("../src/components/destination-ideas.tsx", require);
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", require);
  let props;
  let shown;
  /**
   * The page as it renders now, from the store's trip as the page last loaded it. It renders twice, as React renders
   * again at once when the page changes its state while rendering, as it does on loading a trip again.
   */
  const show = () => { for (let pass = 0; pass < 2; pass++) { cursor = 0; shown = render(PlannerApp(props)); } };
  /** Loads the page again, as after a saved change or a refresh. */
  const reload = () => { const { data, access, library } = store.getTripSnapshot(tripId); props = { initialData: data, access: { [tripId]: access }, library, tripId }; show(); };
  reload();
  const all = () => shown.flatMap(within);
  const dialog = () => all().find((node) => node.type === "dialog");
  return {
    sent, all, reload,
    /** Each star on the page, in order, by its name and whether it is pressed. */
    stars: () => all().filter((node) => node.props.className === "star").map((star) => [star.type, star.props["aria-label"], star.props["aria-pressed"]]),
    star: (name) => all().find((node) => node.type === "button" && node.props["aria-label"] === "Must do for " + name),
    /** The card that shows an idea's details, by the idea's name. */
    card: (name) => all().find((node) => node.props.className === "card" && text(within(node).find((part) => part.props.className === "name")) === name),
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
    /** Answers the next save with what `answer` returns or throws, without saving it. */
    answerNext(answer) { answers.push(answer); },
    /** Waits for the save in progress to finish, then shows the page, loaded again if the save asked for that. */
    async settle() {
      await new Promise((resolve) => setImmediate(resolve));
      if (refreshed) { refreshed = false; reload(); } else show();
    },
  };
}
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

/** A trip visiting Vienna and Salzburg, with a hotel, activities and a restaurant, two of them Must do. */
function trip(t) {
  const { store, tripId } = setup(t);
  const vienna = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const salzburg = addDestination(store, tripId, { city: "Salzburg", nights: 2 });
  const save = (destinationId, category, name, overrides = {}) => store.applyMutation(candidateInput(destinationId, category, { name, included: false, ...overrides })).id;
  const ideas = {
    sacher: save(vienna, "hotels", "Hotel Sacher"),
    opera: save(vienna, "activities", "Opera"),
    palace: save(vienna, "activities", "Palace", { mustDo: true }),
    figlmuller: save(vienna, "restaurants", "Figlmüller", { mustDo: true }),
    fortress: save(salzburg, "activities", "Fortress"),
  };
  return { store, tripId, ideas };
}
const mustDo = (store, tripId, id) => store.getTripSnapshot(tripId).data.candidates.find((item) => item.id === id).mustDo;

test("every activity's card on a trip's page has a Must do star beside it, filled and pressed for Must do, and no other idea has one (TRA-161)", (t) => {
  const { store, tripId } = trip(t);
  const page = tripPage(store, tripId);
  // A Must do restaurant and the hotel show none, as the ticket leaves them out.
  assert.deepEqual(page.stars(), [["button", "Must do for Opera", false], ["button", "Must do for Palace", true], ["button", "Must do for Fortress", false]]);
  for (const name of ["Opera", "Palace", "Fortress"]) {
    const star = page.star(name);
    assert.deepEqual([star.props.type, star.props.disabled], ["button", false]);
    // A star alone, hidden from screen readers, which hear the control's name and whether it is pressed.
    assert.deepEqual(star.props.children.map((icon) => [icon.type, icon.props.fill, icon.props["aria-hidden"]]), [["icon:Star", star.props["aria-pressed"] ? "currentColor" : "none", "true"]]);
    // Beside its card rather than in it, so it never selects the card.
    const card = page.card(name);
    assert.deepEqual(page.all().find((node) => node.type === "li" && node.props.children.includes(star)).props.children, [card, star]);
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
  assert.deepEqual(page.stars(), [["button", "Must do for Opera", true], ["button", "Must do for Palace", true], ["button", "Must do for Fortress", false]]);
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
  assert.deepEqual(page.stars().map(([, , pressed]) => pressed), [false, true, false]);
  assert.equal(page.message(), "Must do removed.");
  assert.equal(mustDo(store, tripId, ideas.opera), false);
  page.select(page.card("Opera"));
  assert.equal(page.detail("Must do"), "No");
  assert.equal(page.sent.length, 2, "showing details and the editor saves nothing");
});

test("if saving an activity's star fails, it stays as saved, the error shows and nothing says it saved (TRA-161)", async (t) => {
  const { store, tripId, ideas } = trip(t);
  const page = tripPage(store, tripId);
  // Refused by the store, for an activity removed in another tab after this page loaded.
  store.applyMutation({ type: "candidate.delete", id: ideas.opera });
  const before = store.getSnapshot();
  page.select(page.star("Opera"));
  await page.settle();
  assert.deepEqual(page.stars().map(([, name, pressed]) => [name, pressed]), [["Must do for Opera", false], ["Must do for Palace", true], ["Must do for Fortress", false]]);
  assert.equal(page.error(), "This item no longer exists or isn't shared with you. Please refresh and try again.");
  assert.equal(page.message(), undefined);
  // Without an answer, as when the connection drops while it saves.
  page.answerNext(() => { throw new TypeError("Failed to fetch"); });
  page.select(page.star("Palace"));
  await page.settle();
  assert.deepEqual(page.star("Palace").props["aria-pressed"], true, "still Must do, as saved");
  assert.equal(page.error(), "We couldn't confirm that your changes were saved. Please try again.");
  assert.equal(page.message(), undefined);
  assert.deepEqual(store.getSnapshot(), before, "nothing was saved");
  assert.ok(["Opera", "Palace", "Fortress"].every((name) => page.star(name).props.disabled === false), "each can be selected again");
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
