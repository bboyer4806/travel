import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as dropdownPosition from "../src/lib/dropdown-position.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import { addDestination, destination, setup, tripInput } from "./budget-fixtures.mjs";
import { cssRules, styles, TOUCH } from "./css-rules.mjs";

// TRA-55: one three-dot options button on each destination card of a trip's page replaces its Move up, Move down, Edit
// and Delete buttons, with those four actions in its menu. The real menu runs with a small hook harness and stand-ins for
// the page's focus, pointer and window, and the real planner renders the trip's page from what the store gives it. No
// browser or server is involved.
const compile = (file) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const element = (type, props, key) => ({ type, props, key });
const jsxRuntime = { jsx: element, jsxs: element, Fragment: "fragment" };
const icons = new Proxy({}, { get: (_, name) => "icon:" + String(name) });
// A CSS module's class names are their own names.
const cssModule = { default: new Proxy({}, { get: (_, name) => String(name) }) };
const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = (node) => typeof node === "string" ? node : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
const ACTIONS = ["Move up", "Move down", "Edit", "Delete"];

/**
 * The page the menus are on: which element has focus, and the pointer listeners on its document. An element taking
 * focus tells the menu it was in that focus left it, as the focusout event does, with where focus went.
 */
function page() {
  const listeners = new Set();
  const document = {
    activeElement: null,
    addEventListener(type, listener) { listeners.add({ type, listener }); },
    removeEventListener(type, listener) { for (const one of listeners) if (one.type === type && one.listener === listener) listeners.delete(one); },
  };
  return {
    document, listeners,
    /** An element on the page, inside the menu `owner` or outside any. */
    element(name, owner = null, extra = {}) {
      return Object.assign({ name, owner, focus() { const left = document.activeElement; document.activeElement = this; left?.owner?.focusLeft(left, this); } }, extra);
    },
    /** A mouse button or finger pressed down on `target`, as the document hears it. */
    press(target) { for (const { type, listener } of [...listeners]) if (type === "pointerdown") listener({ target }); },
  };
}

const MENU = compile("../src/components/destination-options-menu.tsx");

/**
 * One destination's options on `screen`, rendered again whenever its state changes, as React does, with effects run
 * after each render whose dependencies changed. Its button is 32 pixels tall with its top `top` pixels down the window,
 * `viewport` is the part of the window people can see, and its menu is `menuHeight` pixels tall at most.
 */
