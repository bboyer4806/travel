import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as tripBestTime from "../src/lib/trip-best-time.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import * as tripTags from "../src/lib/trip-tags.ts";
import { addCity, newItem, stopEdit, tripInput } from "./budget-fixtures.mjs";
import { cssRules } from "./css-rules.mjs";
import { createOwnedStore } from "./owned-store.mjs";

// TRA-177: Sort by on All trips orders the trips it shows by destinations, countries, estimated cost, budget completeness
// or length, for as long as the page is open, without changing the account's own order (TRA-16).
const { destinationCountry, sortTrips, TRIP_SORTS } = tripSort;

/**
 * An in-memory store, closed after the test, that reads and writes as the designated owner, and `addTrip`, which adds a
 * trip with `details` and returns its ID. Time stands still but for adding a trip, a minute after the one before, so
 * trips come in the owner's own order as they were added, as trips never arranged do (TRA-16).
 */
function planner(t) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 1) });
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const addTrip = (name, details = {}) => { t.mock.timers.tick(60_000); return store.applyMutation(tripInput({ name, ...details })).id; };
  return { store, addTrip };
}
/** Adds a city to a trip as typed, with `details` for its stay and destination. */
const typed = (store, tripId, city, details = {}) => addCity((input) => store.applyMutation(input).id, tripId, city, details);
/** Adds a city to a trip as chosen from a city suggestion, whose label `city` is, with `details` for its stay and destination. */
function suggested(store, tripId, city, details = {}) {
  const id = store.applyMutation({ type: "stop.add", tripId, city, cityFromSuggestion: true }).id;
  store.applyMutation(stopEdit(id, details));
  return id;
}
/** The names of the owner's trips on All trips, in the order `sort` shows them, from what the page loads. */
function names(store, sort) {
  const { data, budgets } = store.getHomeOverview();
  return sortTrips(data.trips, sort, { stops: data.stops, destinations: data.destinations, budgets }).map((trip) => trip.name);
}
/** Prices every connection of a trip, so only its stays decide whether its estimate is complete. */
function priceConnections(store, tripId, price) {
  for (const leg of store.getSnapshot().legs.filter((item) => item.tripId === tripId)) {
    store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price, miscAmount: "", departure: "", arrival: "", url: "", notes: "" });
  }
}

test("Sort by lists Custom order first, then most and fewest destinations and countries, highest and lowest cost, budget completeness, and longest and shortest trip (TRA-177)", () => {
  assert.deepEqual(Object.entries(TRIP_SORTS), [
    ["custom", "Custom order"],
    ["mostDestinations", "Most destinations"], ["fewestDestinations", "Fewest destinations"],
    ["mostCountries", "Most countries"], ["fewestCountries", "Fewest countries"],
    ["highestCost", "Highest estimated cost"], ["lowestCost", "Lowest estimated cost"],
    ["completeness", "Budget completeness"],
    ["longest", "Longest trip"], ["shortest", "Shortest trip"],
  ]);
});

test("Custom order is the account's own order, and sorting changes neither it nor anything saved (TRA-177)", (t) => {
  const { store, addTrip } = planner(t);
  const [lisbon, rome, oslo] = ["Lisbon", "Rome", "Oslo"].map((name) => addTrip(name));
  typed(store, rome, "Rome", { nights: 2 });
  typed(store, rome, "Florence", { nights: 3 });
  typed(store, oslo, "Oslo", { nights: 4 });
  store.applyMutation({ type: "trip.order", tripIds: [oslo, lisbon, rome] });
  const saved = store.getSnapshot();
  const home = store.getHomeOverview();
  const trips = [...home.data.trips];
  assert.deepEqual(names(store, "custom"), ["Oslo", "Lisbon", "Rome"]);
  assert.deepEqual(names(store, "mostDestinations"), ["Rome", "Oslo", "Lisbon"]);
  for (const sort of Object.keys(TRIP_SORTS)) sortTrips(home.data.trips, sort, { stops: home.data.stops, destinations: home.data.destinations, budgets: home.budgets });
  assert.deepEqual(home.data.trips, trips, "the trips the page has stay in the account's order");
  assert.deepEqual(store.getSnapshot(), saved, "no trip, destination, stay or estimate changes");
  assert.deepEqual(names(store, "custom"), ["Oslo", "Lisbon", "Rome"], "and the saved order is the same");
});

