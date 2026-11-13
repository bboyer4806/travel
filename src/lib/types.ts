import type { AiPlatform } from "./ai-auth";
import type { PreviewChange } from "./ai-preview";
import type { EntryRequirements } from "./entry-requirements";
import type { HealthSafety } from "./health-safety";
export type FoodBudgetMode = "itemized" | "daily";
export type ActivitiesBudgetMode = "itemized" | "general";
export type Category = "hotels" | "activities" | "restaurants";
export interface TypicalWeather { weatherHighF: number | null; weatherLowF: number | null; weatherRainfall: string; weatherPeriod: string; weatherSource: string; }
/** A trip, with its tags in alphabetical order. */
export interface Trip { startDate: string | null; endDate: string | null; id: string; name: string; dateLabel: string; homeCity: string; returnCity: string | null; travelers: number; notes: string; createdAt: string; tags: string[]; }
export interface HomeItem { id: string; tripId: string; name: string; notes: string; priceCents: number | null; completed: boolean; createdAt: string; }
/** A city's research, ideas, selections and budget amounts, shared by every trip that visits it. Each owner has one per city. */
export interface Destination extends TypicalWeather, DestinationPhotos { entryRequirements: EntryRequirements | null; healthSafety: HealthSafety | null; churchEnabled: boolean; id: string; city: string; miscDailyMinor: number | null; miscCurrency: string | null; hotelNightlyMinor: number | null; hotelCurrency: string | null; activitiesBudgetMode: ActivitiesBudgetMode; activitiesGeneralMinor: number | null; activitiesCurrency: string | null; foodBudgetMode: FoodBudgetMode; foodDailyMinor: number | null; foodCurrency: string | null; shoppingMinor: number | null; shoppingCurrency: string | null; notes: string; imageVersion: string | null; }
/** One trip's stay at a destination: its place in the route, stay notes, nights and calculated dates. */
export interface TripStop { id: string; tripId: string; destinationId: string; position: number; stay: string; nights: number | null; arrivalDate: string | null; departureDate: string | null; legacyArrivalDate: string | null; legacyDepartureDate: string | null; }
/** A destination with the nights of one stay there, which its duration-based amounts use. Outside a trip they are unknown. */
export type DestinationVisit = Destination & { nights: number | null };
export interface StoredImage { version: string; data: Uint8Array; }
export interface ResearchLink { id: string; url: string; description: string; }
export interface ItineraryStop { id: string; kind: "layover" | "stop"; place: string; arrival: string; departure: string; notes: string; }
export interface TravelLeg { id: string; tripId: string; fromId: string | null; toId: string | null; method: string; priceCents: number | null; departure: string; arrival: string; url: string; notes: string; itinerary: ItineraryStop[]; links: ResearchLink[]; }
export interface CandidateImage { id: string; version: string; }
export interface DestinationPhotos { images: CandidateImage[]; mainImageId: string | null; }
export interface DestinationGalleryUpdate { add: { id: string; data: Uint8Array }[]; remove: string[]; mainImageId?: string | null; order?: string[]; }
export interface CandidateGalleryUpdate { add: { id: string; data: Uint8Array }[]; remove: string[]; mainImageId?: string | null; }
export interface Candidate { id: string; destinationId: string; category: Category; position: number; mustDo: boolean; name: string; priceCents: number | null; address: string; url: string; notes: string; included: boolean; links: ResearchLink[]; images: CandidateImage[]; mainImageId: string | null; }
export interface MassTime { id: string; day: string; time: string; }
export interface Church { id: string; destinationId: string; name: string; address: string; denomination: string; url: string; massTimes: MassTime[]; images: CandidateImage[]; mainImageId: string | null; }
/** `tags` is one spelling of each tag on the trips the account can open, in alphabetical order, for a trip's page to reuse and the trip list to filter by. Destinations pages leave it empty. */
export interface Snapshot { churches: Church[]; trips: Trip[]; homeItems: HomeItem[]; stops: TripStop[]; destinations: Destination[]; legs: TravelLeg[]; candidates: Candidate[]; tags: string[]; }
/** A destination's shared research and budget amounts as a save sends them. A field left out keeps its saved value. */
export interface DestinationFields { city?: string; notes?: string; miscDailyAmount?: string; hotelNightlyAmount?: string; activitiesBudgetMode?: ActivitiesBudgetMode; activitiesGeneralAmount?: string; foodBudgetMode?: FoodBudgetMode; foodDailyAmount?: string; shoppingAmount?: string; weatherHighF?: number | null; weatherLowF?: number | null; weatherRainfall?: string; weatherPeriod?: string; weatherSource?: string; image?: Uint8Array | null; gallery?: DestinationGalleryUpdate }
/** One trip's stay notes and nights at a destination. */
export interface StopFields { stay?: string; nights?: number | null }
/**
 * A save names the item it changes by its ID. An editor adding an item gives it its ID when it opens and sends it with
 * `create`, so saving again after a response is lost changes that item instead of adding another. Without `create`, a
 * save changes a saved item, and is refused when the item no longer exists.
 */
