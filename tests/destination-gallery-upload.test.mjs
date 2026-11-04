import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { prepareDestinationGallery } from "../src/lib/destination-gallery-upload.ts";
import { ImageValidationError } from "../src/lib/image-upload.ts";

function manifestForm(manifest = { addIds: [], removeIds: [] }) {
  const form = new FormData();
  form.set("gallery", JSON.stringify(manifest));
  return form;
}
function uploadForm(files, overrides = {}) {
  const photos = files.map((file) => ({ id: randomUUID(), file }));
  const form = manifestForm({ addIds: photos.map((photo) => photo.id), removeIds: [], ...overrides });
  for (const photo of photos) form.set(`image:${photo.id}`, photo.file);
  return { form, photos };
}
function file(bytes, type = "image/png") { return new File([bytes], "destination-photo", { type }); }
async function fixture(format) {
  return sharp({ create: { width: 40, height: 20, channels: 3, background: "#285f56" } })[format]().toBuffer();
}

test("destination uploads preserve omitted edits and accept ordering, primary-only and removal-only changes", async () => {
  assert.equal(await prepareDestinationGallery(), undefined);
  assert.equal(await prepareDestinationGallery(new FormData()), undefined);
  const first = randomUUID(), second = randomUUID();
  assert.deepEqual(await prepareDestinationGallery(manifestForm({ addIds: [], removeIds: [], order: [second, first] })), { add: [], remove: [], order: [second, first] });
  assert.deepEqual(await prepareDestinationGallery(manifestForm({ addIds: [], removeIds: [], mainImageId: second })), { add: [], remove: [], mainImageId: second });
  assert.deepEqual(await prepareDestinationGallery(manifestForm({ addIds: [], removeIds: [first], order: [], mainImageId: null })), { add: [], remove: [first], order: [], mainImageId: null });
});

test("destination gallery JPEG, PNG and WebP files decode to bounded WebP independently of display order", async () => {
  const files = await Promise.all(["jpeg", "png", "webp"].map(async (format) => file(await fixture(format), `image/${format}`)));
  const { form, photos } = uploadForm(files);
  const order = [photos[2].id, photos[0].id, photos[1].id];
  form.set("gallery", JSON.stringify({ addIds: photos.map((photo) => photo.id), removeIds: [], mainImageId: photos[1].id, order }));
  const result = await prepareDestinationGallery(form);
  assert.deepEqual(result.order, order);
  assert.deepEqual(result.add.map((photo) => photo.id), photos.map((photo) => photo.id));
  assert.equal(result.mainImageId, photos[1].id);
  for (const photo of result.add) {
    const metadata = await sharp(photo.data).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 40);
    assert.equal(metadata.height, 20);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.ok(photo.data.byteLength <= 2 * 1024 * 1024);
  }
});

test("malformed destination ordering is rejected before any file decoding", async () => {
  const id = randomUUID();
  for (const order of [null, "first", {}, [null], [4], ["invalid"], [id, id], [id, id.toUpperCase()], Array.from({ length: 11 }, randomUUID)]) {
    // Missing upload bytes would produce a different error if ordering were checked too late.
    await assert.rejects(prepareDestinationGallery(manifestForm({ addIds: [randomUUID()], removeIds: [], order })), /photo positions/);
  }
});

test("destination gallery rejects malformed manifests, missing files and mixed legacy uploads", async () => {
  for (const manifest of [null, [], {}, { addIds: ["invalid"], removeIds: [] }, { addIds: [], removeIds: [] , mainImageId: true }]) {
    await assert.rejects(prepareDestinationGallery(manifestForm(manifest)), ImageValidationError);
  }
  for (const raw of ["{", "null", " ".repeat(8193)]) {
    const form = new FormData();
    form.set("gallery", raw);
    await assert.rejects(prepareDestinationGallery(form), ImageValidationError);
  }
  for (const invalid of [null, {}, "bad"]) await assert.rejects(prepareDestinationGallery(invalid), ImageValidationError);
  const source = file(await fixture("png"));
  const { form, photos } = uploadForm([source]);
  form.append(`image:${photos[0].id}`, source);
  await assert.rejects(prepareDestinationGallery(form), /missing/);
  await assert.rejects(prepareDestinationGallery(manifestForm({ addIds: [randomUUID()], removeIds: [] })), /missing/);
  const unlisted = manifestForm();
  unlisted.set(`image:${randomUUID()}`, source);
  await assert.rejects(prepareDestinationGallery(unlisted), /not included/);
  const repeated = manifestForm();
  repeated.append("gallery", JSON.stringify({ addIds: [], removeIds: [] }));
  await assert.rejects(prepareDestinationGallery(repeated), ImageValidationError);
  for (const key of ["image", "removeImage"]) {
    const mixed = manifestForm();
    mixed.set(key, key === "image" ? source : "true");
    await assert.rejects(prepareDestinationGallery(mixed), ImageValidationError);
  }
});

test("destination gallery enforces file type, nonempty files, per-file and total upload limits", async () => {
  const valid = file(await fixture("png"));
  for (const invalid of [file("not PNG bytes"), file(new Uint8Array()), file("image", "image/gif"), file(new Uint8Array(5 * 1024 * 1024 + 1))]) {
    const { form } = uploadForm([valid, invalid]);
    await assert.rejects(prepareDestinationGallery(form), ImageValidationError);
  }
  const { form } = uploadForm(Array.from({ length: 4 }, () => file(new Uint8Array(4 * 1024 * 1024))));
  await assert.rejects(prepareDestinationGallery(form), /15 MB/);
  const tooMany = manifestForm({ addIds: Array.from({ length: 11 }, randomUUID), removeIds: [] });
  await assert.rejects(prepareDestinationGallery(tooMany), ImageValidationError);
});