test("destinations sort by how many stops each trip's route has: a trip without any has none, and other trips' and saved destinations don't count (TRA-177)", (t) => {
  const { store, addTrip } = planner(t);
  const two = addTrip("Two");
  addTrip("None");
  const three = addTrip("Three");
  const alsoTwo = addTrip("Also two");
  const one = addTrip("One");
  for (const [tripId, cities] of [[two, ["Rome", "Florence"]], [three, ["Rome", "Venice", "Milan"]], [alsoTwo, ["Oslo", "Bergen"]], [one, ["Kyoto"]]]) {
    for (const city of cities) store.applyMutation({ type: "stop.add", tripId, city });
  }
  // A destination saved in Destinations belongs to no trip, and Rome, visited by two trips, counts once in each.
  store.applyMutation({ type: "destination.create", city: "Lisbon" });
  assert.deepEqual(names(store, "mostDestinations"), ["Three", "Two", "Also two", "One", "None"], "trips with as many keep the account's order");
  assert.deepEqual(names(store, "fewestDestinations"), ["None", "One", "Two", "Also two", "Three"]);
});

test("only a city chosen from a suggestion says its country: the label's last part, when it is a country Travel recognizes (TRA-177)", () => {
  const country = (city, cityFromSuggestion = true) => destinationCountry({ city, cityFromSuggestion });
  // A suggestion's label is its city, region and country, without a region it lacks or one that repeats the city's name.
  assert.deepEqual([country("Rome, Lazio, Italy"), country("Wooster, Ohio, United States"), country("Madrid, Spain"), country("Monaco")], ["IT", "US", "ES", "MC"]);
  // A country Travel doesn't recognize, or a region left last when the country repeats the city's name, says nothing.
  assert.deepEqual([country("Springfield, Somewhere, Nowhere"), country("Singapore, Central Singapore")], [undefined, undefined]);
  // Typed text is never read for a country, however it is written (TRA-76).
  assert.deepEqual([country("Paris, France", false), country("Italy", false), country("Rome, Lazio, Italy", false)], [undefined, undefined, undefined]);
});

test("countries sort by how many different countries a trip's destinations are in, each once, with trips whose countries are all unknown last (TRA-177)", (t) => {
  const { store, addTrip } = planner(t);
  const italy = addTrip("Italy twice");
  suggested(store, italy, "Rome, Lazio, Italy");
  suggested(store, italy, "Florence, Tuscany, Italy");
  const unknown = addTrip("Typed only");
  typed(store, unknown, "Paris, France");
  const iberia = addTrip("Iberia");
  suggested(store, iberia, "Madrid, Spain");
  suggested(store, iberia, "Lisbon, Lisbon, Portugal");
  suggested(store, iberia, "Porto, Porto, Portugal");
  addTrip("No destinations");
  // A typed city isn't guessed, so this trip has the one country Travel can tell.
  const mixed = addTrip("Mixed");
  suggested(store, mixed, "Salzburg, Salzburg, Austria");
  typed(store, mixed, "Munich");
  const three = addTrip("Three countries");
  suggested(store, three, "Wooster, Ohio, United States");
  suggested(store, three, "Toronto, Ontario, Canada");
  suggested(store, three, "Monaco");
  assert.deepEqual(names(store, "mostCountries"), ["Three countries", "Iberia", "Italy twice", "Mixed", "No destinations", "Typed only"]);
  assert.deepEqual(names(store, "fewestCountries"), ["No destinations", "Italy twice", "Mixed", "Iberia", "Three countries", "Typed only"], "unknown is never counted as none");
});

