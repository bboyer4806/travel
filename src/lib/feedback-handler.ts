import { FEEDBACK_FAILURE, FEEDBACK_RETRY, validateFeedback } from "./feedback.ts";
import { createFeedbackGuard } from "./feedback-guard.ts";
import { FeedbackDeliveryError, sendJiraFeedback } from "./jira-feedback.ts";
import { sameOriginRequest } from "./same-origin.ts";

const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The route checks sign-in first and passes the signed-in account, whose limits apply (TRA-92). */
export function createFeedbackHandler({ guard = createFeedbackGuard(), send = sendJiraFeedback }: { guard?: ReturnType<typeof createFeedbackGuard>; send?: typeof sendJiraFeedback } = {}) {
  return async function POST(request: Request, accountId: string) {
    if (!sameOriginRequest(request)) return json({ error: FEEDBACK_RETRY }, 403);
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
        const token = guard.issue(accountId);
        if (!token) return json({ error: FEEDBACK_RETRY }, 429);
        return json({ token });
      }
      let input;
      try { input = validateFeedback({ ...data, browser: request.headers.get("user-agent") ?? "" }); }
      catch (error) { return json({ error: error instanceof Error ? error.message : FEEDBACK_FAILURE }, 400); }
      const returnSlot = typeof data.token === "string" ? guard.consume(accountId, data.token, data.website) : null;
      if (!returnSlot) return json({ error: FEEDBACK_RETRY }, 429);
      try { await send(input); }
      catch (error) {
        // A delivery error's message names what to check; other errors may hold upstream data, so none is logged.
        const delivery = error instanceof FeedbackDeliveryError ? error : null;
        console.error("Feedback delivery failed" + (delivery ? ": " + delivery.message : "."));
        if (delivery?.nothingCreated) returnSlot();
        return json({ error: FEEDBACK_FAILURE }, 502);
      }
      return json({ ok: true });
    } catch { return json({ error: FEEDBACK_FAILURE }, 400); }
  };
}
