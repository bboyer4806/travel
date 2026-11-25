import { currentAccount, signedOutResponse } from "@/auth";
import { imagePreviewResponse } from "@/lib/image-preview";

export const runtime = "nodejs";

/** A signed-in account's preview of an image its browser can't show itself (TRA-179), as Travel would save it, saved nowhere. */
export async function POST(request: Request) {
  if (!(await currentAccount())) return signedOutResponse();
  return imagePreviewResponse(request);
}
