/**
 * Travel's sign-in cookies, written by src/auth.ts and renewed by src/proxy.ts. Kept in one place
 * because a renewed cookie that differed in name, path or flags would sit beside the original.
 * No imports: the proxy runs ahead of everything and never opens the database.
 *
 * Over HTTPS the names start with __Host-, as Meals' do: browsers keep such a cookie only when it
 * is Secure, with Path=/ and no Domain, so another dev.boyersoftware.com app can't plant one for
 * Travel. Over http, as on localhost, they keep the plain name.
 */

/** Thirty days from last use, on the cookie and on the session behind it. */
export const SESSION_DAYS = 30;

/** Whether the request reached Travel over HTTPS, as the proxy in front of it reports. */
export function isHttps(forwardedProto: string | null): boolean {
  return forwardedProto?.split(",")[0].trim() === "https";
}

function cookieName(https: boolean, name: string): string {
  return https ? `__Host-${name}` : name;
}

export function sessionCookieName(https: boolean): string {
  return cookieName(https, "travel_session");
}

/** Holds the state and PKCE verifier while someone is away at Google. */
export function googleCookieName(https: boolean): string {
  return cookieName(https, "travel_google");
}

export function sessionCookieOptions(https: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure: https, path: "/", maxAge: SESSION_DAYS * 86_400 };
}

/** Ten minutes is long enough to choose an account and come back. Lax, because Google sends people back with a top-level navigation. */
export function googleCookieOptions(https: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure: https, path: "/", maxAge: 10 * 60 };
}
