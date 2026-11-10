import { currentAccount, signedOutResponse } from "@/auth";
import { getCandidateImage } from "@/lib/store";
import { storedImageResponse } from "@/lib/stored-image-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  return storedImageResponse(request, (await params).id, (id) => getCandidateImage(account.id, id));
}