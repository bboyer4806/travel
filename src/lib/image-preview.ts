import { formatMegabytes, MAX_IMAGE_UPLOAD_BYTES } from "./image-limits.ts";
import { ImageValidationError, previewImage } from "./image-upload.ts";
import { sameOriginRequest } from "./same-origin.ts";

const json = (body: object, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * A photo editor's preview (TRA-179) of an image the browser can't show itself, such as a HEIC photo outside Safari, for
 * a signed-in account, which its route checks first. A request from a page of Travel's sends the image's file as its
 * body, and gets the photo Travel would save of it as WebP, or why saving it would be refused as `{ "error": "…" }`,
 * which the editor's save then says. Nothing is kept, by Travel or the browser's cache.
 */
export async function imagePreviewResponse(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) return json({ error: "Refresh the page and try again." }, 403);
  // Bound the bytes actually sent, not only the length the request claims.
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength;
      if (size > MAX_IMAGE_UPLOAD_BYTES) {
        await reader.cancel();
        return json({ error: `Choose an image smaller than ${formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)}.` }, 413);
      }
      chunks.push(read.value);
    }
  }
  let preview: Uint8Array;
  try {
    preview = await previewImage(new File(chunks, "image"));
  } catch (error) {
    if (error instanceof ImageValidationError) return json({ error: error.message }, 422);
    throw error;
  }
  return new Response(new Uint8Array(preview).buffer, { headers: { "Content-Type": "image/webp", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
