import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget, calculateDestinationBudget } from "../src/lib/budget.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { PLANNER_UPDATED } from "../src/lib/planner-updated.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { CLIMATE_LIMITS, MONTHS, NAME_EACH_MONTH, climateAveragesText, climateMonthText, formatReferenceYears, monthOf, monthlyClimateFromForm, normalizeMonthlyClimate, sourceHref, temperatureScale } from "../src/lib/typical-weather.ts";
import { aiSetup, GUEST, NOW, OWNER } from "./ai-fixtures.mjs";
import { addCity, candidateInput, destination, destinationEdit, fileDatabase, newItem, prepared, setup, stop, stopEdit, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore } from "./owned-store.mjs";

// TRA-135: each destination's monthly climate averages, apart from its seasonal typical weather. TRA-158: each month is
// named, so ChatGPT and Claude give all 12, once each, and the owner reviews them month by month before they apply.
const months = (high = 40, low = 30, precipitation = 1.5) => MONTHS.map((month, index) => ({ month, highF: high + index, lowF: low + index, precipitationIn: precipitation + index / 10 }));
const climate = (overrides = {}) => ({ months: months(), source: "Test climate normals", firstYear: 1991, lastYear: 2020, ...overrides });
const save = (id, value) => ({ type: "destination.climate", id, climate: value });
// Vienna's temporary summer placeholder, as its typical weather is saved, which monthly averages never change.
const placeholder = { weatherHighF: 75, weatherLowF: 58, weatherRainfall: "Placeholder until researched", weatherPeriod: "Summer (temporary placeholder)", weatherSource: "" };
const seasonal = (store, id) => Object.fromEntries(Object.keys(placeholder).map((key) => [key, destination(store, id)[key]]));
const withMonth = (index, fields) => climate({ months: months().map((month, at) => at === index ? { ...month, ...fields } : month) });
/** Months without their names, as a row keeps them and a page opened before TRA-158 sends them. */
const unnamed = (list) => list.map(({ highF, lowF, precipitationIn }) => ({ highF, lowF, precipitationIn }));
/** A record as its row keeps it (TRA-135): its months in calendar order, without their names. */
const savedRow = (value) => ({ ...value, months: unnamed(value.months) });
/** How a proposal's page shows a record beside the one it replaces (TRA-158): its source, its reference years and every month. */
const review = (before, after) => {
  const shown = (value) => value && [value.source, formatReferenceYears(value), ...value.months.map(climateAveragesText)];
  const [saved, proposed] = [shown(before), shown(after)];
  return ["Source", "Reference years", ...MONTHS].map((name, index) => ({ name, before: saved ? saved[index] : null, after: proposed ? proposed[index] : null }));
};
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);

