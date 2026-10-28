import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { budgetDays, containsSunday, isValidDate, stayNights } from "./destination-duration.ts";
import { parseMinorAmount, SUPPORTED_CURRENCIES } from "./money.ts";
import type { FoodBudgetMode, ActivitiesBudgetMode, Candidate, CandidateImage, CandidateGalleryUpdate, Category, Church, MassTime, Destination, HomeItem, StoredImage, ItineraryStop, Mutation, ResearchLink, Snapshot, TravelLeg, Trip } from "./types";

type StoredDestination = Omit<Destination, "churchEnabled"> & { churchEnabled: number };
type StoredChurch = Omit<Church, "massTimes" | "images"> & { massTimesJson: string };
type StoredHomeItem = Omit<HomeItem, "completed"> & { completed: number };
type StoredLeg = Omit<TravelLeg, "itinerary" | "links"> & { itineraryJson: string; linksJson: string };
type StoredCandidate = Omit<Candidate, "links" | "included" | "images"> & { linksJson: string; included: number };

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_GALLERY_IMAGES = 10;
const MAX_PRICE_CENTS = 10_000_000_000;
const CATEGORIES = ["hotels", "activities", "restaurants"] as const;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
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
function parsePrice(value: string): number | null {
  if (!value) return null;
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(value)) {
    throw new ValidationError("Estimated price must be a positive USD amount or zero, with up to two decimal places. Leave it blank if unknown.");
  }
  const [dollars, fraction = ""] = value.split(".");
  const cents = Number(dollars || "0") * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_PRICE_CENTS) throw new ValidationError("Estimated price must be $100,000,000 or less.");
  return cents;
}
function priceField(input: Input): string {
  const value = textField(input, "price", 32);
  parsePrice(value);
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
function destinationDateField(input: Input, key: "arrivalDate" | "departureDate"): string | null | undefined {
  if (input[key] === undefined || input[key] === null) return input[key];
  const value = textField(input, key, 10);
  if (!value) return null;
  if (!isValidDate(value)) throw new ValidationError("Enter valid arrival and departure dates in YYYY-MM-DD format.");
  return value;
}
function currencyField(input: Input, key: "miscCurrency" | "hotelCurrency" | "activitiesCurrency" | "foodCurrency" | "shoppingCurrency"): string | null | undefined {
  if (input[key] === undefined || input[key] === null) return input[key];
  const currency = textField(input, key, 3).toUpperCase();
  if (!currency) return null;
  if (!SUPPORTED_CURRENCIES.includes(currency)) throw new ValidationError("Choose a supported currency.");
  return currency;
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
  if (value.byteLength > MAX_IMAGE_BYTES) throw new ValidationError(`${label} image must be 2 MB or smaller.`);
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
  if (!Array.isArray(gallery.add) || !Array.isArray(gallery.remove) || gallery.add.length > MAX_GALLERY_IMAGES || gallery.remove.length > MAX_GALLERY_IMAGES) throw new ValidationError(`${label === "Church" ? "A church" : "An idea"} can have up to 10 photos.`);
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
      if (typeof value.travelers !== "number" || !Number.isInteger(value.travelers) || value.travelers < 1 || value.travelers > 999) {
        throw new ValidationError("Number of travelers must be a whole number between 1 and 999.");
      }
      return { type: value.type, id: optionalId(value), name: textField(value, "name", 120, true), dateLabel: textField(value, "dateLabel", 120), homeCity: textField(value, "homeCity", 120), returnCity: returnCityField(value), travelers: value.travelers, notes: textField(value, "notes", 8000) };
    }
    case "trip.delete":
    case "destination.delete":
    case "candidate.delete":
    case "leg.clear":
      return { type: value.type, id: idField(value) };
    case "homeItem.save":
      return { type: value.type, id: optionalId(value), tripId: idField(value, "tripId"), name: textField(value, "name", 160, true), price: priceField(value), notes: textField(value, "notes", 8000), completed: booleanField(value, "completed") };
    case "homeItem.delete":
      return { type: value.type, id: idField(value), tripId: idField(value, "tripId") };
    case "homeItem.complete":
      return { type: value.type, id: idField(value), tripId: idField(value, "tripId"), completed: booleanField(value, "completed") };
    case "destination.save":
      return { type: value.type, id: optionalId(value), tripId: idField(value, "tripId"), city: textField(value, "city", 120, true), stay: textField(value, "stay", 120), arrivalDate: destinationDateField(value, "arrivalDate"), departureDate: destinationDateField(value, "departureDate"), miscDailyAmount: value.miscDailyAmount === undefined ? undefined : textField(value, "miscDailyAmount", 32), miscCurrency: currencyField(value, "miscCurrency"), hotelNightlyAmount: value.hotelNightlyAmount === undefined ? undefined : textField(value, "hotelNightlyAmount", 32), hotelCurrency: currencyField(value, "hotelCurrency"), activitiesBudgetMode: activitiesModeField(value), activitiesGeneralAmount: value.activitiesGeneralAmount === undefined ? undefined : textField(value, "activitiesGeneralAmount", 32), activitiesCurrency: currencyField(value, "activitiesCurrency"), foodBudgetMode: foodModeField(value), foodDailyAmount: value.foodDailyAmount === undefined ? undefined : textField(value, "foodDailyAmount", 32), foodCurrency: currencyField(value, "foodCurrency"), shoppingAmount: value.shoppingAmount === undefined ? undefined : textField(value, "shoppingAmount", 32), shoppingCurrency: currencyField(value, "shoppingCurrency"), weatherHighF: temperatureField(value, "weatherHighF"), weatherLowF: temperatureField(value, "weatherLowF"), weatherRainfall: value.weatherRainfall === undefined ? undefined : textField(value, "weatherRainfall", 4000), weatherPeriod: value.weatherPeriod === undefined ? undefined : textField(value, "weatherPeriod", 120), weatherSource: value.weatherSource === undefined ? undefined : textField(value, "weatherSource", 2048), notes: textField(value, "notes", 8000), image: imageField(value) };
    case "destination.churchVisibility":
      return { type: value.type, id: idField(value), enabled: booleanField(value, "enabled") };
    case "church.save":
      return { type: value.type, id: optionalId(value), destinationId: idField(value, "destinationId"), name: textField(value, "name", 160, true), address: textField(value, "address", 500), denomination: textField(value, "denomination", 160), url: urlField(value), massTimes: massTimesField(value), gallery: galleryField(value, "Church") };
    case "church.delete":
      return { type: value.type, id: idField(value), destinationId: idField(value, "destinationId") };
    case "destination.move":
      if (value.direction !== "up" && value.direction !== "down") throw new ValidationError("Choose a valid direction for this destination.");
      return { type: value.type, id: idField(value), direction: value.direction };
    case "leg.save":
      return { type: value.type, id: idField(value), method: textField(value, "method", 120), price: priceField(value), departure: textField(value, "departure", 120), arrival: textField(value, "arrival", 120), url: urlField(value), notes: textField(value, "notes", 8000), itinerary: itineraryField(value), links: linksField(value) };
    case "candidate.save":
      return { type: value.type, id: optionalId(value), destinationId: idField(value, "destinationId"), category: categoryField(value), name: textField(value, "name", 160, true), price: priceField(value), address: textField(value, "address", 500), url: urlField(value), notes: textField(value, "notes", 8000), included: booleanField(value, "included"), links: linksField(value), image: imageField(value, "Idea"), gallery: galleryField(value) };
    case "candidate.include":
      return { type: value.type, id: idField(value), included: booleanField(value, "included") };
    default:
      throw new ValidationError("This action is not supported. Please refresh and try again.");
  }
}