test("estimated cost sorts by each trip's estimated total as its card shows it, with trips that have none last either way (TRA-177)", (t) => {
  const { store, addTrip } = planner(t);
  const rome = addTrip("Rome");
  typed(store, rome, "Rome", { nights: 2, hotelNightlyAmount: "100", foodBudgetMode: "daily", foodDailyAmount: "50", activitiesBudgetMode: "general", activitiesGeneralAmount: "40", miscDailyAmount: "10" });
  priceConnections(store, rome, "300");
  const lisbon = addTrip("Lisbon");
  typed(store, lisbon, "Lisbon", { nights: 3, hotelNightlyAmount: "200" });
  const oslo = addTrip("Oslo");
  typed(store, oslo, "Oslo", { nights: 2 });
  addTrip("No destinations");
  const kyoto = addTrip("Kyoto");
  typed(store, kyoto, "Kyoto", { nights: 3, hotelNightlyAmount: "200" });
  const { budgets } = store.getHomeOverview();
  assert.deepEqual([rome, lisbon, oslo, kyoto].map((id) => [budgets[id].totalsByCurrency, budgets[id].complete]),
    [[{ USD: 96000 }, true], [{ USD: 60000 }, false], [{}, false], [{ USD: 60000 }, false]]);
  // A partial estimate sorts by the total its card shows, and trips with the same total keep the account's order. Oslo
  // and the trip without destinations have no amount yet, which is never taken as $0.
  assert.deepEqual(names(store, "highestCost"), ["Rome", "Lisbon", "Kyoto", "Oslo", "No destinations"]);
  assert.deepEqual(names(store, "lowestCost"), ["Lisbon", "Kyoto", "Rome", "Oslo", "No destinations"]);
});

test("an estimate in any other currency has no cost to compare, so it is never added up or converted (TRA-177)", () => {
  // The store refuses amounts in any currency but USD, so estimates are USD; the sort still never mixes currencies.
  const estimate = (totalsByCurrency) => ({ totalsByCurrency, complete: false, knownCount: 1 });
  const trips = ["Dollars", "Euros", "Mixed", "More dollars"].map((name) => ({ id: name, name, startDate: null, endDate: null }));
  const budgets = { Dollars: estimate({ USD: 50000 }), Euros: estimate({ EUR: 90000 }), Mixed: estimate({ EUR: 100, USD: 100 }), "More dollars": estimate({ USD: 70000 }) };
  const sorted = (sort) => sortTrips(trips, sort, { stops: [], destinations: [], budgets }).map((trip) => trip.name);
  assert.deepEqual(sorted("highestCost"), ["More dollars", "Dollars", "Euros", "Mixed"]);
  assert.deepEqual(sorted("lowestCost"), ["Dollars", "More dollars", "Euros", "Mixed"]);
});

test("budget completeness puts fully estimated trips first, then partially estimated, then not estimated, as their cards say (TRA-177)", (t) => {
  const { store, addTrip } = planner(t);
  const partial = addTrip("Partial");
  typed(store, partial, "Lisbon", { nights: 3, hotelNightlyAmount: "200" });
  const notEstimated = addTrip("Not estimated");
  typed(store, notEstimated, "Oslo", { nights: 2 });
  const complete = addTrip("Complete");
  typed(store, complete, "Rome", { nights: 1, hotelNightlyAmount: "90", foodBudgetMode: "daily", foodDailyAmount: "40", activitiesBudgetMode: "general", activitiesGeneralAmount: "0", miscDailyAmount: "0" });
  priceConnections(store, complete, "0");
  // At home prices alone are a partial estimate of a trip without destinations.
  const homeOnly = addTrip("At home only");
  store.applyMutation({ type: "homeItem.save", ...newItem(), tripId: homeOnly, name: "Pet sitter", price: "120", notes: "" });
  addTrip("Nothing yet");
  const { budgets } = store.getHomeOverview();
  assert.deepEqual([budgets[complete].complete, budgets[homeOnly].knownCount > 0, budgets[notEstimated].knownCount], [true, true, 0]);
  assert.deepEqual(names(store, "completeness"), ["Complete", "Partial", "At home only", "Not estimated", "Nothing yet"]);
});

