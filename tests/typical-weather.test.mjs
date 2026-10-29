import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget, calculateDestinationBudget } from "../src/lib/budget.ts";
import { createStore, ValidationError } from "../src/lib/store.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Weather planning", dateLabel: "2027", homeCity: "Boston", travelers: 2, notes: "", ...overrides });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Reykjavik", stay: "A few nights", notes: "", ...overrides });
const emptyWeather = { weatherHighF: null, weatherLowF: null, weatherRainfall: "", weatherPeriod: "", weatherSource: "" };
const winterWeather = { weatherHighF: 0, weatherLowF: -12.5, weatherRainfall: "Light snow; occasional rain", weatherPeriod: "January historical averages", weatherSource: "Local climate archive" };
const dates = { nights: 3 };
const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
const weather = (store, id) => Object.fromEntries(Object.keys(emptyWeather).map((key) => [key, destination(store, id)[key]]));
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  return { store, tripId: store.applyMutation(tripInput()).id };
}
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-typical-weather-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}

test("optional weather defaults to missing, preserves zero, and accepts partial negative and decimal temperatures", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId)).id;
  assert.deepEqual(weather(store, id), emptyWeather);
  for (const [fields, expected] of [
    [{ weatherLowF: 0 }, { ...emptyWeather, weatherLowF: 0 }],
    [{ weatherHighF: 32.75 }, { ...emptyWeather, weatherLowF: 0, weatherHighF: 32.75 }],
    [{ weatherHighF: -10.5, weatherLowF: -22.25 }, { ...emptyWeather, weatherHighF: -10.5, weatherLowF: -22.25 }],
    [{ weatherHighF: -22.25 }, { ...emptyWeather, weatherHighF: -22.25, weatherLowF: -22.25 }],
    [{ weatherLowF: null }, { ...emptyWeather, weatherHighF: -22.25 }],
    [{ weatherHighF: null }, emptyWeather],
    [{ weatherHighF: 0 }, { ...emptyWeather, weatherHighF: 0 }],
  ]) {
    store.applyMutation(destinationInput(tripId, { id, ...fields }));
    assert.deepEqual(weather(store, id), expected);
  }
  const partialId = store.applyMutation(destinationInput(tripId, { weatherLowF: -40 })).id;
  assert.deepEqual(weather(store, partialId), { ...emptyWeather, weatherLowF: -40 });
});

test("weather save, edit, per-field omission, and clearing survive closing and reopening", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = store.applyMutation(destinationInput(tripId, {
      ...winterWeather, weatherRainfall: "  Light snow; occasional rain  ",
      weatherPeriod: " January historical averages ", weatherSource: " Local climate archive ",
    })).id;
    const changes = [
      [{}, winterWeather],
      [{ weatherRainfall: "  2 inches on average\nBring waterproof shoes  " }, { ...winterWeather, weatherRainfall: "2 inches on average\nBring waterproof shoes" }],
      [{ weatherHighF: 5.25, weatherSource: " https://example.com/climate " }, { ...winterWeather, weatherHighF: 5.25, weatherRainfall: "2 inches on average\nBring waterproof shoes", weatherSource: "https://example.com/climate" }],
      [{ weatherHighF: null, weatherPeriod: " Late January to early February " }, { ...winterWeather, weatherHighF: null, weatherRainfall: "2 inches on average\nBring waterproof shoes", weatherPeriod: "Late January to early February", weatherSource: "https://example.com/climate" }],
      [{ weatherLowF: null, weatherRainfall: "", weatherSource: "  " }, { ...emptyWeather, weatherPeriod: "Late January to early February" }],
      [{ weatherPeriod: "" }, emptyWeather],
    ];
    for (const [fields, expected] of changes) {
      store.applyMutation(destinationInput(tripId, { id, ...fields }));
      assert.deepEqual(weather(store, id), expected);
      const before = store.getSnapshot();
      store.close(); store = null;
      store = createStore(path);
      assert.deepEqual(store.getSnapshot(), before);
      assert.deepEqual(weather(store, id), expected);
    }
  } finally { store?.close(); }
});

