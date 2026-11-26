import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import { addDestination, newItem, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore } from "./owned-store.mjs";

// TRA-182: a destination's Churches, on a trip's page and on its page in Destinations, are laid out as its Hotels,
// Activities and Restaurants are. Its heading shows how many churches it has and opens and closes it, starting open each
// time the page loads; Add church and Hide Church sit beside it either way; and below it come the stay's Sundays, a
// carousel of the churches and Manage churches, which opens the destination's Church page. There, where the churches are
// the page, each keeps its Edit and Delete, always open (TRA-169). The real components run in small harnesses: no
// browser or server is involved.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
const element = (type, props) => ({ type, props });
const shared = {
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
  "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
};
// A CSS module's class names are their own names.
const cssModule = { default: new Proxy({}, { get: (_, key) => String(key) }) };
// Every other module is one these pages' Churches don't use: each of its exports renders, and returns, nothing.
const unused = new Proxy({}, { get: () => () => null });

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
/** A rendered element's text, including what's hidden and what only screen readers read. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");
/** A rendered element's text as the page shows it: none from inside a hidden element. */
const shown = (node) => typeof node === "string" ? node : node.props.hidden ? "" : node.props.children.map(shown).join("");
const hasClass = (node, className) => String(node.props.className ?? "").split(" ").includes(className);

/** Hooks that keep their state between renders, as React keeps a section's on its card. */
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
      useId: () => "church-" + cursor++,
      useRef: (current) => ({ current }),
      useEffect() {},
    },
    /** Renders `component` with `props`, and the components in it, as React renders them again, from the first hook. */
    draw(component, props) { cursor = 0; return render({ type: component, props })[0]; },
  };
}

/** A saved church of a destination, without photos. */
const savedChurch = (name, denomination = "") => ({ id: randomUUID(), destinationId: "vienna", name, address: "", denomination, url: "", massTimes: [], images: [], mainImageId: null, coordinates: null });

/**
 * One card's Churches section showing `churches`, with any other `props`, rendered again after each change, as React
 * does. Its Add church, Hide Church, cards and Likes record what they are asked to do.
 */
function section(churches, props = {}) {
  const { react, draw } = hooks();
  const modules = { ...shared, react };
  const require = (name) => name.endsWith(".module.css") ? cssModule : modules[name] ?? unused;
  modules["./destination-ideas"] = load("../src/components/destination-ideas.tsx", require);
  const { ChurchSection } = load("../src/components/churches.tsx", require);
  const calls = [];
  const given = {
    churches, label: "Vienna", href: "/trips/trip/destinations/stop/church", hideId: "church-visibility-stop", busy: false,
    onAdd: () => calls.push(["add"]), onHide: (control) => calls.push(["hide", control.props.id]), onView: (item) => calls.push(["view", item.name]),
    like: (item) => element("button", { className: "like", children: "Like " + item.name }), ...props,
  };
  let tree = draw(ChurchSection, given);
  const all = () => within(tree);
  const toggle = () => all().find((node) => node.props["aria-expanded"] !== undefined);
  const heading = () => all().find((node) => node.props.className === "section-heading");
  const buttons = () => within(heading()).filter((node) => node.type === "button");
  return {
    calls, all, toggle,
    tree: () => tree,
    /** Selects the heading, opening or closing the section. */
    select() { toggle().props.onClick(); tree = draw(ChurchSection, given); },
    /** The heading's text, then each of its buttons' text as screen readers hear it, its toggle first. */
    heading: () => [text(within(heading()).find((node) => node.type === "h4")), ...buttons().map(text)],
    /** The heading's buttons. */
    buttons,
    /** What the heading opens and closes. */
    content: () => all().find((node) => node.props.id === toggle().props["aria-controls"]),
    /** Selects one of the heading's buttons by the start of its text. */
    press(label) { const button = buttons().find((node) => text(node).startsWith(label)); button.props.onClick({ currentTarget: button }); },
  };
}

