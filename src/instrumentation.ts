/**
 * Runs once as the server starts, before it takes a request, as Budget's does. Next never calls it
 * during `next build`, so the image still builds without any settings.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { requireServerSettings } = await import("./lib/server-settings");
    requireServerSettings();
  }
}
