import { requestOrigin } from "@/auth";
import { protectedResourceMetadata } from "@/lib/ai-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Protected resource metadata (RFC 9728) for Travel's MCP endpoint (TRA-115). Public, as OAuth needs it. */
export async function GET() {
  return Response.json(protectedResourceMetadata(await requestOrigin()));
}
