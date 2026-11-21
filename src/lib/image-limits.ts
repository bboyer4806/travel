/** Image rules shared by the photo editors, upload decoding and the store. Uploads are re-encoded as WebP before they are saved. */
export const IMAGE_UPLOAD_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
/** Each file someone chooses. */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
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
