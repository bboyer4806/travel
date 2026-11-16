import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import sharp from "sharp";
import { ImageValidationError } from "../src/lib/image-upload.ts";
import { MAX_PHOTO_ZOOM, UNCROPPED } from "../src/lib/photo-focus.ts";
import { SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { prepareTripImage } from "../src/lib/trip-image-upload.ts";
import { aiSetup, OWNER as AI_OWNER } from "./ai-fixtures.mjs";
import { fileDatabase, setup, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore } from "./owned-store.mjs";

// TRA-133: each trip's optional headline image, cropped one way across the top of its card on All trips and another for
// the banner on its page.
const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const replacement = new Uint8Array(webp);
replacement[replacement.length - 1] = 1;
const card = { focusX: 30, focusY: 70, zoom: 1.5 };
const banner = { focusX: 80, focusY: 10, zoom: 2.25 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A saved trip's details as its editor sends them, with `image`, its headline image change, unless it is left out. */
const tripEdit = (id, image, overrides = {}) => ({ type: "trip.save", id, name: "Trip", dateLabel: "Someday", homeCity: "Boston", travelers: 2, notes: "Trip notes", ...overrides, ...(image === undefined ? {} : { image }) });
const tripOf = (store, id) => store.getSnapshot().trips.find((trip) => trip.id === id);
/** A form with the given fields, as the trip editor sends one. */
function form(fields) {
  const result = new FormData();
  for (const [name, value] of Object.entries(fields)) result.set(name, value);
  return result;
}

test("a trip's headline image is saved with its own card and banner crops, which every read gives without its bytes", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput({ image: { data: webp, card, banner } })).id;
  const image = store.getTripImage(tripId);
  assert.deepEqual(image.data, webp);
  assert.match(image.version, UUID);
  const saved = { version: image.version, card, banner };
  assert.deepEqual(tripOf(store, tripId).image, saved);
  assert.deepEqual(store.getHomeOverview().data.trips[0].image, saved, "All trips has what each card shows");
  assert.deepEqual(store.getTripSnapshot(tripId).data.trips[0].image, saved, "and the trip's page what its banner shows");
  assert.equal(store.getTripImage(randomUUID()), undefined);

  // Every other change to the trip keeps its image and crops, as a save from an editor that didn't change them does.
  store.applyMutation(tripEdit(tripId, undefined, { name: "Renamed", startDate: "2027-05-01" }));
  store.applyMutation({ type: "trip.tag", tripId, name: "Summer" });
  assert.deepEqual([store.getTripImage(tripId), tripOf(store, tripId).image], [image, saved]);

  // New crops change only the crops of the image they were chosen for, and saving them again after a lost response is the same.
  const recropped = { version: image.version, card: UNCROPPED, banner: card };
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(store.applyMutation(tripEdit(tripId, recropped)), { id: tripId });
    assert.deepEqual(tripOf(store, tripId).image, recropped);
    assert.deepEqual(store.getTripImage(tripId), image, "the image and its version stay as they were");
  }

  // Saved, as after refreshing or signing in again.
  store.close();
  store = createOwnedStore(path);
  assert.deepEqual([store.getTripImage(tripId), tripOf(store, tripId).image], [image, recropped]);

  // A new image replaces it, with a new version and the crops chosen for it.
  store.applyMutation(tripEdit(tripId, { data: replacement, card, banner }));
  const replaced = store.getTripImage(tripId);
  assert.deepEqual(replaced.data, replacement);
  assert.notEqual(replaced.version, image.version);
  assert.deepEqual(tripOf(store, tripId).image, { version: replaced.version, card, banner });
  replaced.data.fill(0);
  assert.deepEqual(store.getTripImage(tripId).data, replacement, "callers can't change saved bytes through what they read");

  // Removing it leaves the trip as a trip without one, and removing it again after a lost response is the same.
  for (let attempt = 0; attempt < 2; attempt++) {
    store.applyMutation(tripEdit(tripId, null));
    assert.deepEqual([store.getTripImage(tripId), tripOf(store, tripId).image], [undefined, null]);
  }
  assert.equal(tripOf(store, tripId).name, "Trip");
});

test("a new trip is saved with its headline image, and saved once when its save is sent again", (t) => {
  const { store } = setup(t, tripInput({ name: "Other" }));
  const created = tripInput({ name: "With an image", image: { data: webp, card, banner } });
  for (let attempt = 0; attempt < 2; attempt++) assert.deepEqual(store.applyMutation(created), { id: created.id });
  assert.deepEqual(store.getTripImage(created.id).data, webp);
  assert.deepEqual(Object.fromEntries(store.getHomeOverview().data.trips.map((trip) => [trip.name, trip.image?.card ?? null])), { "Other": null, "With an image": card }, "a trip without one has none");
  // A new trip has no saved image to crop.
  assert.throws(() => store.applyMutation(tripInput({ image: { version: randomUUID(), card, banner } })), { name: "ValidationError", message: "This trip's headline image has changed since you opened the editor. Refresh and try again." });
});