function options(screen, overrides = {}, { id = "a", top = 100, viewport = { offsetTop: 0, height: 900 }, menuHeight = 152 } = {}) {
  const slots = [], effects = [], calls = [];
  let cursor = 0, pending = [], tree, dirty = true, menuRef = null, menu = null;
  const react = {
    useId: () => id + ":",
    useRef: (current) => slots[cursor++] ??= { current },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; dirty = true; }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = effects[index];
      if (previous && deps.every((dep, at) => Object.is(dep, previous.deps[at]))) return;
      pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
    },
  };
  react.useLayoutEffect = react.useEffect;
  const modules = { react, "react/jsx-runtime": jsxRuntime, "lucide-react": icons, "@/lib/dropdown-position": dropdownPosition, "./destination-options-menu.module.css": cssModule };
  const loaded = { exports: {} };
  runInNewContext(MENU, { exports: loaded.exports, require: (name) => modules[name] ?? assert.fail("Unexpected import " + name), window: { visualViewport: viewport }, document: screen.document });
  const harness = {};
  const box = { top, bottom: top + 32 };
  // Everything the menu renders is inside its root.
  const root = screen.element("root", harness, { getBoundingClientRect: () => box, contains: (node) => node?.owner === harness });
  const button = screen.element("options button", harness, { getBoundingClientRect: () => box });
  const items = new Map();
  const shownItems = () => nodes(tree).filter((node) => node.props?.role === "menuitem");
  const enabled = (selector) => {
    assert.equal(selector, "button:not(:disabled)");
    return shownItems().map((node) => items.get(text(node))).filter((item) => !item.disabled);
  };
  const record = (name) => (...args) => calls.push([name, ...args.map((arg) => arg === button ? "its button" : arg), screen.document.activeElement === button ? "focus on its button" : "focus elsewhere"]);
  const props = { label: "Rome", disabled: false, first: false, last: false, onMoveUp: record("Move up"), onMoveDown: record("Move down"), onEdit: record("Edit"), onDelete: record("Delete"), ...overrides };
  // React gives refs their elements before effects run, and clears a ref whose element left the page.
  function attach() {
    const found = nodes(tree);
    found[0].props.ref.current = root;
    found.find((node) => node.props?.["aria-haspopup"] === "menu").props.ref.current = button;
    const shown = found.find((node) => node.props?.role === "menu");
    if (shown) {
      menuRef = shown.props.ref;
      menu = menuRef.current ??= screen.element("menu", harness, { style: {}, offsetHeight: menuHeight, querySelector: (selector) => enabled(selector)[0] ?? null, querySelectorAll: enabled });
    } else if (menuRef) menuRef.current = menu = null;
    for (const node of shownItems()) {
      const name = text(node);
      if (!items.has(name)) items.set(name, screen.element(name, harness));
      items.get(name).disabled = node.props.disabled;
    }
  }
  function render() {
    cursor = 0; pending = []; dirty = false;
    tree = loaded.exports.DestinationOptionsMenu(props);
    attach();
    for (const run of pending) run();
  }
  const settle = () => { for (let pass = 0; dirty && pass < 5; pass++) render(); };
  const control = (name) => name === undefined ? nodes(tree).find((node) => node.props?.["aria-haspopup"] === "menu") : shownItems().find((node) => text(node) === name);
  settle();
  return Object.assign(harness, {
    calls, root, button,
    /** An action's element in the menu, which stays the same while the menu is open. */
    item: (name) => items.get(name),
    tree: () => { settle(); return tree; },
    open: () => { settle(); return nodes(tree).some((node) => node.props?.role === "menu"); },
    /** The menu's actions in order, with whether each is disabled. */
    actions: () => { settle(); return shownItems().map((node) => [text(node), node.props.disabled]); },
    /** Selects the button, or the action `name`, as a click, a tap, or Enter or Space on it does. */
    select(name) { settle(); control(name).props.onClick(); settle(); },
    /** Presses `key` where focus is, and returns its event. */
    press(key) {
      settle();
      const event = { key, target: screen.document.activeElement, prevented: false, preventDefault() { this.prevented = true; } };
      tree.props.onKeyDown(event);
      settle();
      return event;
    },
    /** Focus left an element inside the menu's root for `to`, or for nothing. */
    focusLeft(left, to) { tree.props.onBlur({ relatedTarget: to, currentTarget: root }); },
    /** Shows the menu with changed props, as the page does once a save starts or ends. */
    update(changes) { Object.assign(props, changes); dirty = true; settle(); },
    /** Where the menu was placed, or undefined while it is closed. */
    placed: () => { settle(); return menu ? { ...menu.style } : undefined; },
  });
}

