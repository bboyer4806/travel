import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requestOrigin, requireAccount } from "@/auth";
import { isPkceChallenge } from "@/lib/ai-auth";
import { aiClientPlatform, isAiOwner } from "@/lib/store";
import { answerAiConnection } from "../actions";
import styles from "../ai.module.css";

export const metadata: Metadata = { title: "Connect an AI assistant" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The OAuth authorization endpoint (TRA-115): where Claude or ChatGPT sends Travel's owner to allow a connection. Only
 * the designated owner, signed in with Google, can allow one, and only for a client registered with Claude's or
 * ChatGPT's own callback. A request Travel can't trust goes nowhere; a malformed one goes back to the assistant.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await requireAccount();
  const query = await searchParams;
  const param = (name: string) => typeof query[name] === "string" ? query[name] : "";
  const clientId = param("client_id");
  const redirectUri = param("redirect_uri");
  if (!isAiOwner(account.id)) return <Refusal>Only Travel&apos;s owner can connect AI assistants. You&apos;re signed in as {account.email}.</Refusal>;
  const platform = aiClientPlatform(clientId, redirectUri);
  if (!platform) return <Refusal>This connection request isn&apos;t from Claude or ChatGPT, or it has expired. Start connecting again from your assistant.</Refusal>;
  const codeChallenge = param("code_challenge");
  if (param("response_type") !== "code" || param("code_challenge_method") !== "S256" || !isPkceChallenge(codeChallenge)) {
    const callback = new URL(redirectUri);
    callback.searchParams.set("error", "invalid_request");
    callback.searchParams.set("error_description", "Travel needs response_type code and an S256 code challenge.");
    if (param("state")) callback.searchParams.set("state", param("state"));
    callback.searchParams.set("iss", await requestOrigin());
    redirect(callback.toString());
  }
  return <main id="main-content" className={`main-content sign-in ${styles.page}`}>
    <p className="eyebrow">AI ASSISTANTS</p>
    <h1>{`Connect ${platform} to Travel?`}</h1>
    <ul className={styles.steps}>
      <li>{platform} can read every trip, destination and account in Travel, whoever owns them: notes, budgets, research, photos, and who each trip is shared with. Sign-in details and connection keys are never shared.</li>
      <li>{platform} can propose changes to any trip or destination, including deleting trips and changing who they are shared with. Nothing changes until you approve a proposal on its page here.</li>
      <li>You can revoke this connection at any time in <Link href="/ai" className={styles.link}>AI assistants</Link>.</li>
    </ul>
    <form action={answerAiConnection} className={styles.actions}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="redirectUri" value={redirectUri} />
      <input type="hidden" name="codeChallenge" value={codeChallenge} />
      <input type="hidden" name="state" value={param("state")} />
      <button type="submit" name="decision" value="allow" className="button primary">Allow</button>
      <button type="submit" name="decision" value="deny" className="button secondary">Cancel</button>
    </form>
  </main>;
}

function Refusal({ children }: { children: React.ReactNode }) {
  return <main id="main-content" className="main-content sign-in">
    <p className="eyebrow">AI ASSISTANTS</p>
    <h1>This assistant can&apos;t be connected</h1>
    <p className="form-error" role="alert">{children}</p>
    <Link href="/" className="button secondary">Back to trips</Link>
  </main>;
}
