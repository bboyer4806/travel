import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget, calculateDestinationBudget } from "../src/lib/budget.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { CLIMATE_LIMITS, MONTHS, climateMonthText, formatReferenceYears, monthOf, monthlyClimateFromForm, monthlyClimateText, normalizeMonthlyClimate, sourceHref, temperatureScale } from "../src/lib/typical-weather.ts";
import { aiSetup } from "./ai-fixtures.mjs";
import { addCity, destination, destinationEdit, fileDatabase, newItem, setup, stop, stopEdit, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore } from "./owned-store.mjs";

// TRA-135: each destination's monthly climate averages, apart from its seasonal typical weather.
const months = (high = 40, low = 30, precipitation = 1.5) => MONTHS.map((_, index) => ({ highF: high + index, lowF: low + index, precipitationIn: precipitation + index / 10 }));
const climate = (overrides = {}) => ({ months: months(), source: "Test climate normals", firstYear: 1991, lastYear: 2020, ...overrides });
const save = (id, value) => ({ type: "destination.climate", id, climate: value });
// Vienna's temporary summer placeholder, as its typical weather is saved, which monthly averages never change.
const placeholder = { weatherHighF: 75, weatherLowF: 58, weatherRainfall: "Placeholder until researched", weatherPeriod: "Summer (temporary placeholder)", weatherSource: "" };
const seasonal = (store, id) => Object.fromEntries(Object.keys(placeholder).map((key) => [key, destination(store, id)[key]]));
const withMonth = (index, fields) => climate({ months: months().map((month, at) => at === index ? { ...month, ...fields } : month) });

test("a record needs every month's high, low and precipitation, a source and its reference years, and keeps nothing else", () => {
  const saved = normalizeMonthlyClimate({ ...climate({ source: "  https://example.com/normals  " }), extra: "dropped", months: months().map((month) => ({ ...month, note: "dropped" })) });
  assert.deepEqual(saved, climate({ source: "https://example.com/normals" }));
  assert.equal(normalizeMonthlyClimate(null), null, "null clears the record");
  // Zero, negative, decimal and boundary values are values, and a single reference year is a range of one.
  const edges = climate({ months: months().map((month, index) => index === 0 ? { highF: 0, lowF: -40.5, precipitationIn: 0 } : index === 1 ? { highF: CLIMATE_LIMITS.maxF, lowF: CLIMATE_LIMITS.minF, precipitationIn: CLIMATE_LIMITS.maxPrecipitationIn } : index === 2 ? { highF: 50, lowF: 50, precipitationIn: 2 } : month), firstYear: 2020, lastYear: 2020 });
  assert.deepEqual(normalizeMonthlyClimate(edges), edges);
  const refused = [
    [undefined, "Enter monthly averages, or clear the saved ones."], [[], "Enter monthly averages, or clear the saved ones."], ["1991", "Enter monthly averages, or clear the saved ones."],
    [climate({ months: months().slice(1) }), "Enter averages for all 12 months, January to December."],
    [climate({ months: [...months(), months()[0]] }), "Enter averages for all 12 months, January to December."],
    [climate({ months: undefined }), "Enter averages for all 12 months, January to December."],
    [climate({ months: months().map((month, index) => index === 4 ? null : month) }), "Enter averages for all 12 months, January to December."],
    ...[null, undefined, Number.NaN, Infinity, "52", CLIMATE_LIMITS.maxF + 0.5, CLIMATE_LIMITS.minF - 1].map((value) => [withMonth(2, { highF: value }), "Enter March's average high in °F, from -150 to 150."]),
    ...[null, Number.NaN, "30", -151].map((value) => [withMonth(11, { lowF: value }), "Enter December's average low in °F, from -150 to 150."]),
    [withMonth(6, { highF: 70, lowF: 70.5 }), "July's average high must be at least its average low."],
    ...[null, -0.1, 200.5, "1.2", Number.NaN].map((value) => [withMonth(0, { precipitationIn: value }), "Enter January's average precipitation in inches, from 0 to 200."]),
    ...[undefined, "", "   ", 12].map((source) => [climate({ source }), "Enter where the monthly averages are from."]),
    [climate({ source: "x".repeat(2049) }), "The monthly averages' source must be 2048 characters or fewer."],
    ...[undefined, null, 1991.5, 999, 10000, "1991", Number.NaN].map((firstYear) => [climate({ firstYear }), "Enter the first and last reference years as four-digit years."]),
    [climate({ lastYear: "2020" }), "Enter the first and last reference years as four-digit years."],
    [climate({ firstYear: 2021, lastYear: 2020 }), "The first reference year must be no later than the last."],
  ];
  for (const [value, message] of refused) assert.throws(() => normalizeMonthlyClimate(value), { message }, JSON.stringify(value)?.slice(0, 80));
  assert.equal(normalizeMonthlyClimate(climate({ source: "x".repeat(2048) })).source.length, 2048);
});