test("each destination's options button is named for it, and its menu has Move up, Move down, Edit and Delete, in that order (TRA-55)", () => {
  const screen = page();
  const menu = options(screen, { label: "Paris, France" });
  const closed = menu.tree();
  const button = nodes(closed).find((node) => node.type === "button");
  assert.deepEqual([button.props.type, button.props.className, button.props["aria-label"], button.props["aria-haspopup"], button.props["aria-expanded"], button.props["aria-controls"], button.props.disabled],
    ["button", "icon-button button", "Options for Paris, France", "menu", false, undefined, false], "Travel's icon button, named for the destination as its card names it");
  assert.deepEqual([button.props.children.type, button.props.children.props["aria-hidden"]], ["icon:MoreHorizontal", "true"], "three dots, named by the label alone");
  assert.equal(menu.open(), false, "the menu starts closed");
  menu.select();
  const shown = menu.tree();
  const opened = nodes(shown).find((node) => node.props?.["aria-haspopup"] === "menu");
  const list = nodes(shown).find((node) => node.props?.role === "menu");
  assert.deepEqual([opened.props["aria-expanded"], opened.props["aria-controls"], list.props.id, list.props["aria-labelledby"], opened.props.id], [true, "a:menu", "a:menu", "a:button", "a:button"], "screen readers hear the menu named for the destination");
  const items = nodes(list).filter((node) => node.props?.role === "menuitem");
  assert.deepEqual(items.map(text), ACTIONS);
  for (const [item, icon] of items.map((item, index) => [item, ["icon:ArrowUp", "icon:ArrowDown", "icon:Pencil", "icon:Trash2"][index]])) {
    assert.deepEqual([item.type, item.props.type, item.props.tabIndex, item.props.className], ["button", "button", -1, "item"], text(item));
    assert.deepEqual([item.props.children[0].type, item.props.children[0].props["aria-hidden"]], [icon, "true"], "each with its icon, as its button had, and its name");
  }
  assert.deepEqual(menu.calls, [], "opening it changes nothing");
});

test("Move up is disabled for the first destination and Move down for the last, both for a trip's only one, and disabled actions still show (TRA-55)", () => {
  for (const [first, last, disabled] of [[false, false, []], [true, false, ["Move up"]], [false, true, ["Move down"]], [true, true, ["Move up", "Move down"]]]) {
    const menu = options(page(), { first, last });
    menu.select();
    assert.deepEqual(menu.actions(), ACTIONS.map((name) => [name, disabled.includes(name)]), JSON.stringify({ first, last }));
  }
});

test("while a change saves, the options button and every action are disabled, so none saves twice (TRA-55)", () => {
  const menu = options(page());
  menu.update({ disabled: true });
  assert.equal(nodes(menu.tree()).find((node) => node.props?.["aria-haspopup"] === "menu").props.disabled, true);
  menu.update({ disabled: false });
  menu.select();
  menu.update({ disabled: true });
  assert.deepEqual(menu.actions(), ACTIONS.map((name) => [name, true]), "a menu open as a save starts");
  menu.update({ disabled: false });
  assert.deepEqual(menu.actions(), ACTIONS.map((name) => [name, false]));
});

test("opening the menu moves focus to its first enabled action, and the arrow keys, Home and End move among enabled actions (TRA-55)", () => {
  const screen = page();
  const menu = options(screen, { first: true });
  menu.button.focus();
  menu.select();
  const focused = () => screen.document.activeElement.name;
  assert.equal(focused(), "Move down", "Move up is disabled for the first destination");
  const moves = [["ArrowDown", "Edit"], ["ArrowDown", "Delete"], ["ArrowDown", "Move down"], ["ArrowUp", "Delete"], ["ArrowUp", "Edit"], ["Home", "Move down"], ["End", "Delete"]];
  for (const [key, to] of moves) {
    const event = menu.press(key);
    assert.deepEqual([focused(), event.prevented], [to, true], key);
  }
  // Enter and Space select the focused action as any button's do, and Tab moves on, so the menu leaves them to the browser.
  for (const key of ["Enter", " ", "Tab", "a"]) assert.deepEqual([menu.press(key).prevented, focused()], [false, "Delete"], key);
  // Focus back on the open menu's button, as Shift+Tab takes it, keeps the menu open, and the arrows go back into it.
  menu.button.focus();
  assert.equal(menu.open(), true);
  assert.deepEqual([menu.press("ArrowUp").prevented, focused()], [true, "Delete"]);
  menu.button.focus();
  assert.deepEqual([menu.press("ArrowDown").prevented, focused()], [true, "Move down"]);
  assert.deepEqual(menu.calls, [], "moving through the actions selects none");
  // With the menu closed, the keys do nothing.
  menu.press("Escape");
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) assert.deepEqual([menu.press(key).prevented, menu.open(), focused()], [false, false, "options button"], key);
});

