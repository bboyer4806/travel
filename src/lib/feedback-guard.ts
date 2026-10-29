import { randomBytes } from "node:crypto";

/** One web process behind Dokku. Aggregate limits cannot be bypassed with forged proxy IPs/cookies. */
export function createFeedbackGuard(now: () => number = Date.now) {
  const challenges = new Map<string, { session: string; issued: number }>();
  let issued: number[] = [];
  let sends: number[] = [];
  const sessions = new Map<string, number[]>();
  const window = 60 * 60 * 1000;
  function prune() {
    const cutoff = now() - window;
    issued = issued.filter((time) => time > cutoff);
    sends = sends.filter((time) => time > cutoff);
    for (const [token, challenge] of challenges) if (challenge.issued < now() - 15 * 60_000) challenges.delete(token);
    for (const [session, times] of sessions) {
      const recent = times.filter((time) => time > cutoff);
      if (recent.length) sessions.set(session, recent); else sessions.delete(session);
    }
  }
  return {
    issue(session: string) {
      prune();
      if (issued.length >= 120 || issued.filter((time) => time > now() - 60_000).length >= 20) return null;
      issued.push(now());
      const token = randomBytes(32).toString("hex");
      challenges.set(token, { session, issued: now() });
      return token;
    },
    consume(session: string, token: string, honeypot: unknown) {
      prune();
      const challenge = challenges.get(token);
      if (!challenge || challenge.session !== session) return false;
      challenges.delete(token); // Single use even after upstream failure or timeout.
      if (honeypot !== "" || now() - challenge.issued < 1000) return false;
      const recent = sessions.get(session) ?? [];
      if (recent.length >= 3 || sends.length >= 30 || sends.filter((time) => time > now() - 60_000).length >= 5) return false;
      sends.push(now());
      sessions.set(session, [...recent, now()]);
      return true;
    },
  };
}

export function sameOriginFeedback(request: Request): boolean {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // Next standalone's request.url may use its internal 0.0.0.0 bind address.
  // Dokku preserves Host. Never use a caller-supplied forwarded host or IP as identity.
  if (!origin || (site && site !== "same-origin")) return false;
  try {
    const url = new URL(origin);
    return origin === url.origin && ["http:", "https:"].includes(url.protocol) && url.host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch { return false; }
}