test("trip length counts calendar days from the start date to the end date, both included, wherever the clocks change, with trips lacking either last (TRA-177)", (t) => {
  const { store, addTrip } = planner(t);
  const trip = (name, startDate, ...nights) => {
    const id = addTrip(name, startDate ? { startDate } : {});
    nights.forEach((value, index) => typed(store, id, `${name} ${index + 1}`, { nights: value }));
  };
  trip("Week", "2027-06-01", 3, 4);
  trip("No start date", null, 5);
  trip("Leap year", "2028-02-27", 3);
  trip("New Year", "2026-12-30", 3);
  // United States clocks go forward on March 14, 2027, and Europe's on March 28.
  trip("Clocks change", "2027-03-13", 2);
  trip("Nights unknown", "2027-05-01", null);
  trip("Day trip", "2027-03-28", 0);
  trip("No destinations", "2027-08-01");
  const ends = Object.fromEntries(store.getHomeOverview().data.trips.map((item) => [item.name, item.endDate]));
  assert.deepEqual([ends["Week"], ends["Leap year"], ends["New Year"], ends["Clocks change"], ends["Day trip"]], ["2027-06-08", "2028-03-01", "2027-01-02", "2027-03-15", "2027-03-28"]);
  assert.deepEqual([ends["No start date"], ends["Nights unknown"], ends["No destinations"]], [null, null, null], "without a start date and every stay's nights, a trip has no end date");
  const timeZone = process.env.TZ;
  t.after(() => { if (timeZone === undefined) delete process.env.TZ; else process.env.TZ = timeZone; });
  for (const zone of ["UTC", "America/New_York", "Europe/Berlin", "Pacific/Auckland"]) {
    process.env.TZ = zone;
    // 8 days for the week, 4 days from February 27 to March 1 in a leap year, and from December 30 to January 2, 3 across
    // a clock change, and 1 for a trip that ends the day it starts.
    assert.deepEqual(names(store, "longest"), ["Week", "Leap year", "New Year", "Clocks change", "Day trip", "No start date", "Nights unknown", "No destinations"], zone);
    assert.deepEqual(names(store, "shortest"), ["Day trip", "Clocks change", "Leap year", "New Year", "Week", "No start date", "Nights unknown", "No destinations"], zone);
  }
});

test("a sort follows the trips' destinations, estimates and dates each time the page loads them (TRA-177)", (t) => {
  const { store, addTrip } = planner(t);
  const lisbon = addTrip("Lisbon", { startDate: "2027-05-01" });
  const lisbonStop = typed(store, lisbon, "Lisbon", { nights: 2, hotelNightlyAmount: "100" });
  const rome = addTrip("Rome", { startDate: "2027-06-01" });
  typed(store, rome, "Rome", { nights: 5, hotelNightlyAmount: "300" });
  typed(store, rome, "Florence", { nights: 1 });
  /** The trips' order by most destinations, highest estimated cost and longest trip. */
  const orders = () => ["mostDestinations", "highestCost", "longest"].map((sort) => names(store, sort));
  assert.deepEqual(orders(), [["Rome", "Lisbon"], ["Rome", "Lisbon"], ["Rome", "Lisbon"]]);
  // Two more destinations, and a longer, dearer stay, which moves the trip's end date.
  const added = [typed(store, lisbon, "Porto", { nights: 1 }), typed(store, lisbon, "Sintra", { nights: 1 })];
  store.applyMutation(stopEdit(lisbonStop, { nights: 9, hotelNightlyAmount: "250" }));
  assert.deepEqual(orders(), [["Lisbon", "Rome"], ["Lisbon", "Rome"], ["Lisbon", "Rome"]]);
  for (const id of added) store.applyMutation({ type: "stop.remove", id });
  assert.deepEqual(orders(), [["Rome", "Lisbon"], ["Lisbon", "Rome"], ["Lisbon", "Rome"]], "with one destination again, still 10 days and $2,250");
});

// All trips, rendered by the planner from what the store gives `/`, as its page does, with a small hook harness that
// keeps state between renders, as React does. No browser or server is involved.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
const element = (type, props) => ({ type, props });
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");