test("Escape and the button again close the menu with focus back on the button, selecting nothing (TRA-55)", () => {
  const screen = page();
  const menu = options(screen);
  menu.select();
  menu.press("ArrowDown");
  const escape = menu.press("Escape");
  assert.deepEqual([escape.prevented, menu.open(), screen.document.activeElement], [true, false, menu.button]);
  assert.equal(nodes(menu.tree()).find((node) => node.props?.["aria-haspopup"] === "menu").props["aria-expanded"], false);
  menu.select();
  assert.equal(screen.document.activeElement, menu.item("Move up"));
  menu.select();
  assert.deepEqual([menu.open(), screen.document.activeElement], [false, menu.button], "the button again, which a mouse in Safari doesn't focus");
  assert.deepEqual(menu.calls, []);
});

test("selecting an action closes the menu and focuses the button before the action runs, and a move is given the button (TRA-55)", () => {
  for (const name of ACTIONS) {
    const screen = page();
    const menu = options(screen);
    menu.select();
    menu.select(name);
    assert.equal(menu.open(), false, name);
    const [[called, given, focus], ...more] = menu.calls;
    assert.deepEqual([called, focus, more], [name, "focus on its button", []], name);
    if (name.startsWith("Move")) assert.equal(given, "its button", "a move is given the button, which keeps focus once the page shows it");
  }
});

test("a click or tap outside the menu closes it and leaves focus where it went; one on the menu or its button doesn't (TRA-55)", () => {
  const screen = page();
  const menu = options(screen);
  assert.equal(screen.listeners.size, 0, "a closed menu doesn't listen");
  menu.select();
  for (const target of [menu.item("Edit"), menu.button, menu.root]) {
    screen.press(target);
    assert.equal(menu.open(), true, target.name);
  }
  const elsewhere = screen.element("the page");
  screen.press(elsewhere);
  assert.deepEqual([menu.open(), screen.listeners.size], [false, 0]);
  assert.notEqual(screen.document.activeElement, menu.button, "focus isn't moved back to the button: the click or tap decides it");
  assert.deepEqual(menu.calls, []);
});

test("focus moving outside the menu closes it, as Tab does, but focus within it or leaving the window doesn't (TRA-55)", () => {
  const screen = page();
  const menu = options(screen);
  menu.select();
  menu.item("Delete").focus();
  menu.button.focus();
  assert.equal(menu.open(), true, "focus on its own button, as Shift+Tab takes it");
  menu.focusLeft(menu.button, null);
  assert.equal(menu.open(), true, "focus leaving the window, as when switching apps");
  const next = screen.element("next control");
  next.focus();
  assert.deepEqual([menu.open(), screen.document.activeElement], [false, next], "Tab moves on and closes it");
});

test("opening another destination's menu closes the one that was open, by mouse, touch or keyboard (TRA-55)", () => {
  const screen = page();
  const rome = options(screen, { label: "Rome" }, { id: "rome" });
  const florence = options(screen, { label: "Florence" }, { id: "florence", top: 500 });
  rome.select();
  // A mouse or finger pressing Florence's button presses outside Rome's menu.
  screen.press(florence.button);
  florence.select();
  assert.deepEqual([rome.open(), florence.open(), screen.document.activeElement], [false, true, florence.item("Move up")]);
  florence.press("Escape");
  // Florence's menu opening without a press, as a screen reader opens it, takes focus out of Rome's.
  rome.select();
  florence.select();
  assert.deepEqual([rome.open(), florence.open(), screen.document.activeElement], [false, true, florence.item("Move up")]);
  florence.press("Escape");
  assert.equal(screen.listeners.size, 0, "closed menus stop listening");
  assert.deepEqual([...rome.calls, ...florence.calls], []);
});

