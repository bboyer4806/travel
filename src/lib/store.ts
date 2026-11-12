import { createHash, randomBytes, randomUUID } from "node:crypto";
import { calculateBudget } from "./budget.ts";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { containsSunday, isValidDate, nightsToBudgetDays } from "./destination-duration.ts";
import { destinationKey } from "./destination-label.ts";
import { backfillDates, MAX_NIGHTS, sequenceDates } from "./trip-dates.ts";
import { MAX_AMOUNT_CENTS, parseMinorAmount } from "./money.ts";
import { formatMegabytes, MAX_CANDIDATE_IMAGES, MAX_DESTINATION_IMAGES, MAX_STORED_IMAGE_BYTES } from "./image-limits.ts";
import { ENTRY_REQUIREMENT_FIELDS, normalizeEntryRequirements } from "./entry-requirements.ts";
import { normalizeHealthSafety } from "./health-safety.ts";
import { SESSION_DAYS } from "./session-cookie.ts";
import type { EntryRequirements } from "./entry-requirements.ts";
import type { HealthSafety } from "./health-safety.ts";
import type { DestinationGalleryUpdate } from "./types";
import type { AuthorizedAccount, DestinationAccess, GoogleIdentity, TripAccess, TripMember, TripStop } from "./types";
import type { FoodBudgetMode, ActivitiesBudgetMode, Candidate, CandidateImage, CandidateGalleryUpdate, Category, Church, MassTime, Destination, HomeItem, StoredImage, ItineraryStop, Mutation, ResearchLink, Snapshot, TravelLeg, Trip } from "./types";

type StoredDestination = Omit<Destination, "churchEnabled" | "images" | "entryRequirements" | "healthSafety" | "mainImageId" | "imageVersion"> & { churchEnabled: number; ownerId: string; cityKey: string };
type StoredChurch = Omit<Church, "massTimes" | "images"> & { massTimesJson: string };
type StoredHomeItem = Omit<HomeItem, "completed"> & { completed: number };
type StoredLeg = Omit<TravelLeg, "itinerary" | "links"> & { itineraryJson: string; linksJson: string };
type StoredCandidate = Omit<Candidate, "links" | "included" | "mustDo" | "images"> & { linksJson: string; included: number; mustDo: number };

const CATEGORIES = ["hotels", "activities", "restaurants"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MS = SESSION_DAYS * DAY_MS;
/** The trips an account owns or was shared, as SQL binding the account's ID twice. Every read of trip data is limited to these. */
const VISIBLE_TRIPS = "SELECT id FROM trips WHERE ownerId = ? UNION SELECT tripId FROM trip_shares WHERE accountId = ?";
/** The destinations an account owns or that a trip it can open visits, as SQL binding the account's ID three times. */
const VISIBLE_DESTINATIONS = `SELECT id FROM destinations WHERE ownerId = ? UNION SELECT destinationId FROM trip_stops WHERE tripId IN (${VISIBLE_TRIPS})`;
/** Every trip column but the owner's account ID, which stays on the server. */
const TRIP_COLUMNS = "id, name, dateLabel, homeCity, returnCity, travelers, notes, createdAt, startDate";
/** Every destination column but its owner's account ID and its city key, which stay on the server. */
const DESTINATION_COLUMNS = ["id", "city", "notes", "miscDailyMinor", "miscCurrency", "hotelNightlyMinor", "hotelCurrency", "activitiesBudgetMode", "activitiesGeneralMinor", "activitiesCurrency", "foodBudgetMode", "foodDailyMinor", "foodCurrency", "shoppingMinor", "shoppingCurrency", "weatherHighF", "weatherLowF", "weatherRainfall", "weatherPeriod", "weatherSource", "churchEnabled"]
  .map((column) => "destinations." + column).join(", ");
/** How each saved trip item finds its trip. */
const TRIP_OF = {
  trips: "SELECT id AS tripId FROM trips WHERE id = ?",
  trip_stops: "SELECT tripId FROM trip_stops WHERE id = ?",
  home_items: "SELECT tripId FROM home_items WHERE id = ?",
  legs: "SELECT tripId FROM legs WHERE id = ?",
} as const;
/** How each saved destination item finds its destination. */
const DESTINATION_OF = {
  destinations: "SELECT id AS destinationId FROM destinations WHERE id = ?",
  candidates: "SELECT destinationId FROM candidates WHERE id = ?",
  churches: "SELECT destinationId FROM churches WHERE id = ?",
} as const;
/** A missing trip or destination and one the account can't open look the same, so an ID reveals nothing about other people's. */
const NOT_AVAILABLE = "This item no longer exists or isn't shared with you. Please refresh and try again.";
const OWNER_ONLY: Partial<Record<Mutation["type"], string>> = {
  "trip.delete": "Only the trip's owner can delete it.",
  "trip.share": "Only the trip's owner can share it.",
  "trip.unshare": "Only the trip's owner can remove someone's access.",
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
/**
 * Whether an error is the store's, with a message to show as written. Checked by name, not class: a
 * production build can bundle this module more than once, and the one store on globalThis throws the
 * class of whichever copy created it, so `instanceof` fails in the others.
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof Error && error.name === "ValidationError";
}

type Input = Record<string, unknown>;
function textField(input: Input, key: string, max: number, required = false): string {
  const value = input[key];
  if (typeof value !== "string") throw new ValidationError(`${key} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`Please enter ${key}.`);
  if (trimmed.length > max) throw new ValidationError(`${key} must be ${max} characters or fewer.`);
  return trimmed;
}
function idField(input: Input, key = "id"): string {
  const value = textField(input, key, 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError("This item has an invalid identifier. Please refresh and try again.");
  }
  return value;
}
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
function emailAddress(value: string): string {
  const email = normalizeEmail(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  return email;
}
function optionalId(input: Input): string | undefined {
  return input.id === undefined ? undefined : idField(input);
}
function booleanField(input: Input, key: string): boolean {
  if (typeof input[key] !== "boolean") throw new ValidationError(`${key} must be true or false.`);
  return input[key];
}
function categoryField(input: Input): Category {
  if (!CATEGORIES.includes(input.category as Category)) throw new ValidationError("Choose hotels, activities, or restaurants.");
  return input.category as Category;
}
function urlField(input: Input, required = false): string {
  const value = textField(input, "url", 2048, required);
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error("Invalid URL");
    return url.toString();
  } catch {
    throw new ValidationError("Enter a website link starting with https:// or http://.");
  }
}
/** An entered amount in cents, or null when blank. Every amount follows money.ts's rules and messages; `label` names the field in them. */
function amountCents(value: string, label: string): number | null {
  try {
    return parseMinorAmount(value, "USD", label);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new ValidationError(error.message);
  }
}
/** An entered price in cents, or null when blank. */
function priceCents(value: string): number | null {
  return amountCents(value, "Estimated price");
}
/**
 * One of a destination's budget amounts as it is saved. An amount in the save is entered in USD, the only
 * currency; one the save leaves out keeps its saved amount and currency.
 */
function destinationAmount(entered: string | undefined, label: string, savedMinor: number | null | undefined, savedCurrency: string | null | undefined): { minor: number | null; currency: string | null } {
  if (entered === undefined) return { minor: savedMinor ?? null, currency: savedCurrency ?? null };
  return { minor: amountCents(entered, label), currency: "USD" };
}
function priceField(input: Input): string {
  const value = textField(input, "price", 32);
  priceCents(value);
  return value;
}
function temperatureField(input: Input, key: "weatherHighF" | "weatherLowF"): number | null | undefined {
  const value = input[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError("Typical " + (key === "weatherHighF" ? "high" : "low") + " must be a number in °F, or left blank.");
  }
  return value;
}
function destinationDateField(input: Input, key: "startDate"): string | null | undefined {
  if (input[key] === undefined || input[key] === null) return input[key];
  const value = textField(input, key, 10);
  if (!value) return null;
  if (!isValidDate(value)) throw new ValidationError("Enter a valid trip start date in YYYY-MM-DD format.");
  return value;
}
function nightsField(input: Input): number | null | undefined {
  const value = input.nights;
  if (value === undefined || value === null) return value;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_NIGHTS) {
    throw new ValidationError(`Nights must be a whole number between 0 and ${MAX_NIGHTS}, or left blank.`);
  }
  return value;
}
function activitiesModeField(input: Input): ActivitiesBudgetMode | undefined {
  if (input.activitiesBudgetMode === undefined) return undefined;
  if (input.activitiesBudgetMode !== "itemized" && input.activitiesBudgetMode !== "general") {
    throw new ValidationError("Choose General budget or Itemized activity costs.");
  }
  return input.activitiesBudgetMode;
}
function foodModeField(input: Input): FoodBudgetMode | undefined {
  if (input.foodBudgetMode === undefined) return undefined;
  if (input.foodBudgetMode !== "itemized" && input.foodBudgetMode !== "daily") {
    throw new ValidationError("Choose Daily food budget or Itemized restaurant costs.");
  }
  return input.foodBudgetMode;
}
function returnCityField(input: Input): string | null | undefined {
  if (input.returnCity === undefined || input.returnCity === null) return input.returnCity;
  if (typeof input.returnCity !== "string" || !input.returnCity.trim()) throw new ValidationError("Enter a return city, or use the departing city for your return.");
  if (input.returnCity.trim().length > 120) throw new ValidationError("Return city must be 120 characters or fewer.");
  return input.returnCity.trim();
}
function itineraryField(input: Input): ItineraryStop[] | undefined {
  if (input.itinerary === undefined) return undefined;
  if (!Array.isArray(input.itinerary) || input.itinerary.length > 30) {
    throw new ValidationError("An itinerary can contain up to 30 layovers or stops.");
  }
  const ids = new Set<string>();
  return input.itinerary.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ValidationError("Each itinerary stop must include its place and details.");
    const stop = item as Input;
    const id = idField(stop);
    if (ids.has(id.toLowerCase())) throw new ValidationError("Each itinerary stop must have a unique identifier.");
    ids.add(id.toLowerCase());
    if (stop.kind !== "layover" && stop.kind !== "stop") throw new ValidationError("Choose a layover or stop for each itinerary entry.");
    return { id, kind: stop.kind, place: textField(stop, "place", 160, true), arrival: textField(stop, "arrival", 120), departure: textField(stop, "departure", 120), notes: textField(stop, "notes", 2000) };
  });
}
function linksField(input: Input): ResearchLink[] | undefined {
  if (input.links === undefined) return undefined;
  if (!Array.isArray(input.links) || input.links.length > 20) throw new ValidationError("You can save up to 20 research links.");
  const ids = new Set<string>();
  return input.links.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ValidationError("Each research link must include a website address.");
    const link = item as Input;
    const id = idField(link);
    if (ids.has(id.toLowerCase())) throw new ValidationError("Each research link must have a unique identifier.");
    ids.add(id.toLowerCase());
    return { id, url: urlField(link, true), description: link.description === undefined ? "" : textField(link, "description", 160) };
  });
}
function storedLinks(row: { id: string; url: string; linksJson: string }): ResearchLink[] {
  const links = JSON.parse(row.linksJson) as ResearchLink[];
  // An older container may still write the legacy URL during a rolling deployment.
  if (row.url === (links[0]?.url ?? "")) return links;
  if (!row.url) return links.slice(1);
  if (links.length) return [{ ...links[0], url: row.url }, ...links.slice(1)];
  return [{ id: row.id, url: row.url, description: "" }];
}
function savedLinks(input: { url: string; links?: ResearchLink[] }, before?: { id: string; url: string; linksJson: string }): ResearchLink[] {
  if (input.links !== undefined) return input.links;
  const links = before ? storedLinks(before) : [];
  if ((links[0]?.url ?? "") === input.url) return links;
  if (!input.url) return links.slice(1);
  if (links.length) return [{ ...links[0], url: input.url }, ...links.slice(1)];
  return [{ id: randomUUID(), url: input.url, description: "" }];
}
function imageField(input: Input, label = "Destination"): Uint8Array | null | undefined {
  const value = input.image;
  if (value === undefined || value === null) return value;
  if (!(value instanceof Uint8Array)) throw new ValidationError(`Choose a valid WebP ${label.toLowerCase()} image.`);
  if (value.byteLength > MAX_STORED_IMAGE_BYTES) throw new ValidationError(`${label} image must be ${formatMegabytes(MAX_STORED_IMAGE_BYTES)} or smaller.`);
  if (value.byteLength < 12 || ![82, 73, 70, 70].every((byte, index) => value[index] === byte) || ![87, 69, 66, 80].every((byte, index) => value[index + 8] === byte)) {
    throw new ValidationError(`Choose a valid WebP ${label.toLowerCase()} image.`);
  }
  return new Uint8Array(value);
}
function galleryField(input: Input, label = "Idea"): CandidateGalleryUpdate | undefined {
  if (input.gallery === undefined) return undefined;
  if (input.image !== undefined) throw new ValidationError("Use either a photo gallery or a single image change.");
  const value = input.gallery;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("These photo changes are invalid.");
  const gallery = value as Input;
  const maxImages = label === "Destination" ? MAX_DESTINATION_IMAGES : MAX_CANDIDATE_IMAGES;
  if (!Array.isArray(gallery.add) || !Array.isArray(gallery.remove) || gallery.add.length > maxImages || gallery.remove.length > maxImages) throw new ValidationError(`${label === "Church" ? "A church" : label === "Destination" ? "A destination" : "An idea"} can have up to ${maxImages} photos.`);
  const seen = new Set<string>();
  const add = gallery.add.map((photo) => {
    if (!photo || typeof photo !== "object" || Array.isArray(photo)) throw new ValidationError("Choose a valid photo.");
    const id = idField(photo);
    if (seen.has(id.toLowerCase())) throw new ValidationError("Each photo must have a unique identifier.");
    seen.add(id.toLowerCase());
    const data = imageField({ image: photo.data }, label);
    if (!data) throw new ValidationError("Choose a valid photo.");
    return { id, data };
  });
  const remove = gallery.remove.map((value) => {
    const id = idField({ id: value });
    if (seen.has(id.toLowerCase())) throw new ValidationError("Each photo change must have a unique identifier.");
    seen.add(id.toLowerCase());
    return id;
  });
  const mainImageId = gallery.mainImageId === undefined || gallery.mainImageId === null ? gallery.mainImageId : idField({ id: gallery.mainImageId });
  return { add, remove, mainImageId };
}
function destinationGalleryField(input: Input): DestinationGalleryUpdate | undefined {
  const gallery = galleryField(input, "Destination");
  if (!gallery) return undefined;
  const orderValue = (input.gallery as Input).order;
  if (orderValue === undefined) return gallery;
  if (!Array.isArray(orderValue) || orderValue.length > MAX_DESTINATION_IMAGES) throw new ValidationError(`A destination can have up to ${MAX_DESTINATION_IMAGES} photos.`);
  const order = orderValue.map((id) => idField({ id }));
  if (new Set(order.map((id) => id.toLowerCase())).size !== order.length) throw new ValidationError("Each photo must appear once in the photo order.");
  return { ...gallery, order };
}
function massTimesField(input: Input): MassTime[] {
  if (!Array.isArray(input.massTimes) || input.massTimes.length > 30) throw new ValidationError("A church can have up to 30 Mass times. Leave the list empty when times are unknown.");
  const ids = new Set<string>();
  return input.massTimes.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ValidationError("Each Mass time needs a day or date and a time.");
    const entry = item as Input;
    const id = idField(entry);
    if (ids.has(id.toLowerCase())) throw new ValidationError("Each Mass time must have a unique identifier.");
    ids.add(id.toLowerCase());
    return { id, day: textField(entry, "day", 120, true), time: textField(entry, "time", 120, true) };
  });
}
function validate(input: unknown): Mutation {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("The submitted information is invalid.");
  const value = input as Input;
  switch (value.type) {
    case "trip.save": {
      if (value.endDate !== undefined) throw new ValidationError("The trip end date is calculated from the start date and destination nights.");
      if (typeof value.travelers !== "number" || !Number.isInteger(value.travelers) || value.travelers < 1 || value.travelers > 999) {
        throw new ValidationError("Number of travelers must be a whole number between 1 and 999.");
      }
      return { type: value.type, id: optionalId(value), name: textField(value, "name", 120, true), startDate: destinationDateField(value, "startDate"), dateLabel: textField(value, "dateLabel", 120), homeCity: textField(value, "homeCity", 120), returnCity: returnCityField(value), travelers: value.travelers, notes: textField(value, "notes", 8000) };
    }
    case "trip.delete":
    case "stop.remove":
    case "candidate.delete":
    case "leg.clear":
      return { type: value.type, id: idField(value) };
    case "trip.share":
    case "trip.unshare":
      return { type: value.type, tripId: idField(value, "tripId"), email: emailAddress(textField(value, "email", 254)) };
    case "homeItem.save":
      return { type: value.type, id: optionalId(value), tripId: idField(value, "tripId"), name: textField(value, "name", 160, true), price: priceField(value), notes: textField(value, "notes", 8000), completed: booleanField(value, "completed") };
    case "homeItem.delete":
      return { type: value.type, id: idField(value), tripId: idField(value, "tripId") };
    case "homeItem.complete":
      return { type: value.type, id: idField(value), tripId: idField(value, "tripId"), completed: booleanField(value, "completed") };
    case "destination.save": {
      if (value.arrivalDate !== undefined || value.departureDate !== undefined) throw new ValidationError("Destination dates are calculated. Edit the trip start date or destination nights instead.");
      const fields = { city: value.city === undefined ? undefined : textField(value, "city", 120, true), stay: value.stay === undefined ? undefined : textField(value, "stay", 120), nights: nightsField(value), miscDailyAmount: value.miscDailyAmount === undefined ? undefined : textField(value, "miscDailyAmount", 32), hotelNightlyAmount: value.hotelNightlyAmount === undefined ? undefined : textField(value, "hotelNightlyAmount", 32), activitiesBudgetMode: activitiesModeField(value), activitiesGeneralAmount: value.activitiesGeneralAmount === undefined ? undefined : textField(value, "activitiesGeneralAmount", 32), foodBudgetMode: foodModeField(value), foodDailyAmount: value.foodDailyAmount === undefined ? undefined : textField(value, "foodDailyAmount", 32), shoppingAmount: value.shoppingAmount === undefined ? undefined : textField(value, "shoppingAmount", 32), weatherHighF: temperatureField(value, "weatherHighF"), weatherLowF: temperatureField(value, "weatherLowF"), weatherRainfall: value.weatherRainfall === undefined ? undefined : textField(value, "weatherRainfall", 4000), weatherPeriod: value.weatherPeriod === undefined ? undefined : textField(value, "weatherPeriod", 120), weatherSource: value.weatherSource === undefined ? undefined : textField(value, "weatherSource", 2048), notes: value.notes === undefined ? undefined : textField(value, "notes", 8000), image: imageField(value), gallery: destinationGalleryField(value) };
      // A new destination joins a trip as its last stop. A saved one is changed by its own ID, and only a trip's
      // stop has stay notes and nights, so a save that changes them names that stop.
      if (value.id === undefined) {
        if (value.tripId === undefined) throw new ValidationError("Add a destination from a trip's page.");
        if (value.stopId !== undefined) throw new ValidationError("A new destination has no stop yet. Please refresh and try again.");
        return { type: value.type, tripId: idField(value, "tripId"), ...fields, city: textField(value, "city", 120, true) };
      }
      if (value.tripId !== undefined) throw new ValidationError("A saved destination is changed by its own ID. Please refresh and try again.");
      const stopId = value.stopId === undefined ? undefined : idField(value, "stopId");
      if (stopId === undefined && (fields.stay !== undefined || fields.nights !== undefined)) throw new ValidationError("Stay notes and nights belong to a trip. Change them from the trip's page.");
      return { type: value.type, id: idField(value), stopId, ...fields };
    }
    case "destination.entryRequirements": {
      let requirements: EntryRequirements | null;
      try { requirements = normalizeEntryRequirements(value.requirements); }
      catch (error) { throw new ValidationError(error instanceof Error ? error.message : "Enter valid entry requirements."); }
      return { type: value.type, id: idField(value), requirements };
    }
    case "destination.healthSafety": {
      let healthSafety: HealthSafety | null;
      try { healthSafety = normalizeHealthSafety(value.healthSafety); }
      catch (error) { throw new ValidationError(error instanceof Error ? error.message : "Enter valid health and safety information."); }
      return { type: value.type, id: idField(value), healthSafety };
    }
    case "destination.churchVisibility":
      return { type: value.type, id: idField(value), enabled: booleanField(value, "enabled") };
    case "church.save":
      return { type: value.type, id: optionalId(value), destinationId: idField(value, "destinationId"), name: textField(value, "name", 160, true), address: textField(value, "address", 500), denomination: textField(value, "denomination", 160), url: urlField(value), massTimes: massTimesField(value), gallery: galleryField(value, "Church") };
    case "church.delete":
      return { type: value.type, id: idField(value), destinationId: idField(value, "destinationId") };
    case "stop.move":
      if (value.direction !== "up" && value.direction !== "down") throw new ValidationError("Choose a valid direction for this destination.");
      return { type: value.type, id: idField(value), direction: value.direction };
    case "leg.save":
      return { type: value.type, id: idField(value), method: textField(value, "method", 120), price: priceField(value), departure: textField(value, "departure", 120), arrival: textField(value, "arrival", 120), url: urlField(value), notes: textField(value, "notes", 8000), itinerary: itineraryField(value), links: linksField(value) };
    case "candidate.save":
      return { type: value.type, id: optionalId(value), destinationId: idField(value, "destinationId"), category: categoryField(value), name: textField(value, "name", 160, true), price: priceField(value), address: textField(value, "address", 500), url: urlField(value), notes: textField(value, "notes", 8000), included: booleanField(value, "included"), mustDo: value.mustDo === undefined ? undefined : booleanField(value, "mustDo"), links: linksField(value), gallery: galleryField(value) };
    case "candidate.move":
      if (value.direction !== "up" && value.direction !== "down") throw new ValidationError("Choose a valid direction for this idea.");
      return { type: value.type, id: idField(value), direction: value.direction };
    case "candidate.mustDo":
      return { type: value.type, id: idField(value), mustDo: booleanField(value, "mustDo") };
    case "candidate.include":
      return { type: value.type, id: idField(value), included: booleanField(value, "included") };
    default:
      throw new ValidationError("This action is not supported. Please refresh and try again.");
  }
}

