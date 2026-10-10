export type Category = "hotels" | "activities" | "restaurants";
export interface Trip { id: string; name: string; dateLabel: string; homeCity: string; returnCity: string | null; travelers: number; notes: string; createdAt: string; }
export interface Destination { id: string; tripId: string; city: string; stay: string; notes: string; position: number; imageVersion: string | null; }
export interface DestinationImage { version: string; data: Uint8Array; }
export interface ResearchLink { id: string; url: string; description: string; }
export interface ItineraryStop { id: string; kind: "layover" | "stop"; place: string; arrival: string; departure: string; notes: string; }
export interface TravelLeg { id: string; tripId: string; fromId: string | null; toId: string | null; method: string; priceCents: number | null; departure: string; arrival: string; url: string; notes: string; itinerary: ItineraryStop[]; links: ResearchLink[]; }
export interface Candidate { id: string; destinationId: string; category: Category; name: string; priceCents: number | null; address: string; url: string; notes: string; included: boolean; links: ResearchLink[]; }
export interface Snapshot { trips: Trip[]; destinations: Destination[]; legs: TravelLeg[]; candidates: Candidate[]; }
export type Mutation =
 | { type: "trip.save"; id?: string; name: string; dateLabel: string; homeCity: string; returnCity?: string | null; travelers: number; notes: string }
 | { type: "trip.delete"; id: string }
 | { type: "destination.save"; id?: string; tripId: string; city: string; stay: string; notes: string; image?: Uint8Array | null }
 | { type: "destination.delete"; id: string }
 | { type: "destination.move"; id: string; direction: "up" | "down" }
 | { type: "leg.save"; id: string; method: string; price: string; departure: string; arrival: string; url: string; notes: string; itinerary?: ItineraryStop[]; links?: ResearchLink[] }
 | { type: "leg.clear"; id: string }
 | { type: "candidate.save"; id?: string; destinationId: string; category: Category; name: string; price: string; address: string; url: string; notes: string; included: boolean; links?: ResearchLink[] }
 | { type: "candidate.delete"; id: string }
 | { type: "candidate.include"; id: string; included: boolean };
export type ActionResult = { ok: true; snapshot: Snapshot; id?: string } | { ok: false; error: string };
export interface Budget { totalCents: number; travelCents: number; hotelsCents: number; activitiesCents: number; restaurantsCents: number; knownCount: number; missingCount: number; complete: boolean; }