test("the menu opens below its button, or above it when it doesn't fit below and there is more room above, within the part of the window people can see (TRA-55)", () => {
  const placed = (top, viewport) => {
    const menu = options(page(), {}, { top, viewport });
    menu.select();
    return menu.placed();
  };
  // Its tallest is 152 pixels, 4 pixels from the button and 8 from the edge of what people can see, as city suggestions are
  // placed (TRA-140). `top` is from the top of its box, the button's.
  assert.deepEqual(placed(100, { offsetTop: 0, height: 900 }), { top: "36px", maxHeight: "152px", transform: "" }, "below, with room");
  assert.deepEqual(placed(840, { offsetTop: 0, height: 900 }), { top: "-4px", maxHeight: "152px", transform: "translateY(-100%)" }, "above, near the bottom of the window");
  assert.deepEqual(placed(600, { offsetTop: 300, height: 400 }), { top: "-4px", maxHeight: "152px", transform: "translateY(-100%)" }, "above, near the bottom of a zoomed-in view");
  assert.deepEqual(placed(80, { offsetTop: 0, height: 200 }), { top: "36px", maxHeight: "76px", transform: "" }, "below, shortened, where neither side fits it and below has more room");
});

const MODULE = "../src/components/destination-options-menu.module.css";
const GLOBALS = "../src/app/globals.css";

test("the menu floats over the card, right-aligned with its button, above Send feedback, and fits a 320-pixel phone; touchscreens get 44-pixel targets (TRA-55)", () => {
  const rule = (selector, width = 1024, input) => styles(MODULE, [selector], width, input);
  assert.equal(rule(".options").position, "relative");
  const menu = rule(".menu");
  assert.deepEqual([menu.position, menu.right, menu["overflow-y"]], ["absolute", "0", "auto"], "lined up with the button's right edge, scrolling when shortened");
  const launcher = cssRules(GLOBALS).find(([selector]) => selector === ".feedback-launcher")[1];
  assert.ok(Number(menu["z-index"]) > Number(launcher["z-index"]), "above Send feedback");
  // On a 320-pixel phone a trip's card is 320 - 2 × 18 pixels wide, with 12 pixels of padding and a 1-pixel border inside
  // each side (TRA-156). The button is at the right of its padding, so the menu reaches left from there within the card.
  const card = styles(GLOBALS, [".destination-card", ".trip-page .destination-card"], 320);
  const inside = 320 - 2 * 18 - 2 * parseInt(card.padding) - 2;
  assert.ok(parseInt(menu["min-width"]) <= inside, `${menu["min-width"]} within ${inside}px`);
  assert.deepEqual([rule(".options .button", 390, TOUCH).width, rule(".options .button", 390, TOUCH).height, rule(".item", 390, TOUCH)["min-height"]], ["44px", "44px", "44px"]);
  assert.deepEqual([rule(".options .button").width, rule(".item")["min-height"]], [undefined, "36px"], "a mouse keeps Travel's 32-pixel icon button");
});

test("the four buttons' layout rules are gone, and the options button keeps their place at the right of the destination's name (TRA-55)", () => {
  const rules = cssRules(GLOBALS).filter(([selector]) => selector.split(",").some((part) => part.trim().startsWith(".destination-tools")));
  assert.deepEqual(rules, [[".destination-tools", { "margin-left": "auto", "margin-top": "-3px" }, "@media(max-width:540px)"]], "on phones it stays at the right, level with the name");
});

