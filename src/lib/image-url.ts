import { downloadImage, fetchPublic, type PhotoFetch, type WebProtocols } from "./image-download.ts";
import { IMAGE_URL_DOWNLOAD_SECONDS } from "./image-limits.ts";
import { ImageValidationError, prepareImage } from "./image-upload.ts";
import { sameOriginRequest } from "./same-origin.ts";

/** Add image by URL takes http:// and https:// addresses (TRA-139). */
const WEB: WebProtocols = ["http:", "https:"];
/** The longest address Add image by URL takes, which leaves room for the long query strings image hosts sign. */
export const MAX_IMAGE_URL_LENGTH = 4096;

/**
 * The image at the address someone gives Add image by URL (TRA-139), downloaded only from a public internet address, as
 * ChatGPT's and Claude's photos are, and checked as an upload is, so a photo editor previews only an image its save
 * accepts. It comes back as its server sent it: the editor adds it as it adds a file chosen from the device, and saving
 * prepares it then, as it prepares every upload. `fetch` and `timeoutMs` change only for tests.
 */
export async function downloadImageByUrl(address: string, fetch: PhotoFetch = fetchPublic, timeoutMs = IMAGE_URL_DOWNLOAD_SECONDS * 1000): Promise<File> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const file = await downloadImage(address, WEB, deadline, fetch).catch((error: unknown) => {
    throw deadline.aborted ? new ImageValidationError(`The photo didn't download within ${timeoutMs / 1000} seconds.`) : error;
  });
  const form = new FormData();
  form.set("image", file);
  await prepareImage(form);
  return file;
}

const json = (body: object, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Add image by URL's answer (TRA-139) to a signed-in account, which its route checks first. A request from a page of
 * Travel's naming the address as JSON, `{ "url": "…" }`, gets the image as its server sent it, with its type, or why it
 * can't be added as `{ "error": "…" }`, which the editor shows as written.
 */
export async function imageUrlResponse(request: Request, download: (address: string) => Promise<File> = downloadImageByUrl): Promise<Response> {
  if (!sameOriginRequest(request)) return json({ error: "Refresh the page and try again." }, 403);
  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return json({ error: "Enter the image's web address and try again." }, 400);
  }
  if (typeof url !== "string" || !url.trim()) return json({ error: "Enter the image's web address." }, 400);
  if (url.length > MAX_IMAGE_URL_LENGTH) return json({ error: `Enter a web address of up to ${MAX_IMAGE_URL_LENGTH.toLocaleString("en-US")} characters.` }, 400);
  let file: File;
  try {
    file = await download(url.trim());
  } catch (error) {
    if (error instanceof ImageValidationError) return json({ error: error.message }, 422);
    throw error;
  }
  return new Response(file, { headers: { "Content-Type": file.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
