import { currentAccount, signedOutResponse } from "@/auth";
import { getTripImage } from "@/lib/store";
import { storedImageResponse } from "@/lib/stored-image-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A trip's headline image (TRA-133), for the accounts that can open the trip. Anyone else, and any other version, finds nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  return storedImageResponse(request, (await params).id, (tripId) => getTripImage(account.id, tripId));
}
