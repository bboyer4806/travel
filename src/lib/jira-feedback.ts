import { feedbackIssue, type FeedbackInput } from "./feedback.ts";

/**
 * Why feedback didn't reach Jira. The message is fixed text naming what to check, safe for the server log: never a
 * setting's value or anything Jira sent. nothingCreated says Jira certainly created no issue, so the send doesn't count
 * against the feedback limits (TRA-92).
 */
export class FeedbackDeliveryError extends Error {
  nothingCreated: boolean;

  constructor(message: string, nothingCreated: boolean) {
    super(message);
    this.name = "FeedbackDeliveryError";
    this.nothingCreated = nothingCreated;
  }
}

const SETTINGS = ["JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"];
/** Connections Jira never accepted: refused, or to a host that doesn't resolve. */
const NOT_CONNECTED = ["ECONNREFUSED", "ENOTFOUND"];
/** What to check after the statuses a misconfiguration answers with. */
const STATUS_HINTS: Record<number, string> = {
  401: "; check JIRA_EMAIL and JIRA_API_TOKEN",
  403: "; the Jira account needs permission to create Tasks in TRA",
  404: "; check JIRA_URL",
};

// Imported only by the server route. No credentials or upstream responses reach the client.
export async function sendJiraFeedback(input: FeedbackInput, options: {
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch; timeoutMs?: number;
} = {}): Promise<void> {
  const env = options.env ?? process.env;
  // Trimmed: a value saved with a line break would otherwise reach Jira inside the credentials (TRA-92).
  const settings = SETTINGS.map((key) => env[key]?.trim() ?? "");
  const missing = SETTINGS.filter((_, index) => !settings[index]);
  if (missing.length) throw new FeedbackDeliveryError("Missing feedback settings: " + missing.join(", "), true);
  const [url, email, apiToken] = settings;
  const base = URL.parse(url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base?.hostname ?? "");
  if (!base || base.username || base.password || base.search || base.hash || (base.protocol !== "https:" && !(local && base.protocol === "http:"))) throw new FeedbackDeliveryError("Invalid JIRA_URL setting.", true);
  if (env.NODE_ENV !== "production" && !local) throw new FeedbackDeliveryError("Local feedback requires a loopback Jira stand-in; live Jira is disabled outside production.", true);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(new URL("rest/api/3/issue", base.href.replace(/\/?$/, "/")), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Basic " + Buffer.from(email + ":" + apiToken).toString("base64") },
      body: JSON.stringify(feedbackIssue(input)),
    });
  } catch (error) {
    // Only a connection Jira never accepted certainly created nothing; a timeout or dropped connection may follow Jira creating the issue.
    if (error instanceof DOMException && error.name === "TimeoutError") throw new FeedbackDeliveryError("Jira did not answer in time.", false);
    const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
    if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(code)) throw new FeedbackDeliveryError("The request to Jira failed.", false);
    throw new FeedbackDeliveryError(`The request to Jira failed (${code}).`, NOT_CONNECTED.includes(code));
  }
  // Jira certainly created nothing when it refused the request (4xx) or couldn't handle it (503).
  if (response.status !== 201) throw new FeedbackDeliveryError(`Jira answered HTTP ${response.status}${STATUS_HINTS[response.status] ?? ""}.`, (response.status >= 400 && response.status < 500) || response.status === 503);
  // Jira's creation response must identify the accepted issue; do not automatically retry uncertainty.
  const result = await response.json().catch(() => null);
  if (typeof result?.id !== "string" || typeof result?.key !== "string") throw new FeedbackDeliveryError("Jira returned an incomplete creation response.", false);
}
