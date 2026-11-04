import { prepareCandidateGallery } from "./candidate-gallery-upload.ts";
import { ImageValidationError } from "./image-upload.ts";
import { MAX_DESTINATION_IMAGES } from "./image-limits.ts";
import type { DestinationGalleryUpdate } from "./types";

/** Destination ordering is validated separately; all uploads share the same decoding limits. */
export async function prepareDestinationGallery(form?: FormData): Promise<DestinationGalleryUpdate | undefined> {
  let order: string[] | undefined;
  if (form instanceof FormData && form.has("gallery")) {
    const raw = form.get("gallery");
    if (typeof raw === "string" && raw.length <= 8192) {
      let manifest: unknown;
      try { manifest = JSON.parse(raw); } catch { /* The shared upload validator supplies the error. */ }
      if (manifest && typeof manifest === "object" && "order" in manifest) {
        const value = manifest.order;
        if (!Array.isArray(value) || value.length > MAX_DESTINATION_IMAGES || value.some((id) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) || new Set(value.map((id: string) => id.toLowerCase())).size !== value.length) {
          throw new ImageValidationError("These photo positions are invalid. Refresh and try again.");
        }
        order = value;
      }
    }
  }
  const gallery = await prepareCandidateGallery(form);
  return gallery ? { ...gallery, ...(order === undefined ? {} : { order }) } : undefined;
}