test("an invalid headline image change is refused before anything in the trip changes", (t) => {
  const { store, tripId } = setup(t, tripInput({ image: { data: webp, card, banner } }));
  const { version } = store.getTripImage(tripId);
  const before = store.getSnapshot();
  const beforeImage = store.getTripImage(tripId);
  const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
  oversized.set(webp);
  const notWebp = new Uint8Array(webp);
  notWebp[8] = 0;
  const crop = (overrides) => ({ ...card, ...overrides });
  for (const image of [
    "https://example.com/trip.webp", [], 7, { card, banner },
    { data: [...webp], card, banner }, { data: new Uint8Array(), card, banner }, { data: oversized, card, banner }, { data: notWebp, card, banner },
    { data: webp, version, card, banner }, { data: webp, card }, { data: webp, banner }, { version, card, banner: null },
    ...[{ zoom: 0.99 }, { zoom: MAX_PHOTO_ZOOM + 0.01 }, { zoom: "2" }, { focusX: -0.1 }, { focusX: 100.1 }, { focusY: Number.NaN }, { focusY: Number.POSITIVE_INFINITY }, { focusX: undefined }]
      .flatMap((overrides) => [{ data: webp, card: crop(overrides), banner }, { version, card, banner: crop(overrides) }]),
    { version: "not an id", card, banner }, { version: randomUUID(), card, banner },
  ]) {
    assert.throws(() => store.applyMutation(tripEdit(tripId, image, { name: "Not saved" })), ValidationError, JSON.stringify(image));
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getTripImage(tripId), beforeImage);
  }
  // The limits themselves are allowed.
  store.applyMutation(tripEdit(tripId, { version, card: { focusX: 0, focusY: 100, zoom: 1 }, banner: { focusX: 100, focusY: 0, zoom: MAX_PHOTO_ZOOM } }));
  assert.deepEqual(tripOf(store, tripId).image.banner, { focusX: 100, focusY: 0, zoom: MAX_PHOTO_ZOOM });
});

test("a headline image save that fails keeps the saved image, its crops and the trip's details", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  const observer = new DatabaseSync(path);
  t.after(() => { observer.close(); store.close(); });
  const tripId = store.applyMutation(tripInput({ image: { data: webp, card, banner } })).id;
  const before = store.getSnapshot();
  const beforeImage = store.getTripImage(tripId);
  observer.exec("CREATE TRIGGER reject_insert BEFORE INSERT ON trip_images BEGIN SELECT RAISE(ABORT, 'Injected image failure'); END;");
  observer.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON trip_images BEGIN SELECT RAISE(ABORT, 'Injected image failure'); END;");
  for (const image of [{ data: replacement, card: UNCROPPED, banner: UNCROPPED }, null]) {
    assert.throws(() => store.applyMutation(tripEdit(tripId, image, { name: "Not saved", startDate: "2027-01-01" })), /Injected image failure/);
    assert.deepEqual(store.getSnapshot(), before);
    assert.deepEqual(store.getTripImage(tripId), beforeImage);
  }
});

test("deleting a trip deletes its headline image, and other trips keep theirs", (t) => {
  const path = fileDatabase(t);
  const store = createOwnedStore(path);
  const observer = new DatabaseSync(path);
  t.after(() => { observer.close(); store.close(); });
  const deleted = store.applyMutation(tripInput({ image: { data: webp, card, banner } })).id;
  const kept = store.applyMutation(tripInput({ name: "Kept", image: { data: replacement, card, banner } })).id;
  store.applyMutation({ type: "trip.delete", id: deleted });
  assert.equal(store.getTripImage(deleted), undefined);
  assert.deepEqual(store.getTripImage(kept).data, replacement);
  assert.deepEqual(observer.prepare("SELECT tripId FROM trip_images").all().map((row) => row.tripId), [kept]);
  assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
});

