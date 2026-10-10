import sharp from "sharp";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_STORED_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class ImageValidationError extends Error {}

/** Decode untrusted uploads and store only bounded, metadata-free WebP images. */
export async function prepareDestinationImage(form?: FormData): Promise<Uint8Array | null | undefined> {
  if (form === undefined) return undefined;
  if (!(form instanceof FormData)) throw new ImageValidationError("Choose an image and try again.");
  const file = form.get("image");
  if (file === null) return form.get("removeImage") === "true" ? null : undefined;
  if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type)) {
    throw new ImageValidationError("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size === 0) throw new ImageValidationError("That image is empty. Choose another image.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ImageValidationError("Choose an image smaller than 5 MB.");

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
    if (image.byteLength > MAX_STORED_BYTES) throw new ImageValidationError("That image is too detailed. Try a smaller image.");
    return new Uint8Array(image);
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError("We couldn't read that image. Choose a JPEG, PNG, or WebP image up to 20 megapixels.");
  }
}