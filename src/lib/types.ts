import type { AiPlatform } from "./ai-auth";
import type { Coordinates, SavedCoordinates } from "./coordinates";
import type { PreviewChange } from "./ai-preview";
import type { EntryRequirements } from "./entry-requirements";
import type { HealthSafety } from "./health-safety";
import type { LayoverPlan, SavedLayoverPlan } from "./layover-plan";
import type { MonthlyClimate } from "./typical-weather";
export type FoodBudgetMode = "itemized" | "daily";
export type ActivitiesBudgetMode = "itemized" | "general";
export type Category = "hotels" | "activities" | "restaurants";
/** The meals and visits a restaurant can suit, in the order its editor and tags list them (TRA-36). Only restaurants have them. */
export const RESTAURANT_TYPES = ["breakfast", "lunch", "dinner", "snack", "drinks"] as const;
export type RestaurantType = typeof RESTAURANT_TYPES[number];
export const RESTAURANT_TYPE_LABELS: Record<RestaurantType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack", drinks: "Drinks" };
/** A destination's seasonal typical weather (TRA-13), and its monthly climate averages, or null without them (TRA-135). */
export interface TypicalWeather { weatherHighF: number | null; weatherLowF: number | null; weatherRainfall: string; weatherPeriod: string; weatherSource: string; climate: MonthlyClimate | null; }
/**
 * A trip, with its tags in alphabetical order, and its headline image, or null without one (TRA-133).
 * `tagline` is the line its page shows above its name, saved as typed, or empty for the default heading (TRA-134).
 */
export interface Trip { startDate: string | null; endDate: string | null; id: string; name: string; tagline: string; dateLabel: string; homeCity: string; returnCity: string | null; travelers: number; notes: string; createdAt: string; tags: string[]; image: TripImage | null; }
export interface HomeItem { id: string; tripId: string; name: string; notes: string; priceCents: number | null; createdAt: string; }
/**
 * A city's research, ideas, selections and budget amounts, shared by every trip that visits it. Each owner has one per city.
 * `cityFromSuggestion` records that `city` is the label of a city suggestion chosen for it, the only city shown shorter (TRA-76).
 * `tagline` is the line its page shows above its name, saved as typed, or empty for the default heading (TRA-125).
 */
export interface Destination extends TypicalWeather, DestinationPhotos { entryRequirements: EntryRequirements | null; healthSafety: HealthSafety | null; churchEnabled: boolean; id: string; city: string; cityFromSuggestion: boolean; tagline: string; miscDailyMinor: number | null; miscCurrency: string | null; hotelNightlyMinor: number | null; hotelCurrency: string | null; activitiesBudgetMode: ActivitiesBudgetMode; activitiesGeneralMinor: number | null; activitiesCurrency: string | null; foodBudgetMode: FoodBudgetMode; foodDailyMinor: number | null; foodCurrency: string | null; shoppingMinor: number | null; shoppingCurrency: string | null; notes: string; imageVersion: string | null; }
/**
 * A saved destination Add destination's search offers (TRA-142): one of the trip owner's destinations that the signed-in
 * account can open, as its city shows and its ID, which adding it to the trip sends.
 */
export type LibraryDestination = Pick<Destination, "id" | "city" | "cityFromSuggestion">;
/** One trip's stay at a destination: its place in the route, stay notes, nights and calculated dates. */
export interface TripStop { id: string; tripId: string; destinationId: string; position: number; stay: string; nights: number | null; arrivalDate: string | null; departureDate: string | null; legacyArrivalDate: string | null; legacyDepartureDate: string | null; }
/** A destination with the nights of one stay there, which its duration-based amounts use. Outside a trip they are unknown. */
export type DestinationVisit = Destination & { nights: number | null };
export interface StoredImage { version: string; data: Uint8Array; }
/** The widths in pixels of a photo and of its large version, which is wider (TRA-154). */
export interface PhotoWidths { photo: number; large: number; }
/** A photo's large version (TRA-154): the whole photo as WebP, scaled down only as far as fitting 2560 × 1920, with its width and the photo's. */
export interface LargePhoto { data: Uint8Array; widths: PhotoWidths; }
/**
 * A photo as Travel saves it, re-encoded as WebP with its thumbnail, which gallery thumbnails and editor previews show
 * (TRA-89), and its large version, or null when the upload was no larger than the photo (TRA-154).
 */
