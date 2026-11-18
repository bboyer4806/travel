import { currentAccount, signedOutResponse } from "@/auth";
import { imageUrlResponse } from "@/lib/image-url";

export const runtime = "nodejs";

/** Add image by URL (TRA-139): the image at a web address, downloaded and checked for a signed-in account's photo editor. */
export async function POST(request: Request) {
  if (!(await currentAccount())) return signedOutResponse();
  return imageUrlResponse(request);
}
