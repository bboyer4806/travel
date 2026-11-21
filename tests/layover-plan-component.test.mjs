import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as layoverPlan from "../src/lib/layover-plan.ts";
import * as tripMap from "../src/lib/trip-map.ts";

// TRA-45: a layover's plan in its editor and under its layover on the trip's page, run with a small hook harness that
// keeps state between renders, as React does. No browser is involved.
const element = (type, props, key) => ({ type, props, key });
/** An element as the browser has it: components rendered in place, down to host elements and text. */
function render(node) {
  if (Array.isArray(node)) return node.flatMap(render);
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node !== "object") return [String(node)];
  if (typeof node.type === "function") return render(node.type(node.props));
  if (node.type === "fragment") return render(node.props.children);
  return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
}
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");
const clean = (value) => value.replace(/\s/g, " ");

function load(file, state, extra = {}) {
  const exports = {};
  let ids = 0;
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    // The host's Error, as in a browser, where the component and the plan's checks share one.
    exports, Error,
    require(name) {
      if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      const modules = {
        react: {
          useState(initial) { const index = state.cursor++; if (!(index in state.hooks)) state.hooks[index] = initial; return [state.hooks[index], (value) => { state.hooks[index] = value; }]; },
          useRef(current) { const index = state.cursor++; if (!(index in state.hooks)) state.hooks[index] = { current }; return state.hooks[index]; },
          useMemo: (make) => make(),
          useId: () => "id",
        },
        "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
        "lucide-react": new Proxy({}, { get: (_, name) => () => element("svg", { "data-icon": String(name), children: [] }) }),
        "@/lib/layover-plan": layoverPlan,
        "@/lib/trip-map": tripMap,
        "@/lib/uuid": { randomUuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}` },
        "./focus-after": { useFocusAfter: () => () => {}, controlOrNeighbor: (control) => control },
        ...extra,
      };
      if (!(name in modules)) throw new Error("Unexpected component import: " + name);
      return modules[name];
    },
  });
  return exports;
}

/** The editor of a layover's plan, starting from `draft`, rendered again after each change as its dialog does. */
function editor(draft) {
  const state = { hooks: [], cursor: 0 };
  const { LayoverPlanEditor } = load("../src/components/layover-plan.tsx", state);
  let tree;
  const render_ = () => { state.cursor = 0; tree = render(LayoverPlanEditor({ place: "Frankfurt (FRA)", draft, onChange: (next) => { draft = next; render_(); } })); };
  render_();
  const nodes = () => tree.flatMap(within);
  /** The field labeled `label`, the nth when several are, as the browser finds it inside its label. */
  const field = (label, nth = 0) => nodes().filter((node) => node.type === "label" && text(node.props.children[0] ?? "") === label).map((node) => within(node).find((child) => ["input", "select", "textarea"].includes(child.type)))[nth];
  return {
    field,
    /** The draft as the dialog holds it, copied out of the component's context so it compares as any other value. */
    draft: () => JSON.parse(JSON.stringify(draft)),
    /** Types into a field, or chooses an option, as its change event sets it. */
    set(label, value, nth = 0) { field(label, nth).props.onChange({ target: { value } }); },
    button: (name) => nodes().find((node) => node.type === "button" && text(node) === name),
    section: (heading) => nodes().find((node) => node.type === "section" && within(node).some((child) => child.type === "h3" && text(child) === heading)),
    text: (node) => clean(text(node)),
    nodes,
  };
}

test("a new plan's editor starts with every estimate at 0, and its schedule waits for what it needs", () => {
  const ui = editor(layoverPlan.layoverPlanDraft(undefined));
  const estimates = ["Immigration (minutes)", "Customs (minutes)", "Security (minutes)", "Terminal transfer (minutes)", "Boarding (minutes)"].map((label) => ui.field(label).props);
  assert.deepEqual(estimates.map(({ type, value, required, min, max, step }) => ({ type, value, required, min, max, step })), Array(5).fill({ type: "number", value: "0", required: true, min: 0, max: 1440, step: "1" }));
  const zone = ui.field("Airport time zone");
  assert.deepEqual([zone.type, zone.props.required, zone.props.value], ["select", true, ""]);
  const options = within(zone);
  assert.equal(text(options.find((node) => node.type === "option")), "Choose the airport's time zone");
  const europe = options.find((node) => node.type === "optgroup" && node.props.label === "Europe");
  assert.ok(within(europe).some((node) => node.type === "option" && node.props.value === "Europe/Berlin" && text(node) === "Berlin"), "zones are named by their place, without an offset until the arrival's date is entered");
  assert.equal(text(options.find((node) => node.type === "option" && node.props.value === "America/Argentina/Ushuaia")), "Argentina / Ushuaia", "a zone within a country's zones names both");
  assert.deepEqual(["Arriving flight lands", "Connecting flight departs"].map((label) => [ui.field(label).props.type, ui.field(label).props.required, ui.field(label).props.value]), [["datetime-local", true, ""], ["datetime-local", true, ""]]);
  assert.equal(ui.text(ui.section("Schedule")), "ScheduleThe schedule shows once the plan is complete. Choose the airport's time zone.");
  assert.equal(ui.field("Travel back to the airport (minutes)"), undefined, "without activities outside the airport, there's no travel back");
  assert.match(ui.text(ui.section("Airport time")), /Travel doesn't supply any, so leave 0 for anything that doesn't apply\./);
});

test("the schedule is worked out again with each change, and warns as soon as the plan runs past boarding", () => {
  const ui = editor(layoverPlan.layoverPlanDraft(undefined));
  ui.set("Airport time zone", "Europe/Berlin");
  ui.set("Arriving flight lands", "2027-05-10T07:35");
  assert.match(ui.text(ui.section("Schedule")), /Enter the date and time the connecting flight departs/);
  ui.set("Connecting flight departs", "2027-05-10T14:20");
  assert.match(ui.text(ui.section("Flights")), /Layover: 6 h 45 min/);
  assert.equal(text(within(ui.field("Airport time zone")).find((node) => node.type === "option" && node.props.value === "Europe/Berlin")), "Berlin (UTC+2)", "once the arrival's date is entered, each zone shows its offset then");
  assert.match(ui.text(ui.section("Schedule")), /^Schedule6 h 45 min to spare before departure \(estimated\)/);
  ui.set("Boarding (minutes)", "30");
  ui.set("Immigration (minutes)", "45");
  assert.match(ui.text(ui.section("Schedule")), /^Schedule5 h 30 min to spare before boarding \(estimated\)/);

  // An activity outside the airport asks for the travel there and back.
  ui.button("Add activity").props.onClick();
  assert.deepEqual(ui.draft().activities, [{ id: "00000000-0000-4000-8000-000000000001", name: "", place: "", outside: false, minutes: "", travelMinutes: "", notes: "" }]);
  assert.match(ui.text(ui.section("Schedule")), /Enter what each activity is\./);
  ui.set("What", "Old town");
  ui.set("Duration (minutes)", "120");
  assert.equal(ui.field("Travel there (minutes)"), undefined);
  ui.set("In or outside the airport", "outside");
  assert.deepEqual([ui.field("Travel there (minutes)").props.min, ui.field("Travel back to the airport (minutes)").props.min], [0, 0]);
  ui.set("Travel there (minutes)", "30");
  ui.set("Travel back to the airport (minutes)", "30");
  const steps = () => within(ui.section("Schedule")).filter((node) => node.type === "li").map((node) => ui.text(node));
  assert.deepEqual(steps(), [
    "7:35 AMMon, May 10Arriving flight landsScheduled", "7:35 AMImmigration45 min", "8:20 AMTravel to Old town30 min", "8:50 AMOld town2 h", "10:50 AMTravel back to the airport30 min",
    "11:20 AMTime to spare2 h 30 min", "1:50 PMAt the gate for boarding30 min", "2:20 PMConnecting flight departsScheduled",
  ].map(clean));
  assert.match(ui.text(ui.section("Schedule")), /Only the flights' times are scheduled\. Every other time is an estimate from what you entered, not a guarantee/);

  // Three more hours of sightseeing run past boarding, and past departure.
  ui.set("Duration (minutes)", "300");
  assert.match(ui.text(ui.section("Schedule")), /Over by 30 min\. You would reach the gate 30 min after boarding time and could miss your connecting flight\./);
  ui.set("Duration (minutes)", "340");
  assert.match(ui.text(ui.section("Schedule")), /Over by 1 h 10 min\. This plan ends 40 min after your connecting flight departs\./);
  assert.ok(steps().some((step) => step.includes("Late")));
  // A second activity in the airport comes after security, and a new one can't split the trip out of the airport.
  ui.button("Add activity").props.onClick();
  ui.set("What", "Lounge", 1);
  ui.set("Duration (minutes)", "30", 1);
  ui.set("In or outside the airport", "outside", 1);
  ui.set("Travel there (minutes)", "15", 1);
  ui.set("In or outside the airport", "airport", 1);
  assert.deepEqual(ui.draft().activities[1], { id: "00000000-0000-4000-8000-000000000002", name: "Lounge", place: "", outside: false, minutes: "30", travelMinutes: "15", notes: "" }, "moving it into the airport keeps what was typed");
  assert.equal(layoverPlan.layoverPlanFromDraft(ui.draft()).activities[1].travelMinutes, null, "but saves no travel for it");
  ui.nodes().find((node) => node.type === "button" && node.props["aria-label"] === "Move activity 2 up").props.onClick({ currentTarget: {} });
  assert.deepEqual(ui.draft().activities.map((activity) => activity.name), ["Lounge", "Old town"]);
  ui.nodes().find((node) => node.type === "button" && node.props["aria-label"] === "Remove activity 1").props.onClick();
  assert.deepEqual(ui.draft().activities.map((activity) => activity.name), ["Old town"]);
});

/** The panel under a layover on the trip's page, with the controls it calls. */
function panel(plan) {
  const { LayoverPlanPanel } = load("../src/components/layover-plan.tsx", { hooks: [], cursor: 0 });
  const calls = [];
  const tree = render(LayoverPlanPanel({ place: "Frankfurt (FRA)", plan, disabled: false, onEdit: () => calls.push("edit"), onRemove: () => calls.push("remove") }));
  const nodes = tree.flatMap(within);
  return { calls, nodes, text: clean(tree.map(text).join("")), button: (label) => nodes.find((node) => node.type === "button" && node.props["aria-label"] === label) };
}
const frankfurt = (overrides = {}) => ({
  timeZone: "Europe/Berlin", arrival: "2027-05-10T07:35", departure: "2027-05-10T14:20",
  immigrationMinutes: 45, customsMinutes: 15, securityMinutes: 45, transferMinutes: 15, boardingMinutes: 30, returnMinutes: 30,
  activities: [{ id: "a0000000-0000-4000-8000-000000000001", name: "Old town", place: "Römerberg", outside: true, minutes: 90, travelMinutes: 30, notes: "" }],
  ...overrides,
});

test("a layover without a plan offers Plan layover, and one with a plan shows its totals, time to spare and schedule", () => {
  const empty = panel(undefined);
  assert.equal(empty.text, "Plan layover");
  empty.button("Plan your layover in Frankfurt (FRA)").props.onClick();
  assert.deepEqual(empty.calls, ["edit"]);

  const planned = panel(frankfurt());
  assert.equal(planned.text.slice(0, planned.text.indexOf("Schedule, in")), "Layover 6 h 45 minAirport time 2 h 30 minTravel 1 h1 activity, 1 h 30 min1 h 45 min to spare before boarding (estimated)");
  const details = planned.nodes.find((node) => node.type === "details");
  assert.equal(text(within(details).find((node) => node.type === "summary")), "Schedule, in Europe/Berlin");
  const steps = within(details).filter((node) => node.type === "li").map((node) => clean(text(node)));
  assert.deepEqual([steps[0], steps.at(-1), steps.filter((step) => step.includes("Scheduled")).length], [clean("7:35 AMMon, May 10Arriving flight landsScheduled"), clean("2:20 PMConnecting flight departsScheduled"), 2], "only the flights' own times are marked scheduled");
  planned.button("Edit the layover plan for Frankfurt (FRA)").props.onClick();
  planned.button("Remove the layover plan for Frankfurt (FRA)").props.onClick();
  assert.deepEqual(planned.calls, ["edit", "remove"]);

  const over = panel(frankfurt({ activities: [{ ...frankfurt().activities[0], minutes: 200 }] }));
  assert.match(over.text, /Over by 5 min\. You would reach the gate 5 min after boarding time and could miss your connecting flight\./);
  assert.ok(over.nodes.some((node) => node.type === "svg" && node.props["data-icon"] === "CircleAlert"));
  // A saved plan this device's time zone data can't read shows why, rather than breaking the page.
  const unreadable = panel(frankfurt({ timeZone: "Mars/Olympus_Mons" }));
  assert.ok(unreadable.text.length > 0 && !unreadable.text.includes("Layover 6 h"));
});

test("each layover in a connection's itinerary has its plan or Plan layover, and other stops have neither", () => {
  const state = { hooks: [], cursor: 0 };
  const plans = load("../src/components/layover-plan.tsx", state);
  const { ConnectionItinerary, ConnectionItineraryEditor } = load("../src/components/connection-itinerary.tsx", state, { "./layover-plan": plans });
  const stops = [
    { id: "f0000000-0000-4000-8000-000000000001", kind: "layover", place: "Frankfurt (FRA)", arrival: "", departure: "", notes: "" },
    { id: "f0000000-0000-4000-8000-000000000002", kind: "stop", place: "Heidelberg", arrival: "", departure: "", notes: "" },
    { id: "f0000000-0000-4000-8000-000000000003", kind: "layover", place: "London Heathrow (LHR)", arrival: "", departure: "", notes: "" },
  ];
  const opened = [];
  const tree = render(ConnectionItinerary({ legId: "leg", stops, plans: [{ layoverId: stops[0].id, ...frankfurt() }], disabled: false, onPlan: (stop) => opened.push(stop.place), onRemovePlan: () => {} }));
  const items = tree.flatMap(within).filter((node) => node.type === "li" && node.props.id?.startsWith("itinerary-"));
  assert.deepEqual(items.map((item) => [within(item).some((node) => node.type === "details"), within(item).filter((node) => node.type === "button").map((node) => node.props["aria-label"])]), [
    [true, ["Edit the layover plan for Frankfurt (FRA)", "Remove the layover plan for Frankfurt (FRA)"]],
    [false, []],
    [false, ["Plan your layover in London Heathrow (LHR)"]],
  ]);
  within(items[2]).find((node) => node.type === "button").props.onClick();
  assert.deepEqual(opened, ["London Heathrow (LHR)"]);

  // The connection's editor says which layovers have a plan that removing them, or making them stops, removes.
  state.cursor = 0;
  const notes = render(ConnectionItineraryEditor({ stops, onChange: () => {}, planned: [stops[0].id], disabled: false })).flatMap(within)
    .filter((node) => node.type === "fieldset").map((fieldset) => within(fieldset).filter((node) => node.type === "p").map(text));
  assert.deepEqual(notes, [["This layover has a plan. Removing the layover, or changing it to another kind of stop, removes its plan when you save."], [], []]);
});
