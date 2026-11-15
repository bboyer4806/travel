import { ImageValidationError, prepareImage } from "./image-upload.ts";
import { formatMegabytes, MAX_CANDIDATE_IMAGES, MAX_GALLERY_UPLOAD_BYTES } from "./image-limits.ts";
import type { GalleryUpdate } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(value: unknown, maxImages: number): string[] {
  if (!Array.isArray(value) || value.length > maxImages || value.some((id) => typeof id !== "string" || !UUID.test(id))) {
    throw new ImageValidationError("These photo changes are invalid. Refresh and try again.");
  }
  if (new Set(value.map((id: string) => id.toLowerCase())).size !== value.length) {
    throw new ImageValidationError("Each photo must have a different identifier. Refresh and try again.");
  }
  return value;
}

/** A rearranged gallery's order: each photo it keeps and adds, by ID, once (TRA-126). */
function photoOrder(value: unknown, maxImages: number): string[] {
  if (!Array.isArray(value) || value.length > maxImages || value.some((id) => typeof id !== "string" || !UUID.test(id)) || new Set(value.map((id: string) => id.toLowerCase())).size !== value.length) {
    throw new ImageValidationError("These photo positions are invalid. Refresh and try again.");
  }
  return value;
}

/** Destination photos' new focal points (TRA-53): each photo once, by ID, as percentages from 0 to 100. The store refuses them for ideas and churches. */
function focalPoints(value: unknown, maxImages: number): NonNullable<GalleryUpdate["focus"]> {
  const invalid = new ImageValidationError("These crop adjustments are invalid. Refresh and try again.");
  if (!Array.isArray(value) || value.length > maxImages) throw invalid;
  const percent = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 100;
  if (value.some((entry) => !entry || typeof entry !== "object" || typeof entry.id !== "string" || !UUID.test(entry.id) || !percent(entry.focusX) || !percent(entry.focusY))) throw invalid;
  if (new Set(value.map((entry) => entry.id.toLowerCase())).size !== value.length) throw invalid;
  return value.map(({ id, focusX, focusY }) => ({ id, focusX, focusY }));
}

/**
 * A gallery save's photo changes, for a destination, idea or church, with at most `maxImages` photos. Validate the
 * complete batch before decoding; persistence happens only after every file succeeds.
 */
export async function prepareCandidateGallery(form?: FormData, maxImages = MAX_CANDIDATE_IMAGES): Promise<GalleryUpdate | undefined> {
  if (form === undefined) return undefined;
  if (!(form instanceof FormData)) throw new ImageValidationError("Choose your photos and try again.");
  if (!form.has("gallery")) return undefined;
  const raw = form.get("gallery");
  if (form.getAll("gallery").length !== 1 || typeof raw !== "string" || raw.length > 8192 || form.has("image") || form.has("removeImage")) {
    throw new ImageValidationError("These photo changes are invalid. Refresh and try again.");
  }
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    manifest = parsed as Record<string, unknown>;
  } catch {
    throw new ImageValidationError("These photo changes are invalid. Refresh and try again.");
  }
  const addIds = ids(manifest.addIds, maxImages);
  const remove = ids(manifest.removeIds, maxImages);
  const removedIds = new Set(remove.map((id) => id.toLowerCase()));
  if (addIds.some((id) => removedIds.has(id.toLowerCase()))) throw new ImageValidationError("A photo cannot be added and removed at the same time.");
  const main = manifest.mainImageId;
  if (main !== undefined && main !== null && (typeof main !== "string" || !UUID.test(main))) {
    throw new ImageValidationError("Choose a valid main photo.");
  }
  const order = manifest.order === undefined ? undefined : photoOrder(manifest.order, maxImages);
  const focus = manifest.focus === undefined ? undefined : focalPoints(manifest.focus, maxImages);
  const expectedFields = new Set(addIds.map((id) => "image:" + id));
  for (const key of form.keys()) {
    if (key.startsWith("image:") && !expectedFields.has(key)) throw new ImageValidationError("An uploaded photo was not included in your changes. Try again.");
  }
  const files = addIds.map((id) => {
    const values = form.getAll("image:" + id);
    if (values.length !== 1 || !(values[0] instanceof File)) throw new ImageValidationError("One of your photos is missing. Select it again.");
    return { id, file: values[0] };
  });
  if (files.reduce((total, { file }) => total + file.size, 0) > MAX_GALLERY_UPLOAD_BYTES) {
    throw new ImageValidationError(`Add up to ${formatMegabytes(MAX_GALLERY_UPLOAD_BYTES)} of new photos at a time. Save these photos before adding more.`);
  }
  const add: GalleryUpdate["add"] = [];
  for (const { id, file } of files) {
    const single = new FormData();
    single.set("image", file);
    const data = await prepareImage(single);
    if (!data) throw new ImageValidationError("One of your photos could not be read. Select it again.");
    add.push({ id, data });
  }
  return { add, remove, ...(main !== undefined ? { mainImageId: main } : {}), ...(order === undefined ? {} : { order }), ...(focus === undefined ? {} : { focus }) };
}