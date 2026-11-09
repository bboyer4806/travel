import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAccount } from "@/auth";
import { returnPath } from "@/lib/return-path";
import { signInWithGoogle } from "@/app/auth-actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACCESS_DENIED = "This Google account doesn't have access to Travel. Choose a different Google account, or ask a trip owner to share a trip with this account's email address.";
const SIGN_IN_FAILED = "Google sign in was canceled or didn't finish, so you aren't signed in. Please try again.";

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { callbackUrl, error } = await searchParams;
  const destination = returnPath(callbackUrl);
  if (await currentAccount()) redirect(destination);
  return <main id="main-content" className="main-content sign-in">
    <p className="eyebrow">TRAVEL NOTEBOOK</p>
    <h1>Sign in to Travel</h1>
    <p className="hero-description">Sign in with your Google account. Only accounts that have been given access to Travel can open trips.</p>
    {error && <p className="form-error" role="alert">{error === "AccessDenied" ? ACCESS_DENIED : SIGN_IN_FAILED}</p>}
    <form action={signInWithGoogle}>
      <input type="hidden" name="callbackUrl" value={destination} />
      <button type="submit" className="button primary">Sign in with Google</button>
    </form>
  </main>;
}
