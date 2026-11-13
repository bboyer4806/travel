"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentAccount, requestOrigin } from "@/auth";
import { aiClientPlatform, allowAiConnection, decideAiProposal, isValidationError, revokeAiConnection } from "@/lib/store";

// Server Actions are public endpoints, so each checks the session itself; the store checks it is the designated owner's.

/**
 * The owner's answer on the connection page (TRA-115). Allow sends Claude or ChatGPT back with a code for its tokens;
 * Cancel tells it no. Either way it goes only to a callback its registration named, with Travel's issuer (RFC 9207).
 */
export async function answerAiConnection(form: FormData): Promise<void> {
  const account = await currentAccount();
  if (!account) redirect("/login");
  const field = (name: string) => String(form.get(name) ?? "");
  const clientId = field("clientId");
  const redirectUri = field("redirectUri");
  if (!aiClientPlatform(clientId, redirectUri)) throw new Error("This connection request isn't from Claude or ChatGPT.");
  const callback = new URL(redirectUri);
  if (field("decision") === "allow") callback.searchParams.set("code", allowAiConnection(account.id, { clientId, redirectUri, codeChallenge: field("codeChallenge") }));
  else callback.searchParams.set("error", "access_denied");
  if (field("state")) callback.searchParams.set("state", field("state"));
  callback.searchParams.set("iss", await requestOrigin());
  redirect(callback.toString());
}

/** The owner's decision on a proposal, naming the proposal exactly as shown to them. */
export async function decideProposal(_previous: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  const account = await currentAccount();
  if (!account) return { error: "Your session has ended. Sign in again in another tab, then decide again." };
  const decision = form.get("decision");
  if (decision !== "approve" && decision !== "reject") return { error: "Choose Approve or Reject." };
  try {
    decideAiProposal(account.id, String(form.get("proposalId") ?? ""), String(form.get("digest") ?? ""), decision === "approve");
  } catch (error) {
    if (isValidationError(error)) return { error: error.message };
    console.error("Unable to decide an AI proposal", error);
    return { error: "Travel couldn't make these changes, so nothing was changed. Please try again." };
  }
  revalidatePath("/", "layout");
  return null;
}

/** Ends an AI connection at once, with its proposals. */
export async function revokeConnection(form: FormData): Promise<void> {
  const account = await currentAccount();
  if (!account) redirect("/login");
  revokeAiConnection(account.id, String(form.get("connectionId") ?? ""));
  revalidatePath("/ai");
}
