import { downloadAddress, downloadImage, fetchPublic, type PhotoFetch } from "./image-download.ts";
import { AI_PHOTO_DOWNLOAD_SECONDS, formatMegabytes, MAX_AI_PROPOSAL_PHOTOS, MAX_GALLERY_UPLOAD_BYTES } from "./image-limits.ts";
import { ImageValidationError, prepareImage } from "./image-upload.ts";
import type { AiPhotoToAdd } from "./types";

/**
 * Downloads the photos a ChatGPT or Claude proposal adds, all at once, and prepares each as an upload is (TRA-122),
 * returning them by their new IDs. When any can't be downloaded or used, the proposal is refused, naming its change and
 * address, and the other downloads stop: nothing is proposed with a photo Travel couldn't prepare. `fetch` and
 * `timeoutMs` change only for tests.
 */
export async function prepareAiPhotos(photos: AiPhotoToAdd[], fetch: PhotoFetch = fetchPublic, timeoutMs = AI_PHOTO_DOWNLOAD_SECONDS * 1000): Promise<Map<string, Uint8Array>> {
  if (photos.length > MAX_AI_PROPOSAL_PHOTOS) throw new ImageValidationError(`Propose up to ${MAX_AI_PROPOSAL_PHOTOS} new photos at a time, and the rest in another proposal.`);
  // Every address is checked before anything is downloaded.
  for (const photo of photos) {
    try {
      downloadAddress(photo.url);
    } catch (error) {
      throw named(photo, error);
    }
  }
  const deadline = AbortSignal.timeout(timeoutMs);
  const refused = new AbortController();
  const signal = AbortSignal.any([deadline, refused.signal]);
  let files: File[];
  try {
    files = await Promise.all(photos.map((photo) => downloadImage(photo.url, signal, fetch).catch((error: unknown) => {
      throw deadline.aborted ? refusal(photo, `The photo didn't download within ${timeoutMs / 1000} seconds.`) : named(photo, error);
    })));
  } finally {
    refused.abort();
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_GALLERY_UPLOAD_BYTES) {
    throw new ImageValidationError(`Propose up to ${formatMegabytes(MAX_GALLERY_UPLOAD_BYTES)} of new photos at a time, and the rest in another proposal.`);
  }
  const prepared = new Map<string, Uint8Array>();
  for (const [index, photo] of photos.entries()) {
    const form = new FormData();
    form.set("image", files[index]);
    try {
      prepared.set(photo.id, (await prepareImage(form))!);
    } catch (error) {
      throw named(photo, error);
    }
  }
  return prepared;
}

/** A refusal about one photo, naming its change and address. */
function refusal(photo: AiPhotoToAdd, reason: string): ImageValidationError {
  return new ImageValidationError(`Change ${photo.change}: ${photo.url}: ${reason}`);
}
/** A photo's refusal named for it; anything else, as it is. */
function named(photo: AiPhotoToAdd, error: unknown): unknown {
  return error instanceof ImageValidationError ? refusal(photo, error.message) : error;
}
