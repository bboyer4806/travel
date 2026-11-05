export interface Release { version: string; date: string; changes: readonly string[]; }

// Add only verified, deployed changes and their actual release dates at release close.
export const releases: readonly Release[] = [{
  version: "1.4",
  date: "2026-11-04",
  changes: [
    "Keep entry requirements with each destination, including traveler context, visa and passport rules, transit notes, official sources, and the date you checked them.",
    "Add up to 10 destination photos, arrange their order, and choose a primary photo. Existing destination photos are kept.",
    "See every Sunday during your stay in the Church section as your trip dates change.",
    "Save weather, shopping, food, and activities edits without overwriting newer destination details or travel plans.",
  ],
}, {
  version: "1.3",
  date: "2026-11-01",
  changes: [
    "Mark activities and restaurants as Must do from their cards or editor, independently of budget inclusion.",
    "Arrange hotel, activity, and restaurant ideas with saved Up and Down controls. New ideas appear last, and renaming keeps their place.",
    "Find Add hotel, Add activity, and Add restaurant below each list, including empty lists.",
  ],
}, {
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
