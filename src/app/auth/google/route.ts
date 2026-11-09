import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSecureRequest, requestOrigin } from "@/auth";
import { startGoogleSignIn } from "@/lib/google";
import { googleCookieName, googleCookieOptions } from "@/lib/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where Sign in with Google leads: off to Google, with the cookie the callback checks it against. Public, as signing in must be. */
export async function GET() {
  const https = await isSecureRequest();
  const { url, cookie } = startGoogleSignIn(await requestOrigin());
  (await cookies()).set(googleCookieName(https), cookie, googleCookieOptions(https));
  redirect(url);
}