export interface PreparedImage { data: Uint8Array; thumbnail: Uint8Array; large: LargePhoto | null; }
/** A saved photo's thumbnail, or for a photo saved before Travel kept thumbnails (TRA-89), the photo to make one from. */
export type StoredThumbnail = StoredImage | { version: string; photo: Uint8Array };
export interface ResearchLink { id: string; url: string; description: string; }
export interface ItineraryStop { id: string; kind: "layover" | "stop"; place: string; arrival: string; departure: string; notes: string; }
/**
 * A travel connection. `miscCents` is the whole party's miscellaneous spending on the way, such as airport meals and
 * layover purchases, apart from its price, or null when not estimated (TRA-26). `layoverPlans` are the plans of layovers
 * in its itinerary, each naming its layover (TRA-45).
 */
export interface TravelLeg { id: string; tripId: string; fromId: string | null; toId: string | null; method: string; priceCents: number | null; miscCents: number | null; departure: string; arrival: string; url: string; notes: string; itinerary: ItineraryStop[]; links: ResearchLink[]; layoverPlans: SavedLayoverPlan[]; }
/**
 * A saved photo: its ID and version, which its address names, and the widths of it and its large version, or null for a
 * photo without one, as a photo saved before TRA-154 or no larger than 1600 × 1200 is.
 */
export interface CandidateImage { id: string; version: string; widths: PhotoWidths | null; }
/**
 * A destination photo's focal point (TRA-53): the point of the photo, as percentages of its width and height from its top
 * left corner, that stays in view where it is cropped to fit a frame, at the same place in the frame. 50, 50 is its center.
 */
export interface PhotoFocus { focusX: number; focusY: number; }
export interface DestinationImage extends CandidateImage, PhotoFocus {}
/**
 * How a trip's headline image is cropped to fit one of its frames (TRA-133): its focal point, as a destination photo's
 * is, and its zoom, how many times larger than the smallest size covering the frame it shows, from 1 to MAX_PHOTO_ZOOM.
 * Zooming keeps the focal point at the same place in the frame.
 */
export interface PhotoCrop extends PhotoFocus { zoom: number; }
/** A trip's headline image crops (TRA-133): one for the top of its card on All trips, and one for the banner on its page. */
export interface TripImageCrops { card: PhotoCrop; banner: PhotoCrop; }
/**
 * A trip's headline image (TRA-133): its version, which its address names, its crops, and the widths of it and its large
 * version, or null without one (TRA-154).
 */
export interface TripImage extends TripImageCrops { version: string; widths: PhotoWidths | null; }
/**
 * A trip save's change to its headline image (TRA-133): a new image Travel prepared from an upload, with its large version
 * (TRA-154) and its crops; new crops for the saved image of `version`; or null to remove the image. A save without one
 * keeps the image and its crops.
 */
export type TripImageUpdate = ({ data: Uint8Array; large: LargePhoto | null } & TripImageCrops) | ({ version: string } & TripImageCrops) | null;
export interface DestinationPhotos { images: DestinationImage[]; mainImageId: string | null; }
/**
 * A photo editor's changes to a destination's, idea's or church's photos. `order` lists every photo it keeps and adds, and
 * is sent only when they are rearranged (TRA-126). `focus` gives destination photos it keeps or adds new focal points, and
 * is sent only for those that change (TRA-53); idea and church photos have none.
 */
export interface GalleryUpdate { add: ({ id: string } & PreparedImage)[]; remove: string[]; mainImageId?: string | null; order?: string[]; focus?: ({ id: string } & PhotoFocus)[]; }
/**
 * A hotel, activity or restaurant idea. `description` says what it is in a few words, such as "Boutique hotel", shown
 * below its name on its cards, or is empty without one (TRA-138). `restaurantTypes` is empty for hotels and activities,
 * and for a restaurant without any. `coordinates` place it on its destination's map without a lookup, or are null (TRA-150).
 */
