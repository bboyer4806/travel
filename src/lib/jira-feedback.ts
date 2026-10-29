import { feedbackIssue, type FeedbackInput } from "./feedback.ts";

// Imported only by the server route. No credentials or upstream responses reach the client.
export async function sendJiraFeedback(input: FeedbackInput, options: {
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch; timeoutMs?: number;
} = {}): Promise<void> {
  const env = options.env ?? process.env;
  const missing = ["JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"].filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error("Missing feedback settings: " + missing.join(", "));
  const base = new URL(env.JIRA_URL!.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash || (base.protocol !== "https:" && !(local && base.protocol === "http:"))) throw new Error("Invalid JIRA_URL setting.");
  if (env.NODE_ENV !== "production" && !local) throw new Error("Local feedback requires a loopback Jira stand-in; live Jira is disabled outside production.");
  const response = await (options.fetch ?? fetch)(new URL("rest/api/3/issue", base.href.replace(/\/?$/, "/")), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Basic " + Buffer.from(env.JIRA_EMAIL + ":" + env.JIRA_API_TOKEN).toString("base64") },
    body: JSON.stringify(feedbackIssue(input)),
  });
  if (response.status !== 201) throw new Error("Jira did not confirm feedback creation.");
  // Jira's creation response must identify the accepted issue; do not automatically retry uncertainty.
  const result = await response.json();
  if (typeof result?.id !== "string" || typeof result?.key !== "string") throw new Error("Jira returned an incomplete creation response.");
}
