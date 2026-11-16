import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as destinationLabel from "../src/lib/destination-label.ts";

// Run the actual city field with a small hook harness. City suggestions come from `locations`; nothing is fetched.
const compiled = ts.transpileModule(readFileSync(new URL("../src/components/location-field.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(props, locations = []) {
  const hooks = [], effects = [], timers = new Set();
  let cursor = 0, tree, pending = [];
  const react = {
    useId: () => "city",
    useRef: (initial) => hooks[cursor++] ??= { current: initial },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (value) => { hooks[index] = value; }];
    },
    // Effects run after each render whose dependencies changed, as React runs them.
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = effects[index];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
    },
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
      throw new Error("Unexpected component import: " + name);
    },
    fetch: async () => ({ ok: true, json: async () => ({ locations }) }),
    AbortController,
    setTimeout: (callback) => { const timer = { callback }; timers.add(timer); return timer; },
    clearTimeout: (timer) => { timers.delete(timer); },
  });
  function render() {
    cursor = 0;
    pending = [];
    tree = loaded.exports.default(props);
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
    /** Each suggestion's icon, name and where it is. */
    options: () => nodes(tree).filter((node) => node.props?.role === "option").map((node) => {
      const [icon, text] = node.props.children;
      return [icon.type, ...text.props.children.map((line) => line.props.children)];
    }),
    /** Waits out the search delay, then chooses the suggestion at `index`. */
    async choose(index) {
      await this.search();
      find((node) => node.props?.id === `city-option-${index}`).props.onClick();
      render();
    },
  };
}

const destinationField = (defaultValue, locations) => harness({ name: "city", label: "City or destination", defaultValue, compactDestination: true }, locations);
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
