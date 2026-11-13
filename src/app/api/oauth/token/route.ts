import { handleToken } from "@/lib/oauth-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The OAuth token endpoint for Claude and ChatGPT (TRA-115). Public: it needs a code the owner's consent produced, or a refresh token. */
export function POST(request: Request) {
  return handleToken(request);
}