export type Mutation =
 | { type: "trip.save"; id: string; create?: true; startDate?: string | null; name: string; dateLabel: string; homeCity: string; returnCity?: string | null; travelers: number; notes: string }
 | { type: "trip.delete"; id: string }
 | { type: "trip.share"; tripId: string; email: string }
 | { type: "trip.unshare"; tripId: string; email: string }
 // Adds a tag to a trip, spelled as the same tag already is on a trip the account can open.
 | { type: "trip.tag"; tripId: string; name: string }
 // Removes one tag from a trip. The trip, its other tags and other trips' tags stay.
 | { type: "trip.untag"; tripId: string; name: string }
 | { type: "homeItem.save"; id: string; create?: true; tripId: string; name: string; price: string; notes: string; completed: boolean }
 | { type: "homeItem.delete"; id: string; tripId: string }
 | { type: "homeItem.complete"; id: string; tripId: string; completed: boolean }
 // Changes a saved destination everywhere it is used, and with `stopId` that trip's stay notes and nights too.
 | ({ type: "destination.save"; id: string; stopId?: string } & DestinationFields & StopFields)
 // Saves a destination outside any trip. A city the account already has a destination for opens that one instead.
 | { type: "destination.create"; city: string }
 // Deletes a destination no trip visits, with everything saved for it. Only its owner can.
 | { type: "destination.delete"; id: string }
 | { type: "destination.entryRequirements"; id: string; requirements: EntryRequirements | null }
 | { type: "destination.healthSafety"; id: string; healthSafety: HealthSafety | null }
 | { type: "destination.churchVisibility"; id: string; enabled: boolean }
 | { type: "church.save"; id: string; create?: true; destinationId: string; name: string; address: string; denomination: string; url: string; massTimes: MassTime[]; gallery?: CandidateGalleryUpdate }
 | { type: "church.delete"; id: string; destinationId: string }
 // Adds a city to a trip as its last stop, without stay notes or nights: the trip owner's saved destination for the
 // city, or a new one. A city the trip already visits opens that stop instead of adding another.
 | { type: "stop.add"; tripId: string; city: string }
 | { type: "stop.move"; id: string; direction: "up" | "down" }
 // Removes a destination from one trip. The destination and everything saved with it stay.
 | { type: "stop.remove"; id: string }
 | { type: "leg.save"; id: string; method: string; price: string; departure: string; arrival: string; url: string; notes: string; itinerary?: ItineraryStop[]; links?: ResearchLink[] }
 | { type: "leg.clear"; id: string }
 | { type: "candidate.save"; id: string; create?: true; destinationId: string; category: Category; name: string; price: string; address: string; url: string; notes: string; included: boolean; mustDo?: boolean; links?: ResearchLink[]; gallery?: CandidateGalleryUpdate }
 | { type: "candidate.move"; id: string; direction: "up" | "down" }
 | { type: "candidate.mustDo"; id: string; mustDo: boolean }
 | { type: "candidate.delete"; id: string }
 | { type: "candidate.include"; id: string; included: boolean };
export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };
/** An email authorized to use Travel. Its Google subject is bound privately at the first sign-in. */
export interface AuthorizedAccount { id: string; email: string; name: string | null; }
/** Who Google's ID token says signed in, never what the browser says. */
export interface GoogleIdentity { subject: string; email: string; emailVerified: boolean; name: string | null; }
/** An account with access to a trip: its authorized email, and its Google name once it has signed in. */
export interface TripMember { email: string; name: string | null; }
/** What the signed-in account may do with a trip. Only its owner sees, and changes, who it is shared with. */
export type TripAccess = { role: "owner"; owner: TripMember; sharedWith: TripMember[] } | { role: "editor"; owner: TripMember };
/** What the signed-in account may do with a destination: one it owns, or one that a trip shared with it visits. */
export type DestinationAccess = { role: "owner" } | { role: "editor"; owner: TripMember };
/** A ChatGPT or Claude connection the designated owner allowed (TRA-115). Times are milliseconds since the epoch. */
export interface AiConnection { id: string; platform: AiPlatform; connectedAt: number; lastUsedAt: number; }
/**
 * Changes ChatGPT or Claude proposed (TRA-115), with what each does, and what has become of them. `digest` names the
 * proposal's exact contents, which a decision must name. Times are milliseconds since the epoch.
 */
export interface AiProposal { id: string; platform: AiPlatform; summary: string; preview: PreviewChange[]; status: "pending" | "applied" | "rejected" | "failed" | "expired"; createdAt: number; expiresAt: number; decidedAt: number | null; error: string | null; digest: string; }
export interface Budget { shoppingByCurrency: Record<string, number>; travelMissingCount: number; foodByCurrency: Record<string, number>; foodMissingCount: number; activitiesByCurrency: Record<string, number>; activitiesMissingCount: number; hotelsByCurrency: Record<string, number>; hotelMissingCount: number; totalsByCurrency: Record<string, number>; miscellaneousByCurrency: Record<string, number>; miscMissingCount: number; homeCents: number; travelCents: number; knownCount: number; missingCount: number; complete: boolean; }
