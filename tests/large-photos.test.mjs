import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import sharp from "sharp";
import { LARGE_PHOTO_SIZE, MAX_STORED_LARGE_IMAGE_BYTES, PHOTO_SIZE } from "../src/lib/image-limits.ts";
import { makeThumbnail, prepareImage } from "../src/lib/image-upload.ts";
import { createStore, SCHEMA_VERSION } from "../src/lib/store.ts";
import { aiSetup, NOW } from "./ai-fixtures.mjs";
import { addCity, candidateInput, fileDatabase, newItem, prepared, tripInput } from "./budget-fixtures.mjs";
import { OWNER_EMAIL, UNDO_SCHEMA_40 } from "./owned-store.mjs";

// TRA-154: each photo keeps a large version beside it when its upload is larger than the photo, for frames wider than
// the photo on high-resolution screens, such as a trip's banner.

/** WebP bytes as the store checks them, told apart by their last byte. */
const webp = (byte) => new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, byte]);
/** A large version as Travel prepares one: its bytes, and its width and its photo's. */
const large = (byte, widths = { photo: 1600, large: 2560 }) => ({ data: webp(byte), widths });
/** A photo to add, with its large version, or with `largeVersion` null none. */
const photo = (byte, largeVersion = large(byte + 100)) => ({ id: randomUUID(), ...prepared(webp(byte), webp(byte), largeVersion) });
const churchInput = (destinationId, overrides = {}) => ({ type: "church.save", destinationId, name: "Kiyomizu", address: "", denomination: "", url: "", massTimes: [], ...overrides, ...newItem(overrides) });
const flat = { focusX: 50, focusY: 50, zoom: 1 };
const headline = (data, largeVersion) => ({ data, large: largeVersion, card: flat, banner: { ...flat, zoom: 2 } });

/** An upload of a size, as someone chooses it, turned by its EXIF orientation. */
async function upload(width, height, orientation = 1) {
  const form = new FormData();
  form.set("image", new File([await sharp({ create: { width, height, channels: 3, background: "#496b62" } }).withMetadata({ orientation }).jpeg().toBuffer()], "photo.jpg", { type: "image/jpeg" }));
  return form;
}

test("an upload larger than the photo keeps a large version up to 2560 × 1920 with both widths, and one no larger keeps none", async () => {
  assert.deepEqual([PHOTO_SIZE, LARGE_PHOTO_SIZE, MAX_STORED_LARGE_IMAGE_BYTES], [{ width: 1600, height: 1200 }, { width: 2560, height: 1920 }, 5 * 1024 * 1024]);
  const size = async (data) => { const { format, width, height, orientation, exif } = await sharp(data).metadata(); return [format, width, height, orientation, exif]; };
  for (const [width, height, orientation, photoSize, largeSize] of [
    [4000, 3000, 1, [1600, 1200], [2560, 1920]],
    [3000, 4000, 1, [900, 1200], [1440, 1920]],
    [4000, 3000, 6, [900, 1200], [1440, 1920]],
    [2000, 1500, 1, [1600, 1200], [2000, 1500]],
    [1920, 1080, 1, [1600, 900], [1920, 1080]],
  ]) {
    const image = await prepareImage(await upload(width, height, orientation));
    const name = `${width} × ${height}, orientation ${orientation}`;
    assert.deepEqual(await size(image.data), ["webp", ...photoSize, undefined, undefined], name);
    assert.deepEqual(await size(image.large.data), ["webp", ...largeSize, undefined, undefined], `${name}: upright, never enlarged, without metadata`);
    assert.deepEqual(image.large.widths, { photo: photoSize[0], large: largeSize[0] }, name);
    assert.deepEqual(image.thumbnail, await makeThumbnail(image.data), `${name}: the thumbnail is still made from the photo`);
  }
  for (const [width, height] of [[1600, 1200], [1200, 1200], [800, 600]]) {
    const image = await prepareImage(await upload(width, height));
    assert.equal(image.large, null, `${width} × ${height} is no larger than the photo`);
  }
});

