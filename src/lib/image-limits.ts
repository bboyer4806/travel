/** Image rules shared by the photo editors, upload decoding and the store. Uploads are re-encoded as WebP before they are saved. */

/**
 * The image formats an upload may be (TRA-179), named as messages name them, with the extensions their files have and
 * the types browsers and web servers give them. Travel decides what an upload is from what it holds, never from its
 * name or type: these let photo editors offer such files, and take one whose browser gives it an unexpected type or
 * none, and let Add image by URL turn away an address whose server says it isn't one. Animated and multi-page images
 * are refused in every format.
 */
export const IMAGE_FORMATS: readonly { name: string; extensions: readonly string[]; types: readonly string[] }[] = [
  { name: "JPEG", extensions: [".jpg", ".jpeg", ".jfif", ".jpe"], types: ["image/jpeg"] },
  { name: "PNG", extensions: [".png"], types: ["image/png"] },
  { name: "WebP", extensions: [".webp"], types: ["image/webp"] },
  { name: "AVIF", extensions: [".avif"], types: ["image/avif"] },
  { name: "GIF", extensions: [".gif"], types: ["image/gif"] },
  { name: "TIFF", extensions: [".tif", ".tiff"], types: ["image/tiff"] },
  // nginx serves BMP files as image/x-ms-bmp.
  { name: "BMP", extensions: [".bmp"], types: ["image/bmp", "image/x-ms-bmp"] },
  { name: "HEIC", extensions: [".heic", ".heif"], types: ["image/heic", "image/heif"] },
];
/** Every type a browser or web server gives one of IMAGE_FORMATS. */
export const IMAGE_UPLOAD_TYPES: readonly string[] = IMAGE_FORMATS.flatMap((format) => format.types);
/** What a photo editor's file picker offers (TRA-179): every format, by type and by extension. */
export const IMAGE_UPLOAD_ACCEPT = IMAGE_FORMATS.flatMap((format) => [...format.types, ...format.extensions]).join(",");
const formatNames = IMAGE_FORMATS.map((format) => format.name);
/** The formats as messages list them: "JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, or HEIC". */
export const IMAGE_FORMAT_NAMES = `${formatNames.slice(0, -1).join(", ")}, or ${formatNames.at(-1)}`;

/**
 * Whether a photo editor takes a file as an image (TRA-179): by the type its browser gives it, or by its name's
 * extension, since browsers give some images, such as .jfif and .heic files, an unexpected type or none. Saving it
 * checks what it holds.
 */
export function isImageUploadFile(file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  return IMAGE_UPLOAD_TYPES.includes(file.type.toLowerCase()) || IMAGE_FORMATS.some((format) => format.extensions.some((extension) => name.endsWith(extension)));
}

/** Each file someone chooses. */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
/** The most pixels an upload may decode to, so a small file can't expand into more than Travel processes. */
export const MAX_IMAGE_PIXELS = 20_000_000;
/** Each saved image, once an upload is resized and re-encoded. */
export const MAX_STORED_IMAGE_BYTES = 2 * 1024 * 1024;
/**
 * Each photo's large version (TRA-154): the photo's limit for its up to 2.56 times the pixels, rounded down. The hardest
 * images to compress, pure noise, make about 3.3 MB at that size.
 */
export const MAX_STORED_LARGE_IMAGE_BYTES = 5 * 1024 * 1024;
/** The largest a saved photo is: uploads are scaled down to fit it, never up. */
export const PHOTO_SIZE = { width: 1600, height: 1200 } as const;
/**
 * The largest a photo's large version is (TRA-154), saved beside the photo when an upload is larger than the photo, for
 * frames wider than the photo on high-resolution screens, such as a trip's banner.
 */
export const LARGE_PHOTO_SIZE = { width: 2560, height: 1920 } as const;
/** Photos of one idea or church. */
export const MAX_CANDIDATE_IMAGES = 10;
/** Photos of one destination. */
export const MAX_DESTINATION_IMAGES = 10;
/** All new files in one gallery save, and all photos one ChatGPT or Claude proposal downloads (TRA-122). */
export const MAX_GALLERY_UPLOAD_BYTES = 15 * 1024 * 1024;
/** New photos in one ChatGPT or Claude proposal, which Travel downloads together while the assistant waits (TRA-122). */
export const MAX_AI_PROPOSAL_PHOTOS = 10;
/** How long the photos of one ChatGPT or Claude proposal may take to download, together (TRA-122). */
export const AI_PHOTO_DOWNLOAD_SECONDS = 15;
/** How long an image added by URL in a photo editor may take to download (TRA-139). */
export const IMAGE_URL_DOWNLOAD_SECONDS = 15;

/** A byte limit as messages state it, such as "5 MB". */
export function formatMegabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`;
}
