import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { containsSunday } from "../src/lib/destination-duration.ts";
import { createStore, ValidationError } from "../src/lib/store.ts";
import { calculateBudget, calculateDestinationBudget } from "../src/lib/budget.ts";

const tripInput = (overrides = {}) => ({ type: "trip.save", name: "Church planning", dateLabel: "May 2027", homeCity: "New York", travelers: 2, notes: "", ...overrides });
const destinationInput = (tripId, overrides = {}) => ({ type: "destination.save", tripId, city: "Rome", stay: "Spring", notes: "", ...overrides });
const churchInput = (destinationId, overrides = {}) => ({ type: "church.save", destinationId, name: "St. Mary's", address: "", denomination: "", url: "", massTimes: [], ...overrides });
const mass = (day = "Sunday", time = "9:00 AM") => ({ id: randomUUID(), day, time });
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const photo = () => ({ id: randomUUID(), data: webp });
const destination = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id);
const church = (store, id) => store.getSnapshot().churches.find((item) => item.id === id);
function setup(t) {
  const store = createStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput()).id;
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  return { store, tripId, destinationId };
}
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-church-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}

test("Sunday detection includes either endpoint, multiple Sundays, DST, leap days, and year boundaries", () => {
  for (const [start, end, expected] of [
    ["2027-05-02", "2027-05-02", true], ["2027-05-03", "2027-05-03", false],
    ["2027-05-01", "2027-05-02", true], ["2027-05-02", "2027-05-03", true],
    ["2027-05-03", "2027-05-08", false], ["2027-05-03", "2027-05-09", true],
    ["2027-05-01", "2027-05-31", true], ["2027-03-13", "2027-03-14", true],
    ["2027-11-06", "2027-11-07", true], ["2027-12-31", "2028-01-02", true],
    ["2028-02-28", "2028-03-04", false], ["2028-02-29", "2028-03-05", true],
    [null, "2027-05-02", false], ["2027-05-02", undefined, false], [null, null, false],
    ["", "", false], ["Sunday", "2027-05-02", false], ["2027-02-29", "2027-03-07", false],
    ["2027-05-03", "2027-05-02", false], ["0000-01-01", "2027-05-02", false],
  ]) assert.equal(containsSunday(start, end), expected, `${start} through ${end}`);
});





test("church details, multiple Mass times, gallery, manual hiding and optional unknowns persist after reopening", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const destinationId = store.applyMutation(destinationInput(tripId)).id;
    store.applyMutation({ type: "destination.churchVisibility", id: destinationId, enabled: true });
    const first = photo(), second = photo();
    const times = [mass(), mass("2027-05-02", "11:30 AM (English)")];
    const id = store.applyMutation(churchInput(destinationId, {
      name: "  St. Peter's  ", address: "  Piazza San Pietro  ", denomination: "  Catholic  ", url: " https://example.com/mass ",
      massTimes: times, gallery: { add: [first, second], remove: [], mainImageId: second.id },
    })).id;
    const unknownId = store.applyMutation(churchInput(destinationId, { name: "Nearby chapel" })).id;
    assert.equal(church(store, id).name, "St. Peter's");
    assert.equal(church(store, id).address, "Piazza San Pietro");
    assert.equal(church(store, id).denomination, "Catholic");
    assert.equal(church(store, id).url, "https://example.com/mass");
    assert.deepEqual(church(store, id).massTimes, times);
    assert.deepEqual(church(store, unknownId), { id: unknownId, destinationId, name: "Nearby chapel", address: "", denomination: "", url: "", massTimes: [], mainImageId: null, images: [] });
    const images = church(store, id).images;
    const storedPhoto = store.getChurchPhoto(id, second.id);
    store.applyMutation(churchInput(destinationId, { id, name: "Edited church", massTimes: times.slice(1) }));
    assert.deepEqual(church(store, id).images, images, "omitting gallery preserves images and their versions");
    assert.equal(church(store, id).mainImageId, second.id);
    store.applyMutation({ type: "destination.churchVisibility", id: destinationId, enabled: false });
    const before = store.getSnapshot();
    store.close(); store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getChurchPhoto(id, second.id), storedPhoto);
    assert.deepEqual(store.getChurchPhoto(id, first.id).data, webp);
    store.applyMutation({ type: "destination.churchVisibility", id: destinationId, enabled: true });
    assert.deepEqual(church(store, id).images, images);
    store.applyMutation(churchInput(destinationId, { id, gallery: { add: [], remove: [second.id] } }));
    assert.equal(church(store, id).mainImageId, first.id, "removing the main photo selects a remaining image");
    assert.equal(store.getChurchPhoto(id, second.id), undefined);
    store.applyMutation(churchInput(destinationId, { id, gallery: { add: [], remove: [first.id], mainImageId: null } }));
    assert.deepEqual(church(store, id).images, []);
    assert.equal(church(store, id).mainImageId, null);
    store.applyMutation({ type: "church.delete", id: unknownId, destinationId });
    assert.equal(store.getSnapshot().churches.length, 1);
  } finally { store?.close(); }
});

