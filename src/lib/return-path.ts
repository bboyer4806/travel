/** After signing in, follow only same-origin paths; anything else returns home. */
export function returnPath(value: unknown): string {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";
}
