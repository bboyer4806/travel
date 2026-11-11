import sharp from "sharp";

import { formatMegabytes, IMAGE_UPLOAD_TYPES, MAX_IMAGE_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES } from "./image-limits.ts";

/** The formats sharp reports once it decodes each of IMAGE_UPLOAD_TYPES. */
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class ImageValidationError extends Error {}

/** Decode untrusted uploads and store only bounded, metadata-free WebP images. */
export async function prepareImage(form?: FormData): Promise<Uint8Array | null | undefined> {
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
    return new Uint8Array(image);
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError("We couldn't read that image. Choose a JPEG, PNG, or WebP image up to 20 megapixels.");
  }
}