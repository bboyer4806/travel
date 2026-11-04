import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDestinationGalleryDraft, destinationGalleryChanged, destinationGalleryForm, moveDestinationPhoto, removeDestinationPhoto } from "../src/lib/destination-gallery.ts";

function savedDestination() {
  const images = Array.from({ length: 3 }, () => ({ id: randomUUID(), version: randomUUID() }));
  return { id: randomUUID(), city: "Paris", images, mainImageId: images[1].id };
}
function manifest(draft, destination) {
  return JSON.parse(destinationGalleryForm(draft, destination).get("gallery"));
}

test("destination gallery drafts can move photos without changing primary choice or saved state", () => {
  const destination = savedDestination();
  const draft = createDestinationGalleryDraft(destination);
  assert.equal(destinationGalleryChanged(draft, destination), false);
  assert.equal(destinationGalleryForm(draft, destination), undefined);
  const moved = moveDestinationPhoto(draft, draft.images[2].id, "left");
  assert.deepEqual(moved.images.map((image) => image.id), [destination.images[0].id, destination.images[2].id, destination.images[1].id]);
  assert.equal(moved.mainImageId, destination.mainImageId);
  assert.deepEqual(draft.images, destination.images);
  assert.deepEqual(manifest(moved, destination).order, moved.images.map((image) => image.id));
  const restored = moveDestinationPhoto(moved, moved.images[1].id, "right");
  assert.equal(destinationGalleryForm(restored, destination), undefined);
  assert.equal(moveDestinationPhoto(draft, draft.images[0].id, "left"), draft);
  assert.equal(moveDestinationPhoto(draft, draft.images[2].id, "right"), draft);
  assert.equal(moveDestinationPhoto(draft, randomUUID(), "left"), draft);
});

test("removing the primary draft photo chooses the first remaining photo in draft order", () => {
  const destination = savedDestination();
  const draft = moveDestinationPhoto(createDestinationGalleryDraft(destination), destination.images[0].id, "right");
  const removed = removeDestinationPhoto(draft, destination.mainImageId);
  assert.equal(removed.mainImageId, removed.images[0].id);
  assert.deepEqual(removed.removedIds, [destination.mainImageId]);
  assert.deepEqual(manifest(removed, destination).removeIds, [destination.mainImageId]);
  const empty = removed.images.reduce((value, image) => removeDestinationPhoto(value, image.id), removed);
  assert.equal(empty.mainImageId, null);
  assert.equal(empty.images.length, 0);
  assert.equal(removeDestinationPhoto(empty, randomUUID()), empty);
});

test("new destination photos serialize files and only send ordering when the default order changes", () => {
  const destination = savedDestination();
  const image = { id: randomUUID(), file: new File(["fake upload bytes"], "photo.png", { type: "image/png" }) };
  const initial = createDestinationGalleryDraft(destination);
  const draft = { ...initial, images: [...initial.images, image] };
  const form = destinationGalleryForm(draft, destination);
  const data = JSON.parse(form.get("gallery"));
  assert.equal("order" in data, false, "ordinary edits permit concurrent additions");
  assert.deepEqual(data.addIds, [image.id]);
  assert.equal(form.get(`image:${image.id}`), image.file);
  const moved = moveDestinationPhoto(draft, image.id, "left");
  assert.deepEqual(manifest(moved, destination).order, moved.images.map((image) => image.id));
  assert.equal(destinationGalleryForm(removeDestinationPhoto(draft, image.id), destination), undefined, "removing an unsaved addition does not delete a stored photo");
  const primaryOnly = { ...initial, mainImageId: initial.images[0].id };
  assert.deepEqual(manifest(primaryOnly, destination), { addIds: [], removeIds: [], mainImageId: initial.images[0].id });
  assert.deepEqual(createDestinationGalleryDraft(), { images: [], removedIds: [], mainImageId: null });
});
