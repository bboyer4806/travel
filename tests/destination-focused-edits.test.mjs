import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ValidationError } from "../src/lib/store.ts";
import { createOwnedStore } from "./owned-store.mjs";

const edits = [
  { weatherHighF: 70, weatherLowF: 40, weatherPeriod: "November", weatherRainfall: "Light rain", weatherSource: "Climate notes" },
  { shoppingAmount: "12.34", shoppingCurrency: "USD" },
  { foodBudgetMode: "daily", foodDailyAmount: "50.25", foodCurrency: "USD" },
  { activitiesBudgetMode: "general", activitiesGeneralAmount: "125.50", activitiesCurrency: "USD" },
];

for (const edit of edits) test(`focused ${Object.keys(edit)[0]} save preserves newer destination and connection details`, t => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation({ type: "trip.save", name: "Shared trip", startDate: "2026-11-01", dateLabel: "", homeCity: "Home", travelers: 2, notes: "" }).id;
  const id = store.applyMutation({ type: "destination.save", tripId, city: "Original", stay: "Old stay", notes: "Old notes", nights: 2 }).id;
  // Another traveler saves while a focused editor remains open on the old snapshot.
  store.applyMutation({ type: "destination.save", id, tripId, city: "New city", stay: "New stay", notes: "New notes", nights: 4, hotelNightlyAmount: "100", miscDailyAmount: "20" });
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Train", price: "40.50", departure: "Morning", arrival: "Afternoon", url: "https://example.com/train", notes: "Latest connection", itinerary: [{ id: randomUUID(), kind: "stop", place: "Transfer", arrival: "11 am", departure: "Noon", notes: "Keep this" }], links: [{ id: randomUUID(), url: "https://example.com/train", description: "Timetable" }] });
  const before = store.getSnapshot();
  store.applyMutation({ type: "destination.save", id, tripId, ...edit });
  const after = store.getSnapshot();
  const changed = new Set(Object.keys(edit).map(key => ({ shoppingAmount: "shoppingMinor", foodDailyAmount: "foodDailyMinor", activitiesGeneralAmount: "activitiesGeneralMinor" })[key] ?? key));
  for (const [key, value] of Object.entries(before.destinations[0])) {
    if (!changed.has(key)) assert.deepEqual(after.destinations[0][key], value, key);
  }
  assert.deepEqual(after.legs, before.legs);
  assert.deepEqual(after.trips, before.trips);
  assert.deepEqual(after.candidates, before.candidates);
  // Explicit empty text is still an intentional edit, unlike an omitted field.
  store.applyMutation({ type: "destination.save", id, tripId, stay: "", notes: "" });
  assert.equal(store.getSnapshot().destinations[0].stay, "");
  assert.equal(store.getSnapshot().destinations[0].notes, "");
  assert.deepEqual(store.getSnapshot().legs, before.legs);
  store.applyMutation({ type: "destination.save", id, tripId, city: "Intentional rename" });
  assert.ok(store.getSnapshot().legs.every(leg => leg.priceCents === null && leg.itinerary.length === 0 && leg.links.length === 0));
  for (const city of [undefined, null, "", "   "]) assert.throws(() => store.applyMutation({ type: "destination.save", tripId, city }), ValidationError);
  for (const field of ["city", "stay", "notes"]) assert.throws(() => store.applyMutation({ type: "destination.save", id, tripId, [field]: null }), ValidationError);
});
