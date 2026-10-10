import { getDestinationImage } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response(null, { status: 404 });
  }
  const image = getDestinationImage(id);
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