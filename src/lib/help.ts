import type { AppRoutes } from "../../.next/types/routes";
import type { Category } from "./types";

/** A page's Help (TRA-3): its name, shown as "Help: <title>", and at most six short points on what it's for and how to use it. */
export interface PageHelp {
  title: string;
  points: readonly string[];
}

/** Every page someone signed in can open: all but signing in. Next.js lists the app's pages in `AppRoutes`. */
type SignedInRoute = Exclude<AppRoutes, "/login">;

/** The pages a destination's `[category]` names, in a trip and in Destinations. */
type IdeaPage = Category | "church";

/** The not-found page's, for an address no page has and for a page whose trip, destination or proposal can't be opened. */
export const NOT_FOUND_HELP: PageHelp = {
  title: "Page not found",
  points: [
    "This trip or destination may have been deleted, or it's no longer shared with you.",
    "All trips and Destinations, at the top of the page, list everything you can open.",
    "If you still need it, ask its owner to share it with you again.",
  ],
};

/** Hotels, Activities, Restaurants and Church describe the same page in a trip and in Destinations. */
const IDEA_PAGES: Record<IdeaPage, PageHelp> = {
  hotels: {
    title: "Hotels",
    points: [
      "Hotels you're considering for this destination, with what each costs for the whole stay.",
      "Add hotel saves one, with what it is, its price, address, coordinates, photos, links and notes. The pencil edits a hotel and the trash can deletes it.",
      "Choose hotel uses its price in the budget instead of the general nightly estimate. Select Included to go back to the estimate.",
      "The Accommodation budget's edit button sets the general nightly estimate, and in a trip, the stay's nights.",
      "Up and Down set the order of the list.",
      "Hotels are shared by every trip that visits this destination.",
    ],
  },
  activities: {
    title: "Activities",
    points: [
      "Things you'd like to do at this destination, with what each costs for the whole party.",
      "Add activity saves one: what it is, its price, estimated time, address, coordinates, photos, links and notes. The pencil edits it and the trash can deletes it.",
      "Edit activities budget chooses a general amount for the whole stay or itemized activity costs.",
      "With itemized costs, Include in budget adds an activity's price. Switching methods keeps your amounts and selections.",
      "Mark as must do flags a priority without changing the budget. Up and Down set the order of the list.",
      "Activities are shared by every trip that visits this destination.",
    ],
  },
  restaurants: {
    title: "Restaurants",
    points: [
      "Places to eat at this destination, with what a meal costs for the whole party.",
      "Add restaurant saves one: what it is, its price, meals, address, coordinates, photos, links and notes. The pencil edits it and the trash can deletes it.",
      "Edit food budget chooses a daily food amount or itemized restaurant costs. In a trip, Edit destination nights sets the stay's nights.",
      "With itemized costs, Include in budget adds a restaurant's price. Switching methods keeps your amounts and selections.",
      "Mark as must do flags a priority without changing the budget. Up and Down set the order of the list.",
      "Restaurants are shared by every trip that visits this destination.",
    ],
  },
  church: {
    title: "Church",
    points: [
      "Churches you might attend at this destination, with their Mass times. A church's arrows, or a swipe across its photo, show its other photos.",
      "Add church saves one, with its address, coordinates, website, Mass times and photos. The pencil edits a church and the trash can deletes it.",
      "Mass times are only what you enter. Confirm them with the church before you go.",
      "In a trip, Church lists the Sundays of the stay, and a stay without a Sunday doesn't show it.",
      "Hide Church hides it in every trip without deleting anything, and Show Church brings it back.",
      "Churches are shared by every trip that visits this destination.",
    ],
  },
};

/**
 * Each signed-in page's Help, by its route. A route ending in `[category]` has one for each page it names. A page added
 * without Help here fails `pnpm typecheck`.
 */
