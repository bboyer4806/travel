import type { Destination } from "./types";

export type DestinationGalleryOwner = Pick<Destination, "id" | "city" | "cityFromSuggestion" | "images" | "mainImageId">;
export type DestinationDraftImage = { id: string; version?: string; file?: File };
export type DestinationGalleryDraft = { images: DestinationDraftImage[]; removedIds: string[]; mainImageId: string | null };

export function createDestinationGalleryDraft(destination?: DestinationGalleryOwner): DestinationGalleryDraft {
  return { images: (destination?.images ?? []).map((image) => ({ ...image })), removedIds: [], mainImageId: destination?.mainImageId ?? null };
}

export function moveDestinationPhoto(draft: DestinationGalleryDraft, id: string, direction: "left" | "right"): DestinationGalleryDraft {
  const index = draft.images.findIndex((image) => image.id === id);
  const target = index + (direction === "left" ? -1 : 1);
  if (index < 0 || target < 0 || target >= draft.images.length) return draft;
  const images = [...draft.images];
  [images[index], images[target]] = [images[target], images[index]];
  return { ...draft, images };
}

export function removeDestinationPhoto(draft: DestinationGalleryDraft, id: string): DestinationGalleryDraft {
  const image = draft.images.find((item) => item.id === id);
  if (!image) return draft;
  const images = draft.images.filter((item) => item.id !== id);
  return { images, removedIds: image.file ? draft.removedIds : [...draft.removedIds, id], mainImageId: draft.mainImageId === id ? images[0]?.id ?? null : draft.mainImageId };
}

export function destinationGalleryChanged(draft: DestinationGalleryDraft, destination?: DestinationGalleryOwner): boolean {
  return draft.removedIds.length > 0 || draft.images.some((image) => image.file) || draft.mainImageId !== (destination?.mainImageId ?? null) || draft.images.map((image) => image.id).join(",") !== (destination?.images ?? []).map((image) => image.id).join(",");
}

export function destinationGalleryForm(draft: DestinationGalleryDraft, destination?: DestinationGalleryOwner): FormData | undefined {
  if (!destinationGalleryChanged(draft, destination)) return undefined;
  const added = draft.images.filter((image) => image.file);
  const defaultOrder = [...(destination?.images ?? []).filter((image) => !draft.removedIds.includes(image.id)).map((image) => image.id), ...added.map((image) => image.id)];
  const order = draft.images.map((image) => image.id);
  const form = new FormData();
  form.set("gallery", JSON.stringify({ addIds: added.map((image) => image.id), removeIds: draft.removedIds, mainImageId: draft.mainImageId, ...(order.join(",") === defaultOrder.join(",") ? {} : { order }) }));
  for (const image of added) if (image.file) form.set(`image:${image.id}`, image.file);
  return form;
}
