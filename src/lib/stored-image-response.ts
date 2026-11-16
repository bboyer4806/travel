import { makeThumbnail } from "./image-upload.ts";
import type { StoredImage, StoredThumbnail } from "./types";

/** Both destination and idea photos use versioned URLs and the same cache policy. Photos require sign-in, so only the browser may cache them. */
export function storedImageResponse(request: Request, id: string, readImage: (id: string) => StoredImage | undefined): Response {
  const found = lookup(request, id, readImage);
  return found instanceof Response ? found : imageResponse(found.image.data, found.headers);
}

/**
 * A photo's thumbnail (TRA-89), served as its photo is. A photo saved before Travel kept thumbnails has its thumbnail
 * made for each response, which browsers then keep as they keep the photo; nothing is saved.
 */
export async function storedThumbnailResponse(request: Request, id: string, readThumbnail: (id: string) => StoredThumbnail | undefined): Promise<Response> {
  const found = lookup(request, id, readThumbnail);
  if (found instanceof Response) return found;
  return imageResponse("data" in found.image ? found.image.data : await makeThumbnail(found.image.photo), found.headers);
}

/** The image an ID and version name, with its headers, or the empty response that serves instead: 404 for none, or 304 for the browser's copy. */
function lookup<Image extends { version: string }>(request: Request, id: string, read: (id: string) => Image | undefined): Response | { image: Image; headers: Record<string, string> } {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response(null, { status: 404 });
  }
  const image = read(id);
  const version = new URL(request.url).searchParams.get("v");
  if (!image || (version !== null && version !== image.version)) return new Response(null, { status: 404 });
  const headers = {
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": version ? "private, max-age=31536000, immutable" : "no-cache",
    ETag: `"${image.version}"`,
  };
  if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
  return { image, headers };
}

function imageResponse(data: Uint8Array, headers: Record<string, string>): Response {
  return new Response(new Uint8Array(data).buffer, {
    headers: { ...headers, "Content-Length": String(data.byteLength) },
  });
}
