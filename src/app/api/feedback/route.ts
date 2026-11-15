import { currentAccount, signedOutResponse } from "@/auth";
import { createFeedbackHandler } from "@/lib/feedback-handler";

export const runtime = "nodejs";
const handleFeedback = createFeedbackHandler();
export async function POST(request: Request) {
  const account = await currentAccount();
  if (!account) return signedOutResponse();
  return handleFeedback(request, account.id);
}
