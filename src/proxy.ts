import { NextResponse, type NextRequest } from "next/server";
import { isHttps, sessionCookieName, sessionCookieOptions } from "@/lib/session-cookie";

/**
 * Only asks whether a session cookie is present, as Budget's proxy does. It cannot reach the
 * database, so whether the session is any good is decided by requireAccount() in pages and by
 * currentAccount() in Server Actions and route handlers, which are what actually protect trips.
 * This turns "not signed in" into a redirect rather than a page that streams one.
 */

/** Reachable without signing in. /auth/google covers its callback, where Google sends people back to. */
const PUBLIC_PATHS = ["/login", "/auth/google"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const https = isHttps(request.headers.get("x-forwarded-proto"));
  const name = sessionCookieName(https);
  const token = request.cookies.get(name)?.value;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  // A Server Action answers for itself, so an open editor keeps its draft and says why it can't save.
  if (!token && !isPublic && !request.headers.has("next-action")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const response = NextResponse.next();
  // Sign-in lasts thirty days from last use. Pages can't set cookies, so the cookie is renewed here as
  // it stands; whether it is still good is for the page to decide. GET only, so signing out never
  // gets a renewal in the same response.
  if (token && request.method === "GET") response.cookies.set(name, token, sessionCookieOptions(https));
  return response;
}

export const config = {
  // Route handlers under /api answer signed-out callers with 401 themselves; static files stay reachable.
  matcher: ["/((?!api/|_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
