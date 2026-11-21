import sharp, { type Sharp } from "sharp";

import { formatMegabytes, IMAGE_UPLOAD_TYPES, LARGE_PHOTO_SIZE, MAX_IMAGE_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES, MAX_STORED_LARGE_IMAGE_BYTES, PHOTO_SIZE } from "./image-limits.ts";
import type { PreparedImage } from "./types";

/** The formats sharp reports once it decodes each of IMAGE_UPLOAD_TYPES. */
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class ImageValidationError extends Error {}

/**
 * Decode untrusted uploads and store only bounded, metadata-free WebP images, each with its thumbnail (TRA-89), and with
 * its large version when the upload is larger than the photo (TRA-154).
 */
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
    const oriented = source.autoOrient();
    const [photo, large] = await Promise.all([
      savedVersion(oriented.clone(), PHOTO_SIZE, MAX_STORED_IMAGE_BYTES),
      savedVersion(oriented.clone(), LARGE_PHOTO_SIZE, MAX_STORED_LARGE_IMAGE_BYTES),
    ]);
    return {
      data: photo.data,
      thumbnail: await makeThumbnail(photo.data),
      large: large.width > photo.width ? { data: large.data, widths: { photo: photo.width, large: large.width } } : null,
    };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError("We couldn't read that image. Choose a JPEG, PNG, or WebP image up to 20 megapixels.");
  }
}

/** One version Travel saves of an upload: WebP, scaled down only as far as fitting `size`, with its width in pixels. */
async function savedVersion(image: Sharp, size: { width: number; height: number }, maxBytes: number): Promise<{ data: Uint8Array; width: number }> {
  const { data, info } = await image.resize({ ...size, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  if (data.byteLength > maxBytes) throw new ImageValidationError("That image is too detailed. Try a smaller image.");
  return { data: new Uint8Array(data), width: info.width };
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
