import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as entryRequirements from "../src/lib/entry-requirements.ts";
import * as healthSafety from "../src/lib/health-safety.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as typicalWeather from "../src/lib/typical-weather.ts";
import * as uuid from "../src/lib/uuid.ts";

// TRA-148: Entry requirements, Health and safety and Typical weather show Edit and Clear only while open, and Add
// whenever nothing is recorded. The real sections and focus-after.ts run with a small hook harness and a stand-in for
// the page's focus: no browser or server is involved.
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const jsx = (type, props, key) => ({ type, props, key });
const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
// A CSS module's class names are their own names, and an icon or stand-in component is its name.
const names = new Proxy({}, { get: (_target, name) => name });

/** Hooks that keep their state between renders, as React keeps one section's on one card. */
function hooks() {
  const slots = [];
  let cursor = 0;
  return {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useId: () => "id-" + cursor++,
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      // A callback is kept until one of its dependencies changes.
      useCallback(callback, deps) {
        const index = cursor++;
        const saved = slots[index];
        if (!saved || deps.some((dep, at) => !Object.is(dep, saved.deps[at]))) slots[index] = { callback, deps };
        return slots[index].callback;
      },
      useEffect() {},
    },
    render(component, props) { cursor = 0; return component(props); },
  };
}

/** The page's focus: the element that has it, which an element's `focus()` takes. */
const page = { activeElement: null };
const element = (name) => ({ name, focus() { page.activeElement = this; } });

