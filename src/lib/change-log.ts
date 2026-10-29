export interface Release { version: string; date: string; changes: readonly string[]; }

// Add only verified, deployed changes and their actual release dates at release close.
// Travel 1.2 is intentionally not advertised as shipped by its implementation branch.
export const releases: readonly Release[] = [];

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
