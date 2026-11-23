export interface Release { version: string; date: string; changes: readonly string[]; }

// Add only verified, deployed changes and their actual release dates at release close.
export const releases: readonly Release[] = [{
  version: "1.16",
  date: "2026-11-23",
  changes: [
    "See who has access to your trips and destinations, and to those shared with you, on Access, after Destinations in the header. Its Trips and Destinations tables list each one's Owner and Who has access; search either by name, or select Trip or Destination at the top of its first column to sort it Z to A and back. For one that isn't yours, you see its owner and yourself, since only its owner sees who else has access. The page only shows access: Share on a trip's page still changes it.",
    "Keep a destination's local emergency number, such as 112 or 911, at the top of Health and safety, where it shows even while the section is closed, in large type in a red box with a Call button, such as Call 112, that opens your device's dialer. Enter it under Local emergency number in the Health and safety editor, with the Source that gives it and the Verified date you checked it; until then the box says Emergency number not verified. ChatGPT and Claude can propose it too.",
    "Keep doctors and clinics for routine illness or minor injuries in Non-emergency medical care, below the emergency contacts in Health and safety. Add provider, in the Health and safety editor, adds one with its details and sources, and whether a source verified that it offers consultations in English, sees visiting American patients, and has walk-in, same-day, or short-notice visits. Providers verified for consultations in English are listed first, and each one has links to call it, open its website, and find it in Google Maps. ChatGPT and Claude can propose them too.",
    "Choose a destination's U.S. travel advisory level, from Level 1: Exercise Normal Precautions to Level 4: Do Not Travel, in the first field of the Health and safety editor. The open section shows the level with its number and description in its color: green for Level 1, yellow for Level 2, orange for Level 3, and red for Level 4. It starts Not set, and whatever you typed in Travel advisory level stays as it was. ChatGPT and Claude can propose it too.",
    "Include entry and visa fees, such as visas and electronic travel authorizations, in a trip's estimate as one amount for the whole party: enter it in Entry / visa fees (USD, optional), after Travelers in Edit trip, or select Not set beside Entry / visa fees in the trip estimate. It counts once in the total, and leaving it blank never makes the estimate partial. ChatGPT and Claude can propose it too.",
    "Step through a destination's activities without closing their details: Previous and Next below an activity's name show the one before or after it, in the order of its Activities carousel, with its place, such as 3 of 4. On a phone or tablet, you can also swipe across the details. The editor that Edit opens has Previous and Next too, keeping each activity's unsaved changes as you step between them, and Save changes saves only the activity shown.",
    "Mark an activity Must do without opening it: select the star at the top right of its photo in a destination's Activities carousel. It saves at once and fills in orange, and selecting it again removes Must do.",
    "Fill in a missing amount right from a trip's page: select Not set or Not estimated in the trip estimate or a destination's Budget, or a count such as 2 not estimated, to open the editor for that amount with its field ready to type in. Nothing changes until you save. Destination budget editors now name their destination, such as Edit food budget for Vienna.",
    "Record about how long each activity takes in Estimated time (minutes), below Estimated price (USD) in its editor. It shows in hours and minutes, such as 1 hour 30 minutes, in the activity's details and on its card on the Activities page. ChatGPT and Claude can propose it too.",
    "Say what a trip is mostly about in Focus, below Tagline in Edit trip or when creating a trip. Its card on All trips shows it below the trip's name and any tagline, such as Focus: History, architecture, local cuisine. ChatGPT and Claude can propose it too.",
    "See each trip's tagline, as you typed it, in orange below its name on its card on All trips, above any focus. A trip without a tagline looks as before.",
    "See each destination's tagline, as you typed it, in orange below its name on a trip's destination cards, above the stay notes. A destination without a tagline looks as before.",
    "Ask ChatGPT or Claude to add, replace, or remove a trip's headline image. The proposal's page shows the Current and Proposed images, and nothing changes until you approve it. An approved image starts centered with no zoom on the trip's card and banner, and you can frame it in Edit trip.",
    "See each month's average precipitation in Monthly averages, as a bar under the high and low lines, on its own scale in inches at the right, so rainfall and temperatures compare at a glance.",
    "A destination's map now puts each hotel, activity, restaurant, or church at its address when it can find the address, even if the place has saved coordinates. It falls back to the place's Latitude and Longitude only when it can't find the address or there is none, so a place you pinned with coordinates may now show at its address instead.",
    "Church now starts closed on a trip's destination cards and on a destination's page in Destinations, showing just its heading with Add church and Hide Church. Select the Church heading to show or hide its Sundays and churches. A destination's Church page still shows everything.",
    "On a phone, a trip's page has less padding and space around and between its cards, panels, and sections, so more of the trip fits on each screen. Text sizes and buttons are unchanged.",
  ],
}, {
  version: "1.15",
  date: "2026-11-21",
  changes: [
    "Plan what to do during a layover: Plan layover, under a saved layover in Between the places, opens a plan with the airport's time zone, when you land and when your connecting flight leaves, your own estimates for immigration, customs, security, a terminal transfer, and boarding, and up to 20 activities of your own, in the airport or out, with the travel time for a trip out. Its schedule updates as you type, counts daylight saving and date changes, and warns when the plan could miss your connecting flight. Only the two flights' times are scheduled; everything else is your own estimate. ChatGPT and Claude can propose layover plans too.",
    "Pin a hotel, activity, restaurant, or church to its destination's map when the map can't find its address: enter its Latitude and Longitude under Coordinates (optional) in its editor, marked Exact or Approximate. It shows on the map at once, however far it is from the destination, and leaves Not on the map. An approximate place gets a dashed ring and says approximate location instead of an address. If its address changes, the map sets its coordinates aside until you confirm, change, or clear them. ChatGPT and Claude can propose coordinates too.",
    "Record a flight's airline and flight number in Plan this connection: Airline and Flight number appear below Transportation whenever it names a flight, such as Flight or Plane, and show on the connection's card once entered. Each connection keeps its own, and ChatGPT and Claude can propose them too.",
    "Add a destination anywhere in a trip's route with the + between its destination cards. With a mouse, it shows above and below the card you point at; on a phone or tablet, it's always there. It opens Add destination and puts the city or saved destination you choose in that spot, replacing the connection that was there with two new ones to plan.",
    "Select a hotel, activity, restaurant, or church on a destination's map to see its primary photo at the top of its details. Places without a photo show as before.",
    "Photos you add from now on look sharper on large and high-resolution screens, such as in a trip's banner: Travel keeps a larger version of each new photo and loads it only where it's needed. Photos added before look as they did; add one again from a larger original to sharpen it.",
    "On a phone, a trip's destination cards show their main photo edge to edge across the card, a little larger and in the same shape as before.",
    "Pages no longer scroll sideways on phones, even when names, notes, or links are long words without spaces. On the narrowest phones, a destination's Every month as a table scrolls sideways inside its own box.",
    "Details below a place's photo are easier to read on destination, trip, hotel, activity, restaurant, and church cards: what it is shows darker and larger under its name, addresses, notes, and dates are a little larger, and labels such as Chosen stay are bold.",
    "Entry requirements, Health and safety, and Typical weather show their Edit and Clear buttons only while open, so a closed section is just its heading. Entry requirements and Health and safety still show Add when nothing is saved.",
    "The trip estimate is shorter: the ROOM IN THE BUDGET label above it and the paragraph about what it includes are gone. Its amounts and its note on what still needs an estimate are unchanged.",
    "At home is simpler: items no longer have Mark complete, a To do or Complete tag, a completed count, or a Completed checkbox in their editor. Every item's price still counts in the trip estimate.",
    "When ChatGPT or Claude proposes a destination's monthly averages, the proposal page lists the source, the reference years, and every month from January to December, each with what's saved beside what's proposed. Assistants must name each month and use °F and inches, so a year that starts in another month or is in °C is refused instead of saved wrong.",
  ],
}, {
  version: "1.14",
  date: "2026-11-18",
  changes: [
    "See a destination's typical weather month by month: Monthly averages, in its Typical weather section, charts each month's average high and low in °F, with its precipitation and the averages' source and reference years. Point at, tap, or use the arrow keys to choose a month and read its averages. On a trip's page, the month a dated stay begins is chosen and marked Your stay begins. Record them with Add monthly averages, or ChatGPT and Claude can propose them; Travel never fills in a month itself.",
    "Add a destination you've already researched to a trip: Add destination lists matching saved destinations first, marked In your library, even when you type the name another way, such as Reykjavik for Reykjavík, Iceland. Choosing one adds it with everything saved for it, instead of an empty copy.",
    "Add a photo from its web address with Add image by URL, beside Add photos in every photo editor and beside Add image for a trip's headline image. Preview shows the image before Use this image adds it, and Travel keeps its own copy, so the photo stays if the original goes away.",
    "Say what each hotel, activity, or restaurant is, such as Boutique hotel or Traditional Italian restaurant, in What it is, below Name in its editor. It shows under its name on its cards, in up to two lines, and in its details. ChatGPT and Claude can propose it too.",
    "Point at a destination's numbered marker on a trip's map, or reach it with the keyboard, to see its name and primary photo beside it. Clicking or tapping a marker still takes you to its card.",
    "Step through a church's photos with the arrows on its main photo, as on a destination's, or swipe on a phone or tablet, in the Church section and in a church's details from the destination map.",
    "Hotel and restaurant photos now show at one size in a destination's carousels, as activity photos already did, so one tall photo no longer stretches a whole row of cards.",
    "City suggestions, such as in Add destination, are no longer cut off by the editor they open in. They open below the field, or above it when there's more room there, stay within the screen when a phone's keyboard is open, and scroll when the list is long.",
    "Between the places shows the matching transportation icon for more ways of writing it, such as Flights, Trains, Buses, Plane, Drive, Ride share, and Walk, on connections you've already saved too.",
    "The trip map is simpler: the airport search above it and the instructions below its heading are gone. Departures, returns, and layovers saved as airport codes still show at their airports.",
  ],
}, {
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