test("photos and headline images are saved with their large versions, reads give their widths, and each goes to exactly the accounts that see its photo", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const friend = store.authorizeAccount("friend@example.test").id;
  const save = (input) => store.applyMutation(owner, input).id;
  const photos = { destination: photo(1), small: photo(2, null), idea: photo(3), church: photo(4) };
  const tripId = save(tripInput({ image: headline(webp(5), large(6, { photo: 1600, large: 2000 })) }));
  const destinationId = addCity(save, tripId, "Kyoto", { gallery: { add: [photos.destination, photos.small], remove: [] } });
  const hotelId = save(candidateInput(destinationId, "hotels", { gallery: { add: [photos.idea], remove: [] } }));
  const churchId = save(churchInput(destinationId, { gallery: { add: [photos.church], remove: [] } }));

  // Every read gives each photo's widths, or null without a large version, and never the bytes.
  const snapshot = store.getSnapshot();
  const widths = (images) => Object.fromEntries(images.map((image) => [image.id, image.widths]));
  assert.deepEqual(widths(snapshot.destinations[0].images), { [photos.destination.id]: { photo: 1600, large: 2560 }, [photos.small.id]: null });
  assert.deepEqual(widths(snapshot.candidates[0].images), { [photos.idea.id]: { photo: 1600, large: 2560 } });
  assert.deepEqual(widths(snapshot.churches[0].images), { [photos.church.id]: { photo: 1600, large: 2560 } });
  assert.deepEqual(snapshot.trips[0].image.widths, { photo: 1600, large: 2000 });
  assert.equal(JSON.stringify(snapshot, (key, value) => (value instanceof Uint8Array ? "bytes" : value)).includes("bytes"), false, "no read has image bytes");

  // Each large version shares its photo's version, as its address does, and goes to nobody the photo isn't shared with.
  const reads = [
    [store.getDestinationLargePhoto, store.getDestinationPhoto, destinationId, photos.destination],
    [store.getCandidateLargePhoto, store.getCandidatePhoto, hotelId, photos.idea],
    [store.getChurchLargePhoto, store.getChurchPhoto, churchId, photos.church],
  ];
  for (const [readLarge, readPhoto, ownerId, saved] of reads) {
    const { version } = readPhoto(owner, ownerId, saved.id);
    assert.deepEqual(readLarge(owner, ownerId, saved.id), { version, data: saved.large.data });
    assert.equal(readLarge(friend, ownerId, saved.id), undefined, "nobody the trip isn't shared with sees it");
    assert.equal(readLarge(owner, randomUUID(), saved.id), undefined, "nor does it show under anything else");
  }
  assert.equal(store.getCandidateLargePhoto(owner, churchId, photos.church.id), undefined, "a church's photo isn't an idea's");
  assert.equal(store.getDestinationLargePhoto(owner, destinationId, photos.small.id), undefined, "a photo without one has none to serve");
  assert.deepEqual(store.getTripLargeImage(owner, tripId), { version: store.getTripImage(owner, tripId).version, data: webp(6) });
  assert.equal(store.getTripLargeImage(friend, tripId), undefined);
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  assert.deepEqual(store.getTripLargeImage(friend, tripId).data, webp(6), "sharing the trip shares them");
  assert.deepEqual(store.getChurchLargePhoto(friend, churchId, photos.church.id).data, photos.church.large.data);

  // Recropping keeps the large version; a new image replaces it with its own, or with none.
  const { version } = store.getTripImage(owner, tripId);
  save(tripInput({ id: tripId, image: { version, card: { ...flat, zoom: 3 }, banner: flat } }));
  assert.deepEqual(store.getTripLargeImage(owner, tripId), { version, data: webp(6) });
  save(tripInput({ id: tripId, image: headline(webp(7), null) }));
  assert.equal(store.getTripLargeImage(owner, tripId), undefined);
  assert.equal(store.getSnapshot().trips[0].image.widths, null);

  // An old client's single image replaces the primary photo with its large version, or with none.
  const otherId = addCity(save, tripId, "Osaka", { image: prepared(webp(8), webp(8), large(9)) });
  const primary = () => store.getSnapshot().destinations.find((item) => item.id === otherId).images[0];
  assert.deepEqual([primary().widths, store.getDestinationLargePhoto(owner, otherId, primary().id).data], [{ photo: 1600, large: 2560 }, webp(9)]);
  store.applyMutation(owner, { type: "destination.save", id: otherId, image: prepared(webp(10)) });
  assert.deepEqual([primary().widths, store.getDestinationLargePhoto(owner, otherId, primary().id)], [null, undefined]);

  // A removed photo's large version goes with it.
  store.applyMutation(owner, { type: "destination.save", id: destinationId, gallery: { add: [], remove: [photos.destination.id] } });
  assert.equal(store.getDestinationLargePhoto(owner, destinationId, photos.destination.id), undefined);
});

