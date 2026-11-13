import { handleRegistration } from "@/lib/oauth-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth dynamic client registration for Claude and ChatGPT (TRA-115). Public: registering grants nothing. */
export function POST(request: Request) {
  return handleRegistration(request);
}
