/**
 * Runs once as the server starts, before it takes a request, as Budget's does. Next never calls it
 * during `next build`, so the image still builds without any settings.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { googleSettings } = await import("./lib/google");
    const { ownerEmail } = await import("./lib/store");
    // Each check runs, so one start names every setting that is missing.
    let ready = true;
    for (const check of [googleSettings, ownerEmail]) {
      try {
        check();
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        ready = false;
      }
    }
    // Thrown, this would only be logged and every sign-in would fail. Exiting refuses to start.
    if (!ready) process.exit(1);
  }
}
