import { requestOrigin } from "@/auth";
import { protectedResourceMetadata } from "@/lib/ai-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The same metadata at the path RFC 9728 gives it for the MCP endpoint, /api/mcp, which its WWW-Authenticate challenge names. */
export async function GET() {
  return Response.json(protectedResourceMetadata(await requestOrigin()));
}