/**
 * The schema this build upgrades every database to, as SQLite's user_version. A schema change adds the next
 * upgrade in createStore and raises this to match; earlier upgrades keep their own numbers.
 */
export const SCHEMA_VERSION = 22;

/** A destination as schema 20 saved it, inside one trip, with that trip's owner and name. */
type TripDestinationRow = Omit<StoredDestination, "cityKey"> & Omit<TripStop, "destinationId"> & { tripName: string };
type Weather = Pick<Destination, "weatherHighF" | "weatherLowF" | "weatherRainfall" | "weatherPeriod" | "weatherSource">;
const AMOUNT_COLUMNS = [["miscDailyMinor", "miscCurrency"], ["hotelNightlyMinor", "hotelCurrency"], ["activitiesGeneralMinor", "activitiesCurrency"], ["foodDailyMinor", "foodCurrency"], ["shoppingMinor", "shoppingCurrency"]] as const;

function weatherOf(row: Weather): Weather {
  return { weatherHighF: row.weatherHighF, weatherLowF: row.weatherLowF, weatherRainfall: row.weatherRainfall, weatherPeriod: row.weatherPeriod, weatherSource: row.weatherSource };
}
function weatherText(weather: Weather): string {
  return [weather.weatherHighF === null ? "" : `High: ${weather.weatherHighF} °F`, weather.weatherLowF === null ? "" : `Low: ${weather.weatherLowF} °F`,
    weather.weatherPeriod && `Period: ${weather.weatherPeriod}`, weather.weatherRainfall && `Rainfall: ${weather.weatherRainfall}`, weather.weatherSource && `Source: ${weather.weatherSource}`]
    .filter(Boolean).join("\n");
}
function requirementsText(requirements: EntryRequirements): string {
  return [...ENTRY_REQUIREMENT_FIELDS.map((field) => requirements[field.name] && `${field.label}: ${requirements[field.name]}`),
    ...requirements.sources.map((source) => `Source: ${source.url}${source.description ? ` (${source.description})` : ""}`),
    requirements.lastCheckedDate && `Last checked: ${requirements.lastCheckedDate}`].filter(Boolean).join("\n");
}

/**
 * One owner's destinations for the same city become the first, from the oldest trip. Ideas, photos, churches and
 * notes are all kept. The first weather and entry requirements recorded are kept, and any other weather or entry
 * requirements are added to the notes as text. An amount, budgeting method, Church choice or idea selection is
 * kept when the destinations agree on it or only one of them set it; one they set differently is cleared, so it
 * can be entered again.
 */
function mergeDestinations(db: DatabaseSync, members: TripDestinationRow[]): Omit<StoredDestination, "cityKey"> {
  const [first] = members;
  const shared = { id: first.id, ownerId: first.ownerId, city: first.city, churchEnabled: first.churchEnabled, activitiesBudgetMode: first.activitiesBudgetMode, foodBudgetMode: first.foodBudgetMode };
  const amounts = Object.fromEntries(AMOUNT_COLUMNS.flatMap(([minor, currency]) => [[minor, first[minor]], [currency, first[currency]]]));
  if (members.length === 1) return { ...shared, ...amounts, ...weatherOf(first), notes: first.notes } as Omit<StoredDestination, "cityKey">;
  const ids = JSON.stringify(members.map((member) => member.id));
  for (const category of CATEGORIES) {
    const choosing = members.filter((member) => db.prepare("SELECT 1 FROM candidates WHERE destinationId = ? AND category = ? AND included = 1").get(member.id, category));
    if (choosing.length > 1) db.prepare("UPDATE candidates SET included = 0 WHERE category = ? AND destinationId IN (SELECT value FROM json_each(?))").run(category, ids);
    // Each list continues with the next destination's ideas, in their saved order.
    const ideas = members.flatMap((member) => db.prepare("SELECT id FROM candidates WHERE destinationId = ? AND category = ? ORDER BY position, id").all(member.id, category));
    ideas.forEach((idea, position) => db.prepare("UPDATE candidates SET destinationId = ?, position = ? WHERE id = ?").run(first.id, position, idea.id));
  }
  const photos = members.flatMap((member) => db.prepare("SELECT id, isMain FROM destination_images WHERE destinationId = ? ORDER BY position, id").all(member.id));
  const main = photos.find((photo) => photo.isMain === 1)?.id;
  photos.forEach((photo, position) => db.prepare("UPDATE destination_images SET destinationId = ?, position = ?, isMain = ? WHERE id = ?").run(first.id, position, Number(photo.id === main), photo.id));
  db.prepare("UPDATE churches SET destinationId = ? WHERE destinationId IN (SELECT value FROM json_each(?))").run(first.id, ids);

  const notes = [...new Set(members.map((member) => member.notes).filter(Boolean))];
  const recorded = members.filter((member) => member.weatherHighF !== null || member.weatherLowF !== null || member.weatherRainfall || member.weatherPeriod || member.weatherSource);
  const weather = weatherOf(recorded[0] ?? first);
  const weatherNotes = new Set([weatherText(weather)]);
  for (const member of recorded) {
    const text = weatherText(member);
    if (!weatherNotes.has(text)) notes.push(`Typical weather recorded in “${member.tripName}”:\n${text}`);
    weatherNotes.add(text);
  }
  const requirements = members.flatMap((member) => {
    const row = db.prepare("SELECT requirementsJson FROM destination_entry_requirements WHERE destinationId = ?").get(member.id);
    return row ? [{ member, json: row.requirementsJson as string, text: requirementsText(JSON.parse(row.requirementsJson as string) as EntryRequirements) }] : [];
  });
  const kept = requirements.find((record) => record.text) ?? requirements[0];
  const requirementNotes = new Set(kept ? [kept.text] : []);
  for (const record of requirements) {
    if (record.text && !requirementNotes.has(record.text)) notes.push(`Entry requirements recorded in “${record.member.tripName}”:\n${record.text}`);
    requirementNotes.add(record.text);
  }
  db.prepare("DELETE FROM destination_entry_requirements WHERE destinationId IN (SELECT value FROM json_each(?))").run(ids);
  if (kept) db.prepare("INSERT INTO destination_entry_requirements(destinationId, requirementsJson) VALUES(?, ?)").run(first.id, kept.json);

  const agreed = <T>(values: T[], cleared: T): T => new Set(values).size === 1 ? values[0] : cleared;
  for (const [minor, currency] of AMOUNT_COLUMNS) {
    const set = members.filter((member) => member[minor] !== null);
    if (new Set(set.map((member) => member[minor])).size > 1) Object.assign(amounts, { [minor]: null, [currency]: "USD" });
    else if (set.length) Object.assign(amounts, { [minor]: set[0][minor], [currency]: set[0][currency] });
  }
  return {
    ...shared, ...amounts, ...weather, notes: notes.join("\n\n"),
    activitiesBudgetMode: agreed(members.map((member) => member.activitiesBudgetMode), "itemized"),
    foodBudgetMode: agreed(members.map((member) => member.foodBudgetMode), "itemized"),
    churchEnabled: agreed(members.map((member) => member.churchEnabled), 1),
  } as Omit<StoredDestination, "cityKey">;
}

