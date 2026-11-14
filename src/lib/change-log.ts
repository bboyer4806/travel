export interface Release { version: string; date: string; changes: readonly string[]; }

// Add only verified, deployed changes and their actual release dates at release close.
export const releases: readonly Release[] = [{
  version: "1.10",
  date: "2026-11-14",
  changes: [
    "See each destination's hotels, activities, and restaurants below its budget, on trip pages and in Destinations, as cards showing each idea's photo, name, and price, with ideas chosen for the budget first. Select a card to see its details and edit it. From each section you can also edit its budget, add an idea, or open its full page with Manage, which replaces the budget's links.",
    "See a destination's city exactly as you typed it, such as Tokyo, Kyoto, Japan, on cards, travel connections, page titles, and in the editor. Only cities chosen from a suggestion show shorter. Those saved before this update show in full until you choose them from a suggestion again in the destination editor, which keeps their travel connections.",
    "The estimated price fields for At home items and travel connections no longer show increment and decrement arrows.",
    "See save confirmations above Send feedback, which covered them on phones, so tapping their X closes them instead of opening feedback. They also close by themselves after five seconds.",
    "Keep your place when using the keyboard. After you use Move down, Mark complete, Show Church, Remove photo, or a similar control, focus stays on it or moves to the nearest control instead of being lost, so pressing Enter twice on Move down moves a destination two places.",
    "Ask ChatGPT or Claude to change the photos of destinations, hotels, activities, restaurants, and churches: add photos from the web, remove photos, choose which photo shows first, or put a destination's photos in order. You see each photo on the proposal's page, and nothing changes until you approve it. Only Travel's owner sees proposals.",
  ],
}, {
  version: "1.9",
  date: "2026-11-13",
  changes: [
    "Add tags such as Europe or Beach to a trip from its page, and see them on its card. On All trips, Filter by tag narrows the list to trips with every tag you select, and works with the search.",
    "Bring an already researched destination into a trip with everything saved for it. Add destination now asks only for the city and uses the trip owner's destination for that city when there is one. A city already in the trip shows its card instead.",
    "Keep saving in a tab you opened before Travel was updated. If a reload is ever needed, Travel now says so instead of reporting a connection problem.",
    "Save again after a dropped connection without adding a second trip, destination, idea, church, or At home item. Travel now says it couldn't confirm the save, instead of saying your changes weren't saved.",
    "See errors from controls that save right away, such as Must do, Mark complete, or moving a destination, at the bottom of your screen wherever you've scrolled, instead of at the end of the page.",
    "Connect ChatGPT and Claude from AI assistants in the header. They can read all of Travel and propose changes, which take effect only after you approve them in Travel. Only Travel's owner sees AI assistants and can connect them.",
  ],
}, {
  version: "1.8",
  date: "2026-11-11",
  changes: [
    "See specific validation messages when a change cannot be saved, regardless of which page or image loaded first.",
    "City suggestions now limit excessive requests and pause briefly when the provider is busy; you can still enter cities manually.",
    "Retry feedback after a temporary failure without closing the form or losing your draft, with clearer error messages.",
    "Use Try again to recover from a temporary page failure. Missing pages and server errors now return the correct response status.",
  ],
}, {
  version: "1.7",
  date: "2026-11-11",
  changes: [
    "Open Destinations in the header to see every city you've researched, with its hotels, activities, restaurants, photos, notes, weather, entry requirements, and Church, and the trips that visit it.",
    "Edit a destination once and every trip that visits it shows the change. Each trip keeps its own order, nights, dates, and travel connections, and removing a destination from a trip keeps its research.",
    "Keep destination cards compact: Budget, Entry requirements, and Typical weather start collapsed. Collapsed, Budget still shows each category's amount with its page or editor, and the destination estimate.",
    "See the same message wherever an amount isn't valid.",
  ],
}, {
  version: "1.6",
  date: "2026-11-10",
  changes: [
    "Sign in with Google to open Travel. Only Google accounts that have been given access can see or change trips.",
    "See which account you're signed in with in the header, and sign out there. Signing in lasts 30 days from your last visit.",
    "Share a trip by Google email from its Share button, even with someone who has never used Travel. They see it in their trip list when they sign in and can change everything in it. Only you can delete it or change who has access.",
  ],
}, {
  version: "1.5",
  date: "2026-11-08",
  changes: [
    "Open trips and save changes faster. Trip pages load only the trip you're viewing.",
    "See the trip or destination you're viewing named in your browser tab, with clearer wording and long names that wrap instead of overflowing. The What's new dot no longer flickers when a page opens.",
  ],
}, {
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
