import sharp from "sharp";

import { formatMegabytes, IMAGE_UPLOAD_TYPES, MAX_IMAGE_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES } from "./image-limits.ts";
import type { PreparedImage } from "./types";

/** The formats sharp reports once it decodes each of IMAGE_UPLOAD_TYPES. */
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class ImageValidationError extends Error {}

/** Decode untrusted uploads and store only bounded, metadata-free WebP images, each with its thumbnail (TRA-89). */
export async function prepareImage(form?: FormData): Promise<PreparedImage | null | undefined> {
  if (form === undefined) return undefined;
  if (!(form instanceof FormData)) throw new ImageValidationError("Choose an image and try again.");
  const file = form.get("image");
  if (file === null) return form.get("removeImage") === "true" ? null : undefined;
  if (!(file instanceof File) || !IMAGE_UPLOAD_TYPES.includes(file.type)) {
    throw new ImageValidationError("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size === 0) throw new ImageValidationError("That image is empty. Choose another image.");
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new ImageValidationError(`Choose an image smaller than ${formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)}.`);

  try {
    const source = sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 20_000_000,
      failOn: "error",
      animated: true,
    });
    const metadata = await source.metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      throw new ImageValidationError("Choose a JPEG, PNG, or WebP image.");
    }
    if ((metadata.pages ?? 1) > 1) throw new ImageValidationError("Choose a still image instead of an animated image.");
    const image = await source.autoOrient()
      .resize({ width: 1600, height: 1200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    if (image.byteLength > MAX_STORED_IMAGE_BYTES) throw new ImageValidationError("That image is too detailed. Try a smaller image.");
    const data = new Uint8Array(image);
    return { data, thumbnail: await makeThumbnail(data) };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError("We couldn't read that image. Choose a JPEG, PNG, or WebP image up to 20 megapixels.");
  }
}

/**
 * A saved photo's thumbnail (TRA-89), which gallery thumbnails and editor previews show instead of the photo. It keeps
 * the whole photo, scaled down only as far as still covering 480 × 320, so it fills those frames without being enlarged
 * and they can still crop it around a destination photo's focal point.
 */
export async function makeThumbnail(photo: Uint8Array): Promise<Uint8Array> {
  const thumbnail = await sharp(photo).resize({ width: 480, height: 320, fit: "outside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  return new Uint8Array(thumbnail);
}