// The trip's page, rendered by the planner from what the store gives `/trips/<trip ID>`, with React's state kept between
// renders and its effects run, its saves made by the store, and each card's options standing in for the menu tested
// above: its props, and a button that takes focus. As a browser does, a focused button that turns disabled loses focus.
class FormData {
  constructor(form) { this.fields = form.fields; }
  get(name) { return name in this.fields ? this.fields[name] : null; }
  has(name) { return name in this.fields; }
  getAll(name) { return name in this.fields ? [this.fields[name]] : []; }
}
function tripPage(store, tripId) {
  const slots = [], effects = [];
  let cursor = 0, pending = [];
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
    // A transition finishes at once.
    useTransition: () => [false, (work) => work()],
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = effects[index];
      if (previous && deps && deps.every((dep, at) => Object.is(dep, previous.deps[at]))) return;
      pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
    },
  };
  const body = { name: "body" };
  const document = { body, activeElement: body, getElementById: () => null };
  const buttons = new Map();
  /** The options button on `label`'s card, as the page keeps it. */
  const button = (label) => {
    if (!buttons.has(label)) buttons.set(label, { name: label, disabled: false, parentElement: null, focus() { document.activeElement = this; }, matches(selector) { return selector === ":disabled" && this.disabled; } });
    return buttons.get(label);
  };
  const menus = new Map();
  const sent = [];
  const modules = {
    react, "react/jsx-runtime": jsxRuntime, "lucide-react": icons,
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), unstable_isUnrecognizedActionError: () => false },
    "@/app/actions": { mutatePlanner: async (mutation) => { sent.push({ ...mutation }); return { ok: true, ...store.applyMutation(mutation) }; } },
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort,
    "@/components/destination-options-menu": {
      DestinationOptionsMenu(props) {
        menus.set(props.label, props);
        const shown = button(props.label);
        shown.disabled = props.disabled;
        if (shown.disabled && document.activeElement === shown) document.activeElement = body;
        return element("destination-options-menu", { ...props, children: [] });
      },
    },
  };
  const globals = { FormData, document, HTMLElement: class HTMLElement {}, setTimeout: () => 0, clearTimeout() {} };
  const load = (file) => {
    const exports = {};
    // Every other module is one the destination cards don't need: each of its exports renders, and returns, nothing.
    runInNewContext(compile(file), { exports, require: (name) => modules[name] ?? new Proxy({}, { get: () => () => null }), ...globals });
    return exports;
  };
  modules["@/components/focus-after"] = load("../src/components/focus-after.ts");
  const { default: PlannerApp } = load("../src/components/planner-app.tsx");
  /** An element as the browser has it: host elements with their children rendered, and each component and fragment in its place. */
  function render(node) {
    if (Array.isArray(node)) return [...node].flatMap(render);
    if (node === null || node === undefined || typeof node === "boolean") return [];
    if (typeof node !== "object") return [String(node)];
    if (typeof node.type === "function") return render(node.type(node.props));
    if (node.type === "fragment") return render(node.props.children);
    return [{ type: node.type, key: node.key, props: { ...node.props, children: render(node.props.children) } }];
  }
  let props, shown;
  /** The page as it renders now. It renders twice, as React renders again at once when the page loads a trip again, then runs its effects. */
  const show = () => {
    for (let pass = 0; pass < 2; pass++) { cursor = 0; pending = []; shown = render(PlannerApp(props)); }
    for (const run of pending) run();
  };
  const reload = () => { const { data, access, library } = store.getTripSnapshot(tripId); props = { initialData: data, access: { [tripId]: access }, library, tripId }; show(); };
  reload();
  const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
  const all = () => shown.flatMap(within);
  const dialog = () => all().find((node) => node.type === "dialog");
  return {
    sent, document, button, all, within,
    /** The latest options `label`'s card gave its menu. */
    menu: (label) => menus.get(label),
    /** The destination cards' names, in order. */
    cards: () => all().filter((node) => node.type === "article" && node.props.className === "destination-card").map((card) => text(within(card).find((node) => node.type === "h3"))),
    /** What each card's destination tools hold. */
    tools: () => all().filter((node) => node.props?.className === "destination-tools").map((tools) => tools.props.children),
    /** The open dialog's title, or undefined without one. */
    dialog: () => dialog() && text(within(dialog()).find((node) => node.type === "h2")),
    dialogNodes: () => within(dialog()),
    message: () => { const toast = all().find((node) => node.props?.role === "status" && node.props.className === "toast"); return toast && text(toast); },
    /** Selects one of `label`'s actions as its menu does: closes, focuses its button, then runs the action with a move given the button. */
    choose(label, action) {
      const shownButton = button(label);
      shownButton.focus();
      menus.get(label)[action](shownButton);
      show();
    },
    /** Selects a button by its text. */
    click(label) { all().find((node) => node.type === "button" && text(node) === label).props.onClick({ currentTarget: {} }); show(); },
    /** Submits the open dialog with `fields`. */
    submit(fields = {}) { all().find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { fields } }); show(); },
    /** Waits for the save in progress, then loads the page again, as a saved change does. */
    async settle() { await new Promise((resolve) => setImmediate(resolve)); reload(); },
    /** The page's first render, as a component tree before React renders its components. */
    tree: () => { cursor = 0; return PlannerApp(props); },
  };
}