test("the editor sends its rows in calendar order, and a blank is never zero", () => {
  const form = new FormData();
  form.set("climateSource", " Test normals ");
  form.set("climateFirstYear", "1991");
  form.set("climateLastYear", "2020");
  for (const month of months()) {
    form.append("climateHighF", String(month.highF));
    form.append("climateLowF", String(month.lowF));
    form.append("climatePrecipitationIn", String(month.precipitationIn));
  }
  assert.deepEqual(normalizeMonthlyClimate(monthlyClimateFromForm(form)), climate({ source: "Test normals" }));
  const blank = new FormData();
  for (const month of months()) {
    blank.append("climateHighF", String(month.highF));
    blank.append("climateLowF", String(month.lowF));
    blank.append("climatePrecipitationIn", " ");
  }
  const draft = monthlyClimateFromForm(blank);
  assert.ok(draft.months.every((month) => Number.isNaN(month.precipitationIn)), "a blank precipitation is not a value");
  assert.ok(Number.isNaN(draft.firstYear) && Number.isNaN(draft.lastYear) && draft.source === "");
  assert.throws(() => normalizeMonthlyClimate(draft), { message: "Enter January's average precipitation in inches, from 0 to 200." });
});

test("months, years, sources and the temperature axis read as the chart shows them", () => {
  assert.deepEqual([monthOf("2027-01-31"), monthOf("2027-05-10"), monthOf("2027-12-01"), monthOf(null)], [0, 4, 11, null]);
  assert.deepEqual([formatReferenceYears({ firstYear: 1991, lastYear: 2020 }), formatReferenceYears({ firstYear: 2020, lastYear: 2020 })], ["1991–2020", "2020"]);
  assert.equal(climateMonthText(climate(), 2), "March: average high 42 °F, average low 32 °F, precipitation 1.7 in");
  assert.match(monthlyClimateText(climate()), /^Historical averages for 1991–2020 from Test climate normals; January: average high 40 °F, average low 30 °F, precipitation 1\.5 in; .*; December: average high 51 °F, average low 41 °F, precipitation 2\.6 in$/);
  assert.equal(sourceHref("https://example.com/normals?station=11035"), "https://example.com/normals?station=11035");
  for (const source of ["Test climate normals", "ftp://example.com/normals", "https://user:secret@example.com/", "javascript:alert(1)"]) assert.equal(sourceHref(source), undefined, source);
  // The smallest step spanning the year in six intervals or fewer, from below the lowest low to above the highest high.
  const scale = (pairs) => temperatureScale(pairs.map(([highF, lowF]) => ({ highF, lowF, precipitationIn: 0 })));
  assert.deepEqual(scale([[37, 27], [79, 61]]), { min: 20, max: 80, ticks: [20, 30, 40, 50, 60, 70, 80] });
  assert.deepEqual(scale([[90, 76], [88, 77]]), { min: 75, max: 90, ticks: [75, 80, 85, 90] });
  assert.deepEqual(scale([[70, 70]]), { min: 70, max: 75, ticks: [70, 75] }, "a flat year still has an interval");
  assert.deepEqual(scale([[10, -30], [55, 20]]), { min: -40, max: 60, ticks: [-40, -20, 0, 20, 40, 60] });
  assert.deepEqual(scale([[CLIMATE_LIMITS.maxF, CLIMATE_LIMITS.minF]]), { min: -150, max: 150, ticks: [-150, -100, -50, 0, 50, 100, 150] }, "every allowed record fits");
});