export interface Candidate { id: string; destinationId: string; category: Category; position: number; mustDo: boolean; name: string; description: string; priceCents: number | null; address: string; url: string; notes: string; included: boolean; links: ResearchLink[]; images: CandidateImage[]; mainImageId: string | null; restaurantTypes: RestaurantType[]; coordinates: SavedCoordinates | null; }
export interface MassTime { id: string; day: string; time: string; }
/** A church. `coordinates` place it on its destination's map without a lookup, or are null (TRA-150). */
export interface Church { id: string; destinationId: string; name: string; address: string; denomination: string; url: string; massTimes: MassTime[]; images: CandidateImage[]; mainImageId: string | null; coordinates: SavedCoordinates | null; }
/** `tags` is one spelling of each tag on the trips the account can open, in alphabetical order, for a trip's page to reuse and the trip list to filter by. Destinations pages leave it empty. */
export interface Snapshot { churches: Church[]; trips: Trip[]; homeItems: HomeItem[]; stops: TripStop[]; destinations: Destination[]; legs: TravelLeg[]; candidates: Candidate[]; tags: string[]; }
/**
 * A destination's shared research and budget amounts as a save sends them. A field left out keeps its saved value, except
 * that a new city sent without `cityFromSuggestion` was entered some other way.
 */
export interface DestinationFields { city?: string; cityFromSuggestion?: true; tagline?: string; notes?: string; miscDailyAmount?: string; hotelNightlyAmount?: string; activitiesBudgetMode?: ActivitiesBudgetMode; activitiesGeneralAmount?: string; foodBudgetMode?: FoodBudgetMode; foodDailyAmount?: string; shoppingAmount?: string; weatherHighF?: number | null; weatherLowF?: number | null; weatherRainfall?: string; weatherPeriod?: string; weatherSource?: string; image?: PreparedImage | null; gallery?: GalleryUpdate }
/** One trip's stay notes and nights at a destination. */
export interface StopFields { stay?: string; nights?: number | null }
/**
 * A save names the item it changes by its ID. An editor adding an item gives it its ID when it opens and sends it with
 * `create`, so saving again after a response is lost changes that item instead of adding another. Without `create`, a
 * save changes a saved item, and is refused when the item no longer exists.
 */
