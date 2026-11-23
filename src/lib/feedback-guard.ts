import { randomBytes } from "node:crypto";

/**
 * One web process behind Dokku. Every request comes from a signed-in account, which a client can't change the way it
 * can drop a cookie, so each account's limits keep one client from using up the shared hourly ones (TRA-92). The shared
 * limits bound everyone together.
 */
export function createFeedbackGuard(now: () => number = Date.now) {
  const challenges = new Map<string, { account: string; issued: number }>();
  let issued: number[] = [];
  let sends: number[] = [];
  const accounts = new Map<string, { issued: number[]; sends: number[] }>();
  const window = 60 * 60 * 1000;
  function prune() {
    const cutoff = now() - window;
    issued = issued.filter((time) => time > cutoff);
    sends = sends.filter((time) => time > cutoff);
    for (const [token, challenge] of challenges) if (challenge.issued < now() - 15 * 60_000) challenges.delete(token);
    for (const [account, usage] of accounts) {
      usage.issued = usage.issued.filter((time) => time > cutoff);
      usage.sends = usage.sends.filter((time) => time > cutoff);
      if (!usage.issued.length && !usage.sends.length) accounts.delete(account);
    }
  }
  return {
    /** Twenty tokens an hour for each account: each opening of the feedback sheet, and each retry, uses one. */
    issue(account: string) {
      prune();
      const usage = accounts.get(account) ?? { issued: [], sends: [] };
      if (usage.issued.length >= 20 || issued.length >= 120 || issued.filter((time) => time > now() - 60_000).length >= 20) return null;
      issued.push(now());
      usage.issued.push(now());
      accounts.set(account, usage);
      const token = randomBytes(32).toString("hex");
      challenges.set(token, { account, issued: now() });
      return token;
    },
    /**
     * Takes a send's slot, or returns null when the send must not reach Jira. The returned function gives the slot back,
     * for a send that certainly created nothing in Jira, so it doesn't count against the limits (TRA-92).
     */
    consume(account: string, token: string, honeypot: unknown): (() => void) | null {
      prune();
      const challenge = challenges.get(token);
      if (!challenge || challenge.account !== account) return null;
      challenges.delete(token); // Single use even after upstream failure or timeout.
      if (honeypot !== "" || now() - challenge.issued < 1000) return null;
      const usage = accounts.get(account) ?? { issued: [], sends: [] };
      if (usage.sends.length >= 10 || sends.length >= 30 || sends.filter((time) => time > now() - 60_000).length >= 5) return null;
      const time = now();
      sends.push(time);
      usage.sends.push(time);
      accounts.set(account, usage);
      return () => {
        for (const times of [sends, usage.sends]) if (times.includes(time)) times.splice(times.indexOf(time), 1);
      };
    },
  };
}
