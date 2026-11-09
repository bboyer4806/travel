import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAccount } from "@/auth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Why the Google callback sent someone back here. Canceling at Google needs no explanation. */
const REASONS = new Map([
  ["denied", "This Google account doesn't have access to Travel. Choose a different Google account, or ask a trip owner to share a trip with this account's email address."],
  ["unverified", "Google hasn't verified this account's email address, so it can't be used to sign in."],
  ["expired", "That sign-in expired. Try again."],
  ["failed", "Google sign in didn't finish, so you aren't signed in. Try again."],
]);

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { error } = await searchParams;
  if (await currentAccount()) redirect("/");
  const reason = typeof error === "string" ? REASONS.get(error) : undefined;
  return <main id="main-content" className="main-content sign-in">
    <p className="eyebrow">TRAVEL NOTEBOOK</p>
    <h1>Sign in to Travel</h1>
    <p className="hero-description">Sign in with your Google account. Only accounts that have been given access to Travel can open trips.</p>
    {reason && <p className="form-error" role="alert">{reason}</p>}
    {/* A plain link, as Budget's is: the route sends the browser to Google, which no client-side navigation or prefetch may start. */}
    <a href="/auth/google" className="button primary">Sign in with Google</a>
  </main>;
}
