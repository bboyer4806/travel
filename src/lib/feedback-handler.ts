import { randomBytes } from "node:crypto";
import { FEEDBACK_FAILURE, FEEDBACK_RETRY, validateFeedback } from "./feedback.ts";
import { createFeedbackGuard, sameOriginFeedback } from "./feedback-guard.ts";
import { sendJiraFeedback } from "./jira-feedback.ts";

const cookieName = "travel-feedback";
const json = (body: object, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
function sessionFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1) ?? "";
}

export function createFeedbackHandler({ guard = createFeedbackGuard(), send = sendJiraFeedback }: { guard?: ReturnType<typeof createFeedbackGuard>; send?: typeof sendJiraFeedback } = {}) {
  return async function POST(request: Request) {
    if (!sameOriginFeedback(request)) return json({ error: FEEDBACK_RETRY }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: FEEDBACK_FAILURE }, 415);
    // Bound actual bytes, not just a client-controlled Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: FEEDBACK_FAILURE }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 24_000) { await reader.cancel(); return json({ error: FEEDBACK_FAILURE }, 413); }
        chunks.push(value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (data?.action === "open") {
        const session = /^[a-f0-9]{64}$/.test(sessionFrom(request)) ? sessionFrom(request) : randomBytes(32).toString("hex");
        const token = guard.issue(session);
        if (!token) return json({ error: FEEDBACK_RETRY }, 429);
        return json({ token }, 200, { "Set-Cookie": `${cookieName}=${session}; Path=/api/feedback; HttpOnly; SameSite=Strict; Max-Age=3600${request.headers.get("origin")?.startsWith("https:") ? "; Secure" : ""}` });
      }
      let input;
      try { input = validateFeedback({ ...data, browser: request.headers.get("user-agent") ?? "" }); }
      catch (error) { return json({ error: error instanceof Error ? error.message : FEEDBACK_FAILURE }, 400); }
      if (typeof data.token !== "string" || !guard.consume(sessionFrom(request), data.token, data.website)) return json({ error: FEEDBACK_RETRY }, 429);
      try { await send(input); }
      catch (error) {
        // Configuration names are useful; upstream data and credentials are never logged.
        console.error(error instanceof Error && error.message.startsWith("Missing feedback settings:") ? error.message : "Feedback Jira delivery was not confirmed.");
        return json({ error: FEEDBACK_FAILURE }, 502);
      }
      return json({ ok: true });
    } catch { return json({ error: FEEDBACK_FAILURE }, 400); }
  };
}
