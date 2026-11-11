import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { formatMegabytes, IMAGE_UPLOAD_TYPES, MAX_CANDIDATE_IMAGES, MAX_DESTINATION_IMAGES, MAX_GALLERY_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES } from "../src/lib/image-limits.ts";
import { prepareCandidateGallery } from "../src/lib/candidate-gallery-upload.ts";
import { prepareImage } from "../src/lib/image-upload.ts";
import { candidateInput, destinationInput, setup } from "./budget-fixtures.mjs";

const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const photo = (data = webp) => ({ id: randomUUID(), data });
const photos = (count) => Array.from({ length: count }, () => photo());
const file = (bytes, type = "image/png") => new File([bytes], "photo", { type });

test("image limits and upload types keep their released values", () => {
  assert.deepEqual(IMAGE_UPLOAD_TYPES, ["image/jpeg", "image/png", "image/webp"]);
  assert.deepEqual([MAX_IMAGE_UPLOAD_BYTES, MAX_GALLERY_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES], [5 * 1024 * 1024, 15 * 1024 * 1024, 2 * 1024 * 1024]);
  assert.deepEqual([MAX_IMAGE_UPLOAD_BYTES, MAX_GALLERY_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES].map(formatMegabytes), ["5 MB", "15 MB", "2 MB"]);
  assert.deepEqual([MAX_CANDIDATE_IMAGES, MAX_DESTINATION_IMAGES], [10, 10]);
});

test("uploads accept every shared type and state the shared limits they enforce", async () => {
  for (const type of IMAGE_UPLOAD_TYPES) {
    const source = await sharp({ create: { width: 4, height: 2, channels: 3, background: "#285f56" } })[type.slice("image/".length)]().toBuffer();
    const form = new FormData();
    form.set("image", file(source, type));
    assert.equal((await sharp(await prepareImage(form)).metadata()).format, "webp", type);
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
  const destinationId = store.applyMutation(destinationInput(tripId)).id;
  const ideaId = store.applyMutation(candidateInput(destinationId, "activities")).id;
  const saveDestination = (add) => store.applyMutation(destinationInput(tripId, { id: destinationId, gallery: { add, remove: [] } }));
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
