import { currentAccount, signedOutResponse } from "@/auth";
import { getTripLargeImage } from "@/lib/store";
import { storedImageResponse } from "@/lib/stored-image-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A trip's headline image's large version (TRA-154), which its banner loads on high-resolution screens, served as the image is. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  return storedImageResponse(request, (await params).id, (tripId) => getTripLargeImage(account.id, tripId));
}
