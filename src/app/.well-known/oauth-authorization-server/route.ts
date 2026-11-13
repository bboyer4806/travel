import { requestOrigin } from "@/auth";
import { authorizationServerMetadata } from "@/lib/ai-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth authorization server metadata (RFC 8414), for Claude and ChatGPT to connect (TRA-115). Public, as OAuth needs it. */
export async function GET() {
  return Response.json(authorizationServerMetadata(await requestOrigin()));
}