/** The owner's All trips, with the changes it sends, whether its trips may be dragged, and ways to use it. */
function homePage(store) {
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
  const sent = [];
  let drag;
  const cssModule = { default: new Proxy({}, { get: (_, name) => String(name) }) };
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), unstable_isUnrecognizedActionError: () => false },
    "@/app/actions": { mutatePlanner: async (mutation) => { sent.push(mutation); return { ok: true, ...store.applyMutation(mutation) }; } },
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort, "@/lib/trip-tags": tripTags, "@/lib/trip-best-time": tripBestTime,
    // Dragging itself is tested in trip-drag.test.mjs. Here the list keeps the trips it was given and whether they may move.
    "@/components/trip-drag": { useTripDrag: (trips, place, enabled) => { drag = { trips: trips.map((item) => item.name), enabled }; return { card: () => ({}), handle: () => ({}), announcement: "" }; } },
  };
  // Every other module is one All trips doesn't need here: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  const require = (name) => name.endsWith(".module.css") ? cssModule : modules[name] ?? unused;
  modules["@/components/trip-tags"] = load("../src/components/trip-tags.tsx", require);
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", require);
  function render(node) {
    if (Array.isArray(node)) return [...node].flatMap(render);
    if (node === null || node === undefined || typeof node === "boolean") return [];
    if (typeof node !== "object") return [String(node)];
    if (typeof node.type === "function") return render(node.type(node.props));
    if (node.type === "fragment") return render(node.props.children);
    return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
  }
  const { data, budgets, access } = store.getHomeOverview();
  const props = { initialData: data, initialBudgets: budgets, access };
  let shown;
  /** The page as it renders now, twice, as React renders again at once when the page changes its state while rendering. */
  const show = () => { for (let pass = 0; pass < 2; pass++) { cursor = 0; shown = render(PlannerApp(props)); } };
  show();
  const all = () => shown.flatMap(within);
  const section = () => all().find((node) => node.type === "section" && node.props.className === "trips-section");
  /** Sort by: its label, with the select in it, or undefined without one. */
  const label = () => all().find((node) => node.type === "label" && node.props.className === "trip-sort");
  const select = () => within(label()).find((node) => node.type === "select");
  return {
    sent,
    drag: () => drag,
    label,
    select,
    /** What the trip list shows, in order: each part's tag and class, and Sort by's place among them. */
    parts: () => section().props.children.map((child) => child.type + (child.props.className ? "." + child.props.className : "")),
    /** The trip cards' names, in the order they show. */
    cards: () => all().filter((node) => node.type === "article" && node.props.className.startsWith("trip-card ")).map((card) => text(within(card).find((node) => node.type === "h3"))),
    note: () => { const note = all().find((node) => node.props.className === "helper trip-order-note"); return note && text(note); },
    choose(sort) { select().props.onChange({ target: { value: sort } }); show(); },
    search(value) { all().find((node) => node.type === "input" && node.props["aria-label"] === "Search trips").props.onChange({ target: { value } }); show(); },
    toggleTag(tag) { all().find((node) => node.type === "button" && node.props["aria-pressed"] !== undefined && text(node) === tag).props.onClick(); show(); },
  };
}

test("All trips has Sort by between Filter by tag and the trip cards, in Custom order each time the page opens (TRA-177)", (t) => {
  const { store, addTrip } = planner(t);
  const rome = addTrip("Rome");
  store.applyMutation({ type: "trip.tag", tripId: rome, name: "Europe" });
  addTrip("Kyoto");
  const page = homePage(store);
  assert.deepEqual(page.parts(), ["div.section-heading", "div.filter", "label.trip-sort", "p.sr-only", "p.sr-only", "div.trip-grid"]);
  const [name, select] = page.label().props.children;
  assert.deepEqual([name.type, text(name), select.type], ["span", "Sort by", "select"], "the label names the select");
  assert.equal(select.props.value, "custom");
  assert.deepEqual(select.props.children.map((option) => [option.props.value, text(option)]), Object.entries(TRIP_SORTS));
  page.choose("fewestDestinations");
  assert.equal(page.select().props.value, "fewestDestinations");
  assert.equal(homePage(store).select().props.value, "custom", "opening the page again starts in Custom order");
  // Without trips there is nothing to sort, as there is nothing to search.
  const empty = createOwnedStore(":memory:");
  t.after(() => empty.close());
  assert.equal(homePage(empty).label(), undefined);
});

