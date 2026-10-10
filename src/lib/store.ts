import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Candidate, Category, Destination, DestinationImage, ItineraryStop, Mutation, ResearchLink, Snapshot, TravelLeg, Trip } from "./types";

type StoredLeg = Omit<TravelLeg, "itinerary" | "links"> & { itineraryJson: string; linksJson: string };
type StoredCandidate = Omit<Candidate, "links" | "included"> & { linksJson: string; included: number };

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
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
function imageField(input: Input): Uint8Array | null | undefined {
  const value = input.image;
  if (value === undefined || value === null) return value;
  if (!(value instanceof Uint8Array)) throw new ValidationError("Choose a valid WebP destination image.");
  if (value.byteLength > MAX_IMAGE_BYTES) throw new ValidationError("Destination image must be 2 MB or smaller.");
  if (value.byteLength < 12 || ![82, 73, 70, 70].every((byte, index) => value[index] === byte) || ![87, 69, 66, 80].every((byte, index) => value[index + 8] === byte)) {
    throw new ValidationError("Choose a valid WebP destination image.");
  }
  return new Uint8Array(value);
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
    case "destination.save":
      return { type: value.type, id: optionalId(value), tripId: idField(value, "tripId"), city: textField(value, "city", 120, true), stay: textField(value, "stay", 120), notes: textField(value, "notes", 8000), image: imageField(value) };
    case "destination.move":
      if (value.direction !== "up" && value.direction !== "down") throw new ValidationError("Choose a valid direction for this destination.");
      return { type: value.type, id: idField(value), direction: value.direction };
    case "leg.save":
      return { type: value.type, id: idField(value), method: textField(value, "method", 120), price: priceField(value), departure: textField(value, "departure", 120), arrival: textField(value, "arrival", 120), url: urlField(value), notes: textField(value, "notes", 8000), itinerary: itineraryField(value), links: linksField(value) };
    case "candidate.save":
      return { type: value.type, id: optionalId(value), destinationId: idField(value, "destinationId"), category: categoryField(value), name: textField(value, "name", 160, true), price: priceField(value), address: textField(value, "address", 500), url: urlField(value), notes: textField(value, "notes", 8000), included: booleanField(value, "included"), links: linksField(value) };
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
    if (version > 4) throw new Error("This database was created by a newer version of the travel app.");
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
    const hasColumn = (table: "trips" | "legs" | "candidates", column: string) =>
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
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }

  function getSnapshot(): Snapshot {
    return {
      trips: db.prepare("SELECT * FROM trips ORDER BY createdAt DESC, id").all().map((row) => ({ ...row })) as unknown as Trip[],
      destinations: db.prepare("SELECT destinations.*, destination_images.version AS imageVersion FROM destinations LEFT JOIN destination_images ON destination_images.destinationId = destinations.id ORDER BY destinations.tripId, destinations.position").all().map((row) => ({ ...row })) as unknown as Destination[],
      legs: db.prepare("SELECT legs.* FROM legs LEFT JOIN destinations ON destinations.id = legs.fromId ORDER BY legs.tripId, coalesce(destinations.position, -1)").all().map((row) => {
        const { itineraryJson, linksJson, ...leg } = row as unknown as StoredLeg;
        const links = storedLinks({ ...leg, linksJson });
        return { ...leg, url: links[0]?.url ?? "", itinerary: JSON.parse(itineraryJson) as ItineraryStop[], links };
      }),
      candidates: db.prepare("SELECT * FROM candidates ORDER BY name COLLATE NOCASE, id").all().map((row) => {
        const { linksJson, ...candidate } = row as unknown as StoredCandidate;
        const links = storedLinks({ ...candidate, linksJson });
        return { ...candidate, url: links[0]?.url ?? "", included: candidate.included === 1, links };
      }),
    };
  }
  function getDestinationImage(id: string): DestinationImage | undefined {
    const row = db.prepare("SELECT version, data FROM destination_images WHERE destinationId = ?").get(id);
    return row ? { version: row.version as string, data: new Uint8Array(row.data as Uint8Array) } : undefined;
  }
  function existing<T>(table: "trips" | "destinations" | "legs" | "candidates", id: string): T {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new ValidationError("This item no longer exists. Please refresh and try again.");
    return row as unknown as T;
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
      case "destination.save": {
        existing<Trip>("trips", input.tripId);
        const id = input.id ?? randomUUID();
        if (input.id) {
          const before = existing<Destination>("destinations", id);
          if (before.tripId !== input.tripId) throw new ValidationError("This destination belongs to a different trip.");
          db.prepare("UPDATE destinations SET city = ?, stay = ?, notes = ? WHERE id = ?").run(input.city, input.stay, input.notes, id);
          if (before.city !== input.city) {
            const adjacentLegs = db.prepare("SELECT id FROM legs WHERE fromId = ? OR toId = ?").all(id, id);
            for (const leg of adjacentLegs) clearLeg(leg.id as string);
          }
        } else {
          const position = orderedDestinations(input.tripId).length;
          db.prepare("INSERT INTO destinations(id,tripId,city,stay,notes,position) VALUES(?,?,?,?,?,?)").run(id, input.tripId, input.city, input.stay, input.notes, position);
        }
        if (input.image === null) {
          db.prepare("DELETE FROM destination_images WHERE destinationId = ?").run(id);
        } else if (input.image !== undefined) {
          db.prepare("INSERT INTO destination_images(destinationId, version, data) VALUES(?,?,?) ON CONFLICT(destinationId) DO UPDATE SET version = excluded.version, data = excluded.data").run(id, randomUUID(), input.image);
        }
        reconcileRoute(input.tripId);
        return id;
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
  return { getSnapshot, getDestinationImage, applyMutation, close: () => db.close() };
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
export function getDestinationImage(id: string): DestinationImage | undefined {
  return defaultStore().getDestinationImage(id);
}
export function applyMutation(input: unknown): { snapshot: Snapshot; id?: string } {
  return defaultStore().applyMutation(input);
}