export type Mutation =
 // `image` changes the trip's headline image (TRA-133), only from an upload or the trip editor's crops. Left out, it keeps it.
 // `tagline` is the line the trip's page shows above its name (TRA-134). Left out, as a page opened before taglines does, it keeps the saved one.
 | { type: "trip.save"; id: string; create?: true; startDate?: string | null; name: string; tagline?: string; dateLabel: string; homeCity: string; returnCity?: string | null; travelers: number; notes: string; image?: TripImageUpdate }
 | { type: "trip.delete"; id: string }
 | { type: "trip.share"; tripId: string; email: string }
 | { type: "trip.unshare"; tripId: string; email: string }
 // Adds a tag to a trip, spelled as the same tag already is on a trip the account can open.
 | { type: "trip.tag"; tripId: string; name: string }
 // Removes one tag from a trip. The trip, its other tags and other trips' tags stay.
 | { type: "trip.untag"; tripId: string; name: string }
 // Puts every trip the account can open, each once, in the account's own order on All trips (TRA-16). Other accounts keep theirs.
 | { type: "trip.order"; tripIds: string[] }
 | { type: "homeItem.save"; id: string; create?: true; tripId: string; name: string; price: string; notes: string }
 | { type: "homeItem.delete"; id: string; tripId: string }
 // Changes a saved destination everywhere it is used, and with `stopId` that trip's stay notes and nights too.
 | ({ type: "destination.save"; id: string; stopId?: string } & DestinationFields & StopFields)
 // Saves a destination outside any trip. A city the account already has a destination for opens that one instead.
 | { type: "destination.create"; city: string; cityFromSuggestion?: true }
 // Deletes a destination no trip visits, with everything saved for it. Only its owner can.
 | { type: "destination.delete"; id: string }
 | { type: "destination.entryRequirements"; id: string; requirements: EntryRequirements | null }
 | { type: "destination.healthSafety"; id: string; healthSafety: HealthSafety | null }
 // Replaces a destination's monthly climate averages, or clears them with null (TRA-135). Its seasonal typical weather stays.
 | { type: "destination.climate"; id: string; climate: MonthlyClimate | null }
 | { type: "destination.churchVisibility"; id: string; enabled: boolean }
 // An idea's or church's `coordinates` place it on its destination's map, or null removes them (TRA-150). Left out, they
 // are kept, and once a save changes the address they wait to be reviewed, so the map stops using them until they are
 // saved again or removed.
 | { type: "church.save"; id: string; create?: true; destinationId: string; name: string; address: string; denomination: string; url: string; massTimes: MassTime[]; coordinates?: Coordinates | null; gallery?: GalleryUpdate }
 | { type: "church.delete"; id: string; destinationId: string }
 // Adds a city to a trip as its last stop, without stay notes or nights: the trip owner's saved destination for the
 // city, or a new one. A city the trip already visits opens that stop instead of adding another. With `before`, one of
 // the trip's stops, the new stop goes directly before it instead (TRA-153).
 | { type: "stop.add"; tripId: string; city: string; cityFromSuggestion?: true; before?: string }
 // Adds one of the trip owner's saved destinations to a trip as its last stop, with everything saved for it, without stay
 // notes or nights (TRA-142). A destination the trip already visits opens that stop instead of adding another. With
 // `before`, one of the trip's stops, the new stop goes directly before it instead (TRA-153).
 | { type: "stop.visit"; tripId: string; destinationId: string; before?: string }
 | { type: "stop.move"; id: string; direction: "up" | "down" }
 // Removes a destination from one trip. The destination and everything saved with it stay.
 | { type: "stop.remove"; id: string }
 // `miscAmount` is the connection's miscellaneous spending on the way (TRA-26). Left out, like `itinerary` and `links`, it keeps the saved one.
 | { type: "leg.save"; id: string; method: string; price: string; miscAmount?: string; departure: string; arrival: string; url: string; notes: string; itinerary?: ItineraryStop[]; links?: ResearchLink[] }
 | { type: "leg.clear"; id: string }
 // Saves the plan of one layover in a connection's itinerary, replacing any saved one, or removes it with null (TRA-45).
 // The layover and everything else about the connection stay.
 | { type: "leg.layoverPlan"; id: string; layoverId: string; plan: LayoverPlan | null }
 // A restaurant's `restaurantTypes` replace its saved ones, and left out keep them. Hotels and activities have none.
 // `description` says what the idea is, below its name on its cards (TRA-138). Left out, as a page opened before it does, it keeps the saved one.
 | { type: "candidate.save"; id: string; create?: true; destinationId: string; category: Category; name: string; description?: string; price: string; address: string; url: string; notes: string; included: boolean; mustDo?: boolean; restaurantTypes?: RestaurantType[]; links?: ResearchLink[]; coordinates?: Coordinates | null; gallery?: GalleryUpdate }
 | { type: "candidate.move"; id: string; direction: "up" | "down" }
 | { type: "candidate.mustDo"; id: string; mustDo: boolean }
 | { type: "candidate.delete"; id: string }
 | { type: "candidate.include"; id: string; included: boolean }
 // Change a destination's, idea's or church's photos, and nothing else, with the photos Travel downloaded and prepared
 // for a ChatGPT or Claude proposal (TRA-122). Only those proposals make them; people change photos with each item's save.
 | { type: "destination.photos"; id: string; gallery: GalleryUpdate }
 | { type: "candidate.photos"; id: string; gallery: GalleryUpdate }
 | { type: "church.photos"; id: string; gallery: GalleryUpdate }
 // Set or remove an idea's or church's coordinates, and nothing else, for a ChatGPT or Claude proposal (TRA-150). Only
 // those proposals make them; people change coordinates with each item's save.
 | { type: "candidate.coordinates"; id: string; coordinates: Coordinates | null }
 | { type: "church.coordinates"; id: string; coordinates: Coordinates | null };
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
/** A photo a ChatGPT or Claude proposal adds, before Travel downloads it (TRA-122): its change's place in the proposal, from 1, its new ID, and its address. */
export interface AiPhotoToAdd { change: number; id: string; url: string; }
/** `transitMiscCents` totals the connections' miscellaneous spending, and is null when none has an amount (TRA-26). */
export interface Budget { shoppingByCurrency: Record<string, number>; travelMissingCount: number; foodByCurrency: Record<string, number>; foodMissingCount: number; activitiesByCurrency: Record<string, number>; activitiesMissingCount: number; hotelsByCurrency: Record<string, number>; hotelMissingCount: number; totalsByCurrency: Record<string, number>; miscellaneousByCurrency: Record<string, number>; miscMissingCount: number; homeCents: number; travelCents: number; transitMiscCents: number | null; knownCount: number; missingCount: number; complete: boolean; }