test("church ownership and photo ownership are enforced with atomic gallery updates", (t) => {
  const { store, tripId, destinationId } = setup(t);
  const otherDestinationId = store.applyMutation(destinationInput(tripId, { city: "Florence" })).id;
  const first = photo(), otherPhoto = photo();
  const id = store.applyMutation(churchInput(destinationId, { gallery: { add: [first], remove: [] } })).id;
  const otherId = store.applyMutation(churchInput(otherDestinationId, { gallery: { add: [otherPhoto], remove: [] } })).id;
  const before = store.getSnapshot();
  const image = store.getChurchPhoto(id, first.id);
  for (const input of [
    churchInput(otherDestinationId, { id }), { type: "church.delete", id, destinationId: otherDestinationId },
    churchInput(randomUUID()), churchInput(destinationId, { id: randomUUID() }),
    { type: "church.delete", id: randomUUID(), destinationId }, { type: "destination.churchVisibility", id: randomUUID(), enabled: true },
    churchInput(destinationId, { id, name: "Must not save", gallery: { add: [photo()], remove: [otherPhoto.id] } }),
    churchInput(destinationId, { id, name: "Must not save", gallery: { add: [otherPhoto], remove: [] } }),
    churchInput(destinationId, { id, name: "Must not save", gallery: { add: [photo()], remove: [first.id], mainImageId: otherPhoto.id } }),
    churchInput(destinationId, { id, name: "Must not save", gallery: { add: [], remove: [], mainImageId: null } }),
    churchInput(destinationId, { name: "Must not save", gallery: { add: [photo()], remove: [first.id] } }),
  ]) {
    assert.throws(() => store.applyMutation(input), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getChurchPhoto(id, first.id), image);
  }
  assert.equal(store.getChurchPhoto(otherId, first.id), undefined);
  assert.equal(store.getChurchPhoto(id, otherPhoto.id), undefined);
  store.applyMutation({ type: "church.delete", id, destinationId });
  assert.equal(store.getChurchPhoto(id, first.id), undefined);
  assert.deepEqual(store.getChurchPhoto(otherId, otherPhoto.id).data, webp);
});