test("a destination card's Churches section shows how many churches it has, starts open, and its heading opens and closes it, saving nothing (TRA-182)", () => {
  const churches = section([savedChurch("St. Stephen's Cathedral", "Roman Catholic"), savedChurch("Votivkirche")]);
  assert.deepEqual([churches.tree().type, churches.tree().props.className, churches.tree().props["aria-label"]], ["section", "section", "Churches in Vienna"],
    "a panel as Hotels', Activities' and Restaurants' are, which screen readers name for its destination");
  assert.deepEqual(churches.heading(), ["Churches(2)", "Churches(2)", "Add church in Vienna", "Hide Church for Vienna"], "its heading is a toggle with the count, beside Add church and Hide Church");
  const toggle = churches.toggle();
  assert.deepEqual([toggle.type, toggle.props.className, within(toggle).find((node) => hasClass(node, "count")) && text(within(toggle).find((node) => hasClass(node, "count")))], ["button", "toggle", "(2)"], "the ideas' toggle and count");
  assert.ok(within(toggle).some((node) => node.type === "icon:ChevronDown"), "its chevron shows that it opens and closes");
  assert.deepEqual([toggle.props["aria-expanded"], churches.content().props.hidden, churches.content().props.className], [true, false, "content"], "it starts open, and says so");
  churches.select();
  assert.deepEqual([churches.toggle().props["aria-expanded"], churches.content().props.hidden], [false, true], "selecting the heading closes it");
  assert.equal(shown(churches.tree()), "Churches(2)Add church in ViennaHide Church for Vienna", "only its heading and actions show while it is closed");
  churches.select();
  assert.deepEqual([churches.toggle().props["aria-expanded"], churches.content().props.hidden], [true, false], "selecting it again opens it");
  assert.deepEqual(churches.calls, [], "opening and closing saves nothing");
});

test("Add church and Hide Church work whether the section is open or closed, and wait while a change saves (TRA-182)", () => {
  const churches = section([savedChurch("St. Stephen's Cathedral")]);
  churches.select();
  churches.press("Add church");
  churches.press("Hide Church");
  assert.deepEqual(churches.calls, [["add"], ["hide", "church-visibility-stop"]], "closed, they do what they did, and Hide Church carries the ID Show Church shares");
  churches.select();
  churches.press("Add church");
  assert.deepEqual(churches.calls.at(-1), ["add"]);
  // Each is a button as the ideas' sections' are, with its icon hidden from screen readers.
  assert.deepEqual(churches.buttons().slice(1).map((button) => [button.props.type, button.props.className, within(button).find((node) => String(node.type).startsWith("icon:")).type]),
    [["button", "button secondary small", "icon:Plus"], ["button", "button secondary small", "icon:EyeOff"]]);
  assert.ok(section([], { busy: true }).buttons().slice(1).every((button) => button.props.disabled), "both wait while a change saves");
});

test("the Churches section shows the stay's Sundays, then its carousel, then Manage churches, which opens the destination's Church page (TRA-182)", () => {
  const sundays = element("section", { "aria-label": "Sundays during your stay", children: "Sunday, May 2, 2027" });
  const churches = section([savedChurch("St. Stephen's Cathedral", "Roman Catholic")], { sundays });
  const [first, carousel, manage] = churches.content().props.children;
  assert.deepEqual([first.type, text(first)], ["section", "Sunday, May 2, 2027"], "the Sundays come first");
  assert.ok(hasClass(carousel, "carousel"), "then the carousel");
  assert.deepEqual(within(carousel).filter((node) => hasClass(node, "card")).map(text), ["St. Stephen's CathedralRoman Catholic"]);
  assert.deepEqual([manage.type, manage.props.href, manage.props.className, text(manage)], ["a", "/trips/trip/destinations/stop/church", "text-button manage", "Manage churches in Vienna"], "then Manage churches, as Manage hotels is");
});

test("a Churches section without churches says so, and keeps Add church and Manage churches (TRA-182)", () => {
  const churches = section([]);
  assert.deepEqual(churches.heading().slice(0, 3), ["Churches(0)", "Churches(0)", "Add church in Vienna"]);
  const [message, manage] = churches.content().props.children;
  assert.deepEqual([message.type, message.props.className, text(message)], ["p", "empty", "No churches saved yet."], "as Hotels says No hotels saved yet.");
  assert.equal(churches.all().some((node) => hasClass(node, "carousel")), false, "no carousel");
  assert.equal(text(manage), "Manage churches in Vienna");
  churches.press("Add church");
  assert.deepEqual(churches.calls, [["add"]]);
});

test("each card's Churches section opens and closes on its own, and starts open again each time the page loads (TRA-182)", () => {
  const [vienna, salzburg] = [section([savedChurch("St. Stephen's Cathedral")]), section([])];
  vienna.select();
  assert.deepEqual([vienna.content().props.hidden, salzburg.content().props.hidden], [true, false], "closing one card's section leaves another's open");
  assert.equal(section([savedChurch("St. Stephen's Cathedral")]).content().props.hidden, false, "a page load starts it open again, closed or not before");
});

