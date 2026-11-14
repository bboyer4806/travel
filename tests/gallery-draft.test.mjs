import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createGalleryDraft, galleryChanged, galleryForm, movePhoto, placePhoto, removePhoto } from "../src/lib/gallery-draft.ts";

function savedDestination() {
  const images = Array.from({ length: 3 }, () => ({ id: randomUUID(), version: randomUUID() }));
  return { id: randomUUID(), city: "Paris", images, mainImageId: images[1].id };
}
function manifest(draft, destination) {
  return JSON.parse(galleryForm(draft, destination).get("gallery"));
}

test("destination gallery drafts can move photos without changing primary choice or saved state", () => {
  const destination = savedDestination();
  const draft = createGalleryDraft(destination);
  assert.equal(galleryChanged(draft, destination), false);
  assert.equal(galleryForm(draft, destination), undefined);
  const moved = movePhoto(draft, draft.images[2].id, "left");
  assert.deepEqual(moved.images.map((image) => image.id), [destination.images[0].id, destination.images[2].id, destination.images[1].id]);
  assert.equal(moved.mainImageId, destination.mainImageId);
  assert.deepEqual(draft.images, destination.images);
  assert.deepEqual(manifest(moved, destination).order, moved.images.map((image) => image.id));
  const restored = movePhoto(moved, moved.images[1].id, "right");
  assert.equal(galleryForm(restored, destination), undefined);
  assert.equal(movePhoto(draft, draft.images[0].id, "left"), draft);
  assert.equal(movePhoto(draft, draft.images[2].id, "right"), draft);
  assert.equal(movePhoto(draft, randomUUID(), "left"), draft);
});

test("removing the primary draft photo chooses the first remaining photo in draft order", () => {
  const destination = savedDestination();
  const draft = movePhoto(createGalleryDraft(destination), destination.images[0].id, "right");
  const removed = removePhoto(draft, destination.mainImageId);
  assert.equal(removed.mainImageId, removed.images[0].id);
  assert.deepEqual(removed.removedIds, [destination.mainImageId]);
  assert.deepEqual(manifest(removed, destination).removeIds, [destination.mainImageId]);
  const empty = removed.images.reduce((value, image) => removePhoto(value, image.id), removed);
  assert.equal(empty.mainImageId, null);
  assert.equal(empty.images.length, 0);
  assert.equal(removePhoto(empty, randomUUID()), empty);
});

test("new destination photos serialize files and only send ordering when the default order changes", () => {
  const destination = savedDestination();
  const image = { id: randomUUID(), file: new File(["fake upload bytes"], "photo.png", { type: "image/png" }) };
  const initial = createGalleryDraft(destination);
  const draft = { ...initial, images: [...initial.images, image] };
  const form = galleryForm(draft, destination);
  const data = JSON.parse(form.get("gallery"));
  assert.equal("order" in data, false, "ordinary edits permit concurrent additions");
  assert.deepEqual(data.addIds, [image.id]);
  assert.equal(form.get(`image:${image.id}`), image.file);
  const moved = movePhoto(draft, image.id, "left");
  assert.deepEqual(manifest(moved, destination).order, moved.images.map((image) => image.id));
  assert.equal(galleryForm(removePhoto(draft, image.id), destination), undefined, "removing an unsaved addition does not delete a stored photo");
  const primaryOnly = { ...initial, mainImageId: initial.images[0].id };
  assert.deepEqual(manifest(primaryOnly, destination), { addIds: [], removeIds: [], mainImageId: initial.images[0].id });
  assert.deepEqual(createGalleryDraft(), { images: [], removedIds: [], mainImageId: null });
});

/** The IDs of a draft's photos, in order. */
const order = (draft) => draft.images.map((image) => image.id);
const newPhoto = (name) => ({ id: randomUUID(), file: new File([name], name, { type: "image/png" }) });

