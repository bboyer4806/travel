import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { prepareCandidateGallery } from "../src/lib/candidate-gallery-upload.ts";
import { ImageValidationError } from "../src/lib/image-upload.ts";

function manifestForm(manifest = { addIds: [], removeIds: [] }) {
  const form = new FormData();
  form.set("gallery", JSON.stringify(manifest));
  return form;
}
function uploadForm(files, overrides = {}) {
  const photos = files.map((file) => ({ id: randomUUID(), file }));
  const form = manifestForm({ addIds: photos.map((photo) => photo.id), removeIds: [], ...overrides });
  for (const photo of photos) form.set("image:" + photo.id, photo.file);
  return { form, photos };
}
function file(bytes, type = "image/png") { return new File([bytes], "photo", { type }); }
async function fixture(format, color = "#285f56") {
  return sharp({ create: { width: 40, height: 20, channels: 3, background: color } })[format]().toBuffer();
}

test("gallery uploads preserve omitted changes and support main selection or removal without files", async () => {
  assert.equal(await prepareCandidateGallery(), undefined);
  assert.equal(await prepareCandidateGallery(new FormData()), undefined);
  const mainImageId = randomUUID();
  assert.deepEqual(await prepareCandidateGallery(manifestForm({ addIds: [], removeIds: [], mainImageId })), { add: [], remove: [], mainImageId });
  const removeIds = [randomUUID(), randomUUID()];
  assert.deepEqual(await prepareCandidateGallery(manifestForm({ addIds: [], removeIds, mainImageId: null })), { add: [], remove: removeIds, mainImageId: null });
  assert.deepEqual(await prepareCandidateGallery(manifestForm()), { add: [], remove: [] });
});

test("multiple JPEG, PNG, and WebP files are decoded to ordered, bounded WebP photos", async () => {
  const formats = ["jpeg", "png", "webp"];
  const files = await Promise.all(formats.map(async (format) => file(await fixture(format), "image/" + format)));
  const { form, photos } = uploadForm(files);
  const removedId = randomUUID();
  form.set("gallery", JSON.stringify({ addIds: photos.map((photo) => photo.id), removeIds: [removedId], mainImageId: photos[1].id }));
  const result = await prepareCandidateGallery(form);
  assert.deepEqual(result.remove, [removedId]);
  assert.equal(result.mainImageId, photos[1].id);
  assert.deepEqual(result.add.map((photo) => photo.id), photos.map((photo) => photo.id));
  for (const photo of result.add) {
    assert.ok(photo.data instanceof Uint8Array);
    assert.ok(photo.data.byteLength <= 2 * 1024 * 1024);
    const decoded = await sharp(photo.data).metadata();
    assert.equal(decoded.format, "webp");
    assert.equal(decoded.width, 40);
    assert.equal(decoded.height, 20);
    assert.equal(decoded.exif, undefined);
    assert.equal(decoded.icc, undefined);
  }
});

test("malformed gallery manifests and invalid or duplicate identifiers are rejected", async () => {
  const sameId = randomUUID();
  const malformed = [null, [], {}, "gallery", { addIds: null, removeIds: [] }, { addIds: [], removeIds: "none" },
    { addIds: ["not-a-uuid"], removeIds: [] }, { addIds: [], removeIds: [42] },
    { addIds: [], removeIds: [], mainImageId: true }, { addIds: [], removeIds: [], mainImageId: "not-an-id" },
    { addIds: [sameId, sameId], removeIds: [] }, { addIds: [sameId, sameId.toUpperCase()], removeIds: [] },
    { addIds: [], removeIds: [sameId, sameId.toUpperCase()] },
    { addIds: [sameId], removeIds: [sameId] }, { addIds: [sameId], removeIds: [sameId.toUpperCase()] },
    { addIds: Array.from({ length: 11 }, () => randomUUID()), removeIds: [] },
    { addIds: [], removeIds: Array.from({ length: 11 }, () => randomUUID()) },
  ];
  for (const manifest of malformed) await assert.rejects(prepareCandidateGallery(manifestForm(manifest)), ImageValidationError);
  for (const raw of ["{", "null", "[]", " ".repeat(8193)]) {
    const form = new FormData();
    form.set("gallery", raw);
    await assert.rejects(prepareCandidateGallery(form), ImageValidationError);
  }
  const duplicateManifest = manifestForm();
  duplicateManifest.append("gallery", JSON.stringify({ addIds: [], removeIds: [] }));
  await assert.rejects(prepareCandidateGallery(duplicateManifest), ImageValidationError);
  const fileManifest = new FormData();
  fileManifest.set("gallery", file("{}"));
  await assert.rejects(prepareCandidateGallery(fileManifest), ImageValidationError);
  for (const invalid of [null, {}, "not a form"]) await assert.rejects(prepareCandidateGallery(invalid), ImageValidationError);
});

test("missing, repeated, unlisted, or legacy-mixed uploads cannot enter a gallery batch", async () => {
  const source = await fixture("png");
  const missing = manifestForm({ addIds: [randomUUID()], removeIds: [] });
  await assert.rejects(prepareCandidateGallery(missing), /missing/);
  const { form, photos } = uploadForm([file(source)]);
  form.append("image:" + photos[0].id, file(source));
  await assert.rejects(prepareCandidateGallery(form), /missing/);
  const stringFile = manifestForm({ addIds: [photos[0].id], removeIds: [] });
  stringFile.set("image:" + photos[0].id, "not a File");
  await assert.rejects(prepareCandidateGallery(stringFile), /missing/);
  const unlisted = manifestForm();
  unlisted.set("image:" + randomUUID(), file(source));
  await assert.rejects(prepareCandidateGallery(unlisted), /not included/);
  for (const field of ["image", "removeImage"]) {
    const mixed = manifestForm();
    mixed.set(field, field === "image" ? file(source) : "true");
    await assert.rejects(prepareCandidateGallery(mixed), ImageValidationError);
  }
});

test("a corrupt or unsupported photo rejects the whole batch even after a valid first photo", async () => {
  const good = file(await fixture("png"));
  for (const invalid of [
    file("not a PNG"), file(new Uint8Array()), file("image", "image/gif"),
    file('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', "image/jpeg"),
    file(new Uint8Array(5 * 1024 * 1024 + 1)),
  ]) {
    const { form } = uploadForm([good, invalid]);
    await assert.rejects(prepareCandidateGallery(form), ImageValidationError);
  }
});

test("the new-photo batch limit is checked before image decoding", async () => {
  // Each file is below the individual 5 MB limit; their combined size exceeds 15 MB.
  const bytes = new Uint8Array(4 * 1024 * 1024);
  const { form } = uploadForm(Array.from({ length: 4 }, () => file(bytes)));
  await assert.rejects(prepareCandidateGallery(form), /15 MB/);
});
