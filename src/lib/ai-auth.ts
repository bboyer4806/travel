import { createHash } from "node:crypto";

/**
 * ChatGPT and Claude connect to Travel's MCP endpoint through OAuth 2.1, as the MCP specification describes (TRA-115).
 * Each registers itself (RFC 7591), Travel's owner allows it on Travel's own page, and it then holds the tokens of one
 * connection, which the owner can revoke. Nothing here touches the database or Next.js.
 */

/** Travel's MCP endpoint, on Travel's own origin. */
export const MCP_PATH = "/api/mcp";
/** The OAuth authorization endpoint: the page where the owner allows a connection. */
export const AUTHORIZE_PATH = "/ai/authorize";
export const TOKEN_PATH = "/api/oauth/token";
export const REGISTRATION_PATH = "/api/oauth/register";

const MINUTE_MS = 60_000;
/** An authorization code is exchanged as soon as the owner allows the connection. */
export const AUTHORIZATION_CODE_MS = 10 * MINUTE_MS;
export const ACCESS_TOKEN_MS = 60 * MINUTE_MS;
/** A connection lasts thirty days from when it last renewed its access, as sign-in does from last use. */
export const CONNECTION_MS = 30 * 24 * 60 * MINUTE_MS;
/** A proposal waits a day for the owner's decision. */
export const PROPOSAL_MS = 24 * 60 * MINUTE_MS;

export type AiPlatform = "Claude" | "ChatGPT";

/**
 * The assistant an OAuth callback address belongs to, or undefined for any other address. Travel sends authorizations
 * only to Claude's and ChatGPT's own callbacks, so no other app can be connected, even by someone who tricks the owner
 * into allowing it. Claude's callback may move from claude.ai to claude.com. ChatGPT uses its fixed callback with
 * servers that identify themselves in the response (RFC 9207), as Travel does, and a per-connection one otherwise.
 */
export function aiPlatform(redirectUri: string): AiPlatform | undefined {
  if (redirectUri === "https://claude.ai/api/mcp/auth_callback" || redirectUri === "https://claude.com/api/mcp/auth_callback") return "Claude";
  if (redirectUri === "https://chatgpt.com/connector_platform_oauth_redirect" || /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,200}$/.test(redirectUri)) return "ChatGPT";
  return undefined;
}

/** Whether a PKCE challenge (RFC 7636) is S256's: the base64url SHA-256 of a verifier, always 43 characters. */
export function isPkceChallenge(challenge: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(challenge);
}
/** Whether a PKCE verifier is the one behind an S256 challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && createHash("sha256").update(verifier).digest("base64url") === challenge;
}

/** Protected resource metadata (RFC 9728): where an assistant finds out how to get access to the MCP endpoint. */
export function protectedResourceMetadata(origin: string) {
  return { resource: origin + MCP_PATH, authorization_servers: [origin], bearer_methods_supported: ["header"], resource_name: "Travel" };
}
/** Authorization server metadata (RFC 8414). Travel is its own authorization server, identified by its origin. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: origin + AUTHORIZE_PATH,
    token_endpoint: origin + TOKEN_PATH,
    registration_endpoint: origin + REGISTRATION_PATH,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  };
}
/** The WWW-Authenticate challenge for a request to the MCP endpoint without a current access token. */
export function bearerChallenge(origin: string, invalidToken: boolean): string {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}"${invalidToken ? ', error="invalid_token"' : ""}`;
}