// Each page, rendered by the planner from what the store gives its address, as the page does, with each render a page
// load: state starts as given, and effects, which run only in a browser, don't run.
const pageModules = {
  ...shared,
  "react": { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}], useTransition: () => [false, () => {}], useId: () => "id", useRef: (current) => ({ current }), useEffect: () => {} },
  "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort,
};
const pageRequire = (name) => name.endsWith(".module.css") ? cssModule : pageModules[name] ?? unused;
pageModules["./destination-ideas"] = load("../src/components/destination-ideas.tsx", pageRequire);
pageModules["@/components/churches"] = load("../src/components/churches.tsx", pageRequire);
pageModules["@/components/church-sundays"] = load("../src/components/church-sundays.tsx", pageRequire);
const { default: PlannerApp } = load("../src/components/planner-app.tsx", pageRequire);

/**
 * A trip from Saturday, May 1, 2027, or `startDate`: two nights in Vienna, with St. Stephen's Cathedral saved, then a
 * week in Salzburg, without churches. From May 1, each stay has a Sunday, so each card shows its Churches.
 */
function plan(t, startDate = "2027-05-01") {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput({ name: "Spring in Austria", startDate })).id;
  const vienna = addDestination(store, tripId, { city: "Vienna", nights: 2 });
  const salzburg = addDestination(store, tripId, { city: "Salzburg", nights: 7 });
  store.applyMutation({ type: "church.save", destinationId: vienna, name: "St. Stephen's Cathedral", address: "Stephansplatz 3", denomination: "Roman Catholic", url: "", massTimes: [{ id: randomUUID(), day: "Sunday", time: "10:15 AM" }], ...newItem() });
  return { store, tripId, vienna, salzburg };
}
/** The trip's page, or with `stopId`, a stay's Church page, as its address renders it. */
function tripPage(store, tripId, stopId) {
  const { data, access, library } = store.getTripSnapshot(tripId, stopId);
  return render(PlannerApp({ initialData: data, access: { [tripId]: access }, library, tripId, stopId, church: stopId !== undefined }));
}
/** A destination's page in Destinations, or with `church`, its Church page, as its address renders it. */
function destinationPage(store, destinationId, church = false) {
  const { data, access } = store.getDestinationSnapshot(destinationId);
  return render(PlannerApp({ initialData: data, destinationAccess: { [destinationId]: access }, destinationId, church }));
}
/** A rendered page's churches, each with its heading's toggle, if any, what the toggle opens and closes, and its link to its Church page. */
function churches(page) {
  return page.flatMap(within).filter((node) => node.type === "section" && /^Church(es)? in /.test(String(node.props["aria-label"]))).map((section) => {
    const toggle = within(section).find((node) => node.props["aria-expanded"] !== undefined);
    const cards = within(section).filter((node) => hasClass(node, "card")).map(text);
    const manage = within(section).find((node) => node.type === "a" && text(node).startsWith("Manage churches"));
    return { label: section.props["aria-label"], section, toggle, cards, manage: manage?.props.href, content: toggle && within(section).find((node) => node.props.id === toggle.props["aria-controls"]) };
  });
}

