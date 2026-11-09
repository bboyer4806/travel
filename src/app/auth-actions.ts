"use server";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { returnPath } from "@/lib/return-path";

export async function signInWithGoogle(formData: FormData) {
  const callbackUrl = returnPath(formData.get("callbackUrl"));
  try {
    await signIn("google", { redirectTo: callbackUrl });
  } catch (error) {
    // Auth.js redirects to Google by throwing; only its own errors are reported here, without a session.
    if (error instanceof AuthError) redirect("/signin?" + new URLSearchParams({ error: error.type, callbackUrl }));
    throw error;
  }
}

export async function signOutOfTravel() {
  await signOut({ redirectTo: "/signin" });
}
