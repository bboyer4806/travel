import { googleSettings } from "./google.ts";
import { ownerEmail } from "./store.ts";

/**
 * Refuses to start without the sign-in settings: thrown, a missing one would only be logged and every sign-in would
 * fail. Each check runs, so one start names every setting that is missing. src/instrumentation.ts runs this as the
 * server starts, and the container's scripts/start.mjs before it opens the database (TRA-78).
 */
export function requireServerSettings(): void {
  let ready = true;
  for (const check of [googleSettings, ownerEmail]) {
    try {
      check();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      ready = false;
    }
  }
  if (!ready) process.exit(1);
}