test("every Churches section on a trip's page starts open, with the stay's Sundays above its churches and Manage churches linking to the stay's Church page (TRA-182)", (t) => {
  const { store, tripId, vienna, salzburg } = plan(t);
  const [viennaChurches, salzburgChurches, ...others] = churches(tripPage(store, tripId));
  assert.deepEqual([viennaChurches.label, salzburgChurches.label, others], ["Churches in Vienna", "Churches in Salzburg", []], "each card has its Churches");
  for (const [{ label, section, toggle, content }, count] of [[viennaChurches, 1], [salzburgChurches, 0]]) {
    const heading = within(section).find((node) => node.type === "h4");
    assert.deepEqual([within(heading).includes(toggle), shown(toggle), toggle.props["aria-expanded"], content.props.hidden], [true, `Churches(${count})`, true, false], label + " starts open, its heading a toggle with its count");
    assert.deepEqual(within(section).find((node) => node.props.className === "actions").props.children.map(text), ["Add church in " + label.slice(12), "Hide Church for " + label.slice(12)], label + " has Add church and Hide Church beside it");
  }
  assert.match(shown(viennaChurches.content), /^Sundays during your stay.*Sunday, May 2, 2027.*St\. Stephen's CathedralRoman CatholicManage churches in Vienna$/, "Vienna's Sunday, then its church's card, then Manage churches");
  assert.deepEqual(viennaChurches.cards, ["St. Stephen's CathedralRoman Catholic"], "each church is a card in a carousel, with its name and denomination, without Edit or Delete");
  assert.deepEqual(within(viennaChurches.section).filter((node) => node.type === "button" && /^(Edit|Delete) /.test(node.props["aria-label"] ?? "")), [], "editing and deleting are on the Church page");
  assert.match(shown(salzburgChurches.content), /Sunday, May 9, 2027.*No churches saved yet\.Manage churches in Salzburg$/, "Salzburg says it has none");
  assert.deepEqual([viennaChurches.manage, salzburgChurches.manage], [`/trips/${tripId}/destinations/${vienna}/church`, `/trips/${tripId}/destinations/${salzburg}/church`], "each opens its stay's Church page");
});

test("a destination's page in Destinations shows its Churches the same way, linking to its own Church page, without Sundays (TRA-182)", (t) => {
  const { store, vienna } = plan(t);
  const [church, ...others] = churches(destinationPage(store, vienna));
  assert.deepEqual([church.label, others], ["Churches in Vienna", []]);
  assert.deepEqual([shown(church.toggle), church.toggle.props["aria-expanded"], church.content.props.hidden], ["Churches(1)", true, false]);
  assert.deepEqual([church.cards, church.manage], [["St. Stephen's CathedralRoman Catholic"], `/destinations/${vienna}/church`]);
  assert.equal(shown(church.section).includes("Sundays during your stay"), false, "Sunday dates come from a trip");
});

test("a stay without a Sunday shows no Churches, and the destination keeps its churches in Destinations (TRA-182)", (t) => {
  // From Monday, May 3, 2027, Vienna's two nights end on Wednesday, and Salzburg's week includes Sunday, May 9.
  const { store, tripId, vienna } = plan(t, "2027-05-03");
  assert.deepEqual(churches(tripPage(store, tripId)).map((church) => church.label), ["Churches in Salzburg"], "only Salzburg's card has Churches");
  assert.deepEqual(churches(destinationPage(store, vienna)).map((church) => [church.label, church.cards]), [["Churches in Vienna", ["St. Stephen's CathedralRoman Catholic"]]]);
});

test("Hide Church keeps every church, and Show Church brings Churches back open (TRA-182)", (t) => {
  const { store, tripId, vienna } = plan(t);
  const saved = store.getSnapshot().churches;
  store.applyMutation({ type: "destination.churchVisibility", id: vienna, enabled: false });
  const page = tripPage(store, tripId);
  assert.deepEqual(churches(page).map((church) => church.label), ["Churches in Salzburg"], "Vienna's card has no Churches");
  const hidden = page.flatMap(within).find((node) => node.props.className === "church-visibility");
  assert.equal(text(hidden), "Church is hidden. Saved churches and photos are kept.Show Church for Vienna");
  assert.deepEqual(store.getSnapshot().churches, saved, "its church and Mass times are kept");
  store.applyMutation({ type: "destination.churchVisibility", id: vienna, enabled: true });
  const [shownAgain] = churches(tripPage(store, tripId));
  assert.deepEqual([shownAgain.label, shownAgain.toggle.props["aria-expanded"], shownAgain.cards], ["Churches in Vienna", true, ["St. Stephen's CathedralRoman Catholic"]]);
});

test("a destination's Church page, in a trip or in Destinations, keeps every church with its Edit and Delete, always open, without a toggle (TRA-169, TRA-182)", (t) => {
  const { store, tripId, vienna } = plan(t);
  for (const [name, page, sunday] of [["in a trip", tripPage(store, tripId, vienna), true], ["in Destinations", destinationPage(store, vienna, true), false]]) {
    const [church, ...others] = churches(page);
    assert.deepEqual([church.label, church.toggle, church.manage, others], ["Church in Vienna", undefined, undefined, []], "its Church page " + name + " has nothing to open or close, and links nowhere else");
    assert.equal(shown(within(church.section).find((node) => node.type === "h4")), "Church");
    assert.match(shown(church.section), /St\. Stephen's Cathedral.*10:15 AM/, "its saved church shows " + name + ", with its Mass times");
    assert.deepEqual(within(church.section).filter((node) => node.type === "button" && node.props["aria-label"]).map((node) => node.props["aria-label"]), ["Edit St. Stephen's Cathedral", "Delete St. Stephen's Cathedral"], "with its Edit and Delete");
    assert.equal(within(church.section).some((node) => hasClass(node, "carousel")), false, "in its grid, not a carousel");
    assert.equal(shown(church.section).includes("Sunday, May 2, 2027"), sunday, sunday ? "with the stay's Sunday" : "without Sunday dates, which come from a trip");
    assert.ok(page.flatMap(within).some((node) => hasClass(node, "helper") && text(node) === "Churches are shared by every trip that visits Vienna. Mass times are manually recorded and have not been verified."), "it says churches are shared, not managed elsewhere");
  }
});
