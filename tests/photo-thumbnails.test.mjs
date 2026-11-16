import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import sharp from "sharp";
import { prepareImage } from "../src/lib/image-upload.ts";
import { createStore, SCHEMA_VERSION } from "../src/lib/store.ts";
import { OWNER_EMAIL, UNDO_SCHEMA_32 } from "./owned-store.mjs";
import { addCity, candidateInput, fileDatabase, newItem, prepared, tripInput } from "./budget-fixtures.mjs";

/** WebP bytes as the store checks them, told apart by their last byte. */
const webp = (byte) => new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, byte]);
const photo = (data, thumbnail) => ({ id: randomUUID(), ...prepared(data, thumbnail) });
const churchInput = (destinationId, overrides = {}) => ({ type: "church.save", destinationId, name: "St. Stephen", address: "", denomination: "", url: "", massTimes: [], ...overrides, ...newItem(overrides) });

/** A trip in Vienna with a destination photo, a hotel photo and a church photo, each with its own thumbnail. */
function plans(store, owner) {
  const save = (input) => store.applyMutation(owner, input).id;
  const tripId = save(tripInput());
  const photos = { destination: photo(webp(1), webp(2)), idea: photo(webp(3), webp(4)), church: photo(webp(5), webp(6)) };
  const destinationId = addCity(save, tripId, "Vienna", { gallery: { add: [photos.destination], remove: [] } });
  const hotelId = save(candidateInput(destinationId, "hotels", { gallery: { add: [photos.idea], remove: [] } }));
  const churchId = save(churchInput(destinationId, { gallery: { add: [photos.church], remove: [] } }));
  return { tripId, destinationId, hotelId, churchId, photos };
}

test("photos are saved with their thumbnails, which go to exactly the accounts that see the photos (TRA-89)", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  const { tripId, destinationId, hotelId, churchId, photos } = plans(store, owner);
  const reads = [
    [store.getDestinationPhoto, store.getDestinationThumbnail, destinationId, photos.destination],
    [store.getCandidatePhoto, store.getCandidateThumbnail, hotelId, photos.idea],
    [store.getChurchPhoto, store.getChurchThumbnail, churchId, photos.church],
  ];
  for (const [readPhoto, readThumbnail, ownerId, saved] of reads) {
    const { version, data } = readPhoto(owner, ownerId, saved.id);
    assert.deepEqual(data, saved.data);
    assert.deepEqual(readThumbnail(owner, ownerId, saved.id), { version, data: saved.thumbnail }, "the thumbnail shares its photo's version");
    assert.equal(readThumbnail(outsider, ownerId, saved.id), undefined, "nobody the photo isn't shared with sees its thumbnail");
    assert.equal(readThumbnail(owner, randomUUID(), saved.id), undefined, "nor does a photo's thumbnail show under anything else");
  }
  assert.equal(store.getCandidateThumbnail(owner, churchId, photos.church.id), undefined, "a church's photo isn't an idea's");

  // An old client's single image adds the primary photo, or replaces it, with its thumbnail.
  const otherId = addCity((input) => store.applyMutation(owner, input).id, tripId, "Salzburg", { image: prepared(webp(7), webp(8)) });
  const primary = () => store.getSnapshot().destinations.find((item) => item.id === otherId);
  const first = primary();
  assert.deepEqual(store.getDestinationThumbnail(owner, otherId, first.mainImageId), { version: first.imageVersion, data: webp(8) });
  store.applyMutation(owner, { type: "destination.save", id: otherId, image: prepared(webp(9), webp(10)) });
  const replaced = primary();
  assert.equal(replaced.mainImageId, first.mainImageId);
  assert.notEqual(replaced.imageVersion, first.imageVersion);
  assert.deepEqual(store.getDestinationThumbnail(owner, otherId, replaced.mainImageId), { version: replaced.imageVersion, data: webp(10) });

  // A removed photo's thumbnail goes with it.
  store.applyMutation(owner, { type: "destination.save", id: destinationId, gallery: { add: [], remove: [photos.destination.id] } });
  assert.equal(store.getDestinationThumbnail(owner, destinationId, photos.destination.id), undefined);
});