/** Rome, Florence and Venice, with stay notes and nights, in a trip that starts on April 10, 2027. */
function italy(t) {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-04-10" }));
  const rome = addDestination(store, tripId, { city: "Rome", nights: 3, stay: "Near the Pantheon" });
  const florence = addDestination(store, tripId, { city: "Florence", nights: 2, stay: "Oltrarno", notes: "Uffizi tickets" });
  const venice = addDestination(store, tripId, { city: "Venice", nights: 2, stay: "Cannaregio" });
  return { store, tripId, rome, florence, venice };
}
/** A trip's connections, each as the stops it joins, null for the departing or return city. */
const connections = (store, tripId) => store.getTripSnapshot(tripId).data.legs.map((leg) => [leg.fromId, leg.toId]);

test("each trip destination card has one options button where its Move up, Move down, Edit and Delete buttons were (TRA-55)", (t) => {
  const { store, tripId } = italy(t);
  const page = tripPage(store, tripId);
  assert.deepEqual(page.tools().map((children) => children.map((child) => child.type)), [["destination-options-menu"], ["destination-options-menu"], ["destination-options-menu"]], "the tools hold the menu alone");
  assert.deepEqual(["Rome", "Florence", "Venice"].map((label) => [page.menu(label).first, page.menu(label).last, page.menu(label).disabled]), [[true, false, false], [false, false, false], [false, true, false]]);
  const old = page.all().filter((node) => node.type === "button" && /^(Move .+ (up|down)|Edit (Rome|Florence|Venice)|Remove .+ from this trip)$/.test(node.props["aria-label"] ?? ""));
  assert.deepEqual(old, [], "no arrows, pencil or trash can remain");
  // A city chosen from a suggestion is named as its card names it, and a trip's only destination can't move either way.
  const { store: one, tripId: lone } = setup(t);
  one.applyMutation({ type: "stop.add", tripId: lone, city: "Naples, Campania, Italy", cityFromSuggestion: true });
  const single = tripPage(one, lone);
  assert.deepEqual([single.cards(), single.menu("Naples, Italy").first, single.menu("Naples, Italy").last], [["Naples, Italy"], true, true]);
});

test("Move up and Move down save the trip's new order through stop.move, its connections follow, and focus returns to the moved destination's options button (TRA-55)", async (t) => {
  const { store, tripId, rome, florence, venice } = italy(t);
  for (const [index, leg] of store.getTripSnapshot(tripId).data.legs.entries()) {
    store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: String(50 + index), miscAmount: "12", departure: "Morning", arrival: "Noon", url: "https://example.com/trains", notes: "Booked " + index });
  }
  const returning = store.getTripSnapshot(tripId).data.legs.find((leg) => leg.fromId === venice && leg.toId === null);
  const page = tripPage(store, tripId);
  page.choose("Florence", "onMoveUp");
  assert.deepEqual(["Rome", "Florence", "Venice"].map((label) => page.menu(label).disabled), [true, true, true], "every destination's options wait while it saves");
  assert.equal(page.document.activeElement, page.document.body, "the options button lost focus as it turned disabled");
  await page.settle();
  assert.deepEqual(page.sent, [{ type: "stop.move", id: florence, direction: "up" }]);
  assert.deepEqual(page.cards(), ["Florence", "Rome", "Venice"]);
  assert.equal(page.message(), "Route updated. Review the new travel connections.");
  assert.deepEqual(connections(store, tripId), [[null, florence], [florence, rome], [rome, venice], [venice, null]]);
  const kept = store.getTripSnapshot(tripId).data.legs.find((leg) => leg.fromId === venice && leg.toId === null);
  assert.deepEqual([kept.id, kept.method, kept.notes], [returning.id, "Train", returning.notes], "a connection the move doesn't change keeps its plans");
  assert.equal(page.document.activeElement, page.button("Florence"), "focus is on Florence's options button once the page shows the move");
  assert.deepEqual(["Florence", "Rome", "Venice"].map((label) => [page.menu(label).first, page.menu(label).last, page.menu(label).disabled]), [[true, false, false], [false, false, false], [false, true, false]]);

  page.choose("Rome", "onMoveDown");
  await page.settle();
  assert.deepEqual(page.sent.at(-1), { type: "stop.move", id: rome, direction: "down" });
  assert.deepEqual(page.cards(), ["Florence", "Venice", "Rome"]);
  assert.equal(page.document.activeElement, page.button("Rome"));
});