test("monthly averages save, replace and clear apart from typical weather, and survive reopening", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ startDate: "2027-05-10" })).id;
    const vienna = addCity((input) => store.applyMutation(input).id, tripId, "Vienna", { nights: 4, ...placeholder });
    const salzburg = addCity((input) => store.applyMutation(input).id, tripId, "Salzburg", { nights: 3 });
    assert.equal(destination(store, vienna).climate, null, "a destination starts without monthly averages");
    assert.deepEqual(store.applyMutation(save(vienna, climate())), { id: vienna });
    const other = climate({ months: months(80, 70, 4), source: "Other normals", firstYear: 1981, lastYear: 2010 });
    store.applyMutation(save(salzburg, other));
    // Each destination has its own averages, which its trip page and its own page both read.
    assert.deepEqual([destination(store, vienna).climate, destination(store, salzburg).climate], [climate(), other]);
    assert.deepEqual(store.getTripSnapshot(tripId).data.destinations.map((item) => [item.city, item.climate?.source]), [["Salzburg", "Other normals"], ["Vienna", "Test climate normals"]]);
    assert.deepEqual(store.getDestinationSnapshot(vienna).data.destinations[0].climate, climate());
    assert.deepEqual(seasonal(store, vienna), placeholder, "the summer placeholder stays");
    const replaced = climate({ months: months(41, 31, 2), firstYear: 1961, lastYear: 1990 });
    store.applyMutation(save(vienna, replaced));
    const before = store.getSnapshot();
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(destination(store, vienna).climate, replaced);
    store.applyMutation(save(vienna, null));
    assert.equal(destination(store, vienna).climate, null);
    assert.deepEqual(seasonal(store, vienna), placeholder, "clearing the averages keeps the typical weather");
    assert.deepEqual(destination(store, salzburg).climate, other, "clearing one destination's averages keeps another's");
    store.applyMutation(save(vienna, null));
    assert.equal(destination(store, vienna).climate, null, "clearing again changes nothing");
  } finally { store?.close(); }
});

