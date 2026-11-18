import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as destinationLibrary from "../src/lib/destination-library.ts";
import * as dropdownPosition from "../src/lib/dropdown-position.ts";

// Run the actual city field with a small hook harness. City suggestions come from `locations`, which aren't an array
// when the lookup fails; nothing is fetched.
const compiled = ts.transpileModule(readFileSync(new URL("../src/components/location-field.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** An element as the city field measures it: its box in the window, its style, and the elements inside it. */
class FakeElement {
  constructor(box = {}, inside = []) { Object.assign(this, { box, inside, style: {}, scrollTop: 0, children: [] }); }
  getBoundingClientRect() { return this.box; }
  contains(node) { return node === this || this.inside.some((child) => child.contains(node)); }
  focus() {}
}

/** Something the field listens to, which records its listeners and calls them. */
function listened(target) {
  return Object.assign(target, {
    listeners: [],
    addEventListener(type, listener, capture = false) { this.listeners.push({ type, listener, capture }); },
    removeEventListener(type, listener, capture = false) {
      this.listeners = this.listeners.filter((one) => !(one.type === type && one.listener === listener && one.capture === capture));
    },
    dispatch(type, event = {}) { for (const one of [...this.listeners]) if (one.type === type) one.listener(event); },
  });
}

/**
 * The window around a city field (TRA-140), as Chromium measured Add destination's at 1920 × 911: the field, the editor's
 * scrolling fields around it, and the window with its visual viewport, the part of it people can see.
 */
function fakeScreen() {
  const field = new FakeElement({ top: 376, bottom: 419, left: 708, width: 504 });
  return { field, fields: new FakeElement({}, [field]), window: listened({ visualViewport: listened({ offsetTop: 0, height: 911 }) }) };
}

function harness(props, locations = [], screen = fakeScreen()) {
  const hooks = [], effects = [], timers = new Set(), attached = new Set();
  let cursor = 0, tree, pending = [];
  // Effects run after each render whose dependencies changed, as React runs them.
  function useEffect(effect, deps) {
    const index = cursor++;
    const previous = effects[index];
    if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
    pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
  }
  const react = {
    useId: () => "city",
    useRef: (initial) => hooks[cursor++] ??= { current: initial },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (value) => { hooks[index] = value; }];
    },
    useEffect,
    useLayoutEffect: useEffect,
  };
  const jsx = (type, props) => ({ type, props });
  const loaded = { exports: {} };
  runInNewContext(compiled, {
    exports: loaded.exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return { MapPin: "map-pin", Plane: "plane" };
      if (name === "@/lib/destination-label") return destinationLabel;
      if (name === "@/lib/destination-library") return destinationLibrary;
      if (name === "@/lib/dropdown-position") return dropdownPosition;
      throw new Error("Unexpected component import: " + name);
    },
    fetch: async () => ({ ok: true, json: async () => ({ locations }) }),
    AbortController,
    setTimeout: (callback) => { const timer = { callback }; timers.add(timer); return timer; },
    clearTimeout: (timer) => { timers.delete(timer); },
    window: screen.window,
    Element: FakeElement,
  });
  // React gives refs their elements before effects run: the combobox's input is the field, and the suggestions' box and
  // list are new each time they appear. Each suggestion is 50 pixels tall in a list 220 pixels tall with 3 pixels of
  // padding. A ref whose element left the page is cleared.
  function attach() {
    const present = new Set();
    for (const node of nodes(tree)) {
      const ref = node.props?.ref;
      if (!ref) continue;
      present.add(ref);
      attached.add(ref);
      ref.current ??= node.props.role === "combobox" ? screen.field : new FakeElement(node.type === "ul" ? { top: 0, bottom: 220 } : {});
      if (node.type === "ul") ref.current.children = [node.props.children].flat().map((_, index) => ({
        getBoundingClientRect: () => ({ top: 3 + 50 * index - ref.current.scrollTop, bottom: 53 + 50 * index - ref.current.scrollTop }),
      }));
    }
    for (const ref of attached) if (!present.has(ref)) ref.current = null;
  }
  function render() {
    cursor = 0;
    pending = [];
    tree = loaded.exports.default(props);
    attach();
    for (const run of pending) run();
  }
  const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  const find = (predicate) => nodes(tree).find(predicate);
  const field = () => find((node) => node.props?.role === "combobox");
  render();
  return {
    shown: () => field().props.value,
    /** What the form sends: each named input's value. */
    sent: () => Object.fromEntries(nodes(tree).filter((node) => node.type === "input" && node.props.name).map((node) => [node.props.name, node.props.value])),
    type(value) { field().props.onChange({ target: { value } }); render(); },
    /** Waits out the search delay, then shows the suggestions. */
    async search() {
      for (const timer of [...timers]) { timers.delete(timer); timer.callback(); }
      for (let i = 0; i < 20; i++) await Promise.resolve();
      render();
    },
    /** Each suggestion's icon, name, where it is, and the tag marking a saved destination (TRA-142). */
    options: () => nodes(tree).filter((node) => node.props?.role === "option").map((node) => {
      const [icon, text, tag] = node.props.children;
      return [icon.type, ...text.props.children.map((line) => line.props.children), ...(tag ? [tag.props.children] : [])];
    }),
    /** What the field tells screen readers about its suggestions. */
    status: () => find((node) => node.props?.role === "status").props.children,
    /** Waits out the search delay, then chooses the suggestion at `index`. */
    async choose(index) {
      await this.search();
      find((node) => node.props?.id === `city-option-${index}`).props.onClick();
      render();
    },
    /** Presses a key in the field and shows what it did, returning the key's event. */
    press(key) {
      const event = { key, nativeEvent: { isComposing: false }, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      field().props.onKeyDown(event);
      render();
      return event;
    },
    /** The suggestion the arrow keys reached, as the field tells screen readers. */
    active: () => field().props["aria-activedescendant"],
    /** The suggestions' list. */
    list: () => find((node) => node.type === "ul").props.ref.current,
    /** Where the field put its suggestions, or undefined while they are closed. */
    placed() {
      const style = find((node) => node.props?.className === "location-panel")?.props.ref.current.style;
      return style && { ...style };
    },
    /** Shows the field again after something outside it changed it, as React does. */
    render,
  };
}

const destinationField = (defaultValue, locations, screen) => harness({ name: "city", label: "City or destination", defaultValue, compactDestination: true }, locations, screen);
const wooster = { id: "1", name: "Wooster", region: "Ohio", country: "United States", countryCode: "US", label: "Wooster, Ohio, United States" };

test("a destination's city editor opens on its city exactly as saved and sends it unchanged (TRA-76)", () => {
  for (const city of ["Tokyo, Kyoto, Japan", "Chicago, Cook County, IL", "Wooster, Ohio, United States"]) {
    const field = destinationField(city);
    assert.equal(field.shown(), city);
    assert.deepEqual(field.sent(), { city }, "without a suggestion's record, so a recorded city keeps the one it has");
  }
});

test("a chosen suggestion shows its shorter label and sends its full label as a suggestion's until the text changes", async () => {
  const field = destinationField("Tokyo, Kyoto, Japan", [wooster]);
  field.type("Wooster");
  assert.deepEqual(field.sent(), { city: "Wooster" });
  await field.choose(0);
  assert.equal(field.shown(), "Wooster, Ohio");
  assert.deepEqual(field.sent(), { city: "Wooster, Ohio, United States", cityFromSuggestion: "true" });
  field.type("Wooster, Ohio!");
  assert.deepEqual(field.sent(), { city: "Wooster, Ohio!" }, "edited text is sent as entered");
  field.type("Wooster, Ohio");
  assert.deepEqual(field.sent(), { city: "Wooster, Ohio, United States", cityFromSuggestion: "true" }, "the chosen label typed again is the suggestion");
});

test("departing and return city fields send a chosen suggestion's full label, without a record", async () => {
  const field = harness({ name: "homeCity", label: "Departing city", defaultValue: "Boston" }, [wooster]);
  assert.deepEqual(field.sent(), { homeCity: "Boston" });
  field.type("Wooster");
  await field.choose(0);
  assert.deepEqual([field.shown(), field.sent()], ["Wooster, Ohio, United States", { homeCity: "Wooster, Ohio, United States" }]);
});

// An airport suggested for its code (TRA-132), as the location search sends it.
const clevelandAirport = { id: "CLE", name: "Cleveland Hopkins International Airport (CLE)", region: "Cleveland", country: "United States", countryCode: "US", label: "CLE", airport: { latitude: 41.4117, longitude: -81.8498 } };

test("departing and return city fields suggest an airport for its code, and choosing it saves the code (TRA-132)", async () => {
  for (const name of ["homeCity", "returnCity"]) {
    const field = harness({ name, label: "City" }, [clevelandAirport, wooster]);
    field.type("cle");
    await field.search();
    assert.deepEqual(field.options(), [
      ["plane", "Cleveland Hopkins International Airport (CLE)", "Cleveland, United States"],
      ["map-pin", "Wooster", "Ohio, United States"],
    ]);
    await field.choose(0);
    assert.deepEqual([field.shown(), field.sent()], ["CLE", { [name]: "CLE" }]);
  }
});

test("a destination's city field suggests no airports, since a destination is a city (TRA-132)", async () => {
  const field = destinationField("", [clevelandAirport, wooster]);
  field.type("cle");
  await field.search();
  assert.deepEqual(field.options(), [["map-pin", "Wooster", "Ohio, United States"]]);
  await field.choose(0);
  assert.deepEqual(field.sent(), { city: "Wooster, Ohio, United States", cityFromSuggestion: "true" });
});

// TRA-140: eight suggestions, more than fit in the list at once.
const springs = ["Springfield", "Spring", "Springdale", "Springville", "Spring Hill", "Spring Valley", "Springboro", "Spring Lake"]
  .map((name, index) => ({ id: String(index + 1), name, region: "Ohio", country: "United States", countryCode: "US", label: name + ", Ohio, United States" }));
/** Below the field at 1920 × 911, as wide as it and as tall as before TRA-140. */
const BELOW = { top: "423px", left: "708px", width: "504px", maxHeight: "222px", transform: "" };

test("Add destination's suggestions float over the editor below the city, as wide as it and 222 pixels tall at most (TRA-140)", async () => {
  const field = destinationField("", springs);
  field.type("Spr");
  assert.deepEqual(field.placed(), BELOW, "while finding cities");
  await field.search();
  assert.equal(field.options().length, 8);
  assert.deepEqual(field.placed(), BELOW);
});

test("when an on-screen keyboard leaves too little room below the city, its suggestions move above it, and back", async () => {
  const screen = fakeScreen();
  const field = destinationField("", springs, screen);
  field.type("Spr");
  await field.search();
  Object.assign(screen.window.visualViewport, { height: 420 });
  screen.window.visualViewport.dispatch("resize");
  assert.deepEqual(field.placed(), { ...BELOW, top: "372px", transform: "translateY(-100%)" }, "their bottom 4 pixels above the city");
  Object.assign(screen.window.visualViewport, { height: 911 });
  screen.window.visualViewport.dispatch("resize");
  assert.deepEqual(field.placed(), BELOW);
});

test("scrolling the editor's fields closes the suggestions, as a select's list closes, and scrolling anything else places them again", async () => {
  const screen = fakeScreen();
  const field = destinationField("", springs, screen);
  field.type("Spr");
  await field.search();
  // The page behind the editor scrolled and the editor moved up, then the list and the field's own text scrolled.
  screen.field.box = { top: 300, bottom: 343, left: 708, width: 504 };
  for (const target of [{}, field.list(), screen.field]) screen.window.dispatch("scroll", { target });
  field.render();
  assert.deepEqual(field.placed(), { ...BELOW, top: "347px" });
  assert.equal(field.options().length, 8);
  screen.window.dispatch("scroll", { target: screen.fields });
  field.render();
  assert.equal(field.placed(), undefined);
  assert.deepEqual(field.options(), []);
  assert.deepEqual([screen.window.listeners, screen.window.visualViewport.listeners], [[], []], "nothing still listens once they close");
  assert.equal(field.shown(), "Spr", "the city is unchanged");
});

test("arrow keys move through the suggestions, scrolling only their list, Enter chooses one and Escape closes them, not the editor", async () => {
  const field = destinationField("", springs);
  field.type("Spr");
  await field.search();
  for (let i = 0; i < 5; i++) field.press("ArrowDown");
  assert.deepEqual([field.active(), field.list().scrollTop], ["city-option-4", 33], "the fifth suggestion's bottom shows at the list's bottom");
  for (let i = 0; i < 4; i++) field.press("ArrowUp");
  assert.deepEqual([field.active(), field.list().scrollTop], ["city-option-0", 3], "the first suggestion's top shows at the list's top");
  field.press("ArrowUp");
  assert.deepEqual([field.active(), field.list().scrollTop], ["city-option-7", 183], "Up from the first goes to the last");
  assert.equal(field.press("Enter").prevented, true);
  assert.deepEqual([field.shown(), field.sent(), field.placed()], ["Spring Lake, Ohio", { city: "Spring Lake, Ohio, United States", cityFromSuggestion: "true" }, undefined]);
  field.type("Spri");
  await field.search();
  const escape = field.press("Escape");
  assert.deepEqual([escape.prevented, escape.stopped, field.placed(), field.shown()], [true, true, undefined, "Spri"]);
  assert.equal(field.press("Escape").stopped, undefined, "a second Escape reaches the editor, which closes");
});

// TRA-142: the saved destinations a trip's Add destination offers, as its page gives them, and Open-Meteo's suggestions.
const reykjavik = { id: "11111111-1111-4111-8111-111111111111", city: "Reykjavík, Iceland", cityFromSuggestion: false };
const nuuk = { id: "22222222-2222-4222-8222-222222222222", city: "Nuuk, Greenland", cityFromSuggestion: false };
const nuukByCode = { id: "33333333-3333-4333-8333-333333333333", city: "Nuuk, Sermersooq, GL", cityFromSuggestion: false };
const vienna = { id: "44444444-4444-4444-8444-444444444444", city: "Vienna, State of Vienna, Austria", cityFromSuggestion: true };
const library = [nuuk, nuukByCode, reykjavik, vienna];
const reykjavikSuggestion = { id: "3413829", name: "Reykjavík", region: "Capital Region", country: "Iceland", countryCode: "IS", label: "Reykjavík, Capital Region, Iceland" };
const reykjahlid = { id: "2627788", name: "Reykjahlíð", region: "Northeast", country: "Iceland", countryCode: "IS", label: "Reykjahlíð, Northeast, Iceland" };
const nuukSuggestion = { id: "3421319", name: "Nuuk", region: "Sermersooq", country: "Greenland", countryCode: "GL", label: "Nuuk, Sermersooq, Greenland" };
const addDestinationField = (locations) => harness({ name: "city", label: "City or destination", compactDestination: true, library }, locations);
const SAVED_REYKJAVIK = ["map-pin", "Reykjavík", "Iceland", "In your library"];

test("Add destination offers saved destinations first, marked In your library, in place of the suggestions that are them (TRA-142)", async () => {
  const field = addDestinationField([reykjavikSuggestion, reykjahlid]);
  field.type("Reykjavik");
  assert.deepEqual(field.options(), [SAVED_REYKJAVIK], "a saved destination needs no lookup, so it shows while suggestions load");
  assert.equal(field.status(), "1 suggestion, 1 in your library. Use the arrow keys to choose, then press Enter.");
  await field.search();
  assert.deepEqual(field.options(), [SAVED_REYKJAVIK, ["map-pin", "Reykjahlíð", "Northeast, Iceland"]], "the suggestion that is the saved Reykjavík shows once, as saved");
  assert.equal(field.status(), "2 suggestions, 1 in your library. Use the arrow keys to choose, then press Enter.");
});

test("each saved destination a suggestion is shows once, and a city chosen from a suggestion shows as it does everywhere", async () => {
  // Two saved Nuuks, from before Add destination recognized them, are both the suggestion, and neither is merged away.
  const field = addDestinationField([nuukSuggestion]);
  field.type("nuuk");
  await field.search();
  assert.deepEqual(field.options(), [["map-pin", "Nuuk", "Greenland", "In your library"], ["map-pin", "Nuuk", "Sermersooq, GL", "In your library"]]);
  const viennaField = addDestinationField([]);
  viennaField.type("Vie");
  await viennaField.search();
  assert.deepEqual(viennaField.options(), [["map-pin", "Vienna", "Austria", "In your library"]]);
});

test("choosing a saved destination shows its city as saved and sends its ID instead of a city, until the text changes", async () => {
  const field = addDestinationField([wooster]);
  field.type("Vienna");
  await field.choose(0);
  assert.deepEqual([field.shown(), field.sent()], ["Vienna, Austria", { destinationId: vienna.id }]);
  field.type("Vienna, Austria!");
  assert.deepEqual(field.sent(), { city: "Vienna, Austria!" }, "edited text is a city, sent as entered");
  field.type("Vienna, Austria");
  assert.deepEqual(field.sent(), { destinationId: vienna.id }, "the saved destination's city typed again is the saved destination");
  field.type("Wooster");
  await field.choose(0);
  assert.deepEqual(field.sent(), { city: "Wooster, Ohio, United States", cityFromSuggestion: "true" }, "a new city is still a suggestion's");
});

test("the arrow keys reach saved destinations first and Enter chooses one", async () => {
  const field = addDestinationField([reykjavikSuggestion, reykjahlid]);
  field.type("Reyk");
  await field.search();
  field.press("ArrowDown");
  assert.equal(field.active(), "city-option-0");
  field.press("ArrowDown");
  field.press("ArrowUp");
  assert.equal(field.press("Enter").prevented, true);
  assert.deepEqual([field.shown(), field.sent(), field.placed()], ["Reykjavík, Iceland", { destinationId: reykjavik.id }, undefined]);
});

test("saved destinations still show when city suggestions are unavailable", async () => {
  const field = addDestinationField(null);
  field.type("Nuuk");
  await field.search();
  assert.deepEqual(field.options().map((option) => option.at(-1)), ["In your library", "In your library"]);
  field.type("Oslo");
  await field.search();
  assert.deepEqual([field.options(), field.status()], [[], "City suggestions are unavailable. You can still enter your own location."]);
});
