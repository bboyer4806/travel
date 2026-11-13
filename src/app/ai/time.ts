/** A moment as the owner reads it, in UTC, so every server shows it the same way. */
export function formatMoment(ms: number): string {
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(ms)} UTC`;
}