test("a large version that isn't as Travel prepares one is refused, and nothing is saved", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const save = (input) => store.applyMutation(owner, input).id;
  const tripId = save(tripInput());
  const destinationId = addCity(save, tripId, "Kyoto");
  const before = store.getSnapshot();
  const widths = { photo: 1600, large: 2560 };
  const oversized = new Uint8Array(MAX_STORED_LARGE_IMAGE_BYTES + 1);
  oversized.set(webp(1));
  const notWebp = webp(1);
  notWebp[8] = 0;
  const invalid = "Choose a valid WebP destination image.";
  for (const [largeVersion, message] of [
    [undefined, invalid], ["large", invalid], [[], invalid], [{ data: webp(1) }, invalid], [{ widths }, invalid],
    [{ data: webp(1), widths: { photo: 1600.5, large: 2560 } }, invalid], [{ data: webp(1), widths: { photo: "1600", large: 2560 } }, invalid],
    [{ data: webp(1), widths: { photo: 0, large: 2560 } }, invalid], [{ data: webp(1), widths: { photo: 1601, large: 2560 } }, invalid],
    [{ data: webp(1), widths: { photo: 1600, large: 1600 } }, invalid], [{ data: webp(1), widths: { photo: 1600, large: 2561 } }, invalid],
    [{ data: [...webp(1)], widths }, invalid], [{ data: notWebp, widths }, invalid], [{ data: oversized, widths }, "Destination image must be 5 MB or smaller."],
  ]) {
    const added = { id: randomUUID(), data: webp(2), thumbnail: webp(2), large: largeVersion };
    assert.throws(() => store.applyMutation(owner, { type: "destination.save", id: destinationId, gallery: { add: [added], remove: [] } }), { name: "ValidationError", message }, JSON.stringify(largeVersion));
    assert.deepEqual(store.getSnapshot(), before);
  }
  for (const largeVersion of [undefined, { data: oversized, widths }, { data: webp(1), widths: { photo: 1600, large: 1600 } }]) {
    assert.throws(() => store.applyMutation(owner, tripInput({ id: tripId, image: headline(webp(3), largeVersion) })), { name: "ValidationError" });
    assert.deepEqual(store.getSnapshot(), before);
  }
  // The limits themselves are allowed.
  const largest = new Uint8Array(MAX_STORED_LARGE_IMAGE_BYTES);
  largest.set(webp(1));
  save({ type: "destination.save", id: destinationId, gallery: { add: [photo(4, { data: largest, widths: { photo: 1, large: 2560 } })], remove: [] } });
  assert.deepEqual(store.getSnapshot().destinations[0].images[0].widths, { photo: 1, large: 2560 });
});

test("the database keeps each large version with both widths, the large one wider, or neither", (t) => {
  const path = fileDatabase(t);
  const store = createStore(path, OWNER_EMAIL);
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const save = (input) => store.applyMutation(owner, input).id;
  const tripId = save(tripInput({ image: headline(webp(1), large(2)) }));
  addCity(save, tripId, "Kyoto", { gallery: { add: [photo(3)], remove: [] } });
  store.close();
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  for (const table of ["destination_images", "trip_images"]) {
    for (const change of ["large = NULL", "photoWidth = NULL", "largeWidth = NULL", "largeWidth = photoWidth", "photoWidth = 0", "large = NULL, largeWidth = NULL", "photoWidth = 'wide'"]) {
      assert.throws(() => db.prepare(`UPDATE ${table} SET ${change}`).run(), /constraint failed|cannot store/, `${table}: ${change}`);
    }
    db.prepare(`UPDATE ${table} SET large = NULL, photoWidth = NULL, largeWidth = NULL`).run();
  }
});