test("schema 32 keeps every photo; one saved before has no thumbnail and gives its photo to make one from, and a replay keeps thumbnails saved since (TRA-89)", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path, OWNER_EMAIL);
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const { destinationId, hotelId, churchId, photos } = plans(store, owner);
  const before = store.getSnapshot();
  store.close();
  let db = new DatabaseSync(path);
  db.exec(UNDO_SCHEMA_32);
  db.close();

  store = createStore(path, OWNER_EMAIL);
  assert.deepEqual(store.getSnapshot(), before, "every photo keeps its version, order and primary choice, and nothing else changes");
  const reads = [
    [store.getDestinationPhoto, store.getDestinationThumbnail, destinationId, photos.destination],
    [store.getCandidatePhoto, store.getCandidateThumbnail, hotelId, photos.idea],
    [store.getChurchPhoto, store.getChurchThumbnail, churchId, photos.church],
  ];
  for (const [readPhoto, readThumbnail, ownerId, saved] of reads) {
    const { version, data } = readPhoto(owner, ownerId, saved.id);
    assert.deepEqual(data, saved.data, "the photo itself is unchanged");
    assert.deepEqual(readThumbnail(owner, ownerId, saved.id), { version, photo: saved.data }, "its thumbnail is made from the photo when asked for");
  }
  const added = photo(webp(11), webp(12));
  store.applyMutation(owner, candidateInput(destinationId, "hotels", { id: hotelId, gallery: { add: [added], remove: [] } }));
  const { version } = store.getCandidatePhoto(owner, hotelId, added.id);
  assert.deepEqual(store.getCandidateThumbnail(owner, hotelId, added.id), { version, data: webp(12) }, "a photo saved after the upgrade has its thumbnail");
  store.close();

  db = new DatabaseSync(path);
  db.exec("PRAGMA user_version = 31;");
  db.close();
  store = createStore(path, OWNER_EMAIL);
  t.after(() => store.close());
  assert.deepEqual(store.getCandidateThumbnail(owner, hotelId, added.id), { version, data: webp(12) }, "a replay keeps saved thumbnails");
  assert.deepEqual(store.getCandidateThumbnail(owner, hotelId, photos.idea.id).photo, photos.idea.data);
  db = new DatabaseSync(path);
  t.after(() => db.close());
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

/**
 * An upload as detailed as a photo: soft shapes, texture and grain, mostly at large scales. Each is about as hard to
 * compress as the 12-megapixel photo TRA-89 measured, which Travel saved at about 375 KB.
 */
async function photoUpload() {
  const [width, height] = [1600, 1200];
  const noise = (scale, sigma) => sharp({ create: { width: Math.ceil(width / scale), height: Math.ceil(height / scale), channels: 3, noise: { type: "gaussian", mean: 128, sigma } } })
    .resize(width, height, { kernel: "cubic" }).raw().toBuffer();
  const [base, ...layers] = await Promise.all([[32, 90], [8, 35], [2, 25], [1, 15]].map(([scale, sigma]) => noise(scale, sigma)));
  const image = await sharp(base, { raw: { width, height, channels: 3 } })
    .composite(layers.map((input) => ({ input, raw: { width, height, channels: 3 }, blend: "soft-light" }))).jpeg({ quality: 92 }).toBuffer();
  const form = new FormData();
  form.set("image", new File([image], "photo.jpg", { type: "image/jpeg" }));
  return form;
}

test("a card with 10 photos downloads under 0.5 MB of thumbnails (TRA-89)", async () => {
  const card = await Promise.all(Array.from({ length: 10 }, async () => prepareImage(await photoUpload())));
  const total = (images) => images.reduce((sum, image) => sum + image.byteLength, 0);
  assert.ok(total(card.map((image) => image.data)) > 10 * 300 * 1024, "the photos are about as detailed as photos");
  assert.ok(total(card.map((image) => image.thumbnail)) < 0.5 * 1024 * 1024, `10 thumbnails take ${total(card.map((image) => image.thumbnail))} bytes`);
});
