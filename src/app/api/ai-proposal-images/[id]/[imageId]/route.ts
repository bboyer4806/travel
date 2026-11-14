import { currentAccount, signedOutResponse } from "@/auth";
import { getAiProposalPhoto } from "@/lib/store";
import { storedImageResponse } from "@/lib/stored-image-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A photo a pending ChatGPT or Claude proposal adds, changes or deletes, for the designated owner to see before deciding
 * it (TRA-122). Anyone else, and any other photo, finds nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  const { id, imageId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) return new Response(null, { status: 404 });
  return storedImageResponse(request, id, (proposalId) => getAiProposalPhoto(account.id, proposalId, imageId));
}