test("church validation accepts unknown optional details, trims text, and rejects invalid times, websites, photos and flags", (t) => {
  const { store, destinationId } = setup(t);
  const id = store.applyMutation(churchInput(destinationId)).id;
  const duplicate = mass();
  const duplicatePhoto = photo();
  const before = store.getSnapshot();
  const invalid = [
    { name: " " }, { name: "x".repeat(161) }, { address: "x".repeat(501) }, { denomination: "x".repeat(161) },
    { url: "javascript:alert(1)" }, { url: "https://user:password@example.com" }, { url: "x".repeat(2049) },
    { massTimes: undefined }, { massTimes: null }, { massTimes: "Sunday 9am" }, { massTimes: [null] },
    { massTimes: [mass("", "9 AM")] }, { massTimes: [mass("Sunday", "")] },
    { massTimes: [mass("x".repeat(121), "9 AM")] }, { massTimes: [mass("Sunday", "x".repeat(121))] },
    { massTimes: [duplicate, { ...duplicate, id: duplicate.id.toUpperCase() }] },
    { massTimes: Array.from({ length: 31 }, () => mass()) }, { massTimes: [{ day: "Sunday", time: "9 AM", id: "bad" }] },
    { gallery: { add: [{ id: randomUUID(), data: new Uint8Array([1, 2]) }], remove: [] } },
    { gallery: { add: [duplicatePhoto, duplicatePhoto], remove: [] } },
    { gallery: { add: [photo()], remove: ["bad"] } },
    { gallery: { add: [{ id: randomUUID(), data: new Uint8Array(2 * 1024 * 1024 + 1) }], remove: [] } },
  ];
  for (const fields of invalid) {
    assert.throws(() => store.applyMutation(churchInput(destinationId, { id, ...fields })), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  for (const enabled of ["true", 1, null, undefined]) {
    assert.throws(() => store.applyMutation({ type: "destination.churchVisibility", id: destinationId, enabled }), ValidationError);
    assert.deepEqual(store.getSnapshot(), before);
  }
  const times = Array.from({ length: 30 }, () => mass(" Sunday ", " 9 AM "));
  store.applyMutation(churchInput(destinationId, { id, massTimes: times }));
  assert.deepEqual(church(store, id).massTimes, times.map((time) => ({ ...time, day: "Sunday", time: "9 AM" })));
});

test("gallery limits include saved photos and failed additions preserve all church details", (t) => {
  const { store, destinationId } = setup(t);
  const photos = Array.from({ length: 10 }, () => photo());
  const id = store.applyMutation(churchInput(destinationId, { gallery: { add: photos, remove: [] } })).id;
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(churchInput(destinationId, { id, name: "Not saved", gallery: { add: [photo()], remove: [] } })), ValidationError);
  assert.deepEqual(store.getSnapshot(), before);
  assert.throws(() => store.applyMutation(churchInput(destinationId, { gallery: { add: Array.from({ length: 11 }, () => photo()), remove: [] } })), ValidationError);
  assert.deepEqual(store.getSnapshot(), before);
  const replacement = photo();
  store.applyMutation(churchInput(destinationId, { id, gallery: { add: [replacement], remove: [photos[0].id], mainImageId: replacement.id } }));
  assert.equal(church(store, id).images.length, 10);
  assert.equal(church(store, id).mainImageId, replacement.id);
  assert.equal(store.getChurchPhoto(id, photos[0].id), undefined);
});

test("churches never change candidate counts, selections, trip budgets or destination budgets", (t) => {
  const { store, tripId, destinationId } = setup(t);
  store.applyMutation(destinationInput(tripId, {
    id: destinationId, nights: 3,
    miscDailyAmount: "0", miscCurrency: "USD", hotelNightlyAmount: "100", hotelCurrency: "USD",
    activitiesBudgetMode: "general", activitiesGeneralAmount: "20", activitiesCurrency: "USD",
    foodBudgetMode: "daily", foodDailyAmount: "30", foodCurrency: "USD", shoppingAmount: "12.34", shoppingCurrency: "USD",
    weatherHighF: 70, weatherLowF: 40, weatherRainfall: "Low", weatherPeriod: "May", weatherSource: "Local archive",
  }));
  for (const category of ["hotels", "activities", "restaurants"]) store.applyMutation({ type: "candidate.save", destinationId, category, name: category, price: category === "hotels" ? "0" : "", address: "", url: "", notes: "", included: true, image: webp });
  store.applyMutation({ type: "homeItem.save", tripId, name: "Mail hold", price: "", notes: "", completed: false });
  store.applyMutation({type:"destination.churchVisibility",id:destinationId,enabled:false});
  const before = store.getSnapshot();
  const budget = calculateBudget(before, tripId), destinationBudget = calculateDestinationBudget(before, destinationId);
  const first = store.applyMutation(churchInput(destinationId, { gallery: { add: [photo()], remove: [] } })).id;
  store.applyMutation(churchInput(destinationId, { name: "Chapel", massTimes: [mass()] }));
  store.applyMutation(churchInput(destinationId, { id: first, name: "Updated church" }));
  store.applyMutation({ type: "destination.churchVisibility", id: destinationId, enabled: true });
  store.applyMutation({ type: "destination.churchVisibility", id: destinationId, enabled: false });
  store.applyMutation({ type: "church.delete", id: first, destinationId });
  const after = store.getSnapshot();
  assert.deepEqual({ ...after, churches: [] }, before);
  assert.deepEqual(calculateBudget(after, tripId), budget);
  assert.deepEqual(calculateDestinationBudget(after, destinationId), destinationBudget);
});

test("deleting churches, destinations and trips cascades their church images without touching other trips", (t) => {
  const { store, tripId, destinationId } = setup(t);
  const otherTrip = store.applyMutation(tripInput({ name: "Other trip" })).id;
  const otherDestination = store.applyMutation(destinationInput(otherTrip)).id;
  const first = photo(), second = photo(), third = photo();
  const id = store.applyMutation(churchInput(destinationId, { gallery: { add: [first], remove: [] } })).id;
  const otherId = store.applyMutation(churchInput(otherDestination, { gallery: { add: [second], remove: [] } })).id;
  store.applyMutation({ type: "destination.delete", id: destinationId });
  assert.equal(church(store, id), undefined);
  assert.equal(store.getChurchPhoto(id, first.id), undefined);
  assert.ok(store.getChurchPhoto(otherId, second.id));
  const newDestination = store.applyMutation(destinationInput(tripId)).id;
  const newId = store.applyMutation(churchInput(newDestination, { gallery: { add: [third], remove: [] } })).id;
  store.applyMutation({ type: "trip.delete", id: tripId });
  assert.equal(store.getChurchPhoto(newId, third.id), undefined);
  assert.equal(store.getSnapshot().churches.length, 1);
  assert.ok(store.getChurchPhoto(otherId, second.id));
});

test("schema 13 upgrade initializes Sunday visibility, preserves prior data and replays without resetting hidden churches", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  try {
    const tripId = store.applyMutation(tripInput({startDate:"2027-05-01"})).id;
    const id = store.applyMutation(destinationInput(tripId, {
      nights: 2, image: webp,
      miscDailyAmount: "0", miscCurrency: "USD", hotelNightlyAmount: "125.25", hotelCurrency: "USD",
      activitiesBudgetMode: "general", activitiesGeneralAmount: "55.55", activitiesCurrency: "USD",
      foodBudgetMode: "daily", foodDailyAmount: "20", foodCurrency: "USD", shoppingAmount: "12.34", shoppingCurrency: "USD",
      weatherHighF: 70.5, weatherLowF: 40, weatherRainfall: "Some rain", weatherPeriod: "May", weatherSource: "Historical averages",
    })).id;
    const weekdayId = store.applyMutation(destinationInput(tripId, { nights: 5 })).id;
    const partialId = store.applyMutation(destinationInput(tripId, { nights: null })).id;
    const unknownId = store.applyMutation(destinationInput(tripId)).id;
    const candidateId = store.applyMutation({ type: "candidate.save", destinationId: id, category: "hotels", name: "Saved hotel", price: "123.45", address: "Main street", url: "", notes: "", included: true, image: webp }).id;
    store.applyMutation({ type: "homeItem.save", tripId, name: "House sitting", price: "23.95", notes: "Leave a key", completed: true });
    for (const hidden of [weekdayId,partialId,unknownId]) store.applyMutation({type:"destination.churchVisibility",id:hidden,enabled:false});
    const before = store.getSnapshot(), budget = calculateBudget(before, tripId);
    const destinationImage = store.getDestinationImage(id), candidateImage = store.getCandidateImage(candidateId);
    store.close(); store = null;
    let observer = new DatabaseSync(path);
    try { observer.exec("DROP TABLE church_images; DROP TABLE churches; ALTER TABLE destinations DROP COLUMN churchEnabled; PRAGMA user_version = 13;"); }
    finally { observer.close(); }
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), before);
    assert.equal(destination(store, id).churchEnabled, true);
    for (const other of [weekdayId, partialId, unknownId]) assert.equal(destination(store, other).churchEnabled, false);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    assert.deepEqual(store.getDestinationImage(id), destinationImage);
    assert.deepEqual(store.getCandidateImage(candidateId), candidateImage);
    const picture = photo();
    const churchId = store.applyMutation(churchInput(id, { massTimes: [mass(), mass("2027-05-09", "11 AM")], gallery: { add: [picture], remove: [] } })).id;
    store.applyMutation({ type: "destination.churchVisibility", id, enabled: false });
    store.applyMutation({ type: "destination.churchVisibility", id: unknownId, enabled: true });
    const saved = store.getSnapshot(), savedPhoto = store.getChurchPhoto(churchId, picture.id);
    store.close(); store = null;
    observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 15);
      observer.exec("PRAGMA user_version = 13;");
    } finally { observer.close(); }
    store = createStore(path);
    assert.deepEqual(store.getSnapshot(), saved, "migration replay preserves explicit hiding, enabling, churches and photos");
    assert.deepEqual(store.getChurchPhoto(churchId, picture.id), savedPhoto);
    assert.deepEqual(calculateBudget(store.getSnapshot(), tripId), budget);
    observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, 15);
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { observer.close(); }
  } finally { store?.close(); }
});