/**
 * Schema 21 (TRA-105): every destination was one trip's, and now each owner has one shared destination per city
 * that trips visit through stops. Each old destination becomes a stop with the same ID, so its travel connections,
 * order, stay notes, nights and dates stay with its trip, and links to it keep working.
 */
function shareDestinations(db: DatabaseSync) {
  const rows = db.prepare(`SELECT destinations.*, trips.ownerId, trips.name AS tripName FROM destinations JOIN trips ON trips.id = destinations.tripId
    ORDER BY trips.createdAt, trips.id, destinations.position, destinations.id`).all() as unknown as TripDestinationRow[];
  const groups = new Map<string, TripDestinationRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.ownerId, destinationKey(row.city)]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const amountColumns = AMOUNT_COLUMNS.flat();
  db.exec(`
    CREATE TABLE shared_destinations (
      id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES accounts(id),
      city TEXT NOT NULL, cityKey TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      ${amountColumns.map((column) => column.endsWith("Minor") ? `${column} INTEGER CHECK(${column} BETWEEN 0 AND 9007199254740991)` : `${column} TEXT`).join(", ")},
      activitiesBudgetMode TEXT NOT NULL DEFAULT 'itemized' CHECK(activitiesBudgetMode IN ('itemized', 'general')),
      foodBudgetMode TEXT NOT NULL DEFAULT 'itemized' CHECK(foodBudgetMode IN ('itemized', 'daily')),
      weatherHighF REAL, weatherLowF REAL,
      weatherRainfall TEXT NOT NULL DEFAULT '', weatherPeriod TEXT NOT NULL DEFAULT '', weatherSource TEXT NOT NULL DEFAULT '',
      churchEnabled INTEGER NOT NULL DEFAULT 1 CHECK(churchEnabled IN (0,1))
    ) STRICT;
    CREATE TABLE trip_stops (
      id TEXT PRIMARY KEY, tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      destinationId TEXT NOT NULL REFERENCES destinations(id),
      position INTEGER NOT NULL CHECK(position >= 0), stay TEXT NOT NULL DEFAULT '',
      nights INTEGER CHECK(nights BETWEEN 0 AND 3652058),
      arrivalDate TEXT, departureDate TEXT, legacyArrivalDate TEXT, legacyDepartureDate TEXT
    ) STRICT;
  `);
  const columns = ["id", "ownerId", "city", "cityKey", "notes", ...amountColumns, "activitiesBudgetMode", "foodBudgetMode", "weatherHighF", "weatherLowF", "weatherRainfall", "weatherPeriod", "weatherSource", "churchEnabled"] as const;
  const insertDestination = db.prepare(`INSERT INTO shared_destinations(${columns.join(", ")}) VALUES(${columns.map(() => "?").join(", ")})`);
  const insertStop = db.prepare("INSERT INTO trip_stops(id, tripId, destinationId, position, stay, nights, arrivalDate, departureDate, legacyArrivalDate, legacyDepartureDate) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const members of groups.values()) {
    const destination: StoredDestination = { ...mergeDestinations(db, members), cityKey: destinationKey(members[0].city) };
    insertDestination.run(...columns.map((column) => destination[column]));
    for (const stop of members) insertStop.run(stop.id, stop.tripId, destination.id, stop.position, stop.stay, stop.nights, stop.arrivalDate, stop.departureDate, stop.legacyArrivalDate, stop.legacyDepartureDate);
  }
  // Travel connections join a trip's stops now. The other tables keep referring to destinations by name, so the
  // shared table takes the old one's place.
  db.exec(`
    CREATE TABLE shared_legs (
      id TEXT PRIMARY KEY, tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      fromId TEXT REFERENCES trip_stops(id) ON DELETE CASCADE,
      toId TEXT REFERENCES trip_stops(id) ON DELETE CASCADE,
      method TEXT NOT NULL DEFAULT '', priceCents INTEGER CHECK(priceCents BETWEEN 0 AND ${MAX_AMOUNT_CENTS}),
      departure TEXT NOT NULL DEFAULT '', arrival TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      itineraryJson TEXT NOT NULL DEFAULT '[]', linksJson TEXT NOT NULL DEFAULT '[]',
      CHECK(fromId IS NOT NULL OR toId IS NOT NULL), CHECK(fromId IS NULL OR toId IS NULL OR fromId != toId)
    ) STRICT;
    INSERT INTO shared_legs(id, tripId, fromId, toId, method, priceCents, departure, arrival, url, notes, itineraryJson, linksJson)
      SELECT id, tripId, fromId, toId, method, priceCents, departure, arrival, url, notes, itineraryJson, linksJson FROM legs;
    DROP TABLE legs;
    ALTER TABLE shared_legs RENAME TO legs;
    DROP TABLE destinations;
    ALTER TABLE shared_destinations RENAME TO destinations;
  `);
}

/**
 * Opens Travel's database, upgrading it in one transaction. `ownerEmail` is the designated owner
 * from deployment configuration: authorized at every start, and the owner of every trip from before sharing.
 */
