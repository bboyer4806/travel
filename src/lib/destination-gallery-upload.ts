import { prepareCandidateGallery } from "./candidate-gallery-upload.ts";
import { MAX_DESTINATION_IMAGES } from "./image-limits.ts";
import type { GalleryUpdate } from "./types";

/** A destination's photo changes, checked as an idea's or church's are, with the destination photo limit. */
export function prepareDestinationGallery(form?: FormData): Promise<GalleryUpdate | undefined> {
  return prepareCandidateGallery(form, MAX_DESTINATION_IMAGES);
}