test("invalid weather types, text lengths, and high/low combinations reject the entire save", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...winterWeather, image: webp })).id;
  const before = store.getSnapshot();
  const image = store.getDestinationImage(id);
  const invalid = [
    ...[NaN, Infinity, -Infinity, "32", "", false, [], {}].flatMap((value) => [{ weatherHighF: value }, { weatherLowF: value }]),
    ...[null, 12, false, [], {}].flatMap((value) => [{ weatherRainfall: value }, { weatherPeriod: value }, { weatherSource: value }]),
    { weatherRainfall: "x".repeat(4001) }, { weatherPeriod: "x".repeat(121) }, { weatherSource: "x".repeat(2049) },
    { weatherHighF: -30, weatherLowF: -20 },
  ];
  for (const fields of invalid) {
    for (const existingId of [undefined, id]) {
      assert.throws(() => store.applyMutation(destinationInput(tripId, { id: existingId, city: "Must not save", notes: "Must not save", image: null, ...fields })), ValidationError);
      assert.deepEqual(store.getSnapshot(), before);
      assert.deepEqual(store.getDestinationImage(id), image);
    }
  }
  for (const fields of [{ weatherHighF: -20 }, { weatherLowF: 1 }]) {
    assert.throws(() => store.applyMutation(destinationInput(tripId, { id, city: "Must not save", ...fields })), ValidationError, "partial updates must validate against the saved counterpart");
    assert.deepEqual(store.getSnapshot(), before);
  }
  store.applyMutation(destinationInput(tripId, { id, weatherHighF: null, weatherLowF: 1 }));
  assert.equal(destination(store, id).weatherLowF, 1, "clearing the high permits a new low without a stale range constraint");
  store.applyMutation(destinationInput(tripId, { id, weatherRainfall: "x".repeat(4000), weatherPeriod: "x".repeat(120), weatherSource: "x".repeat(2048) }));
  assert.equal(destination(store, id).weatherRainfall.length, 4000);
  assert.equal(destination(store, id).weatherPeriod.length, 120);
  assert.equal(destination(store, id).weatherSource.length, 2048);
});

test("date changes and other destination editors preserve manually entered weather and its recorded period", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, { ...dates, ...winterWeather })).id;
  for (const fields of [
    { nights: 3 },
    { nights: null },
    { stay: "Three weeks in summer", notes: "New notes" },
    { hotelNightlyAmount: "120", hotelCurrency: "USD" },
    { foodBudgetMode: "daily", foodDailyAmount: "20", foodCurrency: "USD" },
    { activitiesBudgetMode: "general", activitiesGeneralAmount: "50", activitiesCurrency: "USD" },
    { shoppingAmount: "12.34", shoppingCurrency: "USD" },
    { miscDailyAmount: "100", miscCurrency: "USD" },
    { image: webp }, { image: null },
  ]) {
    store.applyMutation(destinationInput(tripId, { id, ...fields }));
    assert.deepEqual(weather(store, id), winterWeather);
  }
  store.applyMutation(tripInput({ id: tripId, travelers: 8, dateLabel: "Summer 2028" }));
  assert.deepEqual(weather(store, id), winterWeather);
});

test("weather edits leave existing destination data, routes, choices, and separated currency budgets unchanged", (t) => {
  const { store, tripId } = setup(t);
  const id = store.applyMutation(destinationInput(tripId, {
    ...dates, hotelNightlyAmount: "100", hotelCurrency: "USD", miscDailyAmount: "10", miscCurrency: "USD",
    activitiesBudgetMode: "general", activitiesGeneralAmount: "20", activitiesCurrency: "USD",
    foodBudgetMode: "daily", foodDailyAmount: "30", foodCurrency: "USD", shoppingAmount: "12.34", shoppingCurrency: "USD", image: webp,
  })).id;
  store.applyMutation({ type: "candidate.save", destinationId: id, category: "activities", name: "Museum", price: "999", address: "", url: "", notes: "Preserve this idea", included: true });
  for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Flight", price: "100", departure: "Morning", arrival: "Evening", url: "", notes: "Booked" });
  store.applyMutation({ type: "homeItem.save", tripId, name: "Pause mail", price: "", notes: "", completed: false });
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId);
  const destinationBudget = calculateDestinationBudget(before, id);
  const image = store.getDestinationImage(id);
  for (const fields of [winterWeather, { weatherHighF: 12.5, weatherSource: "New source" }, emptyWeather]) {
    store.applyMutation(destinationInput(tripId, { id, ...fields }));
    const after = store.getSnapshot();
    assert.deepEqual(calculateBudget(after, tripId), budget);
    assert.deepEqual(calculateDestinationBudget(after, id), destinationBudget);
    assert.deepEqual(store.getDestinationImage(id), image);
    assert.deepEqual({ ...after, destinations: after.destinations.map((item) => ({ ...item, ...emptyWeather })) }, before);
  }
});