test("dropping a photo on another puts it in that photo's place and keeps the primary photo (TRA-126)", () => {
  const destination = savedDestination();
  const [a, b, c] = destination.images.map((image) => image.id);
  const draft = createGalleryDraft(destination);
  assert.deepEqual(order(placePhoto(draft, a, 2)), [b, c, a], "the first photo dropped on the last goes after it");
  assert.deepEqual(order(placePhoto(draft, c, 0)), [c, a, b], "the last photo dropped on the first goes before it");
  assert.deepEqual(order(placePhoto(draft, b, 0)), [b, a, c]);
  assert.deepEqual(order(placePhoto(draft, b, 2)), [a, c, b]);
  for (const index of [0, 2]) assert.equal(placePhoto(draft, a, index).mainImageId, destination.mainImageId, "the primary photo stays the same photo");
  assert.deepEqual(placePhoto(draft, c, 0).removedIds, []);
  assert.deepEqual(draft.images, destination.images, "the draft it started from is unchanged");
  // A photo dropped on itself, outside the gallery or no longer in it changes nothing.
  for (const [id, index] of [[a, 0], [b, 1], [a, -1], [a, 3], [randomUUID(), 0]]) assert.equal(placePhoto(draft, id, index), draft);
  // Move left and Move right are one place either way.
  assert.deepEqual(movePhoto(draft, b, "left"), placePhoto(draft, b, 0));
  assert.deepEqual(movePhoto(draft, b, "right"), placePhoto(draft, b, 2));
});

test("an idea's or church's rearranged photos are sent in their new order, and Undo restores the saved order (TRA-126)", () => {
  const images = Array.from({ length: 3 }, () => ({ id: randomUUID(), version: randomUUID() }));
  const idea = { id: randomUUID(), name: "Hotel Sacher", images, mainImageId: images[0].id };
  const [a, b, c] = images.map((image) => image.id);
  const dragged = placePhoto(createGalleryDraft(idea), a, 2);
  assert.equal(galleryChanged(dragged, idea), true, "rearranging is a photo change, which Undo photo changes undoes");
  assert.deepEqual(manifest(dragged, idea), { addIds: [], removeIds: [], mainImageId: a, order: [b, c, a] });
  const undone = createGalleryDraft(idea);
  assert.deepEqual(order(undone), [a, b, c]);
  assert.equal(galleryChanged(undone, idea), false);
  assert.equal(galleryForm(undone, idea), undefined, "after Undo, saving changes no photo");
  assert.equal(galleryForm(placePhoto(dragged, a, 0), idea), undefined, "dragging photos back into the saved order changes nothing");
});

test("new photos dragged among saved ones are sent in that order, and new photos alone in the order they're added (TRA-126)", () => {
  const destination = savedDestination();
  const [a, b, c] = destination.images.map((image) => image.id);
  const [first, second] = [newPhoto("first.png"), newPhoto("second.png")];
  const added = { ...createGalleryDraft(destination), images: [...createGalleryDraft(destination).images, first, second] };
  const mixed = placePhoto(added, second.id, 0);
  const form = galleryForm(mixed, destination);
  assert.deepEqual(JSON.parse(form.get("gallery")), { addIds: [second.id, first.id], removeIds: [], mainImageId: destination.mainImageId, order: [second.id, a, b, c, first.id] });
  assert.equal(form.get(`image:${first.id}`), first.file);
  assert.equal(form.get(`image:${second.id}`), second.file);
  // New photos rearranged after the saved ones are added in their order, so no order is needed.
  assert.deepEqual(manifest(placePhoto(added, second.id, 3), destination), { addIds: [second.id, first.id], removeIds: [], mainImageId: destination.mainImageId });
  // So are the photos of an idea or church being added.
  const unsaved = { images: [first, second], removedIds: [], mainImageId: first.id };
  assert.deepEqual(manifest(placePhoto(unsaved, second.id, 0)), { addIds: [second.id, first.id], removeIds: [], mainImageId: first.id });
});