test("a schema 33 database upgrades with no headline images, and a replay keeps saved ones", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput()).id;
  const before = store.getSnapshot();
  store.close();
  let old = new DatabaseSync(path);
  old.exec("DROP TABLE trip_images; PRAGMA user_version = 33;");
  old.close();
  store = createOwnedStore(path);
  assert.deepEqual(store.getSnapshot(), before, "every trip starts without a headline image");
  store.applyMutation(tripEdit(tripId, { data: webp, card, banner }));
  const withImage = [store.getSnapshot(), store.getTripImage(tripId)];
  store.close();
  old = new DatabaseSync(path);
  old.exec("PRAGMA user_version = 33;");
  old.close();
  store = createOwnedStore(path);
  assert.deepEqual([store.getSnapshot(), store.getTripImage(tripId)], withImage);
  const check = new DatabaseSync(path);
  try {
    assert.equal(check.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    assert.deepEqual(check.prepare("PRAGMA foreign_key_check").all(), []);
    // The crops are kept within their limits by the database too.
    for (const [column, value] of [["cardFocusX", 101], ["bannerFocusY", -1], ["cardZoom", 0.5], ["bannerZoom", MAX_PHOTO_ZOOM + 1]]) {
      assert.throws(() => check.prepare(`UPDATE trip_images SET ${column} = ? WHERE tripId = ?`).run(value, tripId), /constraint failed/);
    }
  } finally {
    check.close();
  }
});

test("ChatGPT and Claude can't change a trip's headline image, and see what deleting a trip deletes with it", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  store.applyMutation(owner, tripEdit(ownerTrip, { data: webp, card, banner }, { name: "Owner trip" }));
  for (const image of [null, { version: store.getTripImage(owner, ownerTrip).version, card: UNCROPPED, banner }]) {
    assert.throws(() => propose([tripEdit(ownerTrip, image, { name: "Owner trip" })]), { name: "ValidationError", message: "Change 1: A trip's headline image can only be chosen in Travel." });
  }
  const proposal = propose([{ type: "trip.delete", id: ownerTrip }]);
  assert.ok(proposal.preview[0].records.some((record) => record.action === "Deletes" && record.record === `Trip “Owner trip” (${AI_OWNER}): headline image`), "the owner sees the image deleted with the trip");
  assert.ok(store.getTripImage(owner, ownerTrip), "nothing changes before approval");
  decide(proposal, true);
  assert.equal(store.getTripImage(owner, ownerTrip), undefined);
});

test("the trip editor's form gives a new image prepared as uploads are, new crops, or a removal", async () => {
  assert.equal(await prepareTripImage(), undefined);
  assert.equal(await prepareTripImage(form({ removeImage: "true" })), null);
  const source = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#496b62" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const added = await prepareTripImage(form({ image: new File([source], "trip.jpg", { type: "image/jpeg" }), crops: JSON.stringify({ card, banner }) }));
  assert.deepEqual(Object.keys(added).toSorted(), ["banner", "card", "data"], "only the photo is kept: a headline image has no thumbnail");
  assert.deepEqual([added.card, added.banner], [card, banner]);
  const { format, width, height, orientation, exif } = await sharp(added.data).metadata();
  assert.deepEqual([format, width, height, orientation, exif], ["webp", 600, 1200, undefined, undefined], "turned upright, resized and without metadata, as every upload");
  const version = randomUUID();
  assert.deepEqual(await prepareTripImage(form({ crops: JSON.stringify({ version, card, banner }) })), { version, card, banner });
});

test("a malformed trip image form, or a file that isn't an image, is refused before anything is saved", async () => {
  const file = new File([await sharp({ create: { width: 40, height: 20, channels: 3, background: "#496b62" } }).png().toBuffer()], "trip.png", { type: "image/png" });
  const crops = JSON.stringify({ card, banner });
  for (const fields of [
    {}, { removeImage: "false" }, { removeImage: "true", crops }, { removeImage: "true", image: file }, { image: file },
    { crops: "not JSON" }, { crops: "[]" }, { crops: "null" }, { crops: "7" }, { crops: JSON.stringify({ card, banner, note: "x".repeat(1024) }) },
    { crops, gallery: "{}" }, { crops, image: "not a file" },
  ]) await assert.rejects(prepareTripImage(form(fields)), ImageValidationError, JSON.stringify(Object.keys(fields)));
  const twice = form({ crops });
  twice.append("crops", crops);
  await assert.rejects(prepareTripImage(twice), ImageValidationError);
  await assert.rejects(prepareTripImage(form({ crops, image: new File(["<svg/>"], "trip.svg", { type: "image/svg+xml" }) })), { message: "Choose a JPEG, PNG, or WebP image." });
  await assert.rejects(prepareTripImage(form({ crops, image: new File(["not really a PNG"], "trip.png", { type: "image/png" }) })), /couldn't read that image/);
  await assert.rejects(prepareTripImage("not a form"), ImageValidationError);
});
