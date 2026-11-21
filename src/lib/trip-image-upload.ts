import { ImageValidationError, prepareImage } from "./image-upload.ts";
import type { TripImageUpdate } from "./types";

/**
 * A trip save's change to its headline image (TRA-133), from the trip editor's form: `image`, a new image file, with
 * `crops`, its card and banner crops as JSON; `crops` alone, naming the saved image's `version`, to crop it anew; or
 * `removeImage`. A new file is checked and prepared as every upload is before anything is saved, and the store checks
 * the crops, so a refused change saves nothing.
 */
export async function prepareTripImage(form?: FormData): Promise<TripImageUpdate | undefined> {
  if (form === undefined) return undefined;
  const invalid = new ImageValidationError("These headline image changes are invalid. Refresh and try again.");
  if (!(form instanceof FormData)) throw invalid;
  const keys = [...form.keys()];
  if (keys.some((key) => !["image", "removeImage", "crops"].includes(key)) || new Set(keys).size !== keys.length) throw invalid;
  if (form.has("removeImage")) {
    if (keys.length !== 1 || form.get("removeImage") !== "true") throw invalid;
    return null;
  }
  const raw = form.get("crops");
  if (typeof raw !== "string" || raw.length > 1024) throw invalid;
  let crops: unknown;
  try {
    crops = JSON.parse(raw);
  } catch {
    throw invalid;
  }
  if (!crops || typeof crops !== "object" || Array.isArray(crops)) throw invalid;
  // The store checks the crops, and that a recrop names the saved image, as it checks every save.
  if (!form.has("image")) return crops as TripImageUpdate;
  const image = await prepareImage(form);
  if (!image) throw invalid;
  // The image keeps its large version for the trip's banner on high-resolution screens (TRA-154), but no thumbnail.
  return { ...crops, data: image.data, large: image.large } as TripImageUpdate;
}
