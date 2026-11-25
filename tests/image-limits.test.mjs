import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { formatMegabytes, IMAGE_FORMAT_NAMES, IMAGE_FORMATS, IMAGE_UPLOAD_ACCEPT, IMAGE_UPLOAD_TYPES, isImageUploadFile, MAX_CANDIDATE_IMAGES, MAX_DESTINATION_IMAGES, MAX_GALLERY_UPLOAD_BYTES, MAX_IMAGE_PIXELS, MAX_IMAGE_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES } from "../src/lib/image-limits.ts";
import { prepareCandidateGallery } from "../src/lib/candidate-gallery-upload.ts";
import { prepareImage } from "../src/lib/image-upload.ts";
import { candidateInput, addDestination, prepared, setup, destinationEdit } from "./budget-fixtures.mjs";

const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const photo = (data = webp) => ({ id: randomUUID(), ...prepared(data) });
const photos = (count) => Array.from({ length: count }, () => photo());
const file = (bytes, type = "image/png") => new File([bytes], "photo", { type });

test("image limits keep their released values, and uploads take the formats TRA-179 added", () => {
  assert.deepEqual(IMAGE_FORMATS.map(({ name, extensions }) => [name, extensions]), [
    ["JPEG", [".jpg", ".jpeg", ".jfif", ".jpe"]], ["PNG", [".png"]], ["WebP", [".webp"]], ["AVIF", [".avif"]], ["GIF", [".gif"]], ["TIFF", [".tif", ".tiff"]], ["BMP", [".bmp"]], ["HEIC", [".heic", ".heif"]],
  ]);
  assert.deepEqual(IMAGE_UPLOAD_TYPES, ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/tiff", "image/bmp", "image/x-ms-bmp", "image/heic", "image/heif"]);
  assert.equal(IMAGE_UPLOAD_ACCEPT, "image/jpeg,.jpg,.jpeg,.jfif,.jpe,image/png,.png,image/webp,.webp,image/avif,.avif,image/gif,.gif,image/tiff,.tif,.tiff,image/bmp,image/x-ms-bmp,.bmp,image/heic,image/heif,.heic,.heif");
  assert.equal(IMAGE_FORMAT_NAMES, "JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, or HEIC");
  assert.equal(MAX_IMAGE_PIXELS, 20_000_000);
  assert.deepEqual([MAX_IMAGE_UPLOAD_BYTES, MAX_GALLERY_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES], [5 * 1024 * 1024, 15 * 1024 * 1024, 2 * 1024 * 1024]);
  assert.deepEqual([MAX_IMAGE_UPLOAD_BYTES, MAX_GALLERY_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES].map(formatMegabytes), ["5 MB", "15 MB", "2 MB"]);
  assert.deepEqual([MAX_CANDIDATE_IMAGES, MAX_DESTINATION_IMAGES], [10, 10]);
});

test("photo editors take a file by its type, or by its extension when its browser gives an unexpected type or none (TRA-179)", () => {
  for (const [name, type] of [["IMG_0001.HEIC", ""], ["photo.jfif", "image/pjpeg"], ["photo.JPE", "application/octet-stream"], ["scan.tif", ""], ["scan.TIFF", "image/tiff"],
    ["map.bmp", "image/x-ms-bmp"], ["camera.heif", "image/heif"], ["photo", "image/avif"], ["photo", "IMAGE/JPEG"]]) {
    assert.equal(isImageUploadFile({ name, type }), true, `${name} (${type})`);
  }
  for (const [name, type] of [["notes.txt", "text/plain"], ["drawing.svg", "image/svg+xml"], ["raw.dng", "image/x-adobe-dng"], ["clip.mov", "video/quicktime"], ["photo", ""], ["photo.jpg.txt", ""]]) {
    assert.equal(isImageUploadFile({ name, type }), false, `${name} (${type})`);
  }
});

test("uploads accept every format and state the shared limits they enforce", async () => {
  const create = (format) => sharp({ create: { width: 4, height: 2, channels: 3, background: "#285f56" } })[format]().toBuffer();
  const fixture = (name) => readFileSync(new URL(`./fixtures/images/${name}`, import.meta.url));
  // One image of each format, which sharp makes when it can, by each format's first type.
  const samples = {
    JPEG: await create("jpeg"), PNG: await create("png"), WebP: await create("webp"), AVIF: await create("avif"), GIF: await create("gif"), TIFF: await create("tiff"),
    BMP: fixture("bmp-24.bmp"), HEIC: fixture("photo.heic"),
  };
  assert.deepEqual(Object.keys(samples), IMAGE_FORMATS.map((format) => format.name), "every format has a sample");
  for (const { name, types } of IMAGE_FORMATS) {
    const form = new FormData();
    form.set("image", file(samples[name], types[0]));
    assert.equal((await sharp((await prepareImage(form)).data).metadata()).format, "webp", name);
  }
  const oversized = new FormData();
  oversized.set("image", file(new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1)));
  await assert.rejects(prepareImage(oversized), { message: "Choose an image smaller than 5 MB." });
  // Each file is within the upload limit; together they exceed one save's limit.
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const batch = new FormData();
  batch.set("gallery", JSON.stringify({ addIds: ids, removeIds: [] }));
  for (const id of ids) batch.set("image:" + id, file(new Uint8Array(MAX_GALLERY_UPLOAD_BYTES / ids.length + 1)));
  await assert.rejects(prepareCandidateGallery(batch), { message: "Add up to 15 MB of new photos at a time. Save these photos before adding more." });
});

test("the store keeps saved photos within the shared limits and states them", (t) => {
  const { store, tripId } = setup(t);
  const destinationId = addDestination(store, tripId);
  const ideaId = store.applyMutation(candidateInput(destinationId, "activities")).id;
  const saveDestination = (add) => store.applyMutation(destinationEdit(destinationId, { gallery: { add, remove: [] } }));
  const saveIdea = (add) => store.applyMutation(candidateInput(destinationId, "activities", { id: ideaId, gallery: { add, remove: [] } }));
  const sized = (bytes) => { const data = new Uint8Array(bytes); data.set(webp); return data; };

  assert.throws(() => saveDestination([photo(sized(MAX_STORED_IMAGE_BYTES + 1))]), { name: "ValidationError", message: "Destination image must be 2 MB or smaller." });
  assert.throws(() => saveIdea([photo(sized(MAX_STORED_IMAGE_BYTES + 1))]), { name: "ValidationError", message: "Idea image must be 2 MB or smaller." });
  saveDestination([photo(sized(MAX_STORED_IMAGE_BYTES))]);

  assert.throws(() => saveDestination(photos(MAX_DESTINATION_IMAGES + 1)), { name: "ValidationError", message: "A destination can have up to 10 photos." });
  assert.throws(() => saveDestination(photos(MAX_DESTINATION_IMAGES)), { name: "ValidationError", message: "A destination can have up to 10 photos. Remove a photo before adding more." });
  saveDestination(photos(MAX_DESTINATION_IMAGES - 1));
  assert.equal(store.getSnapshot().destinations[0].images.length, MAX_DESTINATION_IMAGES);

  assert.throws(() => saveIdea(photos(MAX_CANDIDATE_IMAGES + 1)), { name: "ValidationError", message: "An idea can have up to 10 photos." });
  saveIdea(photos(MAX_CANDIDATE_IMAGES));
  assert.throws(() => saveIdea(photos(1)), { name: "ValidationError", message: "An idea can have up to 10 photos. Remove a photo before adding more." });
});
