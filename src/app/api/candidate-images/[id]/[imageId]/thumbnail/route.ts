import { currentAccount, signedOutResponse } from "@/auth";
import { getCandidateThumbnail } from "@/lib/store";
import { storedThumbnailResponse } from "@/lib/stored-image-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A hotel, activity or restaurant photo's thumbnail (TRA-89), which its gallery's thumbnails and its editor's previews show. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  const { id, imageId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) return new Response(null, { status: 404 });
  return storedThumbnailResponse(request, id, (candidateId) => getCandidateThumbnail(account.id, candidateId, imageId));
}
