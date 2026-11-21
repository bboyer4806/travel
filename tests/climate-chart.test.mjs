import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as typicalWeather from "../src/lib/typical-weather.ts";
import { aiSetup } from "./ai-fixtures.mjs";

// TRA-135: the monthly Typical weather chart, its section and its editor, run with a small hook harness: no browser or
// server is involved. Where the chart's labels and columns sit is the CSS module's, checked at the end.
const { MONTHS, climateMonthText, temperatureScale } = typicalWeather;
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const jsx = (type, props, key) => ({ type, props, key });
const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join("");
// A CSS module's class names are their own names.
const styles = new Proxy({}, { get: (_target, name) => name });
const has = (node, name) => String(node.props?.className ?? "").split(" ").includes(name);
// Values a component makes are copied into this test's realm to compare.
const copy = (value) => JSON.parse(JSON.stringify(value));

/** Hooks that keep their state between renders. */
function hooks() {
  const slots = [];
  let cursor = 0;
  return {
    react: {
      Fragment: "fragment",
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useId: () => "id-" + cursor++,
    },
    render(component, props) { cursor = 0; return component(props); },
  };
}

function load(path, react, modules) {
  const loaded = { exports: {} };
  runInNewContext(compile(path), {
    exports: loaded.exports,
    URL,
    require(name) {
      const known = { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" }, "@/lib/typical-weather": typicalWeather, ...modules };
      if (!(name in known)) throw new Error("Unexpected component import: " + name);
      return known[name];
    },
  });
  return loaded.exports;
}

const climate = (source = "Test climate normals") => ({
  months: [[37, 27, 1.5], [41, 29, 1.7], [50, 35, 2], [60, 42, 2], [69, 51, 2.8], [75, 57, 2.8], [79, 61, 2.9], [79, 61, 2.9], [69, 53, 2.4], [58, 44, 1.6], [46, 36, 1.8], [39, 30, 1.8]]
    .map(([highF, lowF, precipitationIn]) => ({ highF, lowF, precipitationIn })),
  source, firstYear: 1991, lastYear: 2020,
});

/** The chart for `props`, rendered again after each change, as React does. */
function chart(props) {
  const { react, render } = hooks();
  const { ClimateChart } = load("../src/components/climate-chart.tsx", react, { "./climate-chart.module.css": { default: styles } });
  let tree;
  const show = () => { tree = render(ClimateChart, props); };
  show();
  const find = (predicate) => nodes(tree).filter(predicate);
  const area = () => find((node) => has(node, "area"))[0];
  return {
    radios: () => find((node) => node.type === "input" && node.props.type === "radio"),
    chosen: () => find((node) => node.type === "input" && node.props.type === "radio").findIndex((node) => node.props.checked),
    labels: () => find((node) => node.type === "label"),
    readout: () => text(find((node) => has(node, "readout"))[0]),
    legend: () => copy(find((node) => has(node, "legend"))[0].props.children.filter(Boolean).map(text)),
    lines: () => Object.fromEntries(find((node) => node.type === "polyline").map((node) => [node.props.className, node.props.points])),
    ticks: () => copy(find((node) => has(node, "axis"))[0].props.children.map(text)),
    crosshair: () => find((node) => has(node, "crosshair"))[0]?.props.x1,
    band: () => find((node) => has(node, "band"))[0]?.props.style.left,
    shownPoints: () => find((node) => has(node, "shownPoint")).map((node) => node.props.style.left),
    source: () => find((node) => has(node, "source"))[0],
    rows: () => copy(find((node) => node.type === "tr").map((row) => row.props.children.flat(Infinity).filter(Boolean).map(text))),
    /** A choice from the keyboard, a tap or a click: the month's radio button changes. */
    choose(index) { this.radios()[index].props.onChange(); show(); },
    /** A pointer moving over the plot, `month` columns across from its left edge, for a plot 240 pixels wide. */
    move(month, pointerType, buttons = 0) { area().props.onPointerMove({ currentTarget: { getBoundingClientRect: () => ({ left: 100, width: 240 }) }, clientX: 100 + month * 20, pointerType, buttons }); show(); },
    leave() { area().props.onPointerLeave(); show(); },
  };
}
const left = (index) => (index + 0.5) / 12 * 100 + "%";
const values = (index) => {
  const { highF, lowF, precipitationIn } = climate().months[index];
  return `Average high${highF} °FAverage low${lowF} °FPrecipitation${precipitationIn} in`;
};

test("the chart draws every month's average high and low as two lines on one °F axis, with a legend, its source and a table", () => {
  const view = chart({ climate: climate(), startMonth: null });
  // January to December, each a radio button named with its averages, shown by its abbreviation or initial.
  assert.deepEqual(view.labels().map((label) => nodes(label).filter((node) => has(node, "abbreviation") || has(node, "initial")).map(text)), MONTHS.map((month) => [month.slice(0, 3), month[0]]));
  assert.deepEqual(view.labels().map((label) => text(nodes(label).find((node) => node.type === "span" && node.props.className === "sr-only"))), MONTHS.map((_, index) => climateMonthText(climate(), index)));
  assert.equal(new Set(view.radios().map((radio) => radio.props.name)).size, 1, "one group, so the arrow keys move between months");
  // Each line has a point at the middle of each month's column, at its temperature on the shared axis.
  const scale = temperatureScale(climate().months);
  assert.deepEqual(scale, { min: 20, max: 80, ticks: [20, 30, 40, 50, 60, 70, 80] });
  const points = (key) => climate().months.map((month, index) => `${index + 0.5},${(scale.max - month[key]) / (scale.max - scale.min) * 100}`).join(" ");
  assert.deepEqual(view.lines(), { high: points("highF"), low: points("lowF") });
  assert.deepEqual(view.ticks(), ["20°", "30°", "40°", "50°", "60°", "70°", "80°"]);
  assert.deepEqual(view.legend(), ["Average high (°F)", "Average low (°F)"]);
  assert.equal(text(view.source()), "Historical averages for 1991–2020 from Test climate normals. These are typical conditions from past years, not a forecast.");
  assert.deepEqual(view.rows(), [["Month", "Average high", "Average low", "Precipitation"], ...climate().months.map((month, index) => [MONTHS[index], `${month.highF} °F`, `${month.lowF} °F`, `${month.precipitationIn} in`])]);
  // A source given as a link opens in a new tab.
  const linked = chart({ climate: climate("https://example.com/normals"), startMonth: null }).source();
  assert.deepEqual(nodes(linked).filter((node) => node.type === "a").map((node) => [node.props.href, node.props.target, node.props.rel]), [["https://example.com/normals", "_blank", "noopener noreferrer"]]);
});

test("without a trip's dates no month is chosen, and choosing one shows its averages without changing them", () => {
  const saved = climate();
  const view = chart({ climate: saved, startMonth: null });
  assert.equal(view.chosen(), -1);
  assert.equal(view.readout(), "Select a month to see its average high, low and precipitation.");
  assert.deepEqual([view.band(), view.crosshair(), view.shownPoints()], [undefined, undefined, []]);
  for (const index of [6, 0, 11]) {
    view.choose(index);
    assert.equal(view.chosen(), index);
    assert.equal(view.readout(), MONTHS[index] + values(index));
    assert.equal(view.band(), left(index));
    assert.deepEqual(view.shownPoints(), [left(index), left(index)], "the month's high and low points grow");
  }
  assert.deepEqual(saved, climate(), "choosing changes nothing saved");
});

test("in a trip, the month the stay begins is chosen at first and stays marked after choosing another", () => {
  const view = chart({ climate: climate(), startMonth: 4 });
  assert.equal(view.chosen(), 4);
  assert.equal(view.readout(), "MayYour stay begins" + values(4));
  assert.deepEqual(view.legend(), ["Average high (°F)", "Average low (°F)", "Your stay begins"]);
  const stayMarks = () => view.labels().map((label) => nodes(label).some((node) => has(node, "stayMonth")));
  assert.deepEqual(stayMarks(), MONTHS.map((_, index) => index === 4));
  assert.match(text(view.labels()[4]), /May: average high 69 °F, average low 51 °F, precipitation 2\.8 in\. Your stay begins this month\.$/);
  view.choose(8);
  assert.equal(view.readout(), "September" + values(8));
  assert.deepEqual(stayMarks(), MONTHS.map((_, index) => index === 4), "the stay's month stays marked");
});

test("a mouse shows the month under it until it leaves, dragging chooses months, and a touch never hovers", () => {
  const view = chart({ climate: climate(), startMonth: 4 });
  view.move(2.5, "mouse");
  assert.equal(view.readout(), "March" + values(2));
  assert.deepEqual([view.crosshair(), view.band(), view.chosen()], [2.5, left(4), 4], "hovering shows a month without choosing it");
  view.move(7.2, "mouse");
  assert.equal(view.readout(), "August" + values(7));
  view.leave();
  assert.equal(view.readout(), "MayYour stay begins" + values(4));
  assert.equal(view.crosshair(), undefined);
  // A finger resting or moving without touching hovers nothing; dragging across the plot chooses each month it reaches.
  view.move(9.5, "touch");
  assert.equal(view.chosen(), 4);
  for (const [at, month] of [[1.5, 1], [10.9, 10], [-3, 0], [14, 11]]) {
    view.move(at, "touch", 1);
    assert.equal(view.chosen(), month);
    assert.equal(view.readout().startsWith(MONTHS[month]), true);
  }
  // A pen or a pressed mouse drags the same way. Choosing from the keyboard shows the choice even under a resting mouse.
  view.move(3.5, "pen", 1);
  assert.equal(view.chosen(), 3);
  view.move(6.5, "mouse");
  view.choose(5);
  assert.deepEqual([view.chosen(), view.readout().slice(0, 4), view.crosshair()], [5, "June", undefined]);
});

test("averages approved from ChatGPT or Claude chart as soon as they are approved, without entering them again (TRA-158)", (t) => {
  const { store, owner, propose, decide } = aiSetup(t);
  const id = store.applyMutation(owner, { type: "destination.create", city: "Vienna" }).id;
  const proposed = { ...climate(), months: climate().months.map((month, index) => ({ month: MONTHS[index], ...month })) };
  assert.equal(decide(propose([{ type: "destination.climate", id, climate: proposed }]), true).status, "applied");
  // The chart reads the destination as its page loads it.
  const view = chart({ climate: store.getDestinationSnapshot(owner, id).data.destinations[0].climate, startMonth: null });
  assert.deepEqual(view.rows(), [["Month", "Average high", "Average low", "Precipitation"], ...climate().months.map((month, index) => [MONTHS[index], `${month.highF} °F`, `${month.lowF} °F`, `${month.precipitationIn} in`])]);
  assert.equal(text(view.source()), "Historical averages for 1991–2020 from Test climate normals. These are typical conditions from past years, not a forecast.");
  view.choose(6);
  assert.equal(view.readout(), "July" + values(6));
});

/** The Typical weather section, whose monthly chart is only checked by its props here. */
function panel(props) {
  const { react, render } = hooks();
  const ClimateChart = () => null;
  const { TypicalWeatherPanel, MonthlyClimateEditor } = load("../src/components/typical-weather.tsx", react, {
    "lucide-react": { ChevronDown: "chevron", Pencil: "pencil", Plus: "plus", Trash2: "trash" },
    "@/components/climate-chart": { ClimateChart },
    "./typical-weather.module.css": { default: styles },
  });
  const calls = [];
  const full = { disabled: false, onEdit: () => calls.push("edit"), onEditClimate: () => calls.push("editClimate"), onClearClimate: () => calls.push("clearClimate"), ...props };
  let tree = render(TypicalWeatherPanel, full);
  const find = (predicate) => nodes(tree).filter(predicate);
  return {
    calls, ClimateChart, MonthlyClimateEditor,
    toggle() { find((node) => node.props?.["aria-expanded"] !== undefined)[0].props.onClick(); tree = render(TypicalWeatherPanel, full); },
    hidden: () => find((node) => node.props?.id === find((toggle) => toggle.props?.["aria-controls"])[0].props["aria-controls"])[0].props.hidden,
    buttons: () => find((node) => node.type === "button").map((node) => [text(node), node.props.onClick]),
    chart: () => find((node) => node.type === ClimateChart)[0],
    empty: () => text(find((node) => has(node, "empty"))[0]),
    details: () => text(find((node) => node.type === "dl")[0]),
  };
}
const placeholder = { weatherHighF: 75, weatherLowF: 58, weatherRainfall: "Placeholder until researched", weatherPeriod: "Summer (temporary placeholder)", weatherSource: "" };

test("the Typical weather section keeps its typical weather and adds the monthly chart, or says none is recorded", () => {
  const without = panel({ weather: { ...placeholder, climate: null } });
  assert.equal(without.hidden(), true, "it starts collapsed, as before (TRA-111)");
  without.toggle();
  assert.equal(without.hidden(), false);
  assert.equal(without.details(), "Typical high (°F)75 °FTypical low (°F)58 °FMonth or travel periodSummer (temporary placeholder)Rainfall notesPlaceholder until researchedSourceNot provided");
  assert.equal(without.chart(), undefined, "nothing is charted without averages");
  assert.equal(without.empty(), "No monthly averages recorded. Add each month’s historical high, low and precipitation from a source, such as a weather service’s climate normals, to chart them.");
  assert.deepEqual(without.buttons().map(([label]) => label), ["Typical weather", "Edit typical weather", "Add monthly averages"]);
  without.buttons()[2][1]();
  assert.deepEqual(without.calls, ["editClimate"]);

  // In a trip, the chart starts at the month the stay begins, and a new start month starts it again.
  const inTrip = panel({ weather: { ...placeholder, climate: climate() }, stay: { arrivalDate: "2027-05-10" } });
  assert.deepEqual(copy([inTrip.chart().props, inTrip.chart().key]), [{ climate: climate(), startMonth: 4 }, 4]);
  assert.equal(inTrip.empty(), "");
  // Edit typical weather shows only while the section is open (TRA-148).
  inTrip.toggle();
  assert.deepEqual(inTrip.buttons().map(([label]) => label), ["Typical weather", "Edit typical weather", "Edit monthly averages", "Clear monthly averages"]);
  for (const [, onClick] of inTrip.buttons().slice(1)) onClick();
  assert.deepEqual(inTrip.calls, ["edit", "editClimate", "clearClimate"]);
  assert.match(inTrip.details(), /Summer \(temporary placeholder\)/);
  // A stay without dates, and a destination's own page, choose no month.
  for (const stay of [{ arrivalDate: null }, undefined]) {
    const undated = panel({ weather: { ...placeholder, climate: climate() }, stay });
    assert.deepEqual([undated.chart().props.startMonth, undated.chart().key], [null, "none"]);
  }
});

test("the monthly editor asks for every month's three averages, the source and the years, filled from what's saved", () => {
  const { render } = hooks();
  const { MonthlyClimateEditor } = panel({ weather: { ...placeholder, climate: null } });
  const fields = (saved) => nodes(render(MonthlyClimateEditor, { climate: saved, disabled: false })).filter((node) => node.type === "input").map((node) => node.props);
  const named = ["climateSource", "climateFirstYear", "climateLastYear", ...MONTHS.flatMap(() => ["climateHighF", "climateLowF", "climatePrecipitationIn"])];
  const blank = fields(null);
  assert.deepEqual(blank.map((field) => field.name), named);
  assert.ok(blank.every((field) => field.required && field.defaultValue === undefined), "every field is required and starts blank");
  assert.deepEqual(blank.slice(3, 6).map((field) => [field["aria-label"], field.min, field.max]), [["January average high (°F)", -150, 150], ["January average low (°F)", -150, 150], ["January average precipitation (inches)", 0, 200]]);
  const filled = fields(climate());
  assert.deepEqual(filled.slice(0, 3).map((field) => field.defaultValue), ["Test climate normals", 1991, 2020]);
  assert.deepEqual(filled.slice(3).map((field) => field.defaultValue), climate().months.flatMap((month) => [month.highF, month.lowF, month.precipitationIn]));
});

test("narrow charts show each month's initial, every month fills an equal full-height column, and a sideways drag stays on the chart", () => {
  const css = readFileSync(new URL("../src/components/climate-chart.module.css", import.meta.url), "utf8");
  const rule = (selector) => css.match(new RegExp("^" + selector.replace(/[.*]/g, "\\$&") + " \\{([^}]*)\\}", "m"))?.[1] ?? "";
  assert.match(rule(".chart"), /container-type: inline-size/);
  assert.match(rule(".months"), /position: absolute; inset: 0;.*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(rule(".area"), /touch-action: pan-y pinch-zoom/);
  const narrow = css.slice(css.indexOf("@container (max-width: 400px)"));
  assert.match(narrow, /\.abbreviation \{ display: none; \}/);
  assert.match(narrow, /\.initial \{ display: inline; \}/);
  assert.match(rule(".initial"), /display: none/);
});
