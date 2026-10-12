import { getCandidatePhoto } from "@/lib/store";
import { storedImageResponse } from "@/lib/stored-image-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const { id, imageId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) return new Response(null, { status: 404 });
  return storedImageResponse(request, id, (candidateId) => getCandidatePhoto(candidateId, imageId));
}