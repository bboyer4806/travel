import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as money from "../src/lib/money.ts";
import { ValidationError } from "../src/lib/store.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import { createOwnedStore } from "./owned-store.mjs";
import { addCity, newItem } from "./budget-fixtures.mjs";

const { calculateBudget } = budget;

const edits = [
  { weatherHighF: 70, weatherLowF: 40, weatherPeriod: "November", weatherRainfall: "Light rain", weatherSource: "Climate notes" },
  { shoppingAmount: "12.34" },
  { foodBudgetMode: "daily", foodDailyAmount: "50.25" },
  { activitiesBudgetMode: "general", activitiesGeneralAmount: "125.50" },
  // Accommodation's editor outside a trip, and Miscellaneous's editor (TRA-113).
  { hotelNightlyAmount: "180" },
  { miscDailyAmount: "30.75" },
];

for (const edit of edits) test(`focused ${Object.keys(edit)[0]} save preserves newer destination and connection details`, t => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation({ type: "trip.save", ...newItem(), name: "Shared trip", startDate: "2026-11-01", dateLabel: "", homeCity: "Home", travelers: 2, notes: "" }).id;
  const id = addCity((input) => store.applyMutation(input).id, tripId, "Original", { stay: "Old stay", notes: "Old notes", nights: 2 });
  // Another traveler saves while a focused editor remains open on the old snapshot.
  store.applyMutation({ type: "destination.save", id, stopId: id, city: "New city", stay: "New stay", notes: "New notes", nights: 4, hotelNightlyAmount: "100", miscDailyAmount: "20" });
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "40.50", departure: "Morning", arrival: "Afternoon", url: "https://example.com/train", notes: "Latest connection", itinerary: [{ id: randomUUID(), kind: "stop", place: "Transfer", arrival: "11 am", departure: "Noon", notes: "Keep this" }], links: [{ id: randomUUID(), url: "https://example.com/train", description: "Timetable" }] });
  const before = store.getSnapshot();
  store.applyMutation({ type: "destination.save", id, ...edit });
  const after = store.getSnapshot();
  // An entered amount is saved with its USD currency label.
  const changed = new Set(Object.keys(edit).flatMap(key => ({ shoppingAmount: ["shoppingMinor", "shoppingCurrency"], foodDailyAmount: ["foodDailyMinor", "foodCurrency"], activitiesGeneralAmount: ["activitiesGeneralMinor", "activitiesCurrency"], hotelNightlyAmount: ["hotelNightlyMinor", "hotelCurrency"], miscDailyAmount: ["miscDailyMinor", "miscCurrency"] })[key] ?? [key]));
  for (const [key, value] of Object.entries(before.destinations[0])) {
    if (!changed.has(key)) assert.deepEqual(after.destinations[0][key], value, key);
  }
  assert.deepEqual(after.stops, before.stops);
  assert.deepEqual(after.legs, before.legs);
  assert.deepEqual(after.trips, before.trips);
  assert.deepEqual(after.candidates, before.candidates);
  // Explicit empty text is still an intentional edit, unlike an omitted field.
  store.applyMutation({ type: "destination.save", id, stopId: id, stay: "", notes: "" });
  assert.equal(store.getSnapshot().stops[0].stay, "");
  assert.equal(store.getSnapshot().destinations[0].notes, "");
  assert.deepEqual(store.getSnapshot().legs, before.legs);
  store.applyMutation({ type: "destination.save", id, city: "Intentional rename" });
  assert.ok(store.getSnapshot().legs.every(leg => leg.priceCents === null && leg.itinerary.length === 0 && leg.links.length === 0));
  for (const city of [undefined, null, "", "   "]) assert.throws(() => store.applyMutation({ type: "stop.add", tripId, city }), ValidationError);
  for (const field of ["city", "stay", "notes"]) assert.throws(() => store.applyMutation({ type: "destination.save", id, stopId: id, [field]: null }), ValidationError);
});

