import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { readGoogleCallback, type GoogleCallback } from "@/lib/google";
import { isHttps, sessionCookieName, sessionCookieOptions } from "@/lib/session-cookie";
import { authorizeGoogleSignIn, createSession, deleteSession, readSession } from "@/lib/store";
import type { AuthorizedAccount } from "@/lib/types";

/** Whether this request reached Travel over HTTPS, which decides the cookies' names and Secure flag. */
export async function isSecureRequest(): Promise<boolean> {
  return isHttps((await headers()).get("x-forwarded-proto"));
}

/** Travel as the browser reached it. Google's redirect URI is built from it, so there is no URL setting. */
export async function requestOrigin(): Promise<string> {
  const host = (await headers()).get("host");
  if (!host) throw new Error("This request has no Host header.");
  return `${(await isSecureRequest()) ? "https" : "http"}://${host}`;
}

/** The signed-in account, or null without a current session. Memoised for one render, so the layout and page share it. */
export const currentAccount = cache(async (): Promise<AuthorizedAccount | null> => {
  const token = (await cookies()).get(sessionCookieName(await isSecureRequest()))?.value;
  return token ? readSession(token) ?? null : null;
});

/** Pages call this first: anyone without a current session signs in. src/proxy.ts only checks that a cookie exists. */
export async function requireAccount(): Promise<AuthorizedAccount> {
  const account = await currentAccount();
  if (!account) redirect("/login");
  return account;
}

/** Route handlers return this to callers without a current session. */
export function signedOutResponse(): Response {
  return Response.json({ error: "Your session has ended. Sign in again to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

/**
 * Finishes Sign in with Google from Google's redirect back, and says where to go next: home once
 * signed in, or /login with the reason. Only Google's word may decide who signs in, so the
 * callback route calls this; it is never a Server Action, which anyone can call with anything.
 */
export async function finishGoogleSignIn(query: URLSearchParams, cookie: string | undefined): Promise<string> {
  let callback: GoogleCallback;
  try {
    callback = await readGoogleCallback(query, cookie, await requestOrigin());
  } catch (error) {
    // The message names the fault; it never holds the code, a token or a secret.
    console.error("Google sign-in failed:", error instanceof Error ? error.message : "unknown error");
    return "/login?error=failed";
  }
  if (callback.kind === "expired") return "/login?error=expired";
  // They chose not to, on Google's screen. Nothing to explain.
  if (callback.kind === "cancelled") return "/login";
  if (!callback.account.emailVerified) return "/login?error=unverified";
  const account = authorizeGoogleSignIn(callback.account);
  if (!account) return "/login?error=denied";
  const https = await isSecureRequest();
  (await cookies()).set(sessionCookieName(https), createSession(account.id), sessionCookieOptions(https));
  return "/";
}

/** Ends this browser's session on the server and removes its cookie. */
export async function endSession(): Promise<void> {
  const https = await isSecureRequest();
  const store = await cookies();
  const token = store.get(sessionCookieName(https))?.value;
  if (token) deleteSession(token);
  store.set(sessionCookieName(https), "", { ...sessionCookieOptions(https), maxAge: 0 });
}
