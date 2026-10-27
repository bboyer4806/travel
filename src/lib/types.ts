export type FoodBudgetMode = "itemized" | "daily";
export type ActivitiesBudgetMode = "itemized" | "general";
export type Category = "hotels" | "activities" | "restaurants";
export interface TypicalWeather { weatherHighF: number | null; weatherLowF: number | null; weatherRainfall: string; weatherPeriod: string; weatherSource: string; }
export interface Trip { id: string; name: string; dateLabel: string; homeCity: string; returnCity: string | null; travelers: number; notes: string; createdAt: string; }
export interface HomeItem { id: string; tripId: string; name: string; notes: string; priceCents: number | null; completed: boolean; createdAt: string; }
export interface Destination extends TypicalWeather { id: string; tripId: string; city: string; stay: string; arrivalDate: string | null; departureDate: string | null; miscDailyMinor: number | null; miscCurrency: string | null; hotelNightlyMinor: number | null; hotelCurrency: string | null; activitiesBudgetMode: ActivitiesBudgetMode; activitiesGeneralMinor: number | null; activitiesCurrency: string | null; foodBudgetMode: FoodBudgetMode; foodDailyMinor: number | null; foodCurrency: string | null; shoppingMinor: number | null; shoppingCurrency: string | null; notes: string; position: number; imageVersion: string | null; }
export interface StoredImage { version: string; data: Uint8Array; }
export interface ResearchLink { id: string; url: string; description: string; }
export interface ItineraryStop { id: string; kind: "layover" | "stop"; place: string; arrival: string; departure: string; notes: string; }
export interface TravelLeg { id: string; tripId: string; fromId: string | null; toId: string | null; method: string; priceCents: number | null; departure: string; arrival: string; url: string; notes: string; itinerary: ItineraryStop[]; links: ResearchLink[]; }
export interface CandidateImage { id: string; version: string; }
export interface CandidateGalleryUpdate { add: { id: string; data: Uint8Array }[]; remove: string[]; mainImageId?: string | null; }
export interface Candidate { id: string; destinationId: string; category: Category; name: string; priceCents: number | null; address: string; url: string; notes: string; included: boolean; links: ResearchLink[]; imageVersion: string | null; images: CandidateImage[]; mainImageId: string | null; }
export interface Snapshot { trips: Trip[]; homeItems: HomeItem[]; destinations: Destination[]; legs: TravelLeg[]; candidates: Candidate[]; }
export type Mutation =
 | { type: "trip.save"; id?: string; name: string; dateLabel: string; homeCity: string; returnCity?: string | null; travelers: number; notes: string }
 | { type: "trip.delete"; id: string }
 | { type: "homeItem.save"; id?: string; tripId: string; name: string; price: string; notes: string; completed: boolean }
 | { type: "homeItem.delete"; id: string; tripId: string }
 | { type: "homeItem.complete"; id: string; tripId: string; completed: boolean }
 | { type: "destination.save"; id?: string; tripId: string; city: string; stay: string; arrivalDate?: string | null; departureDate?: string | null; miscDailyAmount?: string; miscCurrency?: string | null; hotelNightlyAmount?: string; hotelCurrency?: string | null; activitiesBudgetMode?: ActivitiesBudgetMode; activitiesGeneralAmount?: string; activitiesCurrency?: string | null; foodBudgetMode?: FoodBudgetMode; foodDailyAmount?: string; foodCurrency?: string | null; shoppingAmount?: string; shoppingCurrency?: string | null; weatherHighF?: number | null; weatherLowF?: number | null; weatherRainfall?: string; weatherPeriod?: string; weatherSource?: string; notes: string; image?: Uint8Array | null }
 | { type: "destination.delete"; id: string }
 | { type: "destination.move"; id: string; direction: "up" | "down" }
 | { type: "leg.save"; id: string; method: string; price: string; departure: string; arrival: string; url: string; notes: string; itinerary?: ItineraryStop[]; links?: ResearchLink[] }
 | { type: "leg.clear"; id: string }
 | { type: "candidate.save"; id?: string; destinationId: string; category: Category; name: string; price: string; address: string; url: string; notes: string; included: boolean; links?: ResearchLink[]; image?: Uint8Array | null; gallery?: CandidateGalleryUpdate }
 | { type: "candidate.delete"; id: string }
 | { type: "candidate.include"; id: string; included: boolean };
export type ActionResult = { ok: true; snapshot: Snapshot; id?: string } | { ok: false; error: string };
export interface Budget { shoppingByCurrency: Record<string, number>; foodByCurrency: Record<string, number>; foodMissingCount: number; activitiesByCurrency: Record<string, number>; activitiesMissingCount: number; hotelsByCurrency: Record<string, number>; hotelMissingCount: number; totalsByCurrency: Record<string, number>; miscellaneousByCurrency: Record<string, number>; miscMissingCount: number; totalCents: number; homeCents: number; travelCents: number; hotelsCents: number; activitiesCents: number; restaurantsCents: number; knownCount: number; missingCount: number; complete: boolean; }
