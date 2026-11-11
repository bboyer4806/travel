/** Image rules shared by the photo editors, upload decoding and the store. Uploads are re-encoded as WebP before they are saved. */
export const IMAGE_UPLOAD_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
/** Each file someone chooses. */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Each saved image, once an upload is resized and re-encoded. */
export const MAX_STORED_IMAGE_BYTES = 2 * 1024 * 1024;
/** Photos of one idea or church. */
export const MAX_CANDIDATE_IMAGES = 10;
/** Photos of one destination. */
export const MAX_DESTINATION_IMAGES = 10;
/** All new files in one gallery save. */
export const MAX_GALLERY_UPLOAD_BYTES = 15 * 1024 * 1024;

/** A byte limit as messages state it, such as "5 MB". */
export function formatMegabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`;
}
