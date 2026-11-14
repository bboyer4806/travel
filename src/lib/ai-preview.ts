import { formatCurrency } from "./money.ts";
import type { Category, Mutation } from "./types";

/**
 * What an AI proposal changes (TRA-115), worked out from Travel's own data before and after each change: the rows it
 * adds, changes and deletes, and how Travel's owner sees them before approving. The store reads the tables; nothing
 * here touches the database.
 */

/**
 * Travel's own data, in the order a preview lists it. Sessions and the AI integration's tables are never read for a
 * proposal, and every other table must be listed here: tests check each column has a preview label.
 */
export const DATA_TABLES = ["trips", "trip_shares", "trip_tags", "trip_stops", "legs", "home_items", "destinations", "destination_entry_requirements", "destination_health_safety", "destination_images", "candidates", "candidate_images", "churches", "church_images", "accounts"] as const;
export type DataTable = typeof DATA_TABLES[number];
/** The photos of destinations, ideas and churches. The owner sees each photo a change adds, changes or deletes beside its record (TRA-122). */
export const PHOTO_TABLES: readonly DataTable[] = ["destination_images", "candidate_images", "church_images"];
/** Never read for a proposal: photo bytes, and the Google account each authorization is bound to. */
export const UNREAD_COLUMNS: Record<DataTable, string[]> = {
  trips: [], trip_shares: [], trip_tags: [], trip_stops: [], legs: [], home_items: [], destinations: [], destination_entry_requirements: [], destination_health_safety: [],
  destination_images: ["data"], candidates: [], candidate_images: ["data"], churches: [], church_images: ["data"], accounts: ["googleSubject"],
};

export type Value = string | number | null;
export type Row = Record<string, Value>;
/** Every row of each data table, keyed by its primary key's values as JSON. */
export type Tables = Record<DataTable, Map<string, Row>>;
/** One row a change adds, changes or deletes, by its table and key. A changed row has only the columns that changed. */
export interface Effect { table: DataTable; key: string; before: Row | null; after: Row | null }

export interface PreviewField { name: string; before: string | null; after: string | null }
/** One record a change adds, changes or deletes. `photo` is a destination's, idea's or church's photo's ID, for the owner to see it (TRA-122). */
export interface PreviewRecord { action: "Adds" | "Changes" | "Deletes"; record: string; fields: PreviewField[]; photo?: string }
/** One proposed change as the owner reviews it: what it does, and every record it adds, changes or deletes. */
export interface PreviewChange { operation: string; records: PreviewRecord[] }

type Format = "text" | "number" | "order" | "money" | "flag" | "json" | "account";
/**
 * Each column's label in a preview and how its values read, or null for one people never see: IDs, keys, timestamps,
 * photo versions, and values worked out from another column. Hidden columns still count when approving: a proposal
 * makes exactly the rows it previewed, or nothing.
 */
export const PREVIEW_COLUMNS: Record<DataTable, Record<string, [string, Format] | null>> = {
  trips: { id: null, name: ["Name", "text"], dateLabel: ["Dates", "text"], homeCity: ["Departing city", "text"], travelers: ["Travelers", "number"], notes: ["Notes", "text"], createdAt: null, returnCity: ["Return city", "text"], startDate: ["Start date", "text"], ownerId: ["Owner", "account"] },
  trip_shares: { tripId: null, accountId: null, sharedAt: null },
  trip_tags: { tripId: null, tagKey: null, name: null },
  trip_stops: { id: null, tripId: null, destinationId: null, position: ["Order", "order"], stay: ["Stay notes", "text"], nights: ["Nights", "number"], arrivalDate: ["Arrival", "text"], departureDate: ["Departure", "text"], legacyArrivalDate: null, legacyDepartureDate: null },
  legs: { id: null, tripId: null, fromId: null, toId: null, method: ["Method", "text"], priceCents: ["Price", "money"], departure: ["Departure", "text"], arrival: ["Arrival", "text"], url: null, notes: ["Notes", "text"], itineraryJson: ["Itinerary", "json"], linksJson: ["Research links", "json"] },
  home_items: { id: null, tripId: null, name: ["Name", "text"], notes: ["Notes", "text"], priceCents: ["Price", "money"], completed: ["Done", "flag"], createdAt: null },
  destinations: {
    id: null, ownerId: ["Owner", "account"], city: ["City", "text"], cityKey: null, cityFromSuggestion: ["City chosen from a suggestion", "flag"], notes: ["Notes", "text"],
    miscDailyMinor: ["Daily miscellaneous", "money"], miscCurrency: null, hotelNightlyMinor: ["Nightly hotel estimate", "money"], hotelCurrency: null,
    activitiesGeneralMinor: ["General activities budget", "money"], activitiesCurrency: null, foodDailyMinor: ["Daily food budget", "money"], foodCurrency: null,
    shoppingMinor: ["Shopping budget", "money"], shoppingCurrency: null, activitiesBudgetMode: ["Activities budget method", "text"], foodBudgetMode: ["Food budget method", "text"],
    weatherHighF: ["Typical high (°F)", "number"], weatherLowF: ["Typical low (°F)", "number"], weatherRainfall: ["Typical rainfall", "text"], weatherPeriod: ["Weather period", "text"], weatherSource: ["Weather source", "text"],
    churchEnabled: ["Church shown", "flag"],
  },
  destination_entry_requirements: { destinationId: null, requirementsJson: ["Entry requirements", "json"] },
  destination_health_safety: { destinationId: null, healthSafetyJson: ["Health and safety", "json"] },
  destination_images: { id: null, destinationId: null, version: null, position: ["Order", "order"], isMain: ["Primary photo", "flag"] },
  candidates: { id: null, destinationId: null, category: null, name: ["Name", "text"], priceCents: ["Price", "money"], address: ["Address", "text"], url: null, notes: ["Notes", "text"], included: ["Included", "flag"], linksJson: ["Research links", "json"], position: ["Order", "order"], mustDo: ["Must do", "flag"] },
  candidate_images: { id: null, candidateId: null, version: null, position: ["Order", "order"], isMain: ["Main photo", "flag"] },
  churches: { id: null, destinationId: null, name: ["Name", "text"], address: ["Address", "text"], denomination: ["Denomination", "text"], url: ["Website", "text"], massTimesJson: ["Mass times", "json"] },
  church_images: { id: null, churchId: null, version: null, position: ["Order", "order"], isMain: ["Main photo", "flag"] },
  accounts: { id: null, email: ["Email", "text"], name: ["Name", "text"], authorizedAt: null },
};

