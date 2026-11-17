export interface Release { version: string; date: string; changes: readonly string[]; }

// Add only verified, deployed changes and their actual release dates at release close.
export const releases: readonly Release[] = [{
  version: "1.13",
  date: "2026-11-16",
  changes: [
    "See each destination's saved hotels, activities, restaurants, and churches on a map, on its card in a trip and on its page in Destinations. Checkboxes show or hide each kind, a marker opens a place's details, and places the map can't pin down are listed below it with the reason.",
    "Give a trip its own headline image in Edit trip, or when creating it. It runs across the top of the trip's card in All trips and as a banner on its page, and you can drag and zoom each one separately to frame it. Replace or remove it any time; a trip without one looks as before.",
    "Give each trip its own tagline, shown in capitals above its name on its page in place of AN ADVENTURE IN THE MAKING. Type up to 120 characters in Tagline, below Trip name in the trip's editor, or leave it blank for the default. ChatGPT and Claude can propose one too.",
    "See each destination's primary photo across the top of its card in Destinations, framed with its saved crop.",
    "Arrange All trips in your own order by dragging each card's handle, or with the keyboard. The order saves as soon as you drop and is yours alone: people you share a trip with keep their own.",
    "Open Help in the header, or beside the X in any editor, for short notes on what the page you're on is for and how to use it, without leaving the page or losing your changes.",
    "Type an airport code such as CLE in a departing, return, or layover city to choose that airport. The trip map now places layovers saved as airport codes instead of listing them under Not on the map.",
    "Photo galleries load faster: their thumbnails and editor previews now download small versions of each photo instead of the full photo.",
    "Read small and secondary text more easily, now darker to meet accessibility contrast standards, and hear clearer names and a correct heading order on trip pages with a screen reader.",
  ],
}, {
  version: "1.12",
  date: "2026-11-15",
  changes: [
    "See each trip's whole journey on a map below its header: the departing city, every destination in route order, each connection's layovers and stops, and the return city, joined by straight lines with each connection's transportation icons. Select a marker to go to its destination, stop, or connection. Places the map can't find are listed below it instead of being guessed.",
    "Estimate spending on the way, such as airport meals, drinks, and layover purchases, with Miscellaneous spending in each travel connection's editor. One amount covers the whole connection for the whole party. It shows on the connection's card and adds up in the trip estimate's new Transit miscellaneous row. Leaving it blank never makes an estimate partial, and ChatGPT and Claude can propose it too.",
    "Choose what each destination photo shows where it's cropped: in the destination's photo editor, Adjust crop under a photo lets you drag it with a mouse or a finger inside a frame shaped like the main photo. Apply the crop and save the destination to use it for the main photo and thumbnails on every screen, or use Reset to center to start over. The photo itself, the photos' order, and your primary photo stay the same.",
    "Give each destination its own tagline, shown in capitals above its name on its page in place of A PLACE WORTH KNOWING. Type up to 120 characters in Tagline, below City or destination in the destination's editor, or leave it blank for the default. ChatGPT and Claude can propose one too.",
    "A trip without a departing city now shows an Estimated total once every amount it needs is filled in, on its page and its card in All trips, instead of a Partial estimate with nothing left to fix.",
    "If your browser closes an editor while it's saving, as Chrome can after repeated Escapes and Android's back button can, a failed save's error now appears at the bottom of the screen, and every editor opens again without reloading the page.",
    "Send feedback keeps working for everyone when one account sends a lot or Jira is briefly unavailable: each account now has its own limits, so one can't use up everyone's, and a send that failed without creating anything in Jira no longer counts.",
  ],
}, {
  version: "1.11",
  date: "2026-11-14",
  changes: [
    "Mark each restaurant as Breakfast, Lunch, Dinner, Snack, or Drinks, in any combination or none, under Restaurant types in its editor. They show as tags on its cards and at the top of its details in every trip that visits the destination, and ChatGPT and Claude can propose them too.",
    "Delete a hotel, activity, or restaurant while editing it: Delete sits beside Cancel and asks you to confirm. Canceling returns you to the editor with your unsaved changes, and deleting doesn't save them.",
    "Drag photos into a new order with a mouse or trackpad while editing a destination, hotel, activity, restaurant, or church. Saving keeps the order, Cancel or Undo photo changes puts it back, and your primary photo stays the same. Photo editing on phones and tablets is unchanged.",
    "Step through a destination's photos with the arrows on its main photo. They appear when you point at the photo and stay visible on phones and tablets. Next on the last photo returns to the first.",
    "The arrows that scroll a destination's hotel, activity, and restaurant cards now loop: Next at the end returns to the first cards, and Previous at the start goes to the last.",
    "See every activity photo at the same size, whatever its shape, on a destination's activity cards and the Activities page, where an activity without photos keeps an empty frame of the same size. Cards no longer stretch to fit a tall photo or grow as photos load.",
    "Confirmations such as Delete and Remove from trip now open in the middle of the screen over a darker background. On phones, a long message scrolls while Cancel and the confirming button stay in view, and both buttons are easier to tap.",
    "Review proposals from ChatGPT and Claude on your phone: each changed field shows its Before and After values one above the other, long text wraps to fit, and Approve every change and Reject are easier to tap.",
    "See where you are when using the keyboard on All trips and Destinations: the search field and each card now show a focus outline.",
    "If an update can't open or upgrade your saved plans, Travel keeps running the version you were using instead of switching to one that can't load them.",
  ],
}, {
  version: "1.10",
  date: "2026-11-14",
  changes: [
    "See each destination's hotels, activities, and restaurants below its budget, on trip pages and in Destinations, as cards showing each idea's photo, name, and price, with ideas chosen for the budget first. Select a card to see its details and edit it. From each section you can also edit its budget, add an idea, or open its full page with Manage, which replaces the budget's links.",
    "See a destination's city exactly as you typed it, such as Tokyo, Kyoto, Japan, on cards, travel connections, page titles, and in the editor. Only cities chosen from a suggestion show shorter. Cities saved before this update also show shorter when they read as a city, region, and country, so Vienna, State of Vienna, Austria shows as Vienna, Austria.",
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
  date: "2026-11-12",
  changes: [
    "See specific validation messages when a change cannot be saved, regardless of which page or image loaded first.",
    "City suggestions now limit excessive requests and pause briefly when the provider is busy; you can still enter cities manually.",
    "Retry feedback after a temporary failure without closing the form or losing your draft, with clearer error messages.",
    "Use Try again to recover from a temporary page failure. Missing pages and server errors now return the correct response status.",
    "Start researching a city before it's in any trip with New destination in Destinations; a city you already have opens instead. Delete a destination you own from its page once no trip visits it, along with everything saved for it.",
    "Keep health and safety research with each destination, including travel advisories, health precautions, local safety, emergency contacts, official sources, and the date you checked them.",
    "Between the places now shows an icon for each kind of transportation a connection lists, such as a train, bus, or boat, instead of always an airplane.",
    "See only the fields you meant to edit: Edit estimate & nights on Hotels, Edit miscellaneous budget, and Edit destination nights on Restaurants each open just their own fields, while Edit destination still opens everything.",
    "Find Cancel and Save at the bottom of every editor, Cancel on the left and Save on the right, in view while the fields scroll, with any save error just above them.",
    "Type right away when an editor opens: its first field now has focus. City suggestions appear when you type or press the Up or Down arrow, not as soon as a city field is focused.",
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