test("schema 12 upgrade defaults weather to missing and preserves old data; migration replay retains saved weather", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = store.applyMutation(destinationInput(tripId, {
      ...dates, image: webp, hotelNightlyAmount: "125.25", hotelCurrency: "USD", miscDailyAmount: "10.01", miscCurrency: "USD",
      activitiesBudgetMode: "general", activitiesGeneralAmount: "55.55", activitiesCurrency: "USD",
      foodBudgetMode: "daily", foodDailyAmount: "20", foodCurrency: "USD", shoppingAmount: "12.34", shoppingCurrency: "USD",
    })).id;
    const candidateId = store.applyMutation({ type: "candidate.save", destinationId: id, category: "hotels", name: "Saved hotel", price: "123.45", address: "Main street", url: "", notes: "", included: true, image: webp, links: [{ id: randomUUID(), url: "https://example.com/hotel", description: "Booking" }] }).id;
    store.applyMutation({ type: "homeItem.save", tripId, name: "House sitting", price: "23.95", notes: "Leave a key", completed: true });
    for (const leg of store.getSnapshot().legs) store.applyMutation({ type: "leg.save", id: leg.id, method: "Flight", price: "100", departure: "Morning", arrival: "Evening", url: "", notes: "Booked", itinerary: [{ id: randomUUID(), kind: "layover", place: "London", arrival: "10:00", departure: "12:00", notes: "" }] });
    const before = store.getSnapshot();
    const budget = calculateBudget(before, tripId);
    const image = store.getDestinationImage(id);
    const candidateImage = store.getCandidateImage(candidateId);
    store.close(); store = null;
    let observer = new DatabaseSync(path);
    try {
      for (const column of Object.keys(emptyWeather)) observer.exec(`ALTER TABLE destinations DROP COLUMN ${column};`);
      observer.exec("PRAGMA user_version = 12;");
    } finally { observer.close(); }
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(weather(store, id), emptyWeather);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    assert.deepEqual(store.getDestinationImage(id), image);
    assert.deepEqual(store.getCandidateImage(candidateId), candidateImage);
    store.applyMutation(destinationInput(tripId, { id, ...winterWeather }));
    const saved = store.getSnapshot();
    store.close(); store = null;
    observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 15);
      const columns = observer.prepare("PRAGMA table_info(destinations)").all();
      for (const name of ["weatherHighF", "weatherLowF"]) {
        assert.equal(columns.find((column) => column.name === name).type, "REAL");
        assert.equal(columns.find((column) => column.name === name).notnull, 0);
      }
      for (const name of ["weatherRainfall", "weatherPeriod", "weatherSource"]) {
        assert.equal(columns.find((column) => column.name === name).notnull, 1);
        assert.equal(columns.find((column) => column.name === name).dflt_value, "''");
      }
      observer.exec("PRAGMA user_version = 12;");
    } finally { observer.close(); }
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), saved);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    store.close(); store = null;
    observer = new DatabaseSync(path);
    try { observer.exec("ALTER TABLE destinations DROP COLUMN weatherSource; PRAGMA user_version = 12;"); }
    finally { observer.close(); }
    store = createStore(path);
    assert.deepEqual(weather(store, id), { ...winterWeather, weatherSource: "" });
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    assert.deepEqual(store.getDestinationImage(id), image);
    assert.deepEqual(store.getCandidateImage(candidateId), candidateImage);
    observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 15);
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});
