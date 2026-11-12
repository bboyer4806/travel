import type { EntryRequirements } from "./entry-requirements";
import type { HealthSafety } from "./health-safety";
export type FoodBudgetMode = "itemized" | "daily";
export type ActivitiesBudgetMode = "itemized" | "general";
export type Category = "hotels" | "activities" | "restaurants";
export interface TypicalWeather { weatherHighF: number | null; weatherLowF: number | null; weatherRainfall: string; weatherPeriod: string; weatherSource: string; }
export interface Trip { startDate: string | null; endDate: string | null; id: string; name: string; dateLabel: string; homeCity: string; returnCity: string | null; travelers: number; notes: string; createdAt: string; }
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
export interface Snapshot { churches: Church[]; trips: Trip[]; homeItems: HomeItem[]; stops: TripStop[]; destinations: Destination[]; legs: TravelLeg[]; candidates: Candidate[]; }
/** A destination's shared research and budget amounts as a save sends them. A field left out keeps its saved value. */
export interface DestinationFields { city?: string; notes?: string; miscDailyAmount?: string; hotelNightlyAmount?: string; activitiesBudgetMode?: ActivitiesBudgetMode; activitiesGeneralAmount?: string; foodBudgetMode?: FoodBudgetMode; foodDailyAmount?: string; shoppingAmount?: string; weatherHighF?: number | null; weatherLowF?: number | null; weatherRainfall?: string; weatherPeriod?: string; weatherSource?: string; image?: Uint8Array | null; gallery?: DestinationGalleryUpdate }
/** One trip's stay notes and nights at a destination. */
export interface StopFields { stay?: string; nights?: number | null }
export type Mutation =
 | { type: "trip.save"; startDate?: string | null; id?: string; name: string; dateLabel: string; homeCity: string; returnCity?: string | null; travelers: number; notes: string }
 | { type: "trip.delete"; id: string }
 | { type: "trip.share"; tripId: string; email: string }
 | { type: "trip.unshare"; tripId: string; email: string }
 | { type: "homeItem.save"; id?: string; tripId: string; name: string; price: string; notes: string; completed: boolean }
 | { type: "homeItem.delete"; id: string; tripId: string }
 | { type: "homeItem.complete"; id: string; tripId: string; completed: boolean }
 // Adds a new destination to a trip as its last stop.
 | ({ type: "destination.save"; id?: undefined; tripId: string; stopId?: undefined; city: string } & DestinationFields & StopFields)
 // Changes a saved destination everywhere it is used, and with `stopId` that trip's stay notes and nights too.
 | ({ type: "destination.save"; id: string; tripId?: undefined; stopId?: string } & DestinationFields & StopFields)
 // Saves a destination outside any trip. A city the account already has a destination for opens that one instead.
 | { type: "destination.create"; city: string }
 // Deletes a destination no trip visits, with everything saved for it. Only its owner can.
 | { type: "destination.delete"; id: string }
 | { type: "destination.entryRequirements"; id: string; requirements: EntryRequirements | null }
 | { type: "destination.healthSafety"; id: string; healthSafety: HealthSafety | null }
 | { type: "destination.churchVisibility"; id: string; enabled: boolean }
 | { type: "church.save"; id?: string; destinationId: string; name: string; address: string; denomination: string; url: string; massTimes: MassTime[]; gallery?: CandidateGalleryUpdate }
 | { type: "church.delete"; id: string; destinationId: string }
 | { type: "stop.move"; id: string; direction: "up" | "down" }
 // Removes a destination from one trip. The destination and everything saved with it stay.
 | { type: "stop.remove"; id: string }
 | { type: "leg.save"; id: string; method: string; price: string; departure: string; arrival: string; url: string; notes: string; itinerary?: ItineraryStop[]; links?: ResearchLink[] }
 | { type: "leg.clear"; id: string }
 | { type: "candidate.save"; id?: string; destinationId: string; category: Category; name: string; price: string; address: string; url: string; notes: string; included: boolean; mustDo?: boolean; links?: ResearchLink[]; gallery?: CandidateGalleryUpdate }
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
export interface Budget { shoppingByCurrency: Record<string, number>; travelMissingCount: number; foodByCurrency: Record<string, number>; foodMissingCount: number; activitiesByCurrency: Record<string, number>; activitiesMissingCount: number; hotelsByCurrency: Record<string, number>; hotelMissingCount: number; totalsByCurrency: Record<string, number>; miscellaneousByCurrency: Record<string, number>; miscMissingCount: number; homeCents: number; travelCents: number; knownCount: number; missingCount: number; complete: boolean; }