export function createStore(databasePath: string) {
  if (databasePath !== ":memory:") mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version > 14) throw new Error("This database was created by a newer version of the travel app.");
    db.exec(`
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
      method TEXT NOT NULL DEFAULT '', priceCents INTEGER CHECK(priceCents BETWEEN 0 AND ${MAX_PRICE_CENTS}),
      departure TEXT NOT NULL DEFAULT '', arrival TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      CHECK(fromId IS NOT NULL OR toId IS NOT NULL), CHECK(fromId IS NULL OR toId IS NULL OR fromId != toId)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS legs_route ON legs(tripId, ifnull(fromId, ''), ifnull(toId, ''));
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY, destinationId TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('hotels', 'activities', 'restaurants')),
      name TEXT NOT NULL, priceCents INTEGER CHECK(priceCents BETWEEN 0 AND ${MAX_PRICE_CENTS}),
      address TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      included INTEGER NOT NULL DEFAULT 0 CHECK(included IN (0,1))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS candidates_destination ON candidates(destinationId);
    CREATE UNIQUE INDEX IF NOT EXISTS selected_hotel ON candidates(destinationId) WHERE category = 'hotels' AND included = 1;
    `);
    // Version 1 reset user_version at startup. Check columns as well so a rollback
    // followed by redeployment cannot repeat ALTER TABLE or replace saved links.
    const hasColumn = (table: "trips" | "destinations" | "legs" | "candidates" | "candidate_images", column: string) =>
      db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
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
          priceCents INTEGER CHECK(priceCents BETWEEN 0 AND ${MAX_PRICE_CENTS}),
          completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)), createdAt TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS home_items_trip ON home_items(tripId, createdAt, id);
        PRAGMA user_version = 7;
      `);
    }
    if (version < 8) {
      if (!hasColumn("destinations", "arrivalDate")) db.exec("ALTER TABLE destinations ADD COLUMN arrivalDate TEXT;");
      if (!hasColumn("destinations", "departureDate")) db.exec("ALTER TABLE destinations ADD COLUMN departureDate TEXT;");
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
        for (const row of db.prepare("SELECT id, arrivalDate, departureDate FROM destinations").all()) {
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
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }

  function getSnapshot(): Snapshot {
    const churchPhotos = new Map<string, CandidateImage[]>();
    for (const row of db.prepare("SELECT id, churchId, version FROM church_images ORDER BY churchId, position, id").all()) {
      const churchId = row.churchId as string;
      const images = churchPhotos.get(churchId) ?? [];
      images.push({ id: row.id as string, version: row.version as string });
      churchPhotos.set(churchId, images);
    }
    const photos = new Map<string, CandidateImage[]>();
    for (const row of db.prepare("SELECT id, candidateId, version FROM candidate_images ORDER BY candidateId, position, id").all()) {
      const candidateId = row.candidateId as string;
      const images = photos.get(candidateId) ?? [];
      images.push({ id: row.id as string, version: row.version as string });
      photos.set(candidateId, images);
    }
    return {
      trips: db.prepare("SELECT * FROM trips ORDER BY createdAt DESC, id").all().map((row) => ({ ...row })) as unknown as Trip[],
      homeItems: db.prepare("SELECT * FROM home_items ORDER BY createdAt, id").all().map((row) => {
        const item = row as unknown as StoredHomeItem;
        return { ...item, completed: item.completed === 1 };
      }),
      destinations: db.prepare("SELECT destinations.*, destination_images.version AS imageVersion FROM destinations LEFT JOIN destination_images ON destination_images.destinationId = destinations.id ORDER BY destinations.tripId, destinations.position").all().map((row) => {
        const destination = row as unknown as StoredDestination;
        return { ...destination, churchEnabled: destination.churchEnabled === 1 };
      }),
      legs: db.prepare("SELECT legs.* FROM legs LEFT JOIN destinations ON destinations.id = legs.fromId ORDER BY legs.tripId, coalesce(destinations.position, -1)").all().map((row) => {
        const { itineraryJson, linksJson, ...leg } = row as unknown as StoredLeg;
        const links = storedLinks({ ...leg, linksJson });
        return { ...leg, url: links[0]?.url ?? "", itinerary: JSON.parse(itineraryJson) as ItineraryStop[], links };
      }),
      churches: db.prepare("SELECT churches.*, church_images.id AS mainImageId FROM churches LEFT JOIN church_images ON church_images.churchId = churches.id AND church_images.isMain = 1 ORDER BY churches.name COLLATE NOCASE, churches.id").all().map((row) => {
        const { massTimesJson, ...church } = row as unknown as StoredChurch;
        return { ...church, massTimes: JSON.parse(massTimesJson) as MassTime[], images: churchPhotos.get(church.id) ?? [] };
      }),
      candidates: db.prepare("SELECT candidates.*, candidate_images.version AS imageVersion, candidate_images.id AS mainImageId FROM candidates LEFT JOIN candidate_images ON candidate_images.candidateId = candidates.id AND candidate_images.isMain = 1 ORDER BY candidates.name COLLATE NOCASE, candidates.id").all().map((row) => {
        const { linksJson, ...candidate } = row as unknown as StoredCandidate;
        const links = storedLinks({ ...candidate, linksJson });
        return { ...candidate, url: links[0]?.url ?? "", included: candidate.included === 1, links, images: photos.get(candidate.id) ?? [] };
      }),
    };
  }
  function getDestinationImage(id: string): StoredImage | undefined {
    const row = db.prepare("SELECT version, data FROM destination_images WHERE destinationId = ?").get(id);
    return row ? { version: row.version as string, data: new Uint8Array(row.data as Uint8Array) } : undefined;
  }
  function getCandidateImage(id: string): StoredImage | undefined {
    const row = db.prepare("SELECT version, data FROM candidate_images WHERE candidateId = ? AND isMain = 1").get(id);
    return row ? { version: row.version as string, data: new Uint8Array(row.data as Uint8Array) } : undefined;
  }
  function getCandidatePhoto(candidateId: string, imageId: string): StoredImage | undefined {
    const row = db.prepare("SELECT version, data FROM candidate_images WHERE candidateId = ? AND id = ?").get(candidateId, imageId);
    return row ? { version: row.version as string, data: new Uint8Array(row.data as Uint8Array) } : undefined;
  }
  function getChurchPhoto(churchId: string, imageId: string): StoredImage | undefined {
    const row = db.prepare("SELECT version, data FROM church_images WHERE churchId = ? AND id = ?").get(churchId, imageId);
    return row ? { version: row.version as string, data: new Uint8Array(row.data as Uint8Array) } : undefined;
  }
  function saveGallery(kind: "candidate" | "church", ownerId: string, gallery?: CandidateGalleryUpdate, image?: Uint8Array | null) {
    const { table, ownerColumn, label } = kind === "candidate"
      ? { table: "candidate_images", ownerColumn: "candidateId", label: "An idea" }
      : { table: "church_images", ownerColumn: "churchId", label: "A church" };
    if (gallery === undefined && image === undefined) return;
    const current = db.prepare(`SELECT id, position, isMain FROM ${table} WHERE ${ownerColumn} = ? ORDER BY position, id`).all(ownerId) as unknown as { id: string; position: number; isMain: number }[];
    const currentMain = current.find((photo) => photo.isMain === 1)?.id;
    if (gallery === undefined) {
      if (image === null) {
        gallery = { add: [], remove: currentMain ? [currentMain] : [] };
      } else if (image !== undefined && currentMain) {
        // Replacing a legacy single image updates the main photo only.
        db.prepare(`INSERT INTO ${table}(id,${ownerColumn},version,data,position,isMain) VALUES(?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET version = excluded.version, data = excluded.data`).run(currentMain, ownerId, randomUUID(), image, current.find((photo) => photo.id === currentMain)!.position);
        return;
      } else {
        gallery = { add: image ? [{ id: randomUUID(), data: image }] : [], remove: [] };
      }
    }
    const existingIds = new Set(current.map((photo) => photo.id));
    if (gallery.remove.some((id) => !existingIds.has(id))) throw new ValidationError("A photo has changed or no longer exists. Refresh and try again.");
    for (const photo of gallery.add) {
      if (db.prepare(`SELECT 1 FROM ${table} WHERE lower(id) = lower(?)`).get(photo.id)) throw new ValidationError("This photo already exists. Refresh and try again.");
    }
    const removed = new Set(gallery.remove);
    const retained = current.filter((photo) => !removed.has(photo.id));
    const finalIds = [...retained.map((photo) => photo.id), ...gallery.add.map((photo) => photo.id)];
    if (finalIds.length > MAX_GALLERY_IMAGES) throw new ValidationError(`${label} can have up to 10 photos. Remove a photo before adding more.`);
    const main = gallery.mainImageId === undefined ? (currentMain && !removed.has(currentMain) ? currentMain : finalIds[0] ?? null) : gallery.mainImageId;
    if ((main === null && finalIds.length > 0) || (main !== null && !finalIds.includes(main))) throw new ValidationError("Choose a main photo from the remaining photos. Refresh if the gallery has changed.");
    for (const id of gallery.remove) db.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ? AND id = ?`).run(ownerId, id);
    const nextPosition = current.reduce((next, photo) => Math.max(next, photo.position + 1), 0);
    gallery.add.forEach((photo, index) => db.prepare(`INSERT INTO ${table}(id,${ownerColumn},version,data,position,isMain) VALUES(?,?,?,?,?,0)`).run(photo.id, ownerId, randomUUID(), photo.data, nextPosition + index));
    db.prepare(`UPDATE ${table} SET isMain = 0 WHERE ${ownerColumn} = ? AND isMain = 1`).run(ownerId);
    if (main) db.prepare(`UPDATE ${table} SET isMain = 1 WHERE ${ownerColumn} = ? AND id = ?`).run(ownerId, main);
  }
  function existing<T>(table: "trips" | "destinations" | "legs" | "candidates" | "home_items" | "churches", id: string): T {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new ValidationError("This item no longer exists. Please refresh and try again.");
    return row as unknown as T;
  }
  function homeItemForTrip(id: string, tripId: string): StoredHomeItem {
    const item = existing<StoredHomeItem>("home_items", id);
    if (item.tripId !== tripId) throw new ValidationError("This home item belongs to a different trip.");
    return item;
  }
  function orderedDestinations(tripId: string): Destination[] {
    return db.prepare("SELECT * FROM destinations WHERE tripId = ? ORDER BY position, id").all(tripId) as unknown as Destination[];
  }
  function reconcileRoute(tripId: string) {
    const destinations = orderedDestinations(tripId);
    destinations.forEach((destination, position) => db.prepare("UPDATE destinations SET position = ? WHERE id = ?").run(position, destination.id));
    const route: (string | null)[] = destinations.length ? [null, ...destinations.map((destination) => destination.id), null] : [];
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
  function clearLeg(id: string) {
    db.prepare("UPDATE legs SET method = '', priceCents = NULL, departure = '', arrival = '', url = '', notes = '', itineraryJson = '[]', linksJson = '[]' WHERE id = ?").run(id);
  }
  function clearHotelSelection(destinationId: string) {
    db.prepare("UPDATE candidates SET included = 0 WHERE destinationId = ? AND category = 'hotels'").run(destinationId);
  }
  function mutate(input: Mutation): string | undefined {
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
          db.prepare("INSERT INTO trips(id,name,dateLabel,homeCity,returnCity,travelers,notes,createdAt) VALUES(?,?,?,?,?,?,?,?)").run(id, input.name, input.dateLabel, input.homeCity, input.returnCity ?? null, input.travelers, input.notes, new Date().toISOString());
        }
        return id;
      }
      case "trip.delete":
        existing<Trip>("trips", input.id);
        db.prepare("DELETE FROM trips WHERE id = ?").run(input.id);
        return;
      case "homeItem.save": {
        existing<Trip>("trips", input.tripId);
        const id = input.id ?? randomUUID();
        if (input.id) {
          homeItemForTrip(id, input.tripId);
          db.prepare("UPDATE home_items SET name = ?, priceCents = ?, notes = ?, completed = ? WHERE id = ? AND tripId = ?").run(input.name, parsePrice(input.price), input.notes, Number(input.completed), id, input.tripId);
        } else {
          db.prepare("INSERT INTO home_items(id,tripId,name,priceCents,notes,completed,createdAt) VALUES(?,?,?,?,?,?,?)").run(id, input.tripId, input.name, parsePrice(input.price), input.notes, Number(input.completed), new Date().toISOString());
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
      case "destination.save": {
        existing<Trip>("trips", input.tripId);
        const id = input.id ?? randomUUID();
        const before = input.id ? existing<StoredDestination>("destinations", id) : undefined;
        if (before && before.tripId !== input.tripId) throw new ValidationError("This destination belongs to a different trip.");
        const arrivalDate = input.arrivalDate === undefined ? before?.arrivalDate ?? null : input.arrivalDate;
        const departureDate = input.departureDate === undefined ? before?.departureDate ?? null : input.departureDate;
        if (arrivalDate && departureDate && departureDate < arrivalDate) throw new ValidationError("Departure date must be on or after arrival date.");
        const datesChanged = !before || arrivalDate !== before.arrivalDate || departureDate !== before.departureDate;
        const churchEnabled = before?.churchEnabled === 1 || (datesChanged && containsSunday(arrivalDate, departureDate));
        const miscCurrency = input.miscCurrency === undefined ? before?.miscCurrency ?? null : input.miscCurrency;
        if (input.miscDailyAmount === undefined && before?.miscDailyMinor != null && miscCurrency !== before.miscCurrency) {
          throw new ValidationError("Re-enter or clear the daily miscellaneous amount when changing its currency.");
        }
        let miscDailyMinor = before?.miscDailyMinor ?? null;
        if (input.miscDailyAmount !== undefined) {
          try {
            miscDailyMinor = parseMinorAmount(input.miscDailyAmount, miscCurrency);
          } catch (error) {
            throw new ValidationError(error instanceof Error ? error.message : "Enter a valid daily miscellaneous amount.");
          }
        }
        const days = budgetDays(arrivalDate, departureDate);
        if (miscDailyMinor !== null && days !== null && !Number.isSafeInteger(Math.round(miscDailyMinor * days))) {
          throw new ValidationError("The miscellaneous subtotal is too large. Reduce the daily amount or date range.");
        }
        const hotelCurrency = input.hotelCurrency === undefined ? before?.hotelCurrency ?? null : input.hotelCurrency;
        if (input.hotelNightlyAmount === undefined && before?.hotelNightlyMinor != null && hotelCurrency !== before.hotelCurrency) {
          throw new ValidationError("Re-enter or clear the nightly hotel amount when changing its currency.");
        }
        let hotelNightlyMinor = before?.hotelNightlyMinor ?? null;
        if (input.hotelNightlyAmount !== undefined) {
          try {
            hotelNightlyMinor = parseMinorAmount(input.hotelNightlyAmount, hotelCurrency, "Nightly hotel amount");
          } catch (error) {
            throw new ValidationError(error instanceof Error ? error.message : "Enter a valid nightly hotel amount.");
          }
        }
        const activitiesBudgetMode = input.activitiesBudgetMode ?? before?.activitiesBudgetMode ?? "itemized";
        const activitiesCurrency = input.activitiesCurrency === undefined ? before?.activitiesCurrency ?? null : input.activitiesCurrency;
        if (input.activitiesGeneralAmount === undefined && before?.activitiesGeneralMinor != null && activitiesCurrency !== before.activitiesCurrency) {
          throw new ValidationError("Re-enter or clear the general activities amount when changing its currency.");
        }
        let activitiesGeneralMinor = before?.activitiesGeneralMinor ?? null;
        if (input.activitiesGeneralAmount !== undefined) {
          try {
            activitiesGeneralMinor = parseMinorAmount(input.activitiesGeneralAmount, activitiesCurrency, "General activities amount");
          } catch (error) {
            throw new ValidationError(error instanceof Error ? error.message : "Enter a valid general activities amount.");
          }
        }
        const foodBudgetMode = input.foodBudgetMode ?? before?.foodBudgetMode ?? "itemized";
        const foodCurrency = input.foodCurrency === undefined ? before?.foodCurrency ?? null : input.foodCurrency;
        if (input.foodDailyAmount === undefined && before?.foodDailyMinor != null && foodCurrency !== before.foodCurrency) {
          throw new ValidationError("Re-enter or clear the daily food amount when changing its currency.");
        }
        let foodDailyMinor = before?.foodDailyMinor ?? null;
        if (input.foodDailyAmount !== undefined) {
          try {
            foodDailyMinor = parseMinorAmount(input.foodDailyAmount, foodCurrency, "Daily food amount");
          } catch (error) {
            throw new ValidationError(error instanceof Error ? error.message : "Enter a valid daily food amount.");
          }
        }
        if (foodDailyMinor !== null && days !== null && !Number.isSafeInteger(Math.round(foodDailyMinor * days))) {
          throw new ValidationError("The food subtotal is too large. Reduce the daily amount or date range.");
        }
        const shoppingCurrency = input.shoppingCurrency === undefined ? before?.shoppingCurrency ?? null : input.shoppingCurrency;
        if (input.shoppingAmount === undefined && before?.shoppingMinor != null && shoppingCurrency !== before.shoppingCurrency) {
          throw new ValidationError("Re-enter or clear the shopping amount when changing its currency.");
        }
        let shoppingMinor = before?.shoppingMinor ?? null;
        if (input.shoppingAmount !== undefined) {
          try {
            shoppingMinor = parseMinorAmount(input.shoppingAmount, shoppingCurrency, "Shopping amount");
          } catch (error) {
            throw new ValidationError(error instanceof Error ? error.message : "Enter a valid shopping amount.");
          }
        }
        const weatherHighF = input.weatherHighF === undefined ? before?.weatherHighF ?? null : input.weatherHighF;
        const weatherLowF = input.weatherLowF === undefined ? before?.weatherLowF ?? null : input.weatherLowF;
        if (weatherHighF !== null && weatherLowF !== null && weatherHighF < weatherLowF) {
          throw new ValidationError("Typical high (°F) must be greater than or equal to typical low (°F).");
        }
        const weatherRainfall = input.weatherRainfall ?? before?.weatherRainfall ?? "";
        const weatherPeriod = input.weatherPeriod ?? before?.weatherPeriod ?? "";
        const weatherSource = input.weatherSource ?? before?.weatherSource ?? "";
        const nights = stayNights(arrivalDate, departureDate);
        if (hotelNightlyMinor !== null && nights !== null && !Number.isSafeInteger(hotelNightlyMinor * nights)) {
          throw new ValidationError("The hotel estimate is too large. Reduce the nightly amount or date range.");
        }
        if (before) {
          db.prepare("UPDATE destinations SET city = ?, stay = ?, notes = ?, arrivalDate = ?, departureDate = ?, miscDailyMinor = ?, miscCurrency = ?, hotelNightlyMinor = ?, hotelCurrency = ?, activitiesBudgetMode = ?, activitiesGeneralMinor = ?, activitiesCurrency = ?, foodBudgetMode = ?, foodDailyMinor = ?, foodCurrency = ?, shoppingMinor = ?, shoppingCurrency = ?, weatherHighF = ?, weatherLowF = ?, weatherRainfall = ?, weatherPeriod = ?, weatherSource = ?, churchEnabled = ? WHERE id = ?").run(input.city, input.stay, input.notes, arrivalDate, departureDate, miscDailyMinor, miscCurrency, hotelNightlyMinor, hotelCurrency, activitiesBudgetMode, activitiesGeneralMinor, activitiesCurrency, foodBudgetMode, foodDailyMinor, foodCurrency, shoppingMinor, shoppingCurrency, weatherHighF, weatherLowF, weatherRainfall, weatherPeriod, weatherSource, Number(churchEnabled), id);
          if (before.city !== input.city) {
            const adjacentLegs = db.prepare("SELECT id FROM legs WHERE fromId = ? OR toId = ?").all(id, id);
            for (const leg of adjacentLegs) clearLeg(leg.id as string);
          }
        } else {
          const position = orderedDestinations(input.tripId).length;
          db.prepare("INSERT INTO destinations(id,tripId,city,stay,notes,position,arrivalDate,departureDate,miscDailyMinor,miscCurrency,hotelNightlyMinor,hotelCurrency,activitiesBudgetMode,activitiesGeneralMinor,activitiesCurrency,foodBudgetMode,foodDailyMinor,foodCurrency,shoppingMinor,shoppingCurrency,weatherHighF,weatherLowF,weatherRainfall,weatherPeriod,weatherSource,churchEnabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, input.tripId, input.city, input.stay, input.notes, position, arrivalDate, departureDate, miscDailyMinor, miscCurrency, hotelNightlyMinor, hotelCurrency, activitiesBudgetMode, activitiesGeneralMinor, activitiesCurrency, foodBudgetMode, foodDailyMinor, foodCurrency, shoppingMinor, shoppingCurrency, weatherHighF, weatherLowF, weatherRainfall, weatherPeriod, weatherSource, Number(churchEnabled));
        }
        if (input.image === null) {
          db.prepare("DELETE FROM destination_images WHERE destinationId = ?").run(id);
        } else if (input.image !== undefined) {
          db.prepare("INSERT INTO destination_images(destinationId, version, data) VALUES(?,?,?) ON CONFLICT(destinationId) DO UPDATE SET version = excluded.version, data = excluded.data").run(id, randomUUID(), input.image);
        }
        reconcileRoute(input.tripId);
        return id;
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
      case "destination.delete": {
        const before = existing<Destination>("destinations", input.id);
        db.prepare("DELETE FROM destinations WHERE id = ?").run(input.id);
        reconcileRoute(before.tripId);
        return;
      }
      case "destination.move": {
        const destination = existing<Destination>("destinations", input.id);
        const ordered = orderedDestinations(destination.tripId);
        const index = ordered.findIndex((item) => item.id === input.id);
        const nextIndex = index + (input.direction === "up" ? -1 : 1);
        if (nextIndex >= 0 && nextIndex < ordered.length) {
          [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
          ordered.forEach((item, position) => db.prepare("UPDATE destinations SET position = ? WHERE id = ?").run(position, item.id));
          reconcileRoute(destination.tripId);
        }
        return input.id;
      }
      case "leg.save": {
        const before = existing<StoredLeg>("legs", input.id);
        const itineraryJson = input.itinerary === undefined ? before.itineraryJson : JSON.stringify(input.itinerary);
        const links = savedLinks(input, before);
        db.prepare("UPDATE legs SET method = ?, priceCents = ?, departure = ?, arrival = ?, url = ?, notes = ?, itineraryJson = ?, linksJson = ? WHERE id = ?").run(input.method, parsePrice(input.price), input.departure, input.arrival, links[0]?.url ?? "", input.notes, itineraryJson, JSON.stringify(links), input.id);
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
        if (input.included && input.category === "hotels") clearHotelSelection(input.destinationId);
        if (input.id) {
          db.prepare("UPDATE candidates SET name = ?, priceCents = ?, address = ?, url = ?, notes = ?, included = ?, linksJson = ? WHERE id = ?").run(input.name, parsePrice(input.price), input.address, url, input.notes, Number(input.included), JSON.stringify(links), id);
        } else {
          db.prepare("INSERT INTO candidates(id,destinationId,category,name,priceCents,address,url,notes,included,linksJson) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, input.destinationId, input.category, input.name, parsePrice(input.price), input.address, url, input.notes, Number(input.included), JSON.stringify(links));
        }
        saveGallery("candidate", id, input.gallery, input.image);
        return id;
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
  function applyMutation(input: unknown): { snapshot: Snapshot; id?: string } {
    const valid = validate(input);
    db.exec("BEGIN IMMEDIATE");
    try {
      const id = mutate(valid);
      const snapshot = getSnapshot();
      db.exec("COMMIT");
      return id ? { snapshot, id } : { snapshot };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return { getSnapshot, getDestinationImage, getCandidateImage, getCandidatePhoto, getChurchPhoto, applyMutation, close: () => db.close() };
}

type Store = ReturnType<typeof createStore>;
const globalStore = globalThis as typeof globalThis & { travelStore?: Store };
function defaultStore(): Store {
  if (!globalStore.travelStore) {
    const configuredPath = process.env.TRAVEL_DATABASE_PATH?.trim();
    if (process.env.NODE_ENV === "production" && !configuredPath) {
      throw new Error("TRAVEL_DATABASE_PATH must point to persistent storage in production.");
    }
    globalStore.travelStore = createStore(configuredPath || resolve(process.cwd(), "data", "travel.sqlite"));
  }
  return globalStore.travelStore;
}
export function getSnapshot(): Snapshot {
  return defaultStore().getSnapshot();
}
export function getDestinationImage(id: string): StoredImage | undefined {
  return defaultStore().getDestinationImage(id);
}
export function getCandidateImage(id: string): StoredImage | undefined {
  return defaultStore().getCandidateImage(id);
}
export function getCandidatePhoto(candidateId: string, imageId: string): StoredImage | undefined {
  return defaultStore().getCandidatePhoto(candidateId, imageId);
}
export function getChurchPhoto(churchId: string, imageId: string): StoredImage | undefined {
  return defaultStore().getChurchPhoto(churchId, imageId);
}
export function applyMutation(input: unknown): { snapshot: Snapshot; id?: string } {
  return defaultStore().applyMutation(input);
}
