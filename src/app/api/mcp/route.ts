import { requestOrigin } from "@/auth";
import { handleMcp } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Travel's MCP endpoint for ChatGPT and Claude (TRA-115). Each request carries a connection's access token, not a session. */
export async function POST(request: Request) {
  return handleMcp(request, await requestOrigin());
}

/** Travel answers each request with one response, so it opens no event stream and keeps no MCP sessions to end. */
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
export const DELETE = GET;
