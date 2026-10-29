export interface Release { version: string; date: string; changes: readonly string[]; }

// Add only verified, deployed changes and their actual release dates at release close.
export const releases: readonly Release[] = [{
  version: "1.2",
  date: "2026-10-29",
  changes: [
    "Set one trip start date and each destination's nights to calculate arrival dates, departure dates, weekdays, and the trip end.",
    "Plan every budget in USD. Hotels use nights; daily food and miscellaneous spending allow one full day for a zero-night visit.",
    "Open Hotels, Activities, and Restaurants beside their budget headings, and edit Shopping beside its total.",
    "Save destination edits from a sticky header that keeps the Save button and errors in view.",
    "See typical weather and eligible Church sections on destination cards. Church hiding stays saved when dates change.",
    "Send feedback from anywhere in the planner, including while editing. Failed submissions keep your draft for retry.",
    "Find release notes here, with an unread dot when a newer version is available.",
  ],
}];

export function publishedReleases(entries: readonly Release[]): Release[] {
  return [...entries].sort((a, b) => compareVersions(b.version, a.version));
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function hasUnreadRelease(latest: string | undefined, seen: string | null): boolean {
  return !!latest && (!seen || !/^\d+(\.\d+)*$/.test(seen) || compareVersions(latest, seen) > 0);
}
