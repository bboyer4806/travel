import { exchangeAiCode, isValidationError, refreshAiTokens, registerAiClient } from "./store.ts";

/**
 * Travel's OAuth registration and token endpoints, through which Claude and ChatGPT connect to its MCP endpoint
 * (TRA-115). Both are public, as OAuth needs them to be: registering grants nothing, and tokens are issued only for an
 * authorization code the designated owner's consent produced, or a connection's current refresh token.
 */

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

function oauthError(error: string, description: string): Response {
  return Response.json({ error, error_description: description }, { status: 400, headers: NO_STORE });
}

/** Dynamic client registration (RFC 7591). Clients are public, proving themselves with PKCE, so none gets a secret. */
export async function handleRegistration(request: Request): Promise<Response> {
  let metadata: unknown;
  try {
    metadata = await request.json();
  } catch {
    return oauthError("invalid_client_metadata", "Send the client's registration as JSON.");
  }
  try {
    const { clientId, redirectUris } = registerAiClient(metadata);
    const name = (metadata as Record<string, unknown>).client_name;
    return Response.json({
      client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: redirectUris, ...(typeof name === "string" && { client_name: name }),
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
    }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (isValidationError(error)) return oauthError("invalid_client_metadata", error.message);
    throw error;
  }
}

/** The token endpoint: an authorization code, or a refresh token, for a connection's tokens. Each code and refresh token works once. */
export async function handleToken(request: Request): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  const field = (name: string) => form.get(name) ?? "";
  const clientId = field("client_id");
  switch (form.get("grant_type")) {
    case "authorization_code": {
      const [code, redirectUri, codeVerifier] = [field("code"), field("redirect_uri"), field("code_verifier")];
      if (!code || !redirectUri || !codeVerifier || !clientId) return oauthError("invalid_request", "Send code, redirect_uri, code_verifier and client_id.");
      const tokens = exchangeAiCode({ code, clientId, redirectUri, codeVerifier });
      return tokens ? granted(tokens) : oauthError("invalid_grant", "This authorization code is unknown, expired or used, or doesn't match this request.");
    }
    case "refresh_token": {
      const refreshToken = field("refresh_token");
      if (!refreshToken || !clientId) return oauthError("invalid_request", "Send refresh_token and client_id.");
      const tokens = refreshAiTokens({ refreshToken, clientId });
      return tokens ? granted(tokens) : oauthError("invalid_grant", "This refresh token is unknown, used, expired or revoked. Connect to Travel again.");
    }
    default:
      return oauthError("unsupported_grant_type", "Travel issues tokens for an authorization code or a refresh token.");
  }
}

function granted(tokens: { accessToken: string; refreshToken: string; expiresIn: number }): Response {
  return Response.json({ access_token: tokens.accessToken, token_type: "Bearer", expires_in: tokens.expiresIn, refresh_token: tokens.refreshToken }, { headers: NO_STORE });
}