test("a moved destination's card keeps its key, so the browser moves it, with its options button, rather than drawing it again (TRA-55)", (t) => {
  const { store, tripId, rome, florence, venice } = italy(t);
  const page = tripPage(store, tripId);
  const find = (node, predicate) => Array.isArray(node) ? node.reduce((found, child) => found ?? find(child, predicate), null)
    : !node || typeof node !== "object" ? null : predicate(node) ? node : find(node.props?.children, predicate);
  const list = find(page.tree(), (node) => node.props?.className === "destination-list");
  const [cards, last] = list.props.children;
  assert.ok(cards.every((child) => !Array.isArray(child) && typeof child.key === "string"), "one flat list of keyed elements");
  assert.deepEqual(cards.map((child) => child.key), [rome, florence, venice].flatMap((id) => ["insert-" + id, id]));
  assert.equal(last.key, "insert-last");
});

test("Edit opens the destination's complete editor with this trip's stay, and Cancel saves nothing (TRA-55)", (t) => {
  const { store, tripId } = italy(t);
  const page = tripPage(store, tripId);
  page.choose("Florence", "onEdit");
  assert.equal(page.dialog(), "Edit destination: Florence");
  assert.equal(page.dialogNodes().find((node) => node.props?.name === "stay").props.defaultValue, "Oltrarno", "with the stay's notes, as the pencil opened it");
  page.click("Cancel");
  assert.deepEqual([page.dialog(), page.sent], [undefined, []]);
});

test("Delete opens the confirmation the trash can did: Cancel changes nothing, and Remove from trip removes only this trip's stay (TRA-55)", async (t) => {
  const { store, tripId, rome, florence, venice } = italy(t);
  const before = store.getSnapshot();
  const page = tripPage(store, tripId);
  page.choose("Florence", "onDelete");
  assert.equal(page.dialog(), "Remove “Florence” from this trip?");
  assert.equal(text(page.dialogNodes().find((node) => node.props?.className === "delete-description wide")),
    "Its hotels, activities, restaurants, photos, and research stay in Destinations and in any other trip. This trip’s nights, stay notes, and travel plans to and from it are removed, and the remaining route reconnects. This cannot be undone.");
  assert.equal(text(page.dialogNodes().find((node) => node.type === "button" && node.props.type === "submit")), "Remove from trip");
  page.click("Cancel");
  assert.deepEqual([page.dialog(), page.sent, store.getSnapshot()], [undefined, [], before], "canceling changes nothing");
  page.choose("Florence", "onDelete");
  page.submit();
  await page.settle();
  assert.deepEqual(page.sent, [{ type: "stop.remove", id: florence }]);
  assert.deepEqual(page.cards(), ["Rome", "Venice"]);
  assert.deepEqual(connections(store, tripId), [[null, rome], [rome, venice], [venice, null]], "the route reconnects");
  assert.equal(destination(store, florence).notes, "Uffizi tickets", "Florence stays in Destinations with what is saved for it");
});