/**
 * A trip starting November 1 with two stays: the first, which another traveler has just changed while a focused editor
 * remained open on the old snapshot, and the next one, whose dates follow it. Every connection has saved details.
 */
function twoStayTrip(t) {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation({ type: "trip.save", ...newItem(), name: "Shared trip", startDate: "2026-11-01", dateLabel: "", homeCity: "Home", travelers: 2, notes: "" }).id;
  const id = addCity((input) => store.applyMutation(input).id, tripId, "Original", { stay: "Old stay", notes: "Old notes", nights: 2 });
  const next = addCity((input) => store.applyMutation(input).id, tripId, "Next", { stay: "Next stay", nights: 3, hotelNightlyAmount: "80" });
  store.applyMutation({ type: "destination.save", id, stopId: id, city: "New city", stay: "New stay", notes: "New notes", nights: 4, hotelNightlyAmount: "100", miscDailyAmount: "20", foodBudgetMode: "daily", foodDailyAmount: "50" });
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "40.50", departure: "Morning", arrival: "Afternoon", url: "https://example.com/train", notes: "Latest connection", itinerary: [{ id: randomUUID(), kind: "stop", place: "Transfer", arrival: "11 am", departure: "Noon", notes: "Keep this" }], links: [{ id: randomUUID(), url: "https://example.com/train", description: "Timetable" }] });
  return { store, tripId, id, next };
}

const stayEdits = [
  // Accommodation's editor in a trip: that stay's nights and the shared nightly estimate.
  { edit: { nights: 5, hotelNightlyAmount: "210.50" }, dates: [["2026-11-01", "2026-11-06"], ["2026-11-06", "2026-11-09"]], hotels: 21050 * 5 + 8000 * 3, misc: 2000 * 5, food: 5000 * 5 },
  // Edit destination nights, from Restaurants: that stay's nights alone. A zero-night visit still uses one budget day.
  { edit: { nights: 0 }, dates: [["2026-11-01", "2026-11-01"], ["2026-11-01", "2026-11-04"]], hotels: 0 + 8000 * 3, misc: 2000, food: 5000 },
];

for (const { edit, dates, hotels, misc, food } of stayEdits) test(`focused ${Object.keys(edit).join(" and ")} save recalculates dates and budgets and preserves newer details`, t => {
  const { store, tripId, id, next } = twoStayTrip(t);
  const before = store.getSnapshot();
  store.applyMutation({ type: "destination.save", id, stopId: id, ...edit });
  const after = store.getSnapshot();
  const find = (items, itemId) => items.find(item => item.id === itemId);
  const changed = new Set(edit.hotelNightlyAmount === undefined ? [] : ["hotelNightlyMinor", "hotelCurrency"]);
  for (const [key, value] of Object.entries(find(before.destinations, id))) {
    if (!changed.has(key)) assert.deepEqual(find(after.destinations, id)[key], value, key);
  }
  if (edit.hotelNightlyAmount !== undefined) assert.deepEqual([find(after.destinations, id).hotelNightlyMinor, find(after.destinations, id).hotelCurrency], [21050, "USD"]);
  // Only this stay's nights change, with the dates that follow from them, here, at the next stay and at the trip's end.
  assert.deepEqual(find(after.stops, id), { ...find(before.stops, id), nights: edit.nights, arrivalDate: dates[0][0], departureDate: dates[0][1] });
  assert.deepEqual(find(after.stops, next), { ...find(before.stops, next), arrivalDate: dates[1][0], departureDate: dates[1][1] });
  assert.deepEqual(after.trips, before.trips.map(trip => ({ ...trip, endDate: dates[1][1] })));
  assert.deepEqual(find(after.destinations, next), find(before.destinations, next));
  assert.deepEqual(after.legs, before.legs);
  assert.deepEqual(after.candidates, before.candidates);
  // The trip's budget uses the new nights, by the existing rules.
  const budget = calculateBudget(after, tripId);
  assert.deepEqual([budget.hotelsByCurrency, budget.miscellaneousByCurrency, budget.foodByCurrency], [{ USD: hotels }, { USD: misc }, { USD: food }]);
});