function load(path, react, modules, globals = {}) {
  const loaded = { exports: {} };
  runInNewContext(compile(path), {
    ...globals,
    exports: loaded.exports,
    require(name) {
      const known = { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" }, "lucide-react": names, ...modules };
      if (!(name in known)) throw new Error("Unexpected component import: " + name);
      return known[name];
    },
  });
  return loaded.exports;
}

/** One section on one card, from `path`'s `name`, rendered again after each change, as React does. */
function section(path, name, modules, props) {
  const { react, render } = hooks();
  const focusAfter = load("../src/components/focus-after.ts", react, {}, { document: page });
  const Section = load(path, react, {
    "@/components/focus-after": focusAfter, "@/components/research-links": names, "@/lib/trip-dates": tripDates, "@/lib/uuid": uuid, ...modules,
  })[name];
  const calls = [];
  const full = { disabled: false, onEdit: () => calls.push("edit"), onClear: () => calls.push("clear"), onEditClimate: () => calls.push("editClimate"), onClearClimate: () => calls.push("clearClimate"), ...props };
  let tree = render(Section, full);
  const find = (predicate) => nodes(tree).filter(predicate);
  const toggle = () => find((node) => node.props?.["aria-expanded"] !== undefined)[0];
  const buttons = (node) => nodes(node).filter((child) => child.type === "button");
  return {
    calls,
    /** Selects the heading, opening or closing the section. */
    toggle() { toggle().props.onClick(); tree = render(Section, full); },
    /** Shows the section with `changes`, as the page does once a save shows. */
    update(changes) { Object.assign(full, changes); tree = render(Section, full); },
    hidden: () => find((node) => node.props?.id === toggle().props["aria-controls"])[0].props.hidden,
    /** The heading's buttons, its toggle first, with what each does. */
    heading: () => buttons(find((node) => node.props?.className === "section-heading")[0]).map((node) => [text(node), node.props.onClick]),
    /** The buttons inside the section's content, which shows only while it is open. */
    inside: () => buttons(find((node) => node.props?.id === toggle().props["aria-controls"])[0]).map(text),
    content: () => text(find((node) => node.props?.id === toggle().props["aria-controls"])[0]),
    /** The toggle's and the heading actions' refs, which React gives their elements. */
    toggleRef: () => toggle().props.ref,
    actionsRef: () => find((node) => node.props?.className === "actions")[0]?.props.ref,
  };
}

const recorded = {
  requirements: entryRequirements.normalizeEntryRequirements({ passportNationality: "United States", visaRequirements: "No visa for stays under 90 days." }),
  healthSafety: healthSafety.normalizeHealthSafety({ advisoryLevel: "Level 1: Exercise normal precautions" }),
};
const research = [
  {
    name: "Entry requirements", record: "requirements", recorded: recorded.requirements, edit: "Edit entry requirements", add: "Add entry requirements", empty: "No entry requirements recorded.",
    open: (props) => section("../src/components/entry-requirements.tsx", "EntryRequirementsPanel", { "@/lib/entry-requirements": entryRequirements, "./entry-requirements.module.css": { default: names } }, props),
  },
  {
    name: "Health and safety", record: "healthSafety", recorded: recorded.healthSafety, edit: "Edit health and safety", add: "Add health and safety", empty: "No health and safety information recorded.",
    open: (props) => section("../src/components/health-safety.tsx", "HealthSafetyPanel", { "@/lib/health-safety": healthSafety, "./health-safety.module.css": { default: names } }, props),
  },
];
const labels = (view) => view.heading().map(([label]) => label);

test("Entry requirements and Health and safety show Edit and Clear only while open, at once, saving nothing", () => {
  for (const { name, record, recorded, edit, open } of research) {
    const view = open({ [record]: recorded });
    assert.deepEqual([labels(view), view.hidden()], [[name], true], name + " starts closed, with only its heading");
    view.toggle();
    assert.deepEqual([labels(view), view.hidden()], [[name, edit, "Clear"], false], name + "'s Edit and Clear show as it opens");
    assert.match(view.content(), name === "Entry requirements" ? /United States/ : /Level 1: Exercise normal precautions/, "its research shows as before");
    view.toggle();
    assert.deepEqual([labels(view), view.hidden()], [[name], true], name + "'s Edit and Clear hide as it closes");
    view.toggle();
    assert.deepEqual(view.calls, [], "opening and closing saves nothing");
    // Edit and Clear do what they did: Clear still asks the page to confirm.
    for (const [, onClick] of view.heading().slice(1)) onClick();
    assert.deepEqual(view.calls, ["edit", "clear"]);
  }
});

test("a section with nothing recorded shows Add open or closed, and never Clear", () => {
  for (const { name, record, add, empty, open } of research) {
    const view = open({ [record]: null });
    assert.deepEqual(labels(view), [name, add], name + " shows Add while closed");
    view.heading()[1][1]();
    assert.deepEqual(view.calls, ["edit"], "Add opens the editor, as before");
    view.toggle();
    assert.deepEqual(labels(view), [name, add], name + " shows Add while open");
    assert.ok(view.content().includes(empty), "with its message that nothing is recorded");
  }
});

test("each section, on each card, shows its buttons only while it is open itself", () => {
  const [entry, health] = research;
  const first = entry.open({ requirements: recorded.requirements });
  const second = entry.open({ requirements: recorded.requirements });
  const safety = health.open({ healthSafety: recorded.healthSafety });
  first.toggle();
  assert.deepEqual([labels(first), labels(second), labels(safety)], [[entry.name, entry.edit, "Clear"], [entry.name], [health.name]]);
  safety.toggle();
  first.toggle();
  assert.deepEqual([labels(first), labels(second), labels(safety)], [[entry.name], [entry.name], [health.name, health.edit, "Clear"]]);
});

test("Typical weather shows Edit typical weather only while open, as its monthly averages' buttons already were", () => {
  const open = (weather) => section("../src/components/typical-weather.tsx", "TypicalWeatherPanel", {
    "@/components/climate-chart": names, "@/lib/typical-weather": typicalWeather, "./typical-weather.module.css": { default: names },
  }, { weather });
  const climate = { months: Array.from({ length: 12 }, () => ({ highF: 70, lowF: 50, precipitationIn: 2 })), source: "Test climate normals", firstYear: 1991, lastYear: 2020 };
  const nothing = { weatherHighF: null, weatherLowF: null, weatherRainfall: "", weatherPeriod: "", weatherSource: "", climate: null };
  for (const [weather, monthly] of [
    [{ weatherHighF: 75, weatherLowF: 58, weatherRainfall: "Afternoon storms", weatherPeriod: "July", weatherSource: "", climate }, ["Edit monthly averages", "Clear monthly averages"]],
    // Edit typical weather is always Edit, so it hides with nothing recorded too; Add monthly averages stays inside.
    [nothing, ["Add monthly averages"]],
  ]) {
    const view = open(weather);
    assert.deepEqual([labels(view), view.hidden(), view.inside()], [["Typical weather"], true, monthly], "closed, only the heading shows");
    view.toggle();
    assert.deepEqual([labels(view), view.hidden(), view.inside()], [["Typical weather", "Edit typical weather"], false, monthly]);
    view.heading()[1][1]();
    view.toggle();
    assert.deepEqual([labels(view), view.hidden()], [["Typical weather"], true]);
    assert.deepEqual(view.calls, ["edit"], "Edit typical weather opens its editor, and opening and closing saves nothing");
  }
});

test("when a save hides the focused Add in a closed section, its heading takes focus rather than the page", () => {
  for (const { name, record, recorded, add, open } of research) {
    const view = open({ [record]: null });
    // React gives the toggle and the heading's actions their elements, and a ref keeps its callback between renders.
    const toggle = element("toggle");
    const addButton = element(add);
    view.toggleRef().current = toggle;
    const attach = view.actionsRef();
    const detach = attach({ contains: (node) => node === addButton });
    view.toggle();
    view.toggle();
    assert.equal(view.actionsRef(), attach, name + "'s actions keep their ref, so React never detaches it while they show");
    // Add's editor saved and closed, returning focus to Add; the page then shows the research, closed.
    addButton.focus();
    view.update({ [record]: recorded });
    assert.deepEqual(labels(view), [name]);
    // React detaches the actions' ref as it removes them, while Add still has focus.
    detach();
    assert.equal(page.activeElement, toggle, name + "'s heading takes focus");
    // Actions removed while focus is elsewhere, as when closing the section from its heading, move nothing.
    const elsewhere = element("elsewhere");
    elsewhere.focus();
    detach();
    assert.equal(page.activeElement, elsewhere);
  }
});
