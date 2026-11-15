import { photoFocus } from "./photo-focus.ts";
import type { CandidateImage, PhotoFocus } from "./types";

/** A destination's, idea's or church's saved photos, which its photo editor starts from. Only a destination's photos have focal points (TRA-53). */
type SavedPhotos = { images: (CandidateImage & Partial<PhotoFocus>)[]; mainImageId: string | null };
/** A draft photo: a saved one with its version, or a new one with its file. A destination photo has its focal point once saved or adjusted. */
export type DraftImage = { id: string; version?: string; file?: File } & Partial<PhotoFocus>;
/** A photo editor's draft, shared by the destination, idea and church editors: its photos in order, saved photos it removes, and the primary or main photo. */
export type GalleryDraft = { images: DraftImage[]; removedIds: string[]; mainImageId: string | null };

export function createGalleryDraft(saved?: SavedPhotos): GalleryDraft {
  return { images: (saved?.images ?? []).map((image) => ({ ...image })), removedIds: [], mainImageId: saved?.mainImageId ?? null };
}

/** Puts a photo at `index`, as dropping it on the photo there does, keeping the others in order (TRA-126). */
export function placePhoto(draft: GalleryDraft, id: string, index: number): GalleryDraft {
  const from = draft.images.findIndex((image) => image.id === id);
  if (from < 0 || index < 0 || index >= draft.images.length || index === from) return draft;
  const images = draft.images.filter((image) => image.id !== id);
  images.splice(index, 0, draft.images[from]);
  return { ...draft, images };
}

/** Moves a photo one place, as a destination photo's Move left and Move right do. */
export function movePhoto(draft: GalleryDraft, id: string, direction: "left" | "right"): GalleryDraft {
  const index = draft.images.findIndex((image) => image.id === id);
  return index < 0 ? draft : placePhoto(draft, id, index + (direction === "left" ? -1 : 1));
}

export function removePhoto(draft: GalleryDraft, id: string): GalleryDraft {
  const image = draft.images.find((item) => item.id === id);
  if (!image) return draft;
  const images = draft.images.filter((item) => item.id !== id);
  return { images, removedIds: image.file ? draft.removedIds : [...draft.removedIds, id], mainImageId: draft.mainImageId === id ? images[0]?.id ?? null : draft.mainImageId };
}

/** Gives a photo a new focal point, as a destination photo's crop editor applies it (TRA-53). */
export function focusPhoto(draft: GalleryDraft, id: string, focus: PhotoFocus): GalleryDraft {
  return { ...draft, images: draft.images.map((image) => (image.id === id ? { ...image, ...focus } : image)) };
}

/** The focal points the draft changes: saved photos' that differ from their saved ones, and new photos' that aren't centered (TRA-53). */
function changedFocus(draft: GalleryDraft, saved?: SavedPhotos): ({ id: string } & PhotoFocus)[] {
  return draft.images.flatMap((image) => {
    const focus = photoFocus(image);
    const before = photoFocus(saved?.images.find((photo) => photo.id === image.id) ?? {});
    return focus.focusX === before.focusX && focus.focusY === before.focusY ? [] : [{ id: image.id, ...focus }];
  });
}

export function galleryChanged(draft: GalleryDraft, saved?: SavedPhotos): boolean {
  return draft.removedIds.length > 0 || draft.images.some((image) => image.file) || draft.mainImageId !== (saved?.mainImageId ?? null) || draft.images.map((image) => image.id).join(",") !== (saved?.images ?? []).map((image) => image.id).join(",") || changedFocus(draft, saved).length > 0;
}

/**
 * A save's photo changes, or undefined for none. It sends the order only when it isn't the saved order with new photos
 * last, and only the focal points it changes, so other changes keep photos and focal points someone else saves meanwhile.
 */
export function galleryForm(draft: GalleryDraft, saved?: SavedPhotos): FormData | undefined {
  if (!galleryChanged(draft, saved)) return undefined;
  const added = draft.images.filter((image) => image.file);
  const defaultOrder = [...(saved?.images ?? []).filter((image) => !draft.removedIds.includes(image.id)).map((image) => image.id), ...added.map((image) => image.id)];
  const order = draft.images.map((image) => image.id);
  const focus = changedFocus(draft, saved);
  const form = new FormData();
  form.set("gallery", JSON.stringify({ addIds: added.map((image) => image.id), removeIds: draft.removedIds, mainImageId: draft.mainImageId, ...(order.join(",") === defaultOrder.join(",") ? {} : { order }), ...(focus.length ? { focus } : {}) }));
  for (const image of added) if (image.file) form.set(`image:${image.id}`, image.file);
  return form;
}