test("a refused record changes nothing, and only a saved destination can have one", (t) => {
  const { store, tripId } = setup(t);
  const id = addCity((input) => store.applyMutation(input).id, tripId, "Vienna", { nights: 3, ...placeholder });
  store.applyMutation(save(id, climate()));
  const before = store.getSnapshot();
  for (const value of [climate({ months: months().slice(0, 11) }), withMonth(3, { lowF: 99 }), climate({ source: "" }), climate({ firstYear: 2030, lastYear: 2020 }), undefined]) {
    assert.throws(() => store.applyMutation(save(id, value)), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  assert.throws(() => store.applyMutation(save("not-an-id", climate())), ValidationError);
  assert.throws(() => store.applyMutation(save("6b3cf2a8-9b55-4a51-9b55-0d2a2c6b6a11", climate())), { message: "This item no longer exists or isn't shared with you. Please refresh and try again." });
  assert.deepEqual(store.getSnapshot(), before);
});

test("typical weather, dates, budgets and other research edits keep the monthly averages, and theirs never change them", (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-05-10" }));
  const id = addCity((input) => store.applyMutation(input).id, tripId, "Vienna", { nights: 4, hotelNightlyAmount: "150", miscDailyAmount: "40", foodBudgetMode: "daily", foodDailyAmount: "75", ...placeholder });
  store.applyMutation(save(id, climate()));
  const budget = () => calculateBudget(store.getSnapshot(), tripId);
  const dates = () => [store.getSnapshot().trips[0].startDate, stop(store, id).arrivalDate, stop(store, id).departureDate];
  const [savedBudget, savedDates] = [budget(), dates()];
  for (const change of [
    destinationEdit(id, { weatherHighF: 80, weatherPeriod: "July" }),
    // The typical weather editor's Clear all weather fields, saved.
    destinationEdit(id, { weatherHighF: null, weatherLowF: null, weatherRainfall: "", weatherPeriod: "", weatherSource: "" }),
    destinationEdit(id, { ...placeholder }),
    stopEdit(id, { nights: 6 }), stopEdit(id, { nights: 4 }),
    destinationEdit(id, { notes: "New notes", shoppingAmount: "20" }), destinationEdit(id, { shoppingAmount: "" }),
    { type: "destination.healthSafety", id, healthSafety: null },
    { type: "destination.churchVisibility", id, enabled: false },
    tripInput({ id: tripId, startDate: "2027-07-01" }), tripInput({ id: tripId, startDate: "2027-05-10" }),
  ]) {
    store.applyMutation(change);
    assert.deepEqual(destination(store, id).climate, climate(), change.type);
  }
  assert.deepEqual(seasonal(store, id), placeholder);
  // Saving, replacing and clearing the averages changes no date, budget or other research.
  const before = store.getSnapshot();
  const visitOf = (snapshot) => ({ ...snapshot.destinations[0], nights: snapshot.stops[0].nights });
  for (const value of [climate({ months: months(60, 50, 3) }), null, climate()]) {
    store.applyMutation(save(id, value));
    const after = store.getSnapshot();
    assert.deepEqual({ ...after, destinations: after.destinations.map((item) => ({ ...item, climate: null })) }, { ...before, destinations: before.destinations.map((item) => ({ ...item, climate: null })) });
    assert.deepEqual(calculateDestinationBudget(after, visitOf(after)), calculateDestinationBudget(before, visitOf(before)));
    assert.deepEqual([budget(), dates()], [savedBudget, savedDates]);
  }
});

test("every trip that visits a destination shares its averages, which stay when a stop or trip goes", (t) => {
  const { store, tripId } = setup(t);
  const otherTrip = store.applyMutation(tripInput({ name: "Second trip" })).id;
  const id = addCity((input) => store.applyMutation(input).id, tripId, "Vienna", { nights: 2 });
  const secondStop = store.applyMutation({ type: "stop.add", tripId: otherTrip, city: "Vienna" }).id;
  assert.equal(stop(store, secondStop).destinationId, id);
  store.applyMutation(save(id, climate()));
  assert.deepEqual(store.getTripSnapshot(otherTrip).data.destinations[0].climate, climate(), "the other trip shows the same averages");
  store.applyMutation({ type: "stop.remove", id: secondStop });
  store.applyMutation({ type: "trip.delete", id: otherTrip });
  assert.deepEqual(destination(store, id).climate, climate(), "removing a stop or deleting a trip keeps them");
});

test("deleting a destination deletes its averages", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  t.after(() => store.close());
  const id = store.applyMutation({ type: "destination.create", city: "Vienna" }).id;
  store.applyMutation(save(id, climate()));
  const rows = () => { const db = new DatabaseSync(path, { readOnly: true }); try { return db.prepare("SELECT count(*) AS n FROM destination_climate").get().n; } finally { db.close(); } };
  assert.equal(rows(), 1);
  store.applyMutation({ type: "destination.delete", id });
  assert.equal(rows(), 0);
});

test("whoever can change a destination can change its averages; nobody else can", (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const [owner, editor, outsider] = ["owner@example.com", "editor@example.com", "outsider@example.com"].map((email) => store.authorizeAccount(email).id);
  const tripId = store.applyMutation(owner, tripInput()).id;
  const id = addCity((input) => store.applyMutation(owner, input).id, tripId, "Vienna", { nights: 2 });
  store.applyMutation(owner, { type: "trip.share", tripId, email: "editor@example.com" });
  assert.throws(() => store.applyMutation(outsider, save(id, climate())), { message: "This item no longer exists or isn't shared with you. Please refresh and try again." });
  assert.equal(store.getDestinationSnapshot(outsider, id), undefined);
  assert.deepEqual(store.applyMutation(editor, save(id, climate())), { id });
  assert.deepEqual(store.getDestinationSnapshot(owner, id).data.destinations[0].climate, climate());
  assert.deepEqual(store.applyMutation(editor, save(id, null)), { id });
  assert.equal(store.getDestinationSnapshot(owner, id).data.destinations[0].climate, null);
});

test("schema 36 starts every destination without averages, keeping typical weather; a replay keeps saved averages", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput({ startDate: "2027-05-10" })).id;
    const id = addCity((input) => store.applyMutation(input).id, tripId, "Vienna", { nights: 4, hotelNightlyAmount: "150", ...placeholder });
    store.applyMutation({ type: "candidate.save", ...newItem(), destinationId: id, category: "hotels", name: "Hotel", price: "400", address: "", url: "", notes: "", included: true });
    const before = store.getSnapshot();
    const budget = calculateBudget(before, tripId);
    store.close(); store = null;
    let db = new DatabaseSync(path);
    try { db.exec("DROP TABLE destination_climate; PRAGMA user_version = 35;"); } finally { db.close(); }
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.equal(destination(store, id).climate, null);
    assert.deepEqual(seasonal(store, id), placeholder);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    store.applyMutation(save(id, climate()));
    const saved = store.getSnapshot();
    store.close(); store = null;
    db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      assert.deepEqual(db.prepare("PRAGMA table_info(destination_climate)").all().map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk })), [
        { name: "destinationId", type: "TEXT", notnull: 1, pk: 1 }, { name: "climateJson", type: "TEXT", notnull: 1, pk: 0 },
      ]);
      db.exec("PRAGMA user_version = 35;");
    } finally { db.close(); }
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved, "a replay keeps the saved averages");
    store.close(); store = null;
    db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { db.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude can propose monthly averages, which the owner reviews month by month before they apply", (t) => {
  const { store, owner, propose, decide } = aiSetup(t);
  const id = store.applyMutation(owner, { type: "destination.create", city: "Vienna" }).id;
  store.applyMutation(owner, destinationEdit(id, { ...placeholder }));
  const proposal = propose([save(id, climate())]);
  assert.deepEqual(proposal.preview, [{
    operation: "Save a destination's monthly averages",
    records: [{ action: "Adds", record: "Destination “Vienna” (owner@example.test): monthly averages", fields: [{ name: "Monthly averages", before: null, after: monthlyClimateText(climate()) }] }],
  }]);
  assert.equal(store.aiDestination(id).destination.climate, null, "nothing changes until the owner approves");
  decide(proposal, true);
  assert.deepEqual(store.aiDestination(id).destination.climate, climate(), "assistants read the averages with the destination");
  assert.deepEqual(seasonal(store, id), placeholder, "the typical weather stays");
  assert.deepEqual(propose([save(id, null)]).preview, [{
    operation: "Clear a destination's monthly averages",
    records: [{ action: "Deletes", record: "Destination “Vienna” (owner@example.test): monthly averages", fields: [{ name: "Monthly averages", before: monthlyClimateText(climate()), after: null }] }],
  }]);
  // A proposal is checked by the same rules as a person's save.
  assert.throws(() => propose([save(id, withMonth(1, { highF: 10, lowF: 20 }))]), { message: "Change 1: February's average high must be at least its average low." });
});
