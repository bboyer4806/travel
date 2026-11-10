import { currentAccount, signedOutResponse } from "@/auth";
import { createFeedbackHandler } from "@/lib/feedback-handler";

export const runtime = "nodejs";
const handleFeedback = createFeedbackHandler();
export async function POST(request: Request) {
  if (!(await currentAccount())) return signedOutResponse();
  return handleFeedback(request);
}
