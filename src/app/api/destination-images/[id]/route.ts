import { currentAccount, signedOutResponse } from "@/auth";
import { getDestinationImage } from "@/lib/store";
import { storedImageResponse } from "@/lib/stored-image-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  return storedImageResponse(request, (await params).id, (id) => getDestinationImage(account.id, id));
}