import type { StoredImage } from "./types";

type ImageReader = (id: string) => StoredImage | undefined;

/** Both destination and idea photos use versioned URLs and the same cache policy. */
export function storedImageResponse(request: Request, id: string, readImage: ImageReader): Response {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response(null, { status: 404 });
  }
  const image = readImage(id);
  const version = new URL(request.url).searchParams.get("v");
  if (!image || (version !== null && version !== image.version)) return new Response(null, { status: 404 });
  const headers = {
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": version ? "public, max-age=31536000, immutable" : "no-cache",
    ETag: `"${image.version}"`,
  };
  if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(image.data).buffer, {
    headers: { ...headers, "Content-Length": String(image.data.byteLength) },
  });
}