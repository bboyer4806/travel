import NextAuth, { AuthError } from "next-auth";
import Google from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authorizeGoogleSignIn, getAccountByGoogleSubject } from "@/lib/store";
import type { AuthorizedAccount } from "@/lib/types";

export type SignedInAccount = AuthorizedAccount & { name: string | null };

/** Logs the error type and messages only. Auth.js error details can include session claims. */
function logAuthError(error: Error) {
  const cause = (error.cause as { err?: unknown } | undefined)?.err;
  console.error(`[auth] ${error instanceof AuthError ? error.type : error.name}: ${error.message}${cause instanceof Error ? ` (${cause.message})` : ""}`);
}

// AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET and (in production) AUTH_URL are read from the server environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Google is the only sign-in method. PKCE, state and nonce tie each callback to the browser that started it.
  providers: [Google({ checks: ["pkce", "state", "nonce"], authorization: { params: { prompt: "select_account" } } })],
  // An encrypted, HttpOnly, SameSite=Lax cookie. It is Secure, with the __Secure- prefix, when AUTH_URL uses HTTPS.
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/signin", error: "/signin" },
  logger: { error: logAuthError },
  callbacks: {
    // Only Google's validated ID token claims are used, and only an already authorized email may sign in.
    signIn({ profile }) {
      if (typeof profile?.sub !== "string" || typeof profile.email !== "string") return false;
      return authorizeGoogleSignIn({ subject: profile.sub, email: profile.email, emailVerified: profile.email_verified === true }) !== undefined;
    },
    // The session keeps Google's stable subject and display name only. No OAuth tokens are stored.
    jwt({ token, profile }) {
      return profile ? { sub: profile.sub ?? undefined, name: profile.name ?? null } : token;
    },
    session({ session, token }) {
      return { expires: session.expires, user: { id: token.sub, name: token.name } };
    },
  },
});

/** The signed-in account, or null when there is no valid session or the account is no longer authorized. */
export const currentAccount = cache(async (): Promise<SignedInAccount | null> => {
  const user = (await auth())?.user;
  // The session user ID is the Google subject, set in the jwt callback above.
  const account = user?.id ? getAccountByGoogleSubject(user.id) : undefined;
  return account ? { ...account, name: user?.name ?? null } : null;
});

/** Pages call this first: visitors without an authorized session sign in, then return to `returnTo`. */
export async function requireAccount(returnTo: string): Promise<SignedInAccount> {
  const account = await currentAccount();
  if (!account) redirect("/signin?" + new URLSearchParams({ callbackUrl: returnTo }));
  return account;
}

/** Route handlers return this to callers without an authorized session. */
export function signedOutResponse(): Response {
  return Response.json({ error: "Your session has ended. Sign in again to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
