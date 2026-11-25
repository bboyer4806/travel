import sharp, { type Sharp } from "sharp";

import { isBmp, readBmp } from "./bmp.ts";
import { decodeHeic } from "./heic.ts";
import { formatMegabytes, IMAGE_FORMAT_NAMES, LARGE_PHOTO_SIZE, MAX_IMAGE_PIXELS, MAX_IMAGE_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES, MAX_STORED_LARGE_IMAGE_BYTES, PHOTO_SIZE } from "./image-limits.ts";
import { pixelsTiff } from "./pixels.ts";
import type { PreparedImage } from "./types";

/**
 * The formats of IMAGE_FORMATS sharp reads, as it reports them (TRA-179), AVIF and HEIC both as HEIF. It decodes all
 * but HEIC's HEVC-coded pixels, which decodeHeic does, and BMP, which it can't read at all.
 */
const SHARP_FORMATS = new Set(["jpeg", "png", "webp", "gif", "tiff", "heif"]);
/** The brands animated AVIF and HEIC files are made with: ISOBMFF image sequences, which sharp decodes as one image or not at all. */
const SEQUENCE_BRANDS = new Set(["avis", "msf1", "hevc", "hevx", "hevm", "hevs"]);
const DECODING = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", animated: true } as const;

/** Why an upload is refused (TRA-179), as people are told. */
const NOT_AN_IMAGE = `Choose a ${IMAGE_FORMAT_NAMES} image.`;
const UNREADABLE = `We couldn't read that image. It may be damaged, or not a ${IMAGE_FORMAT_NAMES} image.`;
const NOT_STILL = "Choose a still image instead of an animated or multi-page image.";
const TOO_MANY_PIXELS = `That image is larger than ${MAX_IMAGE_PIXELS / 1_000_000} megapixels. Choose a smaller image.`;

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
  return decoded(file, async (oriented) => {
    const [photo, large] = await Promise.all([
      savedVersion(oriented.clone(), PHOTO_SIZE, MAX_STORED_IMAGE_BYTES),
      savedVersion(oriented.clone(), LARGE_PHOTO_SIZE, MAX_STORED_LARGE_IMAGE_BYTES),
    ]);
    return {
      data: photo.data,
      thumbnail: await makeThumbnail(photo.data),
      large: large.width > photo.width ? { data: large.data, widths: { photo: photo.width, large: large.width } } : null,
    };
  });
}

/**
 * A photo editor's preview of an image the browser can't show itself (TRA-179), such as a HEIC photo outside Safari:
 * the photo Travel would save of it, refused as saving it would be. Nothing is kept.
 */
export function previewImage(file: FormDataEntryValue): Promise<Uint8Array> {
  return decoded(file, async (oriented) => (await savedVersion(oriented, PHOTO_SIZE, MAX_STORED_IMAGE_BYTES)).data);
}

/**
 * Checks an upload's size, decodes what it holds, never going by its name or type, and gives the image, turned upright,
 * to `convert`. An image that fails to decode, there or in `convert`, is refused as unreadable.
 */
async function decoded<T>(file: FormDataEntryValue, convert: (oriented: Sharp) => Promise<T>): Promise<T> {
  if (!(file instanceof File)) throw new ImageValidationError(NOT_AN_IMAGE);
  if (file.size === 0) throw new ImageValidationError("That image is empty. Choose another image.");
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new ImageValidationError(`Choose an image smaller than ${formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)}.`);
  try {
    return await convert((await decode(Buffer.from(await file.arrayBuffer()))).autoOrient());
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError(UNREADABLE);
  }
}

/**
 * An upload's image, from what it holds (TRA-179): one sharp decodes, or a BMP or HEIC image decoded apart, which sharp
 * then takes with its colour profile and converts to sRGB, as it does any image with one. An image of another format,
 * an animated or multi-page one, or one of more than MAX_IMAGE_PIXELS pixels is refused before it is decoded.
 */
async function decode(bytes: Buffer): Promise<Sharp> {
  if (bytes.toString("latin1", 4, 8) === "ftyp" && SEQUENCE_BRANDS.has(bytes.toString("latin1", 8, 12))) throw new ImageValidationError(NOT_STILL);
  if (isBmp(bytes)) {
    const bitmap = readBmp(bytes);
    refuseLarge(bitmap.width, bitmap.height);
    return sharp(pixelsTiff(bitmap.pixels()), DECODING);
  }
  // Reading the header decodes no pixels, so any size may be read and refused with why.
  const { format, compression, pages = 1, width = 0, height = 0, icc } = await sharp(bytes, { ...DECODING, limitInputPixels: false }).metadata();
  if (!format || !SHARP_FORMATS.has(format)) throw new ImageValidationError(NOT_AN_IMAGE);
  if (pages > 1 || (format === "png" && pngFrames(bytes) > 1)) throw new ImageValidationError(NOT_STILL);
  refuseLarge(width, height);
  return sharp(format === "heif" && compression === "hevc" ? pixelsTiff(await decodeHeic(bytes), icc) : bytes, DECODING);
}

function refuseLarge(width: number, height: number) {
  if (width * height > MAX_IMAGE_PIXELS) throw new ImageValidationError(TOO_MANY_PIXELS);
}

/** The frames an animated PNG says it has before its image data (TRA-179), which sharp decodes as one image: 1 for a still PNG. */
function pngFrames(bytes: Buffer): number {
  for (let at = 8; at + 12 <= bytes.length; at += 12 + bytes.readUInt32BE(at)) {
    const type = bytes.toString("latin1", at + 4, at + 8);
    if (type === "IDAT") break;
    if (type === "acTL") return bytes.readUInt32BE(at + 8);
  }
  return 1;
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