export function createStore(databasePath: string, ownerEmail: string) {
  const owner = emailAddress(ownerEmail);
  if (databasePath !== ":memory:") mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  // An upgrade may rebuild a table others refer to, which SQLite allows only with foreign keys off, and they can
  // only be switched outside a transaction. The upgrade checks every reference itself before it commits.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version > SCHEMA_VERSION) throw new Error("This database was created by a newer version of the travel app.");
    // A new database starts with the schema 1 tables, which the upgrades below bring up to date.
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'trips'").get()) db.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, dateLabel TEXT NOT NULL DEFAULT '',
      homeCity TEXT NOT NULL DEFAULT '', travelers INTEGER NOT NULL CHECK(travelers BETWEEN 1 AND 999),
      notes TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS destinations (
      id TEXT PRIMARY KEY, tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      city TEXT NOT NULL, stay TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL CHECK(position >= 0)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS destinations_trip ON destinations(tripId, position);
    CREATE TABLE IF NOT EXISTS legs (
      id TEXT PRIMARY KEY, tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      fromId TEXT REFERENCES destinations(id) ON DELETE CASCADE,
      toId TEXT REFERENCES destinations(id) ON DELETE CASCADE,
      method TEXT NOT NULL DEFAULT '', priceCents INTEGER CHECK(priceCents BETWEEN 0 AND ${MAX_AMOUNT_CENTS}),
      departure TEXT NOT NULL DEFAULT '', arrival TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      CHECK(fromId IS NOT NULL OR toId IS NOT NULL), CHECK(fromId IS NULL OR toId IS NULL OR fromId != toId)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS legs_route ON legs(tripId, ifnull(fromId, ''), ifnull(toId, ''));
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY, destinationId TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('hotels', 'activities', 'restaurants')),
      name TEXT NOT NULL, priceCents INTEGER CHECK(priceCents BETWEEN 0 AND ${MAX_AMOUNT_CENTS}),
      address TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      included INTEGER NOT NULL DEFAULT 0 CHECK(included IN (0,1))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS candidates_destination ON candidates(destinationId);
    CREATE UNIQUE INDEX IF NOT EXISTS selected_hotel ON candidates(destinationId) WHERE category = 'hotels' AND included = 1;
    `);
    // Version 1 reset user_version at startup. Check columns as well so a rollback
    // followed by redeployment cannot repeat ALTER TABLE or replace saved links.
    const hasColumn = (table: "trips" | "destinations" | "legs" | "candidates" | "candidate_images" | "destination_images", column: string) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
    // Before schema 21 each destination belonged to one trip. The upgrades from then add trip columns only to such a
    // table, so replaying them on a later database leaves its shared destinations as they are.
    const tripDestinations = hasColumn("destinations", "tripId");
    if (version < 2) {
      if (!hasColumn("trips", "returnCity")) db.exec("ALTER TABLE trips ADD COLUMN returnCity TEXT;");
      if (!hasColumn("legs", "itineraryJson")) db.exec("ALTER TABLE legs ADD COLUMN itineraryJson TEXT NOT NULL DEFAULT '[]';");
      db.exec("PRAGMA user_version = 2;");
    }
    if (version < 3) {
      for (const table of ["legs", "candidates"] as const) {
        if (hasColumn(table, "linksJson")) continue;
        db.exec(`ALTER TABLE ${table} ADD COLUMN linksJson TEXT NOT NULL DEFAULT '[]';`);
        const update = db.prepare(`UPDATE ${table} SET linksJson = ? WHERE id = ?`);
        for (const row of db.prepare(`SELECT id, url FROM ${table} WHERE url != ''`).all()) {
          update.run(JSON.stringify([{ id: randomUUID(), url: row.url, description: "" }]), row.id);
        }
      }
      db.exec("PRAGMA user_version = 3;");
    }
    if (version < 4) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS destination_images (
          destinationId TEXT PRIMARY KEY REFERENCES destinations(id) ON DELETE CASCADE,
          version TEXT NOT NULL, data BLOB NOT NULL
        ) STRICT;
        PRAGMA user_version = 4;
      `);
    }
    if (version < 5) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS candidate_images (
          candidateId TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
          version TEXT NOT NULL, data BLOB NOT NULL
        ) STRICT;
        PRAGMA user_version = 5;
      `);
    }
    if (version < 6) {
      if (!hasColumn("candidate_images", "id")) {
        db.exec(`
          ALTER TABLE candidate_images RENAME TO candidate_images_single;
          CREATE TABLE candidate_images (
            id TEXT PRIMARY KEY, candidateId TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
            version TEXT NOT NULL, data BLOB NOT NULL,
            position INTEGER NOT NULL CHECK(position >= 0), isMain INTEGER NOT NULL CHECK(isMain IN (0,1))
          ) STRICT;
          INSERT INTO candidate_images(id, candidateId, version, data, position, isMain)
            SELECT candidateId, candidateId, version, data, 0, 1 FROM candidate_images_single;
          DROP TABLE candidate_images_single;
        `);
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS candidate_main_image ON candidate_images(candidateId) WHERE isMain = 1;
        CREATE INDEX IF NOT EXISTS candidate_image_order ON candidate_images(candidateId, position);
        PRAGMA user_version = 6;
      `);
    }
    if (version < 7) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS home_items (
          id TEXT PRIMARY KEY, tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
          name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
          priceCents INTEGER CHECK(priceCents BETWEEN 0 AND ${MAX_AMOUNT_CENTS}),
          completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)), createdAt TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS home_items_trip ON home_items(tripId, createdAt, id);
        PRAGMA user_version = 7;
      `);
    }
    if (version < 8) {
      if (tripDestinations && !hasColumn("destinations", "arrivalDate")) db.exec("ALTER TABLE destinations ADD COLUMN arrivalDate TEXT;");
      if (tripDestinations && !hasColumn("destinations", "departureDate")) db.exec("ALTER TABLE destinations ADD COLUMN departureDate TEXT;");
      if (!hasColumn("destinations", "miscDailyMinor")) db.exec("ALTER TABLE destinations ADD COLUMN miscDailyMinor INTEGER CHECK(miscDailyMinor BETWEEN 0 AND 9007199254740991);");
      if (!hasColumn("destinations", "miscCurrency")) db.exec("ALTER TABLE destinations ADD COLUMN miscCurrency TEXT;");
      db.exec("PRAGMA user_version = 8;");
    }
    if (version < 9) {
      if (!hasColumn("destinations", "hotelNightlyMinor")) db.exec("ALTER TABLE destinations ADD COLUMN hotelNightlyMinor INTEGER CHECK(hotelNightlyMinor BETWEEN 0 AND 9007199254740991);");
      if (!hasColumn("destinations", "hotelCurrency")) db.exec("ALTER TABLE destinations ADD COLUMN hotelCurrency TEXT;");
      db.exec("PRAGMA user_version = 9;");
    }
    if (version < 10) {
      if (!hasColumn("destinations", "activitiesBudgetMode")) db.exec("ALTER TABLE destinations ADD COLUMN activitiesBudgetMode TEXT NOT NULL DEFAULT 'itemized' CHECK(activitiesBudgetMode IN ('itemized', 'general'));");
      if (!hasColumn("destinations", "activitiesGeneralMinor")) db.exec("ALTER TABLE destinations ADD COLUMN activitiesGeneralMinor INTEGER CHECK(activitiesGeneralMinor BETWEEN 0 AND 9007199254740991);");
      if (!hasColumn("destinations", "activitiesCurrency")) db.exec("ALTER TABLE destinations ADD COLUMN activitiesCurrency TEXT;");
      db.exec("PRAGMA user_version = 10;");
    }
    if (version < 11) {
      if (!hasColumn("destinations", "foodBudgetMode")) db.exec("ALTER TABLE destinations ADD COLUMN foodBudgetMode TEXT NOT NULL DEFAULT 'itemized' CHECK(foodBudgetMode IN ('itemized', 'daily'));");
      if (!hasColumn("destinations", "foodDailyMinor")) db.exec("ALTER TABLE destinations ADD COLUMN foodDailyMinor INTEGER CHECK(foodDailyMinor BETWEEN 0 AND 9007199254740991);");
      if (!hasColumn("destinations", "foodCurrency")) db.exec("ALTER TABLE destinations ADD COLUMN foodCurrency TEXT;");
      db.exec("PRAGMA user_version = 11;");
    }
    if (version < 12) {
      if (!hasColumn("destinations", "shoppingMinor")) db.exec("ALTER TABLE destinations ADD COLUMN shoppingMinor INTEGER CHECK(shoppingMinor BETWEEN 0 AND 9007199254740991);");
      if (!hasColumn("destinations", "shoppingCurrency")) db.exec("ALTER TABLE destinations ADD COLUMN shoppingCurrency TEXT;");
      db.exec("PRAGMA user_version = 12;");
    }
    if (version < 13) {
      if (!hasColumn("destinations", "weatherHighF")) db.exec("ALTER TABLE destinations ADD COLUMN weatherHighF REAL;");
      if (!hasColumn("destinations", "weatherLowF")) db.exec("ALTER TABLE destinations ADD COLUMN weatherLowF REAL;");
      for (const column of ["weatherRainfall", "weatherPeriod", "weatherSource"]) {
        if (!hasColumn("destinations", column)) db.exec("ALTER TABLE destinations ADD COLUMN " + column + " TEXT NOT NULL DEFAULT '';");
      }
      db.exec("PRAGMA user_version = 13;");
    }
    if (version < 14) {
      if (!hasColumn("destinations", "churchEnabled")) {
        db.exec("ALTER TABLE destinations ADD COLUMN churchEnabled INTEGER NOT NULL DEFAULT 0 CHECK(churchEnabled IN (0,1));");
        if (tripDestinations) for (const row of db.prepare("SELECT id, arrivalDate, departureDate FROM destinations").all()) {
          if (containsSunday(row.arrivalDate as string | null, row.departureDate as string | null)) {
            db.prepare("UPDATE destinations SET churchEnabled = 1 WHERE id = ?").run(row.id);
          }
        }
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS churches (
          id TEXT PRIMARY KEY, destinationId TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
          name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', denomination TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '', massTimesJson TEXT NOT NULL DEFAULT '[]'
        ) STRICT;
        CREATE INDEX IF NOT EXISTS churches_destination ON churches(destinationId);
        CREATE TABLE IF NOT EXISTS church_images (
          id TEXT PRIMARY KEY, churchId TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
          version TEXT NOT NULL, data BLOB NOT NULL,
          position INTEGER NOT NULL CHECK(position >= 0), isMain INTEGER NOT NULL CHECK(isMain IN (0,1))
        ) STRICT;
        CREATE UNIQUE INDEX IF NOT EXISTS church_main_image ON church_images(churchId) WHERE isMain = 1;
        CREATE INDEX IF NOT EXISTS church_image_order ON church_images(churchId, position);
        PRAGMA user_version = 14;
      `);
    }
    // Refuse contrary data without changing its numbers or currency labels.
    for (const column of ["miscCurrency", "hotelCurrency", "activitiesCurrency", "foodCurrency", "shoppingCurrency"]) {
      if (db.prepare("SELECT 1 FROM destinations WHERE " + column + " IS NOT NULL AND " + column + " != 'USD' LIMIT 1").get()) {
        throw new Error("Unexpected non-USD data in " + column + ". Travel 1.2 requires USD. No amounts were converted; review the source database before upgrading.");
      }
    }
    if (version < 15) {
      if (!hasColumn("trips", "startDate")) db.exec("ALTER TABLE trips ADD COLUMN startDate TEXT;");
      if (tripDestinations) {
        const initializeDates = !hasColumn("destinations", "nights");
        if (!hasColumn("destinations", "nights")) db.exec("ALTER TABLE destinations ADD COLUMN nights INTEGER CHECK(nights BETWEEN 0 AND 3652058);");
        if (!hasColumn("destinations", "legacyArrivalDate")) {
          db.exec("ALTER TABLE destinations ADD COLUMN legacyArrivalDate TEXT; UPDATE destinations SET legacyArrivalDate = arrivalDate;");
        }
        if (!hasColumn("destinations", "legacyDepartureDate")) {
          db.exec("ALTER TABLE destinations ADD COLUMN legacyDepartureDate TEXT; UPDATE destinations SET legacyDepartureDate = departureDate;");
        }
        if (initializeDates) {
          for (const trip of db.prepare("SELECT id FROM trips").all()) {
            const stops = db.prepare("SELECT * FROM destinations WHERE tripId = ? ORDER BY position, id").all(trip.id) as unknown as TripStop[];
            const backfill = backfillDates(stops);
            db.prepare("UPDATE trips SET startDate = ? WHERE id = ?").run(backfill.startDate, trip.id);
            for (const stop of backfill.destinations) db.prepare("UPDATE destinations SET nights = ? WHERE id = ?").run(stop.nights, stop.id);
            const schedule = sequenceDates(backfill.startDate, db.prepare("SELECT id, nights FROM destinations WHERE tripId = ? ORDER BY position, id").all(trip.id) as unknown as TripStop[]);
            for (const stop of schedule.destinations) db.prepare("UPDATE destinations SET arrivalDate = ?, departureDate = ? WHERE id = ?").run(stop.arrivalDate, stop.departureDate, stop.id);
          }
        }
      }
      db.exec("PRAGMA user_version = 15;");
    }
    if (version < 16) {
      // Initialize once in the previously displayed alphabetical order. Replays
      // must retain users' subsequent ordering and priority choices.
      if (!hasColumn("candidates", "position")) {
        db.exec(`
          ALTER TABLE candidates ADD COLUMN position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0);
          WITH ordered AS (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY destinationId, category ORDER BY name COLLATE NOCASE, id) - 1 AS position
            FROM candidates
          )
          UPDATE candidates SET position = (SELECT position FROM ordered WHERE ordered.id = candidates.id);
        `);
      }
      if (!hasColumn("candidates", "mustDo")) {
        db.exec("ALTER TABLE candidates ADD COLUMN mustDo INTEGER NOT NULL DEFAULT 0 CHECK(mustDo IN (0,1) AND (category != 'hotels' OR mustDo = 0));");
      }
      db.exec("CREATE INDEX IF NOT EXISTS candidate_order ON candidates(destinationId, category, position, id); PRAGMA user_version = 16;");
    }
    if (version < 17) {
      if (!hasColumn("destination_images", "id")) {
        db.exec(`
          ALTER TABLE destination_images RENAME TO destination_images_single;
          CREATE TABLE destination_images (
            id TEXT PRIMARY KEY, destinationId TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
            version TEXT NOT NULL, data BLOB NOT NULL,
            position INTEGER NOT NULL CHECK(position >= 0), isMain INTEGER NOT NULL CHECK(isMain IN (0,1))
          ) STRICT;
          INSERT INTO destination_images(id, destinationId, version, data, position, isMain)
            SELECT destinationId, destinationId, version, data, 0, 1 FROM destination_images_single;
          DROP TABLE destination_images_single;
        `);
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS destination_main_image ON destination_images(destinationId) WHERE isMain = 1;
        CREATE INDEX IF NOT EXISTS destination_image_order ON destination_images(destinationId, position);
        PRAGMA user_version = 17;
      `);
    }
    if (version < 18) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS destination_entry_requirements (
          destinationId TEXT PRIMARY KEY REFERENCES destinations(id) ON DELETE CASCADE,
          requirementsJson TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version = 18;
      `);
    }
    if (version < 19) {
      // An email is authorized first; its stable Google subject is bound at the first sign-in.
      // Sessions keep only a hash of each browser's token, so a copy of the database signs nobody in.
      db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE CHECK(email != '' AND email = lower(trim(email))),
          googleSubject TEXT UNIQUE CHECK(googleSubject IS NULL OR googleSubject != ''),
          name TEXT,
          authorizedAt TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS sessions (
          tokenHash TEXT PRIMARY KEY,
          accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          expiresAt INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS sessions_account ON sessions(accountId);
        PRAGMA user_version = 19;
      `);
    }
    // The designated owner comes from deployment configuration, never from whoever signs in first.
    const ownerId = authorizeAccount(owner).id;
    if (version < 20) {
      // Every trip has one owner, who may share it with other accounts. Trips from before sharing all
      // go to the designated owner; a replay finds none without an owner and changes nothing.
      // SQLite can't add a NOT NULL column that references another table, so triggers keep every trip owned.
      if (!hasColumn("trips", "ownerId")) db.exec("ALTER TABLE trips ADD COLUMN ownerId TEXT REFERENCES accounts(id);");
      db.prepare("UPDATE trips SET ownerId = ? WHERE ownerId IS NULL").run(ownerId);
      db.exec(`
        CREATE INDEX IF NOT EXISTS trips_owner ON trips(ownerId);
        CREATE TRIGGER IF NOT EXISTS trips_insert_owner BEFORE INSERT ON trips WHEN NEW.ownerId IS NULL
          BEGIN SELECT RAISE(ABORT, 'Every trip needs an owner.'); END;
        CREATE TRIGGER IF NOT EXISTS trips_update_owner BEFORE UPDATE OF ownerId ON trips WHEN NEW.ownerId IS NULL
          BEGIN SELECT RAISE(ABORT, 'Every trip needs an owner.'); END;
        CREATE TABLE IF NOT EXISTS trip_shares (
          tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
          accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          sharedAt TEXT NOT NULL,
          PRIMARY KEY (tripId, accountId)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS trip_shares_account ON trip_shares(accountId);
        PRAGMA user_version = 20;
      `);
    }
    if (version < 21) {
      // Each owner has one shared destination per city, and trips visit destinations through stops (TRA-105).
      // A replay finds destinations already shared and changes nothing.
      if (tripDestinations) shareDestinations(db);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS destinations_city ON destinations(ownerId, cityKey);
        CREATE INDEX IF NOT EXISTS trip_stops_trip ON trip_stops(tripId, position);
        CREATE INDEX IF NOT EXISTS trip_stops_destination ON trip_stops(destinationId);
        CREATE UNIQUE INDEX IF NOT EXISTS legs_route ON legs(tripId, ifnull(fromId, ''), ifnull(toId, ''));
        CREATE TRIGGER IF NOT EXISTS trip_stops_insert_owner BEFORE INSERT ON trip_stops
          WHEN (SELECT ownerId FROM destinations WHERE id = NEW.destinationId) IS NOT (SELECT ownerId FROM trips WHERE id = NEW.tripId)
          BEGIN SELECT RAISE(ABORT, 'A trip can only visit its owner''s destinations.'); END;
        CREATE TRIGGER IF NOT EXISTS trip_stops_update_owner BEFORE UPDATE OF tripId, destinationId ON trip_stops
          WHEN (SELECT ownerId FROM destinations WHERE id = NEW.destinationId) IS NOT (SELECT ownerId FROM trips WHERE id = NEW.tripId)
          BEGIN SELECT RAISE(ABORT, 'A trip can only visit its owner''s destinations.'); END;
        PRAGMA user_version = 21;
      `);
    }
    if (version < 22) {
      // Each destination's manually maintained health and safety research (TRA-14). A replay keeps saved records.
      db.exec(`
        CREATE TABLE IF NOT EXISTS destination_health_safety (
          destinationId TEXT PRIMARY KEY REFERENCES destinations(id) ON DELETE CASCADE,
          healthSafetyJson TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version = 22;
      `);
    }
    if (version < SCHEMA_VERSION && db.prepare("PRAGMA foreign_key_check").get()) {
      throw new Error("This upgrade would leave saved items without the trip or destination they belong to. Nothing was changed; review the database against a backup before upgrading.");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  db.exec("PRAGMA foreign_keys = ON;");

  /** A WHERE clause limiting `column` to the given IDs, with its argument, or nothing when every row is wanted. */
  function among(column: string, ids: readonly string[] | null): [string, string[]] {
    return ids === null ? ["", []] : [` WHERE ${column} IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)]];
  }
  function photosOf(table: "destination_images" | "candidate_images" | "church_images", ownerColumn: string, ids: readonly string[] | null): Map<string, CandidateImage[]> {
    const [where, args] = among(ownerColumn, ids);
    const photos = new Map<string, CandidateImage[]>();
    for (const row of db.prepare(`SELECT id, ${ownerColumn} AS ownerId, version FROM ${table}${where} ORDER BY ${ownerColumn}, position, id`).all(...args)) {
      photos.set(row.ownerId as string, [...(photos.get(row.ownerId as string) ?? []), { id: row.id as string, version: row.version as string }]);
    }
    return photos;
  }
  function readTrips(ids: readonly string[] | null): Trip[] {
    const [where, args] = among("id", ids);
    return db.prepare(`SELECT ${TRIP_COLUMNS} FROM trips${where} ORDER BY createdAt DESC, id`).all(...args).map((row) => {
      const trip = row as unknown as Trip;
      return { ...trip, endDate: sequenceDates(trip.startDate, orderedStops(trip.id)).endDate };
    });
  }
  /** Stops matching a WHERE clause, as plain objects a page can hand to the browser. */
  function stopRows(where: string, ...args: string[]): TripStop[] {
    return db.prepare(`SELECT * FROM trip_stops${where} ORDER BY tripId, position, id`).all(...args).map((row) => ({ ...row }) as unknown as TripStop);
  }
  function readStops(tripIds: readonly string[] | null): TripStop[] {
    const [where, args] = among("tripId", tripIds);
    return stopRows(where, ...args);
  }
  function readLegs(tripIds: readonly string[] | null): TravelLeg[] {
    const [where, args] = among("legs.tripId", tripIds);
    return db.prepare(`SELECT legs.* FROM legs LEFT JOIN trip_stops ON trip_stops.id = legs.fromId${where} ORDER BY legs.tripId, coalesce(trip_stops.position, -1)`).all(...args).map((row) => {
      const { itineraryJson, linksJson, ...leg } = row as unknown as StoredLeg;
      const links = storedLinks({ ...leg, linksJson });
      return { ...leg, url: links[0]?.url ?? "", itinerary: JSON.parse(itineraryJson) as ItineraryStop[], links };
    });
  }
  function readHomeItems(tripIds: readonly string[] | null): HomeItem[] {
    const [where, args] = among("tripId", tripIds);
    return db.prepare(`SELECT * FROM home_items${where} ORDER BY createdAt, id`).all(...args).map((row) => {
      const item = row as unknown as StoredHomeItem;
      return { ...item, completed: item.completed === 1 };
    });
  }
  function readDestinations(ids: readonly string[] | null): Destination[] {
    const [where, args] = among("destinations.id", ids);
    // Entry requirements and health and safety research each have at most one record per destination.
    const [researchWhere, researchArgs] = among("destinationId", ids);
    const requirements = new Map(db.prepare("SELECT destinationId, requirementsJson FROM destination_entry_requirements" + researchWhere).all(...researchArgs)
      .map((row) => [row.destinationId as string, JSON.parse(row.requirementsJson as string) as EntryRequirements]));
    const healthSafety = new Map(db.prepare("SELECT destinationId, healthSafetyJson FROM destination_health_safety" + researchWhere).all(...researchArgs)
      .map((row) => [row.destinationId as string, JSON.parse(row.healthSafetyJson as string) as HealthSafety]));
    const photos = photosOf("destination_images", "destinationId", ids);
    return db.prepare(`SELECT ${DESTINATION_COLUMNS}, destination_images.version AS imageVersion, destination_images.id AS mainImageId FROM destinations
      LEFT JOIN destination_images ON destination_images.destinationId = destinations.id AND destination_images.isMain = 1${where} ORDER BY destinations.city COLLATE NOCASE, destinations.id`).all(...args).map((row) => {
      const destination = row as unknown as Omit<Destination, "churchEnabled" | "images" | "entryRequirements" | "healthSafety"> & { churchEnabled: number };
      return { ...destination, entryRequirements: requirements.get(destination.id) ?? null, healthSafety: healthSafety.get(destination.id) ?? null, churchEnabled: destination.churchEnabled === 1, images: photos.get(destination.id) ?? [] };
    });
  }
  function readCandidates(destinationIds: readonly string[] | null): Candidate[] {
    const [where, args] = among("candidates.destinationId", destinationIds);
    const rows = db.prepare(`SELECT candidates.*, candidate_images.id AS mainImageId FROM candidates LEFT JOIN candidate_images ON candidate_images.candidateId = candidates.id AND candidate_images.isMain = 1${where}
      ORDER BY candidates.destinationId, candidates.category, candidates.position, candidates.id`).all(...args) as unknown as StoredCandidate[];
    const photos = photosOf("candidate_images", "candidateId", destinationIds === null ? null : rows.map((candidate) => candidate.id));
    return rows.map(({ linksJson, ...candidate }) => {
      const links = storedLinks({ ...candidate, linksJson });
      return { ...candidate, url: links[0]?.url ?? "", included: candidate.included === 1, mustDo: candidate.mustDo === 1, links, images: photos.get(candidate.id) ?? [] };
    });
  }
  function readChurches(destinationIds: readonly string[] | null): Church[] {
    const [where, args] = among("churches.destinationId", destinationIds);
    const rows = db.prepare(`SELECT churches.*, church_images.id AS mainImageId FROM churches LEFT JOIN church_images ON church_images.churchId = churches.id AND church_images.isMain = 1${where}
      ORDER BY churches.name COLLATE NOCASE, churches.id`).all(...args) as unknown as (StoredChurch & { mainImageId: string | null })[];
    const photos = photosOf("church_images", "churchId", destinationIds === null ? null : rows.map((church) => church.id));
    return rows.map(({ massTimesJson, ...church }) => ({ ...church, massTimes: JSON.parse(massTimesJson) as MassTime[], images: photos.get(church.id) ?? [] }));
  }
  /** Everything saved, for checks and tests. What the app shows or changes always takes the signed-in account. */
  function getSnapshot(): Snapshot {
    return { trips: readTrips(null), stops: readStops(null), destinations: readDestinations(null), legs: readLegs(null), candidates: readCandidates(null), churches: readChurches(null), homeItems: readHomeItems(null) };
  }
  /** The trips the account owns or was shared, with their budgets and what the account may do with each. */
  function getHomeOverview(accountId: string) {
    const visible = [accountId, accountId];
    const rawTrips = db.prepare(`SELECT ${TRIP_COLUMNS} FROM trips WHERE id IN (${VISIBLE_TRIPS}) ORDER BY createdAt DESC, id`).all(...visible) as unknown as Trip[];
    const stops = db.prepare(`SELECT id, tripId, destinationId, position, nights FROM trip_stops WHERE tripId IN (${VISIBLE_TRIPS}) ORDER BY tripId, position, id`).all(...visible) as unknown as TripStop[];
    const visited = `SELECT destinationId FROM trip_stops WHERE tripId IN (${VISIBLE_TRIPS})`;
    const destinations = db.prepare(`SELECT id,city,miscDailyMinor,miscCurrency,hotelNightlyMinor,hotelCurrency,activitiesBudgetMode,activitiesGeneralMinor,activitiesCurrency,
      foodBudgetMode,foodDailyMinor,foodCurrency,shoppingMinor,shoppingCurrency FROM destinations WHERE id IN (${visited})`).all(...visible) as unknown as Destination[];
    const trips = rawTrips.map((trip) => ({ ...trip, endDate: sequenceDates(trip.startDate, stops.filter((stop) => stop.tripId === trip.id)).endDate }));
    const input: Snapshot = {
      trips, stops, destinations,
      legs: db.prepare(`SELECT tripId,fromId,toId,priceCents FROM legs WHERE tripId IN (${VISIBLE_TRIPS})`).all(...visible) as unknown as TravelLeg[],
      candidates: db.prepare(`SELECT destinationId,category,priceCents,included FROM candidates WHERE destinationId IN (${visited})`).all(...visible).map((row) => ({ ...row, included: row.included === 1 })) as unknown as Candidate[],
      homeItems: db.prepare(`SELECT tripId,priceCents FROM home_items WHERE tripId IN (${VISIBLE_TRIPS})`).all(...visible) as unknown as HomeItem[],
      churches: [],
    };
    const budgets = Object.fromEntries(trips.map((trip) => [trip.id, calculateBudget(input, trip.id)]));
    return {
      data: {
        trips,
        stops: stops.map(({ id, tripId, destinationId, position }) => ({ id, tripId, destinationId, position })) as TripStop[],
        destinations: destinations.map(({ id, city }) => ({ id, city })) as Destination[],
        legs: [], candidates: [], homeItems: [], churches: [],
      } as Snapshot,
      budgets,
      access: Object.fromEntries(trips.map((trip) => [trip.id, tripAccess(accountId, trip.id)!])) as Record<string, TripAccess>,
    };
  }
  /**
   * One trip's page, or with `stopId` one of its destinations' idea pages, and what the account may do there.
   * Undefined when the account can't open the trip.
   */
  function getTripSnapshot(accountId: string, tripId: string, stopId?: string): { data: Snapshot; access: TripAccess } | undefined {
    const access = tripAccess(accountId, tripId);
    if (!access) return undefined;
    const stops = readStops([tripId]);
    // An idea page needs only its own stop's destination; the trip page needs every destination it visits.
    const destinationIds = [...new Set(stops.filter((stop) => stopId === undefined || stop.id === stopId).map((stop) => stop.destinationId))];
    return {
      data: { trips: readTrips([tripId]), stops, destinations: readDestinations(destinationIds), legs: readLegs([tripId]), candidates: readCandidates(destinationIds), churches: readChurches(destinationIds), homeItems: readHomeItems([tripId]) },
      access,
    };
  }
  /** Every destination the account owns or that a trip it can open visits, and the trips it can open that visit them. */
  function getDestinationsOverview(accountId: string): { data: Snapshot; access: Record<string, DestinationAccess> } {
    const destinationIds = db.prepare(VISIBLE_DESTINATIONS).all(accountId, accountId, accountId).map((row) => row.id as string);
    const stops = stopRows(` WHERE tripId IN (${VISIBLE_TRIPS})`, accountId, accountId);
    return {
      data: { trips: readTrips([...new Set(stops.map((stop) => stop.tripId))]), stops, destinations: readDestinations(destinationIds), legs: [], candidates: readCandidates(destinationIds), churches: [], homeItems: [] },
      access: Object.fromEntries(destinationIds.map((id) => [id, destinationAccess(accountId, id)!])),
    };
  }
  /**
   * One destination's page and its idea pages, with only the trips the account can open that visit it, and what the
   * account may do there. Undefined when the account can't open the destination.
   */
  function getDestinationSnapshot(accountId: string, destinationId: string): { data: Snapshot; access: DestinationAccess } | undefined {
    const access = destinationAccess(accountId, destinationId);
    if (!access) return undefined;
    const stops = stopRows(` WHERE destinationId = ? AND tripId IN (${VISIBLE_TRIPS})`, destinationId, accountId, accountId);
    return {
      data: { trips: readTrips([...new Set(stops.map((stop) => stop.tripId))]), stops, destinations: readDestinations([destinationId]), legs: [], candidates: readCandidates([destinationId]), churches: readChurches([destinationId]), homeItems: [] },
      access,
    };
  }
  function getTripName(accountId: string, id: string): string | undefined {
    if (!tripRole(accountId, id)) return undefined;
    return db.prepare("SELECT name FROM trips WHERE id = ?").get(id)?.name as string | undefined;
  }
  /** The city of one of a trip's stops. */
  function getStopName(accountId: string, tripId: string, stopId: string): string | undefined {
    if (!tripRole(accountId, tripId)) return undefined;
    return db.prepare("SELECT destinations.city FROM trip_stops JOIN destinations ON destinations.id = trip_stops.destinationId WHERE trip_stops.tripId = ? AND trip_stops.id = ?").get(tripId, stopId)?.city as string | undefined;
  }
  function getDestinationName(accountId: string, destinationId: string): string | undefined {
    if (!destinationRole(accountId, destinationId)) return undefined;
    return db.prepare("SELECT city FROM destinations WHERE id = ?").get(destinationId)?.city as string | undefined;
  }
  /** The trip a saved trip item belongs to. Undefined when the item doesn't exist. */
  function tripOf(table: keyof typeof TRIP_OF, id: string): string | undefined {
    return db.prepare(TRIP_OF[table]).get(id)?.tripId as string | undefined;
  }
  /** The destination a saved destination item belongs to. Undefined when the item doesn't exist. */
  function destinationOf(table: keyof typeof DESTINATION_OF, id: string): string | undefined {
    return db.prepare(DESTINATION_OF[table]).get(id)?.destinationId as string | undefined;
  }
  /** The account's role in a trip, or undefined when the trip doesn't exist or isn't the account's to open. */
  function tripRole(accountId: string, tripId: string | undefined): TripAccess["role"] | undefined {
    if (tripId === undefined) return undefined;
    const row = db.prepare("SELECT CASE WHEN ownerId = ? THEN 'owner' WHEN EXISTS (SELECT 1 FROM trip_shares WHERE tripId = trips.id AND accountId = ?) THEN 'editor' END AS role FROM trips WHERE id = ?")
      .get(accountId, accountId, tripId);
    return (row?.role ?? undefined) as TripAccess["role"] | undefined;
  }
  /**
   * The account's role in a destination: its owner, or an editor through a trip it can open that visits it. Undefined
   * when the destination doesn't exist or isn't the account's to open, which looks the same.
   */
  function destinationRole(accountId: string, destinationId: string | undefined): DestinationAccess["role"] | undefined {
    if (destinationId === undefined) return undefined;
    const row = db.prepare(`SELECT CASE WHEN ownerId = ? THEN 'owner' WHEN EXISTS (SELECT 1 FROM trip_stops WHERE destinationId = destinations.id AND tripId IN (${VISIBLE_TRIPS})) THEN 'editor' END AS role FROM destinations WHERE id = ?`)
      .get(accountId, accountId, accountId, destinationId);
    return (row?.role ?? undefined) as DestinationAccess["role"] | undefined;
  }
  function member(row: Record<string, unknown>): TripMember {
    return { email: row.email as string, name: row.name as string | null };
  }
  /** Who owns the trip, and, for its owner only, who it is shared with. */
  function tripAccess(accountId: string, tripId: string): TripAccess | undefined {
    const role = tripRole(accountId, tripId);
    if (!role) return undefined;
    const owner = member(db.prepare("SELECT accounts.email, accounts.name FROM trips JOIN accounts ON accounts.id = trips.ownerId WHERE trips.id = ?").get(tripId)!);
    if (role === "editor") return { role, owner };
    const sharedWith = db.prepare("SELECT accounts.email, accounts.name FROM trip_shares JOIN accounts ON accounts.id = trip_shares.accountId WHERE trip_shares.tripId = ? ORDER BY accounts.email")
      .all(tripId).map(member);
    return { role, owner, sharedWith };
  }
  /** Whether the destination is the account's own, or whose it is when a trip shared with the account visits it. */
  function destinationAccess(accountId: string, destinationId: string): DestinationAccess | undefined {
    const role = destinationRole(accountId, destinationId);
    if (role !== "editor") return role && { role };
    return { role, owner: member(db.prepare("SELECT accounts.email, accounts.name FROM destinations JOIN accounts ON accounts.id = destinations.ownerId WHERE destinations.id = ?").get(destinationId)!) };
  }
  function checkHealth(): void { db.prepare("SELECT 1").get(); }

  // Photos are served only from destinations the account can open, the same as everything else in them.
  function getDestinationImage(accountId: string, id: string): StoredImage | undefined {
    if (!destinationRole(accountId, id)) return undefined;
    const row = db.prepare("SELECT version, data FROM destination_images WHERE destinationId = ? AND isMain = 1").get(id);
    return row ? { version: row.version as string, data: new Uint8Array(row.data as Uint8Array) } : undefined;
  }
  function getDestinationPhoto(accountId: string, destinationId: string, imageId: string): StoredImage | undefined {
    if (!destinationRole(accountId, destinationId)) return undefined;
    const row = db.prepare("SELECT version, data FROM destination_images WHERE destinationId = ? AND id = ?").get(destinationId, imageId);
    return row ? { version: row.version as string, data: new Uint8Array(row.data as Uint8Array) } : undefined;
  }
  function getCandidatePhoto(accountId: string, candidateId: string, imageId: string): StoredImage | undefined {
    if (!destinationRole(accountId, destinationOf("candidates", candidateId))) return undefined;
    const row = db.prepare("SELECT version, data FROM candidate_images WHERE candidateId = ? AND id = ?").get(candidateId, imageId);
    return row ? { version: row.version as string, data: new Uint8Array(row.data as Uint8Array) } : undefined;
  }
  function getChurchPhoto(accountId: string, churchId: string, imageId: string): StoredImage | undefined {
    if (!destinationRole(accountId, destinationOf("churches", churchId))) return undefined;
    const row = db.prepare("SELECT version, data FROM church_images WHERE churchId = ? AND id = ?").get(churchId, imageId);
    return row ? { version: row.version as string, data: new Uint8Array(row.data as Uint8Array) } : undefined;
  }
  function saveDestinationGallery(destinationId: string, gallery?: DestinationGalleryUpdate, image?: Uint8Array | null) {
    if (gallery === undefined && image === undefined) return;
    const current = db.prepare("SELECT id, position, isMain FROM destination_images WHERE destinationId = ? ORDER BY position, id").all(destinationId) as unknown as { id: string; position: number; isMain: number }[];
    const currentMain = current.find((photo) => photo.isMain === 1)?.id;
    if (gallery === undefined) {
      if (image === null) {
        gallery = { add: [], remove: currentMain ? [currentMain] : [] };
      } else if (image !== undefined && currentMain) {
        // Old clients and URLs continue to replace or remove only the primary photo.
        db.prepare("INSERT INTO destination_images(id,destinationId,version,data,position,isMain) VALUES(?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET version = excluded.version, data = excluded.data").run(currentMain, destinationId, randomUUID(), image, current.find((photo) => photo.id === currentMain)!.position);
        return;
      } else {
        gallery = { add: image ? [{ id: randomUUID(), data: image }] : [], remove: [] };
      }
    }
    const existingIds = new Set(current.map((photo) => photo.id));
    if (gallery.remove.some((id) => !existingIds.has(id))) throw new ValidationError("A destination photo has changed or no longer exists. Refresh and try again.");
    for (const photo of gallery.add) {
      if (db.prepare("SELECT 1 FROM destination_images WHERE lower(id) = lower(?)").get(photo.id)) throw new ValidationError("This destination photo already exists. Refresh and try again.");
    }
    const removed = new Set(gallery.remove);
    const remaining = [...current.filter((photo) => !removed.has(photo.id)).map((photo) => photo.id), ...gallery.add.map((photo) => photo.id)];
    if (remaining.length > MAX_DESTINATION_IMAGES) throw new ValidationError(`A destination can have up to ${MAX_DESTINATION_IMAGES} photos. Remove a photo before adding more.`);
    const order = gallery.order ?? remaining;
    if (order.length !== remaining.length || order.some((id) => !remaining.includes(id))) throw new ValidationError("The destination photos have changed. Refresh before rearranging them.");
    const main = gallery.mainImageId === undefined ? (currentMain && !removed.has(currentMain) ? currentMain : order[0] ?? null) : gallery.mainImageId;
    if ((main === null && order.length > 0) || (main !== null && !order.includes(main))) throw new ValidationError("Choose a primary photo from the remaining destination photos. Refresh if the gallery has changed.");
    for (const id of gallery.remove) db.prepare("DELETE FROM destination_images WHERE destinationId = ? AND id = ?").run(destinationId, id);
    gallery.add.forEach((photo) => db.prepare("INSERT INTO destination_images(id,destinationId,version,data,position,isMain) VALUES(?,?,?,?,?,0)").run(photo.id, destinationId, randomUUID(), photo.data, order.indexOf(photo.id)));
    order.forEach((id, position) => db.prepare("UPDATE destination_images SET position = ? WHERE destinationId = ? AND id = ?").run(position, destinationId, id));
    db.prepare("UPDATE destination_images SET isMain = 0 WHERE destinationId = ? AND isMain = 1").run(destinationId);
    if (main) db.prepare("UPDATE destination_images SET isMain = 1 WHERE destinationId = ? AND id = ?").run(destinationId, main);
  }
  function saveGallery(kind: "candidate" | "church", ownerId: string, gallery?: CandidateGalleryUpdate) {
    const { table, ownerColumn, label } = kind === "candidate"
      ? { table: "candidate_images", ownerColumn: "candidateId", label: "An idea" }
      : { table: "church_images", ownerColumn: "churchId", label: "A church" };
    if (gallery === undefined) return;
    const current = db.prepare(`SELECT id, position, isMain FROM ${table} WHERE ${ownerColumn} = ? ORDER BY position, id`).all(ownerId) as unknown as { id: string; position: number; isMain: number }[];
    const currentMain = current.find((photo) => photo.isMain === 1)?.id;
    const existingIds = new Set(current.map((photo) => photo.id));
    if (gallery.remove.some((id) => !existingIds.has(id))) throw new ValidationError("A photo has changed or no longer exists. Refresh and try again.");
    for (const photo of gallery.add) {
      if (db.prepare(`SELECT 1 FROM ${table} WHERE lower(id) = lower(?)`).get(photo.id)) throw new ValidationError("This photo already exists. Refresh and try again.");
    }
    const removed = new Set(gallery.remove);
    const retained = current.filter((photo) => !removed.has(photo.id));
    const finalIds = [...retained.map((photo) => photo.id), ...gallery.add.map((photo) => photo.id)];
    if (finalIds.length > MAX_CANDIDATE_IMAGES) throw new ValidationError(`${label} can have up to ${MAX_CANDIDATE_IMAGES} photos. Remove a photo before adding more.`);
    const main = gallery.mainImageId === undefined ? (currentMain && !removed.has(currentMain) ? currentMain : finalIds[0] ?? null) : gallery.mainImageId;
    if ((main === null && finalIds.length > 0) || (main !== null && !finalIds.includes(main))) throw new ValidationError("Choose a main photo from the remaining photos. Refresh if the gallery has changed.");
    for (const id of gallery.remove) db.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ? AND id = ?`).run(ownerId, id);
    const nextPosition = current.reduce((next, photo) => Math.max(next, photo.position + 1), 0);
    gallery.add.forEach((photo, index) => db.prepare(`INSERT INTO ${table}(id,${ownerColumn},version,data,position,isMain) VALUES(?,?,?,?,?,0)`).run(photo.id, ownerId, randomUUID(), photo.data, nextPosition + index));
    db.prepare(`UPDATE ${table} SET isMain = 0 WHERE ${ownerColumn} = ? AND isMain = 1`).run(ownerId);
    if (main) db.prepare(`UPDATE ${table} SET isMain = 1 WHERE ${ownerColumn} = ? AND id = ?`).run(ownerId, main);
  }
  function existing<T>(table: "trips" | "destinations" | "trip_stops" | "legs" | "candidates" | "home_items" | "churches", id: string): T {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new ValidationError("This item no longer exists. Please refresh and try again.");
    return row as unknown as T;
  }
  function homeItemForTrip(id: string, tripId: string): StoredHomeItem {
    const item = existing<StoredHomeItem>("home_items", id);
    if (item.tripId !== tripId) throw new ValidationError("This home item belongs to a different trip.");
    return item;
  }
  function orderedStops(tripId: string): TripStop[] {
    return db.prepare("SELECT * FROM trip_stops WHERE tripId = ? ORDER BY position, id").all(tripId) as unknown as TripStop[];
  }
  function reconcileRoute(tripId: string) {
    const stops = orderedStops(tripId);
    stops.forEach((stop, position) => db.prepare("UPDATE trip_stops SET position = ? WHERE id = ?").run(position, stop.id));
    const route: (string | null)[] = stops.length ? [null, ...stops.map((stop) => stop.id), null] : [];
    const desired = new Set<string>();
    for (let index = 1; index < route.length; index += 1) desired.add(JSON.stringify([route[index - 1], route[index]]));
    const current = db.prepare("SELECT * FROM legs WHERE tripId = ?").all(tripId) as unknown as StoredLeg[];
    const retained = new Set<string>();
    for (const leg of current) {
      const key = JSON.stringify([leg.fromId, leg.toId]);
      if (desired.has(key)) retained.add(key);
      else db.prepare("DELETE FROM legs WHERE id = ?").run(leg.id);
    }
    for (let index = 1; index < route.length; index += 1) {
      if (!retained.has(JSON.stringify([route[index - 1], route[index]]))) {
        db.prepare("INSERT INTO legs(id,tripId,fromId,toId) VALUES(?,?,?,?)").run(randomUUID(), tripId, route[index - 1], route[index]);
      }
    }
  }
  function refreshDates(tripId: string) {
    const trip = db.prepare("SELECT startDate FROM trips WHERE id = ?").get(tripId);
    if (!trip) return;
    try {
      const schedule = sequenceDates(trip.startDate as string | null, orderedStops(tripId));
      for (const stop of schedule.destinations) {
        db.prepare("UPDATE trip_stops SET arrivalDate = ?, departureDate = ? WHERE id = ?").run(stop.arrivalDate, stop.departureDate, stop.id);
      }
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "This trip's dates cannot be calculated.");
    }
  }
  /** Every subtotal multiplies a daily or nightly amount by nights, and each must stay exact for every stay at the destination. */
  function checkSubtotals(nightsOfStays: (number | null)[], miscMinor: number | null, hotelMinor: number | null, foodMinor: number | null) {
    for (const nights of nightsOfStays) {
      const days = nightsToBudgetDays(nights);
      if (miscMinor !== null && days !== null && !Number.isSafeInteger(Math.round(miscMinor * days))) {
        throw new ValidationError("The miscellaneous subtotal is too large. Reduce the daily amount or number of nights.");
      }
      if (foodMinor !== null && days !== null && !Number.isSafeInteger(Math.round(foodMinor * days))) {
        throw new ValidationError("The food subtotal is too large. Reduce the daily amount or number of nights.");
      }
      if (hotelMinor !== null && nights !== null && !Number.isSafeInteger(hotelMinor * nights)) {
        throw new ValidationError("The hotel estimate is too large. Reduce the nightly amount or number of nights.");
      }
    }
  }
  function clearLeg(id: string) {
    db.prepare("UPDATE legs SET method = '', priceCents = NULL, departure = '', arrival = '', url = '', notes = '', itineraryJson = '[]', linksJson = '[]' WHERE id = ?").run(id);
  }
  function clearHotelSelection(destinationId: string) {
    db.prepare("UPDATE candidates SET included = 0 WHERE destinationId = ? AND category = 'hotels'").run(destinationId);
  }
  type DestinationSave = Extract<Mutation, { type: "destination.save" }>;
  /** A destination's columns after a save: the fields it sends, and the saved values of the rest. */
  function destinationColumns(input: DestinationSave, before?: StoredDestination) {
    const misc = destinationAmount(input.miscDailyAmount, "Daily miscellaneous amount", before?.miscDailyMinor, before?.miscCurrency);
    const hotel = destinationAmount(input.hotelNightlyAmount, "Nightly hotel amount", before?.hotelNightlyMinor, before?.hotelCurrency);
    const activities = destinationAmount(input.activitiesGeneralAmount, "General activities amount", before?.activitiesGeneralMinor, before?.activitiesCurrency);
    const food = destinationAmount(input.foodDailyAmount, "Daily food amount", before?.foodDailyMinor, before?.foodCurrency);
    const shopping = destinationAmount(input.shoppingAmount, "Shopping amount", before?.shoppingMinor, before?.shoppingCurrency);
    const weatherHighF = input.weatherHighF === undefined ? before?.weatherHighF ?? null : input.weatherHighF;
    const weatherLowF = input.weatherLowF === undefined ? before?.weatherLowF ?? null : input.weatherLowF;
    if (weatherHighF !== null && weatherLowF !== null && weatherHighF < weatherLowF) {
      throw new ValidationError("Typical high (°F) must be greater than or equal to typical low (°F).");
    }
    const city = input.city ?? before?.city ?? "";
    return {
      city, cityKey: destinationKey(city), notes: input.notes ?? before?.notes ?? "",
      miscDailyMinor: misc.minor, miscCurrency: misc.currency, hotelNightlyMinor: hotel.minor, hotelCurrency: hotel.currency,
      activitiesBudgetMode: input.activitiesBudgetMode ?? before?.activitiesBudgetMode ?? "itemized", activitiesGeneralMinor: activities.minor, activitiesCurrency: activities.currency,
      foodBudgetMode: input.foodBudgetMode ?? before?.foodBudgetMode ?? "itemized", foodDailyMinor: food.minor, foodCurrency: food.currency,
      shoppingMinor: shopping.minor, shoppingCurrency: shopping.currency,
      weatherHighF, weatherLowF, weatherRainfall: input.weatherRainfall ?? before?.weatherRainfall ?? "", weatherPeriod: input.weatherPeriod ?? before?.weatherPeriod ?? "", weatherSource: input.weatherSource ?? before?.weatherSource ?? "",
      // Visibility persists through every date change. Each trip's dates decide whether Church can appear.
      churchEnabled: before?.churchEnabled ?? 1,
    };
  }
  /** Each owner has one destination per city. */
  function claimCity(ownerId: string, cityKey: string, id: string, message: string) {
    const saved = db.prepare("SELECT city FROM destinations WHERE ownerId = ? AND cityKey = ? AND id != ?").get(ownerId, cityKey, id);
    if (saved) throw new ValidationError(`“${saved.city as string}” is already a saved destination. ${message}`);
  }
  /** A new destination, as a trip's last stop. It belongs to the trip's owner, whoever on the trip adds it. */
  function addDestination(input: Extract<DestinationSave, { id?: undefined }>): string {
    const trip = existing<Trip & { ownerId: string }>("trips", input.tripId);
    // The stop shares the new destination's ID, as each destination's original stop does since schema 21.
    const id = randomUUID();
    const columns = destinationColumns(input);
    claimCity(trip.ownerId, columns.cityKey, id, "Adding a saved destination to a trip isn't available yet.");
    const nights = input.nights ?? null;
    checkSubtotals([nights], columns.miscDailyMinor, columns.hotelNightlyMinor, columns.foodDailyMinor);
    const row = { id, ownerId: trip.ownerId, ...columns };
    db.prepare(`INSERT INTO destinations(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    db.prepare("INSERT INTO trip_stops(id,tripId,destinationId,position,stay,nights) VALUES(?,?,?,?,?,?)").run(id, trip.id, id, orderedStops(trip.id).length, input.stay ?? "", nights);
    reconcileRoute(trip.id);
    saveDestinationGallery(id, input.gallery, input.image);
    return id;
  }
  /** Changes a destination everywhere it is used, and with a stop, that trip's stay notes and nights too. */
  function saveDestination(input: Extract<DestinationSave, { id: string }>): string {
    const before = existing<StoredDestination>("destinations", input.id);
    const stop = input.stopId === undefined ? undefined : existing<TripStop>("trip_stops", input.stopId);
    if (stop && stop.destinationId !== input.id) throw new ValidationError("This stop belongs to a different destination.");
    const columns = destinationColumns(input, before);
    claimCity(before.ownerId, columns.cityKey, input.id, "Choose a different city, or keep this one's name.");
    const nights = input.nights === undefined ? stop?.nights ?? null : input.nights;
    // Shared amounts apply to every trip's stay here, and this stop's with its new nights.
    const stays = db.prepare("SELECT id, nights FROM trip_stops WHERE destinationId = ?").all(input.id) as unknown as TripStop[];
    checkSubtotals(stays.map((other) => other.id === stop?.id ? nights : other.nights), columns.miscDailyMinor, columns.hotelNightlyMinor, columns.foodDailyMinor);
    db.prepare(`UPDATE destinations SET ${Object.keys(columns).map((column) => column + " = ?").join(", ")} WHERE id = ?`).run(...Object.values(columns), input.id);
    if (before.city !== columns.city) {
      // A new city changes the connections to and from it, in every trip that visits it.
      const adjacentLegs = db.prepare("SELECT legs.id FROM legs JOIN trip_stops ON trip_stops.id IN (legs.fromId, legs.toId) WHERE trip_stops.destinationId = ?").all(input.id);
      for (const leg of adjacentLegs) clearLeg(leg.id as string);
    }
    if (stop) db.prepare("UPDATE trip_stops SET stay = ?, nights = ? WHERE id = ?").run(input.stay ?? stop.stay, nights, stop.id);
    saveDestinationGallery(input.id, input.gallery, input.image);
    return input.id;
  }
  function mutate(accountId: string, input: Mutation): string | undefined {
    switch (input.type) {
      case "trip.save": {
        const id = input.id ?? randomUUID();
        if (input.id) {
          const before = existing<Trip>("trips", id);
          const returnCity = input.returnCity === undefined ? before.returnCity : input.returnCity;
          db.prepare("UPDATE trips SET name = ?, dateLabel = ?, homeCity = ?, returnCity = ?, travelers = ?, notes = ? WHERE id = ?").run(input.name, input.dateLabel, input.homeCity, returnCity, input.travelers, input.notes, id);
          const departingChanged = before.homeCity !== input.homeCity;
          const returningChanged = (before.returnCity ?? before.homeCity) !== (returnCity ?? input.homeCity);
          const affectedLegs = db.prepare("SELECT id FROM legs WHERE tripId = ? AND ((? AND fromId IS NULL) OR (? AND toId IS NULL))").all(id, Number(departingChanged), Number(returningChanged));
          for (const leg of affectedLegs) clearLeg(leg.id as string);
        } else {
          // A new trip belongs to the account that creates it.
          db.prepare("INSERT INTO trips(id,name,dateLabel,homeCity,returnCity,travelers,notes,createdAt,ownerId) VALUES(?,?,?,?,?,?,?,?,?)").run(id, input.name, input.dateLabel, input.homeCity, input.returnCity ?? null, input.travelers, input.notes, new Date().toISOString(), accountId);
        }
        if (input.startDate !== undefined) db.prepare("UPDATE trips SET startDate = ? WHERE id = ?").run(input.startDate, id);
        return id;
      }
      case "trip.delete":
        existing<Trip>("trips", input.id);
        db.prepare("DELETE FROM trips WHERE id = ?").run(input.id);
        return;
      case "trip.share": {
        // Sharing authorizes the email to sign in, even before that person ever has. Nothing is sent to them.
        const recipient = authorizeAccount(input.email);
        if (db.prepare("SELECT 1 FROM trips WHERE id = ? AND ownerId = ?").get(input.tripId, recipient.id)) throw new ValidationError("You own this trip, so you already have access.");
        const shared = db.prepare("INSERT INTO trip_shares(tripId, accountId, sharedAt) VALUES(?, ?, ?) ON CONFLICT DO NOTHING").run(input.tripId, recipient.id, new Date().toISOString());
        if (shared.changes === 0) throw new ValidationError(`This trip is already shared with ${recipient.email}.`);
        return input.tripId;
      }
      case "trip.unshare": {
        // Only this trip's access ends. The email stays authorized, and nothing in the trip changes.
        const removed = db.prepare("DELETE FROM trip_shares WHERE tripId = ? AND accountId = (SELECT id FROM accounts WHERE email = ?)").run(input.tripId, input.email);
        if (removed.changes === 0) throw new ValidationError(`This trip isn't shared with ${input.email}. Refresh to see who has access.`);
        return input.tripId;
      }
      case "homeItem.save": {
        existing<Trip>("trips", input.tripId);
        const id = input.id ?? randomUUID();
        if (input.id) {
          homeItemForTrip(id, input.tripId);
          db.prepare("UPDATE home_items SET name = ?, priceCents = ?, notes = ?, completed = ? WHERE id = ? AND tripId = ?").run(input.name, priceCents(input.price), input.notes, Number(input.completed), id, input.tripId);
        } else {
          db.prepare("INSERT INTO home_items(id,tripId,name,priceCents,notes,completed,createdAt) VALUES(?,?,?,?,?,?,?)").run(id, input.tripId, input.name, priceCents(input.price), input.notes, Number(input.completed), new Date().toISOString());
        }
        return id;
      }
      case "homeItem.delete":
        homeItemForTrip(input.id, input.tripId);
        db.prepare("DELETE FROM home_items WHERE id = ? AND tripId = ?").run(input.id, input.tripId);
        return;
      case "homeItem.complete":
        homeItemForTrip(input.id, input.tripId);
        db.prepare("UPDATE home_items SET completed = ? WHERE id = ? AND tripId = ?").run(Number(input.completed), input.id, input.tripId);
        return input.id;
      case "destination.save":
        return input.id === undefined ? addDestination(input) : saveDestination(input);
      case "destination.entryRequirements": {
        existing<StoredDestination>("destinations", input.id);
        if (input.requirements === null) {
          db.prepare("DELETE FROM destination_entry_requirements WHERE destinationId = ?").run(input.id);
        } else {
          db.prepare("INSERT INTO destination_entry_requirements(destinationId, requirementsJson) VALUES(?,?) ON CONFLICT(destinationId) DO UPDATE SET requirementsJson = excluded.requirementsJson")
            .run(input.id, JSON.stringify(input.requirements));
        }
        return input.id;
      }
      case "destination.healthSafety": {
        existing<StoredDestination>("destinations", input.id);
        if (input.healthSafety === null) {
          db.prepare("DELETE FROM destination_health_safety WHERE destinationId = ?").run(input.id);
        } else {
          db.prepare("INSERT INTO destination_health_safety(destinationId, healthSafetyJson) VALUES(?,?) ON CONFLICT(destinationId) DO UPDATE SET healthSafetyJson = excluded.healthSafetyJson")
            .run(input.id, JSON.stringify(input.healthSafety));
        }
        return input.id;
      }
      case "destination.churchVisibility":
        existing<Destination>("destinations", input.id);
        db.prepare("UPDATE destinations SET churchEnabled = ? WHERE id = ?").run(Number(input.enabled), input.id);
        return input.id;
      case "church.save": {
        existing<Destination>("destinations", input.destinationId);
        const id = input.id ?? randomUUID();
        if (input.id) {
          const before = existing<StoredChurch>("churches", id);
          if (before.destinationId !== input.destinationId) throw new ValidationError("This church belongs to a different destination.");
          db.prepare("UPDATE churches SET name = ?, address = ?, denomination = ?, url = ?, massTimesJson = ? WHERE id = ? AND destinationId = ?").run(input.name, input.address, input.denomination, input.url, JSON.stringify(input.massTimes), id, input.destinationId);
        } else {
          db.prepare("INSERT INTO churches(id,destinationId,name,address,denomination,url,massTimesJson) VALUES(?,?,?,?,?,?,?)").run(id, input.destinationId, input.name, input.address, input.denomination, input.url, JSON.stringify(input.massTimes));
        }
        saveGallery("church", id, input.gallery);
        return id;
      }
      case "church.delete": {
        const before = existing<StoredChurch>("churches", input.id);
        if (before.destinationId !== input.destinationId) throw new ValidationError("This church belongs to a different destination.");
        db.prepare("DELETE FROM churches WHERE id = ? AND destinationId = ?").run(input.id, input.destinationId);
        return;
      }
      case "stop.remove": {
        // Only this trip's stay goes. The destination and everything saved with it stay, for other trips and Destinations.
        const stop = existing<TripStop>("trip_stops", input.id);
        db.prepare("DELETE FROM trip_stops WHERE id = ?").run(input.id);
        reconcileRoute(stop.tripId);
        return;
      }
      case "stop.move": {
        const stop = existing<TripStop>("trip_stops", input.id);
        const ordered = orderedStops(stop.tripId);
        const index = ordered.findIndex((item) => item.id === input.id);
        const nextIndex = index + (input.direction === "up" ? -1 : 1);
        if (nextIndex >= 0 && nextIndex < ordered.length) {
          [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
          ordered.forEach((item, position) => db.prepare("UPDATE trip_stops SET position = ? WHERE id = ?").run(position, item.id));
          reconcileRoute(stop.tripId);
        }
        return input.id;
      }
      case "leg.save": {
        const before = existing<StoredLeg>("legs", input.id);
        const itineraryJson = input.itinerary === undefined ? before.itineraryJson : JSON.stringify(input.itinerary);
        const links = savedLinks(input, before);
        db.prepare("UPDATE legs SET method = ?, priceCents = ?, departure = ?, arrival = ?, url = ?, notes = ?, itineraryJson = ?, linksJson = ? WHERE id = ?").run(input.method, priceCents(input.price), input.departure, input.arrival, links[0]?.url ?? "", input.notes, itineraryJson, JSON.stringify(links), input.id);
        return input.id;
      }
      case "leg.clear":
        existing<TravelLeg>("legs", input.id);
        clearLeg(input.id);
        return input.id;
      case "candidate.save": {
        existing<Destination>("destinations", input.destinationId);
        const id = input.id ?? randomUUID();
        const before = input.id ? existing<StoredCandidate>("candidates", input.id) : undefined;
        if (before) {
          if (before.destinationId !== input.destinationId || before.category !== input.category) throw new ValidationError("This idea belongs to a different destination or list.");
        }
        const links = savedLinks(input, before);
        const url = links[0]?.url ?? "";
        const mustDo = input.mustDo === undefined ? (before?.mustDo ?? 0) : Number(input.mustDo);
        if (input.category === "hotels" && mustDo) throw new ValidationError("Must do is available for activities and restaurants only.");
        if (input.included && input.category === "hotels") clearHotelSelection(input.destinationId);
        if (input.id) {
          db.prepare("UPDATE candidates SET name = ?, priceCents = ?, address = ?, url = ?, notes = ?, included = ?, mustDo = ?, linksJson = ? WHERE id = ?").run(input.name, priceCents(input.price), input.address, url, input.notes, Number(input.included), mustDo, JSON.stringify(links), id);
        } else {
          const position = Number(db.prepare("SELECT coalesce(max(position), -1) + 1 AS position FROM candidates WHERE destinationId = ? AND category = ?").get(input.destinationId, input.category)!.position);
          db.prepare("INSERT INTO candidates(id,destinationId,category,name,priceCents,address,url,notes,included,mustDo,position,linksJson) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.destinationId, input.category, input.name, priceCents(input.price), input.address, url, input.notes, Number(input.included), mustDo, position, JSON.stringify(links));
        }
        saveGallery("candidate", id, input.gallery);
        return id;
      }
      case "candidate.move": {
        const candidate = existing<StoredCandidate>("candidates", input.id);
        const ordered = db.prepare("SELECT id FROM candidates WHERE destinationId = ? AND category = ? ORDER BY position, id").all(candidate.destinationId, candidate.category);
        const index = ordered.findIndex((item) => item.id === input.id);
        const nextIndex = index + (input.direction === "up" ? -1 : 1);
        if (nextIndex >= 0 && nextIndex < ordered.length) {
          [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
          const update = db.prepare("UPDATE candidates SET position = ? WHERE id = ?");
          ordered.forEach((item, position) => update.run(position, item.id));
        }
        return input.id;
      }
      case "candidate.mustDo": {
        const candidate = existing<StoredCandidate>("candidates", input.id);
        if (candidate.category === "hotels") throw new ValidationError("Must do is available for activities and restaurants only.");
        db.prepare("UPDATE candidates SET mustDo = ? WHERE id = ?").run(Number(input.mustDo), input.id);
        return input.id;
      }
      case "candidate.delete":
        existing<Candidate>("candidates", input.id);
        db.prepare("DELETE FROM candidates WHERE id = ?").run(input.id);
        return;
      case "candidate.include": {
        const candidate = existing<Candidate>("candidates", input.id);
        if (input.included && candidate.category === "hotels") clearHotelSelection(candidate.destinationId);
        db.prepare("UPDATE candidates SET included = ? WHERE id = ?").run(Number(input.included), input.id);
        return input.id;
      }
    }
  }
  /**
   * The trip or destination a change applies to, found from the most specific saved item it names, so a browser can't
   * claim an item belongs to one it can open. `mutate` still checks that the item matches the rest.
   */
  function mutationScope(input: Mutation): { trip: string | undefined } | { destination: string | undefined } {
    switch (input.type) {
      case "trip.save": case "trip.delete": return { trip: input.id && tripOf("trips", input.id) };
      case "trip.share": case "trip.unshare": return { trip: tripOf("trips", input.tripId) };
      case "homeItem.save": return { trip: input.id ? tripOf("home_items", input.id) : tripOf("trips", input.tripId) };
      case "homeItem.delete": case "homeItem.complete": return { trip: tripOf("home_items", input.id) };
      case "stop.move": case "stop.remove": return { trip: tripOf("trip_stops", input.id) };
      case "leg.save": case "leg.clear": return { trip: tripOf("legs", input.id) };
      // Adding one is a change to its trip, and so is changing a trip's stay there along with it.
      case "destination.save":
        if (input.id === undefined) return { trip: tripOf("trips", input.tripId) };
        return input.stopId === undefined ? { destination: destinationOf("destinations", input.id) } : { trip: tripOf("trip_stops", input.stopId) };
      case "destination.churchVisibility": case "destination.entryRequirements": case "destination.healthSafety": return { destination: destinationOf("destinations", input.id) };
      case "church.save": return { destination: input.id ? destinationOf("churches", input.id) : destinationOf("destinations", input.destinationId) };
      case "church.delete": return { destination: destinationOf("churches", input.id) };
      case "candidate.save": return { destination: input.id ? destinationOf("candidates", input.id) : destinationOf("destinations", input.destinationId) };
      case "candidate.move": case "candidate.mustDo": case "candidate.delete": case "candidate.include": return { destination: destinationOf("candidates", input.id) };
    }
  }
  /**
   * Owners and the accounts they shared a trip with may change it and the destinations it visits; deleting a trip and
   * changing who has it are for its owner.
   */
  function authorize(accountId: string, input: Mutation): void {
    if (input.type === "trip.save" && input.id === undefined) return;
    const scope = mutationScope(input);
    const role = "trip" in scope ? tripRole(accountId, scope.trip) : destinationRole(accountId, scope.destination);
    if (!role) throw new ValidationError(NOT_AVAILABLE);
    const ownerOnly = OWNER_ONLY[input.type];
    if (ownerOnly && role !== "owner") throw new ValidationError(ownerOnly);
  }
  /** `accountId` is the signed-in account from the server's session, never anything the browser sent. */
  function applyMutation(accountId: string, input: unknown): { id?: string } {
    const valid = validate(input);
    db.exec("BEGIN IMMEDIATE");
    try {
      authorize(accountId, valid);
      let scheduleTrip: string | undefined;
      if (valid.type === "trip.save" && valid.startDate !== undefined) {
        if (valid.id && db.prepare("SELECT startDate FROM trips WHERE id = ?").get(valid.id)?.startDate !== valid.startDate) scheduleTrip = valid.id;
      } else if (valid.type === "destination.save") {
        if (valid.id === undefined) scheduleTrip = valid.tripId;
        else if (valid.stopId !== undefined && valid.nights !== undefined) {
          const stop = db.prepare("SELECT tripId, nights FROM trip_stops WHERE id = ?").get(valid.stopId);
          if (stop && stop.nights !== valid.nights) scheduleTrip = stop.tripId as string;
        }
      } else if (valid.type === "stop.remove" || valid.type === "stop.move") {
        scheduleTrip = existing<TripStop>("trip_stops", valid.id).tripId;
      }
      const id = mutate(accountId, valid);
      if (valid.type === "trip.save" && !valid.id && valid.startDate !== undefined) scheduleTrip = id;
      if (scheduleTrip) refreshDates(scheduleTrip);
      db.exec("COMMIT");
      return id ? { id } : {};
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  // Declared, not assigned, because the startup transaction above already authorizes the owner.
  function account(row: Record<string, unknown>): AuthorizedAccount {
    return { id: row.id as string, email: row.email as string, name: row.name as string | null };
  }
  function authorizeAccount(email: string): AuthorizedAccount {
    const address = emailAddress(email);
    db.prepare("INSERT INTO accounts(id, email, authorizedAt) VALUES(?, ?, ?) ON CONFLICT(email) DO NOTHING").run(randomUUID(), address, new Date().toISOString());
    return account(db.prepare("SELECT id, email, name FROM accounts WHERE email = ?").get(address)!);
  }
  function getAccountByGoogleSubject(subject: string): AuthorizedAccount | undefined {
    const row = db.prepare("SELECT id, email, name FROM accounts WHERE googleSubject = ?").get(subject);
    return row ? account(row) : undefined;
  }
  function authorizeGoogleSignIn(identity: GoogleIdentity): AuthorizedAccount | undefined {
    if (!identity.emailVerified || !identity.subject) return undefined;
    // A verified email claims its authorization once. Later sign-ins match the stable subject,
    // so an address reassigned to a different Google account never inherits access.
    db.prepare("UPDATE accounts SET googleSubject = ? WHERE email = ? AND googleSubject IS NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE googleSubject = ?)")
      .run(identity.subject, normalizeEmail(identity.email), identity.subject);
    db.prepare("UPDATE accounts SET name = ? WHERE googleSubject = ?").run(identity.name, identity.subject);
    return getAccountByGoogleSubject(identity.subject);
  }

  const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
  /** Starts a session and returns the token for the browser's cookie. Expired sessions are swept on the way. */
  function createSession(accountId: string, now: number): string {
    db.prepare("DELETE FROM sessions WHERE expiresAt <= ?").run(now);
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions(tokenHash, accountId, expiresAt) VALUES(?, ?, ?)").run(tokenHash(token), accountId, now + SESSION_MS);
    return token;
  }
  /** The account a session token belongs to, or undefined when it is unknown, expired or signed out. */
  function readSession(token: string, now: number): AuthorizedAccount | undefined {
    const hash = tokenHash(token);
    const row = db.prepare("SELECT accounts.id, accounts.email, accounts.name, sessions.expiresAt FROM sessions JOIN accounts ON accounts.id = sessions.accountId WHERE sessions.tokenHash = ?").get(hash);
    if (!row) return undefined;
    const expiresAt = row.expiresAt as number;
    if (expiresAt <= now) {
      db.prepare("DELETE FROM sessions WHERE tokenHash = ?").run(hash);
      return undefined;
    }
    // Thirty days from last use, written at most once a day so reading a trip isn't a write.
    if (expiresAt - now <= SESSION_MS - DAY_MS) db.prepare("UPDATE sessions SET expiresAt = ? WHERE tokenHash = ?").run(now + SESSION_MS, hash);
    return account(row);
  }
  function deleteSession(token: string): void {
    db.prepare("DELETE FROM sessions WHERE tokenHash = ?").run(tokenHash(token));
  }

  // getSnapshot reads everything, for checks and tests. Everything the app shows or changes takes the signed-in account.
  return { getSnapshot, getHomeOverview, getTripSnapshot, getDestinationsOverview, getDestinationSnapshot, getTripName, getStopName, getDestinationName, checkHealth, getDestinationImage, getDestinationPhoto, getCandidatePhoto, getChurchPhoto, applyMutation, authorizeAccount, getAccountByGoogleSubject, authorizeGoogleSignIn, createSession, readSession, deleteSession, close: () => db.close() };
}

/** The Google account authorized during initial setup. src/instrumentation.ts checks it as the server starts. */
export function ownerEmail(): string {
  try { return emailAddress(process.env.TRAVEL_OWNER_EMAIL ?? ""); }
  catch { throw new Error("TRAVEL_OWNER_EMAIL must be the email address of the Google account authorized during initial setup."); }
}

type Store = ReturnType<typeof createStore>;
const globalStore = globalThis as typeof globalThis & { travelStore?: Store };
function defaultStore(): Store {
  if (!globalStore.travelStore) {
    const configuredPath = process.env.TRAVEL_DATABASE_PATH?.trim();
    if (process.env.NODE_ENV === "production" && !configuredPath) {
      throw new Error("TRAVEL_DATABASE_PATH must point to persistent storage in production.");
    }
    const owner = ownerEmail();
    globalStore.travelStore = createStore(configuredPath || resolve(process.cwd(), "data", "travel.sqlite"), owner);
  }
  return globalStore.travelStore;
}
// Each takes the signed-in account's ID from the server's session, and sees only that account's trips and destinations.
export function getDestinationImage(accountId: string, id: string): StoredImage | undefined {
  return defaultStore().getDestinationImage(accountId, id);
}
export function getDestinationPhoto(accountId: string, destinationId: string, imageId: string): StoredImage | undefined {
  return defaultStore().getDestinationPhoto(accountId, destinationId, imageId);
}
export function getCandidatePhoto(accountId: string, candidateId: string, imageId: string): StoredImage | undefined {
  return defaultStore().getCandidatePhoto(accountId, candidateId, imageId);
}
export function getChurchPhoto(accountId: string, churchId: string, imageId: string): StoredImage | undefined {
  return defaultStore().getChurchPhoto(accountId, churchId, imageId);
}
export function applyMutation(accountId: string, input: unknown): { id?: string } {
  return defaultStore().applyMutation(accountId, input);
}
export function getTripSnapshot(accountId: string, tripId: string, stopId?: string) { return defaultStore().getTripSnapshot(accountId, tripId, stopId); }
export function getHomeOverview(accountId: string) { return defaultStore().getHomeOverview(accountId); }
export function getDestinationsOverview(accountId: string) { return defaultStore().getDestinationsOverview(accountId); }
export function getDestinationSnapshot(accountId: string, destinationId: string) { return defaultStore().getDestinationSnapshot(accountId, destinationId); }
export function getTripName(accountId: string, id: string) { return defaultStore().getTripName(accountId, id); }
export function getStopName(accountId: string, tripId: string, stopId: string) { return defaultStore().getStopName(accountId, tripId, stopId); }
export function getDestinationName(accountId: string, destinationId: string) { return defaultStore().getDestinationName(accountId, destinationId); }
export function checkHealth(): void { defaultStore().checkHealth(); }
export function authorizeGoogleSignIn(identity: GoogleIdentity) { return defaultStore().authorizeGoogleSignIn(identity); }
export function createSession(accountId: string) { return defaultStore().createSession(accountId, Date.now()); }
export function readSession(token: string) { return defaultStore().readSession(token, Date.now()); }
export function deleteSession(token: string) { defaultStore().deleteSession(token); }