test("choosing a sort rearranges the cards at once and saves nothing, and Custom order shows the saved order again (TRA-177)", (t) => {
  const { store, addTrip } = planner(t);
  const lisbon = addTrip("Lisbon");
  const rome = addTrip("Rome");
  const oslo = addTrip("Oslo");
  typed(store, rome, "Rome");
  typed(store, rome, "Florence");
  typed(store, oslo, "Oslo");
  store.applyMutation({ type: "trip.order", tripIds: [oslo, lisbon, rome] });
  const saved = store.getSnapshot();
  const page = homePage(store);
  assert.deepEqual(page.cards(), ["Oslo", "Lisbon", "Rome"]);
  page.choose("mostDestinations");
  assert.deepEqual(page.cards(), ["Rome", "Oslo", "Lisbon"]);
  page.choose("fewestDestinations");
  assert.deepEqual(page.cards(), ["Lisbon", "Oslo", "Rome"]);
  page.choose("custom");
  assert.deepEqual(page.cards(), ["Oslo", "Lisbon", "Rome"]);
  assert.deepEqual(page.sent, [], "no change is sent");
  assert.deepEqual(store.getSnapshot(), saved);
});

test("a sort orders only the trips matching the search and every selected tag, and trips move only in Custom order with every trip showing (TRA-177)", (t) => {
  const { store, addTrip } = planner(t);
  const trips = {};
  for (const [name, cities, tag] of [["Alps", ["Zurich", "Innsbruck", "Salzburg"], "Europe"], ["Kyoto", ["Kyoto", "Osaka"], "Asia"], ["Rome", ["Rome"], "Europe"], ["Lisbon", ["Lisbon", "Porto"], "Europe"]]) {
    // Without a general date, a search finds a trip only by its name and cities.
    trips[name] = addTrip(name, { dateLabel: "" });
    for (const city of cities) typed(store, trips[name], city);
    store.applyMutation({ type: "trip.tag", tripId: trips[name], name: tag });
  }
  const page = homePage(store);
  assert.deepEqual([page.drag(), page.note()], [{ trips: ["Alps", "Kyoto", "Rome", "Lisbon"], enabled: true }, undefined]);
  page.choose("fewestDestinations");
  assert.deepEqual([page.drag(), page.note()], [{ trips: ["Rome", "Kyoto", "Lisbon", "Alps"], enabled: false }, "Choose Custom order to drag trips into a new order."]);
  page.toggleTag("Europe");
  assert.deepEqual(page.cards(), ["Rome", "Lisbon", "Alps"]);
  page.search("o");
  assert.deepEqual(page.cards(), ["Rome", "Lisbon"], "Alps's name and cities have no o");
  assert.deepEqual([page.drag().enabled, page.note()], [false, "Choose Custom order and clear the search and filters to drag trips into a new order."]);
  page.choose("custom");
  assert.deepEqual(page.cards(), ["Rome", "Lisbon"], "matching trips in the account's order");
  assert.deepEqual([page.drag().enabled, page.note()], [false, "Clear the search and filters to drag trips into a new order."]);
  page.search("");
  page.toggleTag("Europe");
  assert.deepEqual([page.cards(), page.drag().enabled, page.note()], [["Alps", "Kyoto", "Rome", "Lisbon"], true, undefined]);
  assert.deepEqual(page.sent, []);
});

test("Sort by fits a phone beside its label, at a size phones don't zoom into (TRA-177)", () => {
  const rules = cssRules("../src/app/globals.css").filter(([selectors]) => selectors === ".trip-sort select");
  assert.deepEqual(rules.map(([, declarations, atRule]) => [atRule, declarations["font-size"], declarations.flex, declarations["min-width"]]),
    [[null, "13px", undefined, undefined], ["@media(max-width:540px)", "16px", "1", "0"]]);
});
