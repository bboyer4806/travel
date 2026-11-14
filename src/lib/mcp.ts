import { bearerChallenge } from "./ai-auth.ts";
import { prepareAiPhotos } from "./ai-photos.ts";
import { ImageValidationError } from "./image-upload.ts";
import { TOOLS } from "./mcp-tools.ts";
import { aiAccounts, aiDestination, aiDestinations, aiPhoto, aiTrip, aiTrips, checkAiProposal, getAiProposal, isValidationError, proposeAiChanges, readAiConnection } from "./store.ts";
import type { AiProposal } from "./types";

/**
 * Travel's MCP endpoint for ChatGPT and Claude (TRA-115): the Streamable HTTP transport, answering each JSON-RPC
 * request with one JSON response, without sessions or server-sent events. Every request needs the access token of a
 * connection the designated owner allowed; without one, the WWW-Authenticate challenge tells the assistant where to
 * get one. The tools read Travel and propose changes, which only the owner can approve.
 */

/** The MCP versions Travel speaks, newest first. A client asking for another is offered the newest. */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const INSTRUCTIONS = "Travel is a shared trip planner: trips with ordered stays at destinations, travel between them, hotel, activity and restaurant ideas, churches, research, At home items and estimated budgets. Every trip and destination can be read, whoever owns it. To change anything, call propose_changes: nothing changes until Travel's owner approves the proposal on Travel's own page, so give them its approve_at link, then check what they decided with get_change_proposal. Amounts are read as whole USD cents for the whole party and written as dollar text, such as \"125.50\". Photos are added from the https:// addresses of image files, which Travel downloads when they are proposed.";
const NO_STORE = { "Cache-Control": "no-store" };

type Connection = NonNullable<ReturnType<typeof readAiConnection>>;
type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: true };

export async function handleMcp(request: Request, origin: string): Promise<Response> {
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const connection = token === undefined ? undefined : readAiConnection(token);
  if (!connection) {
    return Response.json({ error: "invalid_token", error_description: "Connect to Travel to use it." }, { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": bearerChallenge(origin, token !== undefined) } });
  }
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !PROTOCOL_VERSIONS.includes(version)) return rpcError(null, -32600, `Travel doesn't speak MCP version ${version}.`, 400);
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return rpcError(null, -32700, "The request isn't JSON.", 400);
  }
  if (!message || typeof message !== "object" || Array.isArray(message) || (message as Record<string, unknown>).jsonrpc !== "2.0") return rpcError(null, -32600, "Send one JSON-RPC 2.0 message.", 400);
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
  // Notifications, and responses to requests Travel never makes, need no answer.
  if (id === undefined || typeof method !== "string") return new Response(null, { status: 202 });
  if (typeof id !== "string" && typeof id !== "number") return rpcError(null, -32600, "A request's id must be a string or a number.", 400);
  const args = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
  try {
    switch (method) {
      case "initialize": {
        const requested = args.protocolVersion;
        return rpcResult(id, {
          protocolVersion: typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "travel", title: "Travel", version: "1.0.0" },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping": return rpcResult(id, {});
      case "tools/list": return rpcResult(id, { tools: TOOLS });
      case "tools/call": {
        const result = await callTool(connection, args, origin);
        return result ? rpcResult(id, result) : rpcError(id, -32602, `Travel has no tool ${String(args.name)}.`);
      }
      default: return rpcError(id, -32601, `Travel has no method ${method}.`);
    }
  } catch (error) {
    // The cause is logged, never sent: it may name the database, never a credential.
    console.error("Unable to answer an MCP request", error);
    return rpcError(id, -32603, "Travel couldn't complete this request. Please try again.");
  }
}

/** A tool's result, refusals included, or undefined for a tool Travel doesn't have. */
async function callTool(connection: Connection, params: Record<string, unknown>, origin: string): Promise<ToolResult | undefined> {
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
  const text = (name: string) => typeof args[name] === "string" ? args[name] : "";
  try {
    switch (params.name) {
      case "list_trips": return json({ trips: aiTrips() });
      case "get_trip": return found(aiTrip(text("trip_id")), "Travel has no trip with this id.");
      case "list_destinations": return json({ destinations: aiDestinations() });
      case "get_destination": return found(aiDestination(text("destination_id")), "Travel has no destination with this id.");
      case "list_accounts": return json({ accounts: aiAccounts() });
      case "get_photo": {
        const of = text("of");
        if (of !== "destination" && of !== "idea" && of !== "church") return refusal("Choose a photo of a destination, idea or church.");
        const photo = aiPhoto(of, text("id"), text("photo_id"));
        return photo ? { content: [{ type: "image", data: Buffer.from(photo.data).toString("base64"), mimeType: "image/webp" }] } : refusal(`Travel has no such photo of this ${of}.`);
      }
      case "propose_changes": {
        // The photos the changes add are downloaded and prepared first (TRA-122), once the rest of the proposal checks out.
        const photos = await prepareAiPhotos(checkAiProposal(args));
        // The reply shows what each change adds, changes or deletes, as the owner will see it.
        const proposal = proposeAiChanges(connection.id, args, photos);
        return json({ ...decision(proposal, origin), changes: proposal.preview });
      }
      case "get_change_proposal": {
        const proposal = getAiProposal(connection.accountId, text("proposal_id"));
        return proposal ? json(decision(proposal, origin)) : refusal("Travel has no proposal with this id.");
      }
      default: return undefined;
    }
  } catch (error) {
    if (isValidationError(error) || error instanceof ImageValidationError) return refusal(error.message);
    throw error;
  }
}

/** What has become of a proposal, and where its owner decides it. */
function decision(proposal: AiProposal, origin: string) {
  return {
    proposal_id: proposal.id, summary: proposal.summary, status: proposal.status, approve_at: `${origin}/ai/proposals/${proposal.id}`,
    created_at: new Date(proposal.createdAt).toISOString(), expires_at: new Date(proposal.expiresAt).toISOString(),
    decided_at: proposal.decidedAt === null ? null : new Date(proposal.decidedAt).toISOString(), error: proposal.error,
  };
}
function json(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
function found(data: unknown, missing: string): ToolResult {
  return data === undefined ? refusal(missing) : json(data);
}
/** A refusal the assistant reads, as a tool result rather than a protocol error, so it can correct its call. */
function refusal(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
function rpcResult(id: string | number, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: NO_STORE });
}
function rpcError(id: string | number | null, code: number, message: string, status = 200): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: NO_STORE });
}