test("a record needs all 12 months once each by name, every average in °F and inches, a source and its reference years, and nothing else", () => {
  assert.deepEqual(normalizeMonthlyClimate(climate({ source: "  https://example.com/normals  " })), climate({ source: "https://example.com/normals" }));
  assert.equal(normalizeMonthlyClimate(null), null, "null clears the record");
  // Months may come in any order, and come back in calendar order.
  assert.deepEqual(normalizeMonthlyClimate(climate({ months: [...months().slice(5), ...months().slice(0, 5)].toReversed() })), climate());
  // Zero, negative, decimal and boundary values are values, and a single reference year is a range of one.
  const edges = climate({ months: months().map((month, index) => index === 0 ? { ...month, highF: 0, lowF: -40.5, precipitationIn: 0 } : index === 1 ? { ...month, highF: CLIMATE_LIMITS.maxF, lowF: CLIMATE_LIMITS.minF, precipitationIn: CLIMATE_LIMITS.maxPrecipitationIn } : index === 2 ? { ...month, highF: 50, lowF: 50, precipitationIn: 2 } : month), firstYear: 2020, lastYear: 2020 });
  assert.deepEqual(normalizeMonthlyClimate(edges), edges);
  const named = months();
  const refused = [
    [undefined, "Enter monthly averages, or clear the saved ones."], [[], "Enter monthly averages, or clear the saved ones."], ["1991", "Enter monthly averages, or clear the saved ones."],
    [climate({ months: undefined }), "Enter averages for all 12 months, January to December."],
    [climate({ months: "January to December" }), "Enter averages for all 12 months, January to December."],
    // Every month, once: a refusal names the months missing, or the month given again.
    [climate({ months: named.filter((month) => month.month !== "March") }), "Enter averages for all 12 months, January to December: March is missing."],
    [climate({ months: named.slice(0, 10) }), "Enter averages for all 12 months, January to December: November and December are missing."],
    [climate({ months: named.slice(0, 9) }), "Enter averages for all 12 months, January to December: October, November and December are missing."],
    [climate({ months: [] }), `Enter averages for all 12 months, January to December: ${MONTHS.slice(0, -1).join(", ")} and December are missing.`],
    [climate({ months: named.map((month) => month.month === "July" ? { ...named[5] } : month) }), "Give June's averages only once."],
    [climate({ months: [...named, { ...named[0], highF: 41 }] }), "Give January's averages only once."],
    // Each month is named in full, as the schema lists them.
    ...[undefined, null, "Jan", "january", "Sept", 1, 5.5].map((month) => [climate({ months: named.map((entry, index) => index === 4 ? { ...entry, month } : entry) }), NAME_EACH_MONTH]),
    [climate({ months: unnamed(named) }), NAME_EACH_MONTH],
    [climate({ months: named.map((month, index) => index === 4 ? null : month) }), NAME_EACH_MONTH],
    [climate({ months: named.map((month, index) => index === 4 ? [month] : month) }), NAME_EACH_MONTH],
    // Units are in the fields' names, so averages in other units, or anything else, are refused, never saved as °F or inches.
    [withMonth(0, { highC: 4 }), "January's averages take only month, highF, lowF and precipitationIn, in °F and inches: convert or leave out highC."],
    [climate({ months: named.map(({ precipitationIn, ...month }) => ({ ...month, precipitationMm: precipitationIn * 25.4 })) }), "January's averages take only month, highF, lowF and precipitationIn, in °F and inches: convert or leave out precipitationMm."],
    [withMonth(7, { note: "The wettest month" }), "August's averages take only month, highF, lowF and precipitationIn, in °F and inches: convert or leave out note."],
    [climate({ units: "metric" }), "Monthly averages take only months, source, firstYear and lastYear, with every month in °F and inches: leave out units."],
    [climate({ temperatureUnit: "°C" }), "Monthly averages take only months, source, firstYear and lastYear, with every month in °F and inches: leave out temperatureUnit."],
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

test("the editor sends its rows in calendar order, each named by its month, and a blank is never zero", () => {
  const form = new FormData();
  form.set("climateSource", " Test normals ");
  form.set("climateFirstYear", "1991");
  form.set("climateLastYear", "2020");
  for (const month of months()) {
    form.append("climateHighF", String(month.highF));
    form.append("climateLowF", String(month.lowF));
    form.append("climatePrecipitationIn", String(month.precipitationIn));
  }
  assert.deepEqual(monthlyClimateFromForm(form).months.map((month) => month.month), MONTHS);
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

test("months, years, sources and the temperature axis read as the chart and a proposal's page show them", () => {
  assert.deepEqual([monthOf("2027-01-31"), monthOf("2027-05-10"), monthOf("2027-12-01"), monthOf(null)], [0, 4, 11, null]);
  assert.deepEqual([formatReferenceYears({ firstYear: 1991, lastYear: 2020 }), formatReferenceYears({ firstYear: 2020, lastYear: 2020 })], ["1991–2020", "2020"]);
  assert.equal(climateMonthText(climate(), 2), "March: average high 42 °F, average low 32 °F, precipitation 1.7 in");
  assert.equal(climateAveragesText(months()[2]), "Average high 42 °F, average low 32 °F, precipitation 1.7 in");
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

test("a record is kept as before, its months in calendar order without their names, which reading gives back", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  t.after(() => store.close());
  const id = store.applyMutation({ type: "destination.create", city: "Vienna" }).id;
  // Given in any order, the months are kept January to December, in the row TRA-135 wrote.
  store.applyMutation(save(id, climate({ months: months().toReversed() })));
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  const row = () => JSON.parse(db.prepare("SELECT climateJson FROM destination_climate WHERE destinationId = ?").get(id).climateJson);
  assert.deepEqual(row(), savedRow(climate()));
  assert.deepEqual(destination(store, id).climate, climate());
  // A record saved before months were named reads with their names.
  const earlier = climate({ months: months(60, 50, 3), source: "Saved before TRA-158" });
  db.prepare("UPDATE destination_climate SET climateJson = ? WHERE destinationId = ?").run(JSON.stringify(savedRow(earlier)), id);
  assert.deepEqual(destination(store, id).climate, earlier);
});

test("a refused record changes nothing, and only a saved destination can have one", (t) => {
  const { store, tripId } = setup(t);
  const id = addCity((input) => store.applyMutation(input).id, tripId, "Vienna", { nights: 3, ...placeholder });
  store.applyMutation(save(id, climate()));
  const before = store.getSnapshot();
  for (const value of [climate({ months: months().slice(0, 11) }), withMonth(3, { lowF: 99 }), withMonth(3, { highC: 20 }), climate({ source: "" }), climate({ firstYear: 2030, lastYear: 2020 }), undefined]) {
    assert.throws(() => store.applyMutation(save(id, value)), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  assert.throws(() => store.applyMutation(save("not-an-id", climate())), ValidationError);
  assert.throws(() => store.applyMutation(save("6b3cf2a8-9b55-4a51-9b55-0d2a2c6b6a11", climate())), { message: "This item no longer exists or isn't shared with you. Please refresh and try again." });
  assert.deepEqual(store.getSnapshot(), before);
});

test("a save from a page opened before months were named is refused as outdated, and changes nothing", (t) => {
  const { store, tripId } = setup(t);
  const id = addCity((input) => store.applyMutation(input).id, tripId, "Vienna", { nights: 3 });
  store.applyMutation(save(id, climate()));
  const before = store.getSnapshot();
  // That page's editor sends every month without its name.
  assert.throws(() => store.applyMutation(save(id, climate({ months: unnamed(months(60, 50, 3)) }))), { name: "ValidationError", message: PLANNER_UPDATED });
  assert.deepEqual(store.getSnapshot(), before);
  // Clearing sends no months, so it clears from any page.
  assert.deepEqual(store.applyMutation(save(id, null)), { id });
  assert.equal(destination(store, id).climate, null);
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

test("ChatGPT and Claude propose all 12 months, which the owner reviews month by month beside the saved ones before they apply", (t) => {
  const { store, owner, propose, decide } = aiSetup(t);
  const id = store.applyMutation(owner, { type: "destination.create", city: "Vienna" }).id;
  store.applyMutation(owner, destinationEdit(id, { ...placeholder }));
  const record = `Destination “Vienna” (${OWNER}): monthly averages`;
  // Without saved averages, the page shows every proposed month, its source and its years, and nothing changes until approved.
  const before = store.getSnapshot();
  const added = propose([save(id, climate())]);
  assert.deepEqual(added.preview, [{ operation: "Save a destination's monthly averages", records: [{ action: "Adds", record, fields: review(null, climate()) }] }]);
  assert.deepEqual(added.preview[0].records[0].fields.slice(0, 3), [
    { name: "Source", before: null, after: "Test climate normals" },
    { name: "Reference years", before: null, after: "1991–2020" },
    { name: "January", before: null, after: "Average high 40 °F, average low 30 °F, precipitation 1.5 in" },
  ]);
  assert.deepEqual(store.getSnapshot(), before, "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.deepEqual(store.aiDestination(id).destination.climate, climate(), "assistants read the averages with the destination, each month named");
  assert.deepEqual(seasonal(store, id), placeholder, "the typical weather stays");

  // With saved averages, each saved value shows beside the one replacing it.
  const replacement = climate({ months: months(45, 33, 2), source: "Other normals", firstYear: 1981, lastYear: 2010 });
  const replacing = propose([save(id, replacement)]);
  assert.deepEqual(replacing.preview, [{ operation: "Save a destination's monthly averages", records: [{ action: "Changes", record, fields: review(climate(), replacement) }] }]);
  assert.deepEqual(replacing.preview[0].records[0].fields[13], { name: "December", before: "Average high 51 °F, average low 41 °F, precipitation 2.6 in", after: "Average high 56 °F, average low 44 °F, precipitation 3.1 in" });
  // Rejecting keeps the saved averages; approving replaces every month at once.
  assert.equal(decide(replacing, false).status, "rejected");
  assert.deepEqual(destination(store, id).climate, climate());
  assert.equal(decide(propose([save(id, replacement)]), true).status, "applied");
  assert.deepEqual(destination(store, id).climate, replacement);

  // A replacement that changes one month still shows every month, so the owner sees the whole record it saves.
  const july = { ...replacement, months: replacement.months.map((month) => month.month === "July" ? { ...month, highF: month.highF + 5 } : month) };
  const fields = propose([save(id, july)]).preview[0].records[0].fields;
  assert.deepEqual(fields, review(replacement, july));
  assert.deepEqual(fields.filter((field) => field.before !== field.after).map((field) => field.name), ["July"]);
  // The same averages in another order are the saved ones, so they change nothing.
  assert.deepEqual(propose([save(id, { ...replacement, months: replacement.months.toReversed() })]).preview, [{ operation: "Save a destination's monthly averages", records: [] }]);
  // Clearing shows every saved value it removes.
  assert.deepEqual(propose([save(id, null)]).preview, [{ operation: "Clear a destination's monthly averages", records: [{ action: "Deletes", record, fields: review(replacement, null) }] }]);
});

test("a proposal gives all 12 months once each by name, in °F and inches, from a source over reference years, or nothing is proposed", (t) => {
  const { store, owner, propose, decide } = aiSetup(t);
  const id = store.applyMutation(owner, { type: "destination.create", city: "Vienna" }).id;
  store.applyMutation(owner, save(id, climate()));
  // The schema assistants read names every field, every month among them.
  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "destination.climate");
  const month = schema.properties.climate.properties.months.items;
  assert.deepEqual([month.required, month.properties.month.enum, month.additionalProperties], [["month", "highF", "lowF", "precipitationIn"], MONTHS, false]);
  const before = store.getSnapshot();
  const named = months(50, 40, 2);
  const proposed = (overrides) => climate({ months: named, ...overrides });
  const refused = [
    [proposed({ months: named.filter((entry) => entry.month !== "March") }), "Enter averages for all 12 months, January to December: March is missing."],
    [proposed({ months: named.slice(0, 9) }), "Enter averages for all 12 months, January to December: October, November and December are missing."],
    [proposed({ months: named.map((entry) => entry.month === "July" ? { ...named[5] } : entry) }), "Give June's averages only once."],
    [proposed({ months: [...named, { ...named[11], highF: 70 }] }), "Give December's averages only once."],
    // Assistants name every month, so months without names are refused as such.
    [proposed({ months: unnamed(named) }), NAME_EACH_MONTH],
    [proposed({ months: named.map((entry, index) => index === 0 ? { ...entry, month: "Jan" } : entry) }), NAME_EACH_MONTH],
    [proposed({ months: named.map((entry, index) => ({ ...entry, month: index + 1 })) }), NAME_EACH_MONTH],
    [proposed({ months: named.map((entry, index) => index === 2 ? { ...entry, highF: "52" } : entry) }), "Enter March's average high in °F, from -150 to 150."],
    [proposed({ months: named.map((entry, index) => index === 2 ? { ...entry, lowF: null } : entry) }), "Enter March's average low in °F, from -150 to 150."],
    [proposed({ months: named.map((entry, index) => index === 6 ? { ...entry, lowF: entry.highF + 1 } : entry) }), "July's average high must be at least its average low."],
    [proposed({ months: named.map((entry, index) => index === 0 ? { ...entry, precipitationIn: -1 } : entry) }), "Enter January's average precipitation in inches, from 0 to 200."],
    [proposed({ months: named.map(({ highF, lowF, ...entry }) => ({ ...entry, highC: (highF - 32) / 1.8, lowC: (lowF - 32) / 1.8 })) }), "January's averages take only month, highF, lowF and precipitationIn, in °F and inches: convert or leave out highC."],
    [proposed({ units: "metric" }), "Monthly averages take only months, source, firstYear and lastYear, with every month in °F and inches: leave out units."],
    [proposed({ source: " " }), "Enter where the monthly averages are from."],
    [proposed({ firstYear: 2021, lastYear: 2020 }), "The first reference year must be no later than the last."],
    [proposed({ lastYear: undefined }), "Enter the first and last reference years as four-digit years."],
  ];
  for (const [value, message] of refused) assert.throws(() => propose([save(id, value)]), { name: "ValidationError", message: `Change 1: ${message}` }, message);
  // Only a destination in Travel can have averages.
  assert.throws(() => propose([save(randomUUID(), proposed())]), { message: "Change 1: This item doesn't exist. Read Travel again for current IDs." });
  assert.throws(() => propose([save("not-an-id", proposed())]), { message: "Change 1: This item has an invalid identifier. Please refresh and try again." });
  // A refused change refuses the whole proposal, whatever else it holds.
  assert.throws(() => propose([destinationEdit(id, { notes: "Opera" }), save(id, proposed({ months: named.slice(1) }))]), { message: "Change 2: Enter averages for all 12 months, January to December: January is missing." });
  assert.deepEqual(store.getSnapshot(), before, "nothing changed");
  assert.equal(store.aiOverview(owner, NOW).proposals.length, 0, "and nothing was proposed");

  // Months in any order are placed by name, and saved January to December.
  const shuffled = [...named.slice(7), ...named.slice(0, 7)].toReversed();
  const proposal = propose([save(id, proposed({ months: shuffled }))]);
  assert.deepEqual(proposal.preview[0].records[0].fields, review(climate(), proposed()));
  assert.equal(decide(proposal, true).status, "applied");
  assert.deepEqual(destination(store, id).climate, proposed());
});

test("approving monthly averages changes only them, and an approval that fails partway or comes too late changes nothing", (t) => {
  const path = fileDatabase(t);
  const { store, owner, propose, decide } = aiSetup(t, path);
  const change = (input) => store.applyMutation(owner, input).id;
  // Vienna, in a dated trip, with typical weather, notes, photos, a hotel, an activity, a restaurant and budget amounts.
  const tripId = change(tripInput({ name: "Austria", startDate: "2027-05-10" }));
  const photo = () => ({ id: randomUUID(), ...prepared(webp) });
  const vienna = addCity(change, tripId, "Vienna", { nights: 4, notes: "Opera at eight", hotelNightlyAmount: "150", miscDailyAmount: "40", foodBudgetMode: "daily", foodDailyAmount: "75", ...placeholder, gallery: { add: [photo(), photo()], remove: [] } });
  for (const category of ["hotels", "activities", "restaurants"]) change(candidateInput(vienna, category, { name: `Vienna ${category}` }));
  const salzburg = addCity(change, tripId, "Salzburg", { nights: 2 });
  change(save(vienna, climate()));
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId);
  const db = new DatabaseSync(path);
  t.after(() => db.close());

  // The database fails while writing Salzburg's averages: Vienna keeps every saved month, Salzburg gets none, and the
  // approval rolls back with them, so it can be approved again.
  const replacement = climate({ months: months(50, 40, 3), source: "Other normals" });
  const proposal = propose([save(vienna, replacement), save(salzburg, climate())]);
  db.exec(`CREATE TRIGGER fail_climate BEFORE INSERT ON destination_climate WHEN NEW.destinationId = '${salzburg}' BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END;`);
  assert.throws(() => decide(proposal, true), /database or disk is full/);
  assert.deepEqual(store.getSnapshot(), before, "no month changed");
  assert.equal(store.getAiProposal(owner, proposal.id, NOW).status, "pending");
  db.exec("DROP TRIGGER fail_climate;");
  assert.equal(decide(proposal, true).status, "applied");

  // Every month saved together, in one record per destination, and nothing else changed: typical weather, notes,
  // photos, ideas, trip dates and budgets.
  const after = store.getSnapshot();
  assert.deepEqual([destination(store, vienna).climate, destination(store, salzburg).climate], [replacement, climate()]);
  assert.deepEqual(db.prepare("SELECT destinationId, count(*) AS records FROM destination_climate GROUP BY destinationId").all().map((row) => [row.destinationId, row.records]).sort(), [[vienna, 1], [salzburg, 1]].sort());
  const withoutAverages = (snapshot) => ({ ...snapshot, destinations: snapshot.destinations.map((item) => ({ ...item, climate: null })) });
  assert.deepEqual(withoutAverages(after), withoutAverages(before));
  assert.deepEqual(seasonal(store, vienna), placeholder);
  assert.deepEqual(calculateBudget(after, tripId), budget);

  // A person's change to the averages after a proposal means approving it would change more than it showed: it fails,
  // keeping theirs.
  const late = propose([save(vienna, climate())]);
  change(save(vienna, withMonth(0, { highF: 41.5 })));
  const edited = store.getSnapshot();
  const failed = decide(late, true);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /Travel has changed since this was proposed/);
  assert.deepEqual(store.getSnapshot(), edited);
});

test("assistants propose averages for any destination in Travel, as every change; only the owner decides, and each decision is kept", (t) => {
  const { store, owner, guest, guestTrip, propose, decide } = aiSetup(t);
  // The guest's destination, in a trip nobody shared with the owner, who can't change it in Travel. An assistant can
  // still propose for it, as for every destination (TRA-115).
  const id = addCity((input) => store.applyMutation(guest, input).id, guestTrip, "Lisbon");
  assert.throws(() => store.applyMutation(owner, save(id, climate())), /isn't shared with you/);
  const proposal = propose([save(id, climate())]);
  assert.equal(proposal.preview[0].records[0].record, `Destination “Lisbon” (${GUEST}): monthly averages`);
  // Only the designated owner decides, and only the proposal they were shown.
  assert.throws(() => store.decideAiProposal(guest, proposal.id, proposal.digest, true, NOW), /doesn't exist/);
  assert.throws(() => store.decideAiProposal(owner, proposal.id, "tampered", true, NOW), /isn't the proposal you were shown/);
  assert.equal(destination(store, id).climate, null);
  assert.equal(decide(proposal, true).status, "applied");
  assert.deepEqual(destination(store, id).climate, climate());
  assert.deepEqual(store.getDestinationSnapshot(guest, id).data.destinations[0].climate, climate(), "its owner sees them on its page");
  // The proposal stays recorded with its decision.
  assert.deepEqual(store.aiOverview(owner, NOW + 2000).proposals.map(({ id: proposalId, status, decidedAt }) => [proposalId, status, decidedAt]), [[proposal.id, "applied", NOW + 1000]]);
});