const HELP: { [Route in SignedInRoute]: Route extends `${string}/[category]` ? Record<IdeaPage, PageHelp> : PageHelp } = {
  "/": {
    title: "All trips",
    points: [
      "Your trips and the trips shared with you, in your own order, each with any tagline and focus below its name, and its destinations, dates and estimated budget.",
      "New trip starts a trip with just a name. Select a trip's card to plan it, or Edit to change its name, tagline, focus, dates, cities and headline image.",
      "Drag a trip by its handle to a new place, or press Space on the handle, then the arrow keys, then Space. New trips go last.",
      "Search by trip or city, and select tags under Filter by tag to see only trips with every one. Trips move only while all of them show.",
      "Trips marked Shared by belong to someone else. You can change them, but only their owner can share or delete them.",
      "Deleting a trip keeps its destinations, with their ideas and research, in Destinations.",
    ],
  },
  "/trips/[tripId]": {
    title: "Trip",
    points: [
      "Route map with arrows: point or tab to a destination for its photo; select transportation for details. Then stays, travel, home, packing list and USD cost.",
      "Edit trip changes its name, tagline, focus, dates, travelers, entry and visa fees, cities and headline image. Only its owner shares or deletes the trip.",
      "Add destination adds a city last, a + between cards there, one In your library with its research. Card arrows move it, the pencil edits, the trash removes it.",
      "Each stay's nights set its dates; Typical weather opens on its month. An activity's star marks it Must do; its details step with Previous, Next or a swipe.",
      "Between the places: Edit adds transportation, a flight's airline and flight number, price and layovers. Plan layover times what you'll do during a layover.",
      "Packing list: Recommend items suggests what to pack, to review before adding; check items off as you pack. In a budget, Not set or Not estimated adds a cost.",
    ],
  },
  "/trips/[tripId]/destinations/[stopId]/[category]": IDEA_PAGES,
  "/destinations": {
    title: "Destinations",
    points: [
      "Every city you've researched, in a trip or not, with its primary photo if it has one, the trips that visit it and how many ideas it has.",
      "New destination saves a city to research before it's in a trip. A city you already have opens instead.",
      "Search by city or trip, and select a card to open its destination.",
      "A destination's ideas, research and budget amounts are shared by every trip that visits it, and stay here when it leaves them.",
      "Destinations marked Shared by belong to the owner of a trip shared with you. You can change them, but not delete them.",
    ],
  },
  "/destinations/[destinationId]": {
    title: "Destination",
    points: [
      "One city's research, shared by every trip that visits it: photos, notes, budget, ideas, entry requirements, health and safety, weather and churches.",
      "Edit destination changes its city, tagline, budget amounts, photos and notes. In Typical weather, select a month on the chart for its averages.",
      "Its map shows places at their address, or else coordinates; a dashed ring is approximate. Checkboxes choose places; select a marker for photos and View details.",
      "Select an idea for details, where Previous, Next or a swipe shows other activities; an activity's star marks it Must do. Manage reorders, chooses, deletes.",
      "Select a heading, like Map, Budget or Church, to show or hide it. Entry requirements, Health and safety and Typical weather show Edit and Clear only when open.",
      "In your trips lists each of your trips that visits it, with its nights and estimate. Its owner can delete it once no trip visits it.",
    ],
  },
  "/destinations/[destinationId]/[category]": IDEA_PAGES,
  "/access": {
    title: "Access",
    points: [
      "Who can open each trip and destination you can, each person by name and email, or by email until they first sign in.",
      "You see everyone with access to your own trips and destinations. For one shared with you, you see its owner and yourself.",
      "A destination is open to its owner and to everyone a trip that visits it is shared with. Each destination is listed once.",
      "Search either table by name. Select Trip or Destination at the top of its first column to sort it A to Z or Z to A.",
      "Select a name to open its page. Only a trip's owner changes who has access, with Share on the trip's page.",
      "It shows access as it was when the page opened. Refresh to see changes.",
    ],
  },
  "/whats-new": {
    title: "What's new",
    points: [
      "Recent improvements to Travel, newest release first.",
      "A dot beside What's new means a release you haven't seen in this browser. Opening this page clears it.",
      "Send feedback, at the bottom right of every page, reports a problem or suggests an improvement.",
    ],
  },
  "/ai": {
    title: "AI assistants",
    points: [
      "Connect ChatGPT or Claude to read every trip and destination in Travel and propose changes. Only you can see this page.",
      "To connect, add Travel as a custom connector in your assistant with the address under Connect, then choose Allow in Travel.",
      "Nothing changes until you approve a proposal. Select one under Proposals to review it.",
      "Revoke ends a connection at once and withdraws its proposals. A connection unused for 30 days ends by itself.",
    ],
  },
  "/ai/authorize": {
    title: "Connect an AI assistant",
    points: [
      "ChatGPT or Claude sent you here to connect it to Travel.",
      "Allow lets it read every trip, destination and account in Travel and propose changes. Cancel connects nothing.",
      "Nothing changes until you approve its proposals in AI assistants, where you can also revoke the connection.",
      "Only Travel's owner can connect an assistant.",
    ],
  },
  "/ai/proposals/[proposalId]": {
    title: "Proposal",
    points: [
      "Changes ChatGPT or Claude proposes, with every record each one adds, changes or deletes, before and after.",
      "While it waits, the photos it adds, changes or deletes show beside their records, as do a trip's current and proposed headline images.",
      "A destination's monthly averages show their source, reference years and every month, each saved value beside the proposed one.",
      "Approve every change makes them all exactly as shown, or none if Travel has changed since.",
      "Reject changes nothing.",
      "Each proposal is decided once, within 24 hours, or it expires.",
    ],
  },
};

/**
 * The Help for the page at `pathname`, from its route as Next.js matches it: each `[segment]` matches any one segment.
 * An address no page has, or an idea page that names no category, is the not-found page.
 */
export function pageHelp(pathname: string): PageHelp {
  const segments = pathname.split("/").filter(Boolean);
  for (const [route, help] of Object.entries(HELP)) {
    const pattern = route.split("/").filter(Boolean);
    if (pattern.length !== segments.length || pattern.some((part, index) => !part.startsWith("[") && part !== segments[index])) continue;
    if ("title" in help) return help;
    const page = segments[segments.length - 1];
    return Object.hasOwn(help, page) ? help[page as IdeaPage] : NOT_FOUND_HELP;
  }
  return NOT_FOUND_HELP;
}