const IDEA: Record<Category, string> = { hotels: "hotel", activities: "activity", restaurants: "restaurant" };

/** The rows that differ between two readings of the data tables, table by table in key order. */
export function effectsBetween(before: Tables, after: Tables): Effect[] {
  const effects: Effect[] = [];
  for (const table of DATA_TABLES) {
    const keys = [...new Set([...before[table].keys(), ...after[table].keys()])].sort();
    for (const key of keys) {
      const old = before[table].get(key) ?? null;
      const next = after[table].get(key) ?? null;
      if (!old || !next) {
        if (old !== next) effects.push({ table, key, before: old, after: next });
        continue;
      }
      const changed = Object.keys(next).filter((column) => old[column] !== next[column]);
      if (changed.length) effects.push({ table, key, before: pick(old, changed), after: pick(next, changed) });
    }
  }
  return effects;
}
function pick(row: Row, columns: string[]): Row {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

/** One change as the owner reviews it, from what it did to the data tables. */
export function previewChange(change: Mutation, effects: Effect[], before: Tables, after: Tables): PreviewChange {
  const find = (table: DataTable, key: string): Row => {
    const row = after[table].get(key) ?? before[table].get(key);
    if (!row) throw new Error(`A preview needs ${table} ${key}, which is in neither reading.`);
    return row;
  };
  const byId = (table: DataTable, id: Value) => find(table, JSON.stringify([id]));
  const email = (accountId: Value) => String(byId("accounts", accountId).email);
  const trip = (id: Value) => { const row = byId("trips", id); return `Trip “${row.name}” (${email(row.ownerId)})`; };
  const destination = (id: Value) => { const row = byId("destinations", id); return `Destination “${row.city}” (${email(row.ownerId)})`; };
  const stopCity = (stopId: Value) => String(byId("destinations", byId("trip_stops", stopId).destinationId).city);
  const idea = (id: Value) => { const row = byId("candidates", id); return `${destination(row.destinationId)}: ${IDEA[row.category as Category]} “${row.name}”`; };
  const church = (id: Value) => { const row = byId("churches", id); return `${destination(row.destinationId)}: church “${row.name}”`; };
  const label = (table: DataTable, row: Row): string => {
    switch (table) {
      case "trips": return trip(row.id);
      case "trip_shares": return `${trip(row.tripId)}: shared with ${email(row.accountId)}`;
      case "trip_tags": return `${trip(row.tripId)}: tag “${row.name}”`;
      case "trip_stops": return `${trip(row.tripId)}: stay in ${byId("destinations", row.destinationId).city}`;
      case "legs": {
        const route = byId("trips", row.tripId);
        const from = row.fromId === null ? `the departing city${route.homeCity ? ` (${route.homeCity})` : ""}` : stopCity(row.fromId);
        const returning = route.returnCity ?? route.homeCity;
        const to = row.toId === null ? `the return city${returning ? ` (${returning})` : ""}` : stopCity(row.toId);
        return `${trip(row.tripId)}: travel from ${from} to ${to}`;
      }
      case "home_items": return `${trip(row.tripId)}: At home item “${row.name}”`;
      case "destinations": return destination(row.id);
      case "destination_entry_requirements": return `${destination(row.destinationId)}: entry requirements`;
      case "destination_health_safety": return `${destination(row.destinationId)}: health and safety`;
      case "destination_images": return `${destination(row.destinationId)}: photo`;
      case "candidates": return idea(row.id);
      case "candidate_images": return `${idea(row.candidateId)}: photo`;
      case "churches": return church(row.id);
      case "church_images": return `${church(row.churchId)}: photo`;
      case "accounts": return `Account ${row.email}`;
    }
  };
  const records = effects.flatMap((effect): PreviewRecord[] => {
    const shown = (row: Row) => Object.keys(row).filter((column) => {
      if (!(column in PREVIEW_COLUMNS[effect.table])) throw new Error(`${effect.table}.${column} has no preview label.`);
      return PREVIEW_COLUMNS[effect.table][column] !== null;
    });
    const read = (row: Row | null, column: string) => {
      const [, format] = PREVIEW_COLUMNS[effect.table][column]!;
      return row === null ? null : display(format, row[column], email);
    };
    const row = find(effect.table, effect.key);
    const record = label(effect.table, row);
    const photo = PHOTO_TABLES.includes(effect.table) ? { photo: String(row.id) } : {};
    const columns = shown((effect.after ?? effect.before)!);
    const fields = columns.map((column) => ({ name: PREVIEW_COLUMNS[effect.table][column]![0], before: read(effect.before, column), after: read(effect.after, column) }))
      .filter((field) => field.before !== field.after);
    if (effect.before && effect.after) return fields.length ? [{ action: "Changes", record, fields, ...photo }] : [];
    return [{ action: effect.after ? "Adds" : "Deletes", record, fields, ...photo }];
  });
  return { operation: operationTitle(change), records };
}

/** A value as the owner reads it, or null for none. */
function display(format: Format, value: Value, email: (accountId: Value) => string): string | null {
  if (value === null || value === "") return null;
  switch (format) {
    case "text": case "number": return String(value);
    case "order": return String(Number(value) + 1);
    case "money": return formatCurrency(Number(value), "USD");
    case "flag": return value === 1 ? "Yes" : "No";
    case "json": return jsonText(JSON.parse(String(value))) || null;
    case "account": return email(value);
  }
}
/** Saved JSON, such as research links or Mass times, as text: every value but IDs and empty ones. */
function jsonText(value: unknown): string {
  if (Array.isArray(value)) return value.map(jsonText).filter(Boolean).join("; ");
  if (value && typeof value === "object") {
    return Object.entries(value).filter(([key]) => key !== "id").map(([key, item]) => [key, jsonText(item)]).filter(([, text]) => text).map(([key, text]) => `${key}: ${text}`).join(", ");
  }
  return value === null || value === undefined ? "" : String(value);
}

/** What one change does, in a line. The records under it say which trip, destination or item. */
export function operationTitle(change: Mutation): string {
  switch (change.type) {
    case "trip.save": return `${change.create ? "Add" : "Change"} the trip “${change.name}”`;
    case "trip.delete": return "Delete a trip";
    case "trip.share": return `Share a trip with ${change.email}`;
    case "trip.unshare": return `Stop sharing a trip with ${change.email}`;
    case "trip.tag": return `Tag a trip “${change.name}”`;
    case "trip.untag": return `Remove the tag “${change.name}” from a trip`;
    case "homeItem.save": return `${change.create ? "Add" : "Change"} the At home item “${change.name}”`;
    case "homeItem.delete": return "Delete an At home item";
    case "homeItem.complete": return change.completed ? "Mark an At home item done" : "Mark an At home item not done";
    case "destination.save": return change.stopId === undefined ? "Change a destination" : "Change a destination and a trip's stay there";
    case "destination.create": return `Add the destination “${change.city}”`;
    case "destination.delete": return "Delete a destination";
    case "destination.entryRequirements": return change.requirements ? "Save a destination's entry requirements" : "Clear a destination's entry requirements";
    case "destination.healthSafety": return change.healthSafety ? "Save a destination's health and safety" : "Clear a destination's health and safety";
    case "destination.churchVisibility": return change.enabled ? "Show a destination's Church section" : "Hide a destination's Church section";
    case "church.save": return `${change.create ? "Add" : "Change"} the church “${change.name}”`;
    case "church.delete": return "Delete a church";
    case "stop.add": return `Add ${change.city} to a trip`;
    case "stop.move": return `Move a stay ${change.direction === "up" ? "earlier" : "later"} in its trip`;
    case "stop.remove": return "Remove a stay from its trip";
    case "leg.save": return "Change travel between stops";
    case "leg.clear": return "Clear travel between stops";
    case "candidate.save": return `${change.create ? "Add" : "Change"} the ${IDEA[change.category]} “${change.name}”`;
    case "candidate.move": return `Move an idea ${change.direction} its list`;
    case "candidate.mustDo": return change.mustDo ? "Mark an idea Must do" : "Unmark an idea Must do";
    case "candidate.include": return change.included ? "Include an idea" : "Leave out an idea";
    case "candidate.delete": return "Delete an idea";
    case "destination.photos": return "Change a destination's photos";
    case "candidate.photos": return "Change an idea's photos";
    case "church.photos": return "Change a church's photos";
  }
}
