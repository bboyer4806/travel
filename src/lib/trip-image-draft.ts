import type { PhotoCrop, TripImage, TripImageCrops } from "./types";

/**
 * The trip editor's headline image (TRA-133): the saved image of `version`, or a new one from its `file`, each with the
 * crops its card and banner previews show, or null for none.
 */
export type TripImageDraft = (TripImageCrops & ({ version: string } | { file: File })) | null;

/** The draft a trip editor opens with: the saved image with its crops, or none. */
export function createTripImageDraft(saved: TripImage | null): TripImageDraft {
  return saved && { version: saved.version, card: saved.card, banner: saved.banner };
}

function sameCrop(a: PhotoCrop, b: PhotoCrop): boolean {
  return a.focusX === b.focusX && a.focusY === b.focusY && a.zoom === b.zoom;
}

/** Whether saving the trip changes its headline image: a new image, none in place of the saved one, or new crops. */
export function tripImageChanged(draft: TripImageDraft, saved: TripImage | null): boolean {
  if (draft === null || saved === null) return draft !== saved;
  return "file" in draft || !sameCrop(draft.card, saved.card) || !sameCrop(draft.banner, saved.banner);
}

/**
 * A trip save's headline image change, as the form `prepareTripImage` reads, or undefined to keep the saved image and its
 * crops: a new file with its crops, the saved image's new crops naming its version, or the image's removal.
 */
export function tripImageForm(draft: TripImageDraft, saved: TripImage | null): FormData | undefined {
  if (!tripImageChanged(draft, saved)) return undefined;
  const form = new FormData();
  if (draft === null) {
    form.set("removeImage", "true");
    return form;
  }
  const crops = { card: draft.card, banner: draft.banner };
  if ("file" in draft) {
    form.set("image", draft.file);
    form.set("crops", JSON.stringify(crops));
  } else form.set("crops", JSON.stringify({ version: draft.version, ...crops }));
  return form;
}
