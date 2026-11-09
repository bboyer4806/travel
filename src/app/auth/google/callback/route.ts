import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { finishGoogleSignIn, isSecureRequest } from "@/auth";
import { googleCookieName, googleCookieOptions } from "@/lib/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where Google sends people back to: the redirect URI on the OAuth client. Public, as signing in must be. */
export async function GET(request: Request) {
  const https = await isSecureRequest();
  const store = await cookies();
  const cookie = store.get(googleCookieName(https))?.value;
  // Good for one trip: coming back to this page again finds it gone.
  store.set(googleCookieName(https), "", { ...googleCookieOptions(https), maxAge: 0 });
  redirect(await finishGoogleSignIn(new URL(request.url).searchParams, cookie));
}