test("schema 40 keeps every photo and headline image as it was, without a large version, and a replay keeps those saved since", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path, OWNER_EMAIL);
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const save = (input) => store.applyMutation(owner, input).id;
  const tripId = save(tripInput({ image: headline(webp(1), null) }));
  const kept = photo(2, null);
  const destinationId = addCity(save, tripId, "Kyoto", { gallery: { add: [kept], remove: [] } });
  const hotelId = save(candidateInput(destinationId, "hotels", { gallery: { add: [photo(3, null)], remove: [] } }));
  const before = store.getSnapshot();
  const images = [store.getTripImage(owner, tripId), store.getDestinationPhoto(owner, destinationId, kept.id)];
  store.close();
  let db = new DatabaseSync(path);
  db.exec(UNDO_SCHEMA_40);
  db.close();

  store = createStore(path, OWNER_EMAIL);
  assert.deepEqual(store.getSnapshot(), before, "every photo and headline image keeps its version, order, crops and focal point, with no large version");
  assert.deepEqual([store.getTripImage(owner, tripId), store.getDestinationPhoto(owner, destinationId, kept.id)], images, "the bytes are unchanged");
  assert.deepEqual([store.getTripLargeImage(owner, tripId), store.getDestinationLargePhoto(owner, destinationId, kept.id)], [undefined, undefined]);
  const added = photo(4);
  store.applyMutation(owner, candidateInput(destinationId, "hotels", { id: hotelId, gallery: { add: [added], remove: [] } }));
  const saved = store.getCandidateLargePhoto(owner, hotelId, added.id);
  assert.deepEqual(saved.data, added.large.data, "a photo saved after the upgrade has its large version");
  store.close();

  db = new DatabaseSync(path);
  db.exec("PRAGMA user_version = 39;");
  db.close();
  store = createStore(path, OWNER_EMAIL);
  t.after(() => store.close());
  assert.deepEqual(store.getCandidateLargePhoto(owner, hotelId, added.id), saved, "a replay keeps saved large versions");
  db = new DatabaseSync(path);
  t.after(() => db.close());
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("photos ChatGPT and Claude propose keep their large versions until approval saves them, and one proposed before large versions is saved without", (t) => {
  const path = fileDatabase(t);
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t, path);
  const destinationId = store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Kyoto" }).id;
  const add = (...ids) => ids.map((id) => ({ id, url: `https://images.example.com/${id}.png` }));
  const [withLarge, without, earlier] = [randomUUID(), randomUUID(), randomUUID()];
  const proposal = propose([{ type: "destination.photos", id: destinationId, gallery: { add: add(withLarge, without), remove: [] } }], "Add photos", NOW,
    new Map([[withLarge, prepared(webp(1), webp(2), large(3))], [without, prepared(webp(4), webp(5), null)]]));
  assert.ok(proposal.preview.flatMap((change) => change.records).flatMap((record) => record.fields).every((field) => !/width|large/i.test(field.name)), "the owner reviews the photos, not their sizes");
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  const waiting = () => db.prepare("SELECT id, large, photoWidth, largeWidth FROM ai_proposal_photos").all().map((row) => ({ ...row, large: row.large && new Uint8Array(row.large) }));
  assert.deepEqual(waiting().toSorted((a, b) => (a.id === withLarge ? -1 : b.id === withLarge ? 1 : 0)), [
    { id: withLarge, large: webp(3), photoWidth: 1600, largeWidth: 2560 }, { id: without, large: null, photoWidth: null, largeWidth: null },
  ], "they wait beside the proposal");
  assert.equal(decide(proposal, true).status, "applied");
  assert.deepEqual(store.getDestinationLargePhoto(owner, destinationId, withLarge).data, webp(3));
  assert.equal(store.getDestinationLargePhoto(owner, destinationId, without), undefined);
  assert.deepEqual(waiting(), [], "and go once it is decided");

  // A photo proposed before large versions waits without one, as the upgrade leaves it, and approving saves it so.
  const older = propose([{ type: "destination.photos", id: destinationId, gallery: { add: add(earlier), remove: [] } }], "Add another", NOW, new Map([[earlier, prepared(webp(6), webp(7), large(8))]]));
  db.prepare("DELETE FROM ai_proposal_photos WHERE id = ?").run(earlier);
  db.prepare("INSERT INTO ai_proposal_photos(proposalId, id, data, thumbnail) VALUES(?, ?, ?, ?)").run(older.id, earlier, webp(6), webp(7));
  assert.equal(decide(older, true).status, "applied");
  assert.deepEqual(store.getDestinationPhoto(owner, destinationId, earlier).data, webp(6));
  assert.equal(store.getDestinationLargePhoto(owner, destinationId, earlier), undefined);
  assert.equal(store.getSnapshot().destinations[0].images.find((image) => image.id === earlier).widths, null);
});
