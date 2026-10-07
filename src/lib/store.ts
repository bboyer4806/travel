import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Candidate, Category, Destination, Mutation, Snapshot, TravelLeg, Trip } from "./types";

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
function urlField(input: Input): string {
  const value = textField(input, "url", 2048);
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
function validate(input: unknown): Mutation {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("The submitted information is invalid.");
  const value = input as Input;
  switch (value.type) {
    case "trip.save": {
      if (typeof value.travelers !== "number" || !Number.isInteger(value.travelers) || value.travelers < 1 || value.travelers > 999) {
        throw new ValidationError("Number of travelers must be a whole number between 1 and 999.");
      }
      return { type: value.type, id: optionalId(value), name: textField(value, "name", 120, true), dateLabel: textField(value, "dateLabel", 120), homeCity: textField(value, "homeCity", 120), travelers: value.travelers, notes: textField(value, "notes", 8000) };
    }
    case "trip.delete":
    case "destination.delete":
    case "candidate.delete":
    case "leg.clear":
      return { type: value.type, id: idField(value) };
    case "destination.save":
      return { type: value.type, id: optionalId(value), tripId: idField(value, "tripId"), city: textField(value, "city", 120, true), stay: textField(value, "stay", 120), notes: textField(value, "notes", 8000) };
    case "destination.move":
      if (value.direction !== "up" && value.direction !== "down") throw new ValidationError("Choose a valid direction for this destination.");
      return { type: value.type, id: idField(value), direction: value.direction };
    case "leg.save":
      return { type: value.type, id: idField(value), method: textField(value, "method", 120), price: priceField(value), departure: textField(value, "departure", 120), arrival: textField(value, "arrival", 120), url: urlField(value), notes: textField(value, "notes", 8000) };
    case "candidate.save":
      return { type: value.type, id: optionalId(value), destinationId: idField(value, "destinationId"), category: categoryField(value), name: textField(value, "name", 160, true), price: priceField(value), address: textField(value, "address", 500), url: urlField(value), notes: textField(value, "notes", 8000), included: booleanField(value, "included") };
    case "candidate.include":
      return { type: value.type, id: idField(value), included: booleanField(value, "included") };
    default:
      throw new ValidationError("This action is not supported. Please refresh and try again.");
  }
}

export function createStore(databasePath: string) {
  if (databasePath !== ":memory:") mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
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
    PRAGMA user_version = 1;
  `);

  function getSnapshot(): Snapshot {
    return {
      trips: db.prepare("SELECT * FROM trips ORDER BY createdAt DESC, id").all().map((row) => ({ ...row })) as unknown as Trip[],
      destinations: db.prepare("SELECT * FROM destinations ORDER BY tripId, position").all().map((row) => ({ ...row })) as unknown as Destination[],
      legs: db.prepare("SELECT legs.* FROM legs LEFT JOIN destinations ON destinations.id = legs.fromId ORDER BY legs.tripId, coalesce(destinations.position, -1)").all().map((row) => ({ ...row })) as unknown as TravelLeg[],
      candidates: db.prepare("SELECT * FROM candidates ORDER BY name COLLATE NOCASE, id").all().map((row) => ({ ...row, included: row.included === 1 })) as unknown as Candidate[],
    };
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
    const current = db.prepare("SELECT * FROM legs WHERE tripId = ?").all(tripId) as unknown as TravelLeg[];
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
    db.prepare("UPDATE legs SET method = '', priceCents = NULL, departure = '', arrival = '', url = '', notes = '' WHERE id = ?").run(id);
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
          db.prepare("UPDATE trips SET name = ?, dateLabel = ?, homeCity = ?, travelers = ?, notes = ? WHERE id = ?").run(input.name, input.dateLabel, input.homeCity, input.travelers, input.notes, id);
          if (before.homeCity !== input.homeCity) {
            const homeLegs = db.prepare("SELECT id FROM legs WHERE tripId = ? AND (fromId IS NULL OR toId IS NULL)").all(id);
            for (const leg of homeLegs) clearLeg(leg.id as string);
          }
        } else {
          db.prepare("INSERT INTO trips(id,name,dateLabel,homeCity,travelers,notes,createdAt) VALUES(?,?,?,?,?,?,?)").run(id, input.name, input.dateLabel, input.homeCity, input.travelers, input.notes, new Date().toISOString());
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
      case "leg.save":
        existing<TravelLeg>("legs", input.id);
        db.prepare("UPDATE legs SET method = ?, priceCents = ?, departure = ?, arrival = ?, url = ?, notes = ? WHERE id = ?").run(input.method, parsePrice(input.price), input.departure, input.arrival, input.url, input.notes, input.id);
        return input.id;
      case "leg.clear":
        existing<TravelLeg>("legs", input.id);
        clearLeg(input.id);
        return input.id;
      case "candidate.save": {
        existing<Destination>("destinations", input.destinationId);
        const id = input.id ?? randomUUID();
        if (input.id) {
          const before = existing<Candidate>("candidates", input.id);
          if (before.destinationId !== input.destinationId || before.category !== input.category) throw new ValidationError("This idea belongs to a different destination or list.");
        }
        if (input.included && input.category === "hotels") clearHotelSelection(input.destinationId);
        if (input.id) {
          db.prepare("UPDATE candidates SET name = ?, priceCents = ?, address = ?, url = ?, notes = ?, included = ? WHERE id = ?").run(input.name, parsePrice(input.price), input.address, input.url, input.notes, Number(input.included), id);
        } else {
          db.prepare("INSERT INTO candidates(id,destinationId,category,name,priceCents,address,url,notes,included) VALUES(?,?,?,?,?,?,?,?,?)").run(id, input.destinationId, input.category, input.name, parsePrice(input.price), input.address, input.url, input.notes, Number(input.included));
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
  return { getSnapshot, applyMutation, close: () => db.close() };
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
export function applyMutation(input: unknown): { snapshot: Snapshot; id?: string } {
  return defaultStore().applyMutation(input);
}