test("focused nights and nightly estimate save is refused whole when either is invalid", t => {
  const { store, id } = twoStayTrip(t);
  const before = store.getSnapshot();
  for (const edit of [{ stopId: id, nights: 6, hotelNightlyAmount: "1.001" }, { stopId: id, nights: -1, hotelNightlyAmount: "90" }, { nights: 6, hotelNightlyAmount: "90" }]) {
    assert.throws(() => store.applyMutation({ type: "destination.save", id, ...edit }), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
});

// The actual editors, rendered with each hook's initial state. No browser is involved.
const editors = {};
runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/destination-budget.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: editors,
  require(name) {
    const element = (type, props) => ({ type, props });
    const modules = {
      "react": { useId: () => "id", useState: (initial) => [initial, () => {}] },
      "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
      "next/link": { default: "a" }, "lucide-react": { ChevronDown: "icon" },
      "@/lib/trip-dates": tripDates, "@/lib/budget": budget, "@/lib/money": money,
    };
    if (!(name in modules)) throw new Error("Unexpected component import: " + name);
    return modules[name];
  },
});
/** The host elements an element renders to, with every component rendered. */
function hosts(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (typeof node.type === "function") return hosts(node.type(node.props));
  return [node, ...hosts(node.props.children)];
}
const render = (Editor, props) => hosts({ type: Editor, props: { disabled: false, ...props } });
const fieldNames = (rendered) => rendered.filter((node) => ["input", "select", "textarea"].includes(node.type)).map((node) => node.props.name);
const texts = (rendered) => rendered.flatMap((node) => [node.props.children].flat(Infinity)).filter((child) => typeof child === "string");

test("each section's editor shows only its own fields, and the destination editor keeps them all", () => {
  const { AccommodationBudgetEditor, MiscellaneousBudgetEditor, StayNightsEditor, DestinationBudgetEditor } = editors;
  const stop = { id: "stop", nights: 3, legacyArrivalDate: null, legacyDepartureDate: null };
  const stay = { trip: { startDate: "2026-11-01" }, stops: [stop], stop };
  const destination = { hotelNightlyMinor: 35000, hotelCurrency: "USD", miscDailyMinor: 2500, miscCurrency: "USD", activitiesBudgetMode: "itemized", activitiesGeneralMinor: null, activitiesCurrency: null, foodBudgetMode: "daily", foodDailyMinor: 12000, foodCurrency: "USD", shoppingMinor: null, shoppingCurrency: null };
  // Edit estimate & nights, in a trip: the stay's nights and the nightly estimate, previewed with that stay's dates.
  const accommodation = render(AccommodationBudgetEditor, { destination, stay });
  assert.deepEqual(fieldNames(accommodation), ["nights", "hotelNightlyAmount"]);
  for (const preview of ["Wed, Nov 4, 2026", "$1,050"]) assert.ok(texts(accommodation).includes(preview), preview);
  // Edit nightly estimate, in Destinations, where nights belong to each trip.
  assert.deepEqual(fieldNames(render(AccommodationBudgetEditor, { destination })), ["hotelNightlyAmount"]);
  const miscellaneous = render(MiscellaneousBudgetEditor, { destination, nights: 3 });
  assert.deepEqual(fieldNames(miscellaneous), ["miscDailyAmount"]);
  assert.ok(texts(miscellaneous).includes("$75"));
  // Edit destination nights, from Restaurants.
  assert.deepEqual(fieldNames(render(StayNightsEditor, { stay })), ["nights"]);
  assert.deepEqual(fieldNames(render(DestinationBudgetEditor, { destination, stay })), ["nights", "hotelNightlyAmount", "miscDailyAmount", "activitiesBudgetMode", "activitiesGeneralAmount", "foodBudgetMode", "foodDailyAmount", "shoppingAmount"]);
});
