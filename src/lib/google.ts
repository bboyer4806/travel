import { createHash, randomBytes } from "node:crypto";
import type { GoogleIdentity } from "./types";

/**
 * Sign in with Google: the OpenID Connect authorization code flow with PKCE, written by hand as
 * Budget and Meals do. Someone is sent to Google with a fresh state and code challenge, and Google
 * sends them back with a code, exchanged here for an ID token naming their account. Nothing here
 * touches the database or Next.js; what that account may do is decided in src/auth.ts and the store.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Google writes its ID tokens' issuer both ways. */
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const CALLBACK_PATH = "/auth/google/callback";
const TIMEOUT_MS = 10_000;

/** The OAuth client Travel signs in through. Throws naming each setting that isn't set. */
export function googleSettings(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    const missing = Object.entries({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret }).filter(([, value]) => !value).map(([name]) => name);
    throw new Error(`Sign in with Google can't work without ${missing.join(", ")}. See .env.example.`);
  }
  return { clientId, clientSecret };
}

/**
 * Where to send someone to sign in, and what the cookie holds until they are back: the state
 * Google will echo and the verifier behind the challenge. `origin` is Travel as the browser reached it.
 */
export function startGoogleSignIn(origin: string): { url: string; cookie: string } {
  const { clientId } = googleSettings();
  // base64url, so neither has a "." to confuse with the cookie's separator.
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: origin + CALLBACK_PATH,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    // Lets someone with several Google accounts choose the one that has access.
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), cookie: `${state}.${verifier}` };
}

/**
 * What a trip to Google came back with. Expired when the state doesn't match the cookie's, which
 * is also how a cookie that has run out looks, and cancelled when Google sent an error instead of
 * a code, as it does when someone backs out on its screen.
 */
export type GoogleCallback = { kind: "expired" } | { kind: "cancelled" } | { kind: "account"; account: GoogleIdentity };

/**
 * Reads Google's redirect back: `query` is its query string, `cookie` the one the trip started
 * with, and `origin` the same one it started from. Throws when Google refuses the code or its ID
 * token is wrong, which is a fault rather than anything the person did.
 */
export async function readGoogleCallback(query: URLSearchParams, cookie: string | undefined, origin: string): Promise<GoogleCallback> {
  const [state, verifier, ...rest] = (cookie ?? "").split(".");
  if (!state || !verifier || rest.length > 0 || query.get("state") !== state) return { kind: "expired" };
  if (query.has("error")) return { kind: "cancelled" };
  const code = query.get("code");
  if (!code) throw new Error("Google came back with neither a code nor an error.");
  return { kind: "account", account: accountFromIdToken(await exchangeCode(code, verifier, origin)) };
}

/** Trades the code, and the verifier only this browser holds, for an ID token. */
async function exchangeCode(code: string, verifier: string, origin: string): Promise<string> {
  const { clientId, clientSecret } = googleSettings();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: origin + CALLBACK_PATH, grant_type: "authorization_code", code_verifier: verifier }),
    // The browser waits on this before it goes anywhere.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    // Google's error code only: it names the problem without echoing anything sent.
    const { error } = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(`Google refused the sign-in code: HTTP ${response.status}${typeof error === "string" ? ` ${error}` : ""}.`);
  }
  const { id_token: idToken } = (await response.json()) as { id_token?: unknown };
  if (typeof idToken !== "string") throw new Error("Google's token response has no ID token.");
  return idToken;
}

/**
 * The account an ID token names. It came straight from Google's token endpoint over TLS, so its
 * signature isn't checked (OpenID Connect Core 3.1.3.7). Its issuer, audience and expiry still are.
 */
function accountFromIdToken(idToken: string): GoogleIdentity {
  const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  if (typeof claims.iss !== "string" || !ISSUERS.includes(claims.iss)) throw new Error("Google's ID token is not from Google.");
  if (claims.aud !== googleSettings().clientId) throw new Error("Google's ID token is for another client.");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) throw new Error("Google's ID token has expired.");
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email) throw new Error("Google's ID token names no account.");
  const name = typeof claims.name === "string" ? claims.name.trim() : "";
  return { subject: claims.sub, email: claims.email, emailVerified: claims.email_verified === true, name: name || null };
}
