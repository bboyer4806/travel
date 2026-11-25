import { ACCURACY_LABELS } from "./coordinates.ts";
import { EDITABLE_FIELDS, fieldColumn } from "./editable-fields.ts";
import { formatCurrency } from "./money.ts";
import { RESTAURANT_TYPE_LABELS } from "./types.ts";
import { hasBestTime } from "./trip-best-time.ts";
import { climateAveragesText, climateFromJson, formatReferenceYears, MONTHS } from "./typical-weather.ts";
import type { CoordinatesAccuracy } from "./coordinates";
import type { EditableField } from "./editable-fields";
import type { Category, LikeKind, Mutation, RestaurantType } from "./types";
import type { MonthlyClimate } from "./typical-weather";

/**
 * What an AI proposal changes (TRA-115), worked out from Travel's own data before and after each change: the rows it
 * adds, changes and deletes, and how Travel's owner sees them before approving. The store reads the tables; nothing
 * here touches the database.
 */

/**
 * Travel's own data, in the order a preview lists it. Sessions and the AI integration's tables are never read for a
 * proposal, and every other table must be listed here: tests check each column has a preview label.
 */
export const DATA_TABLES = ["trips", "trip_images", "trip_shares", "trip_tags", "trip_order", "trip_likes", "trip_stops", "legs", "layover_plans", "home_items", "packing_items", "destinations", "destination_entry_requirements", "destination_health_safety", "destination_climate", "destination_images", "destination_likes", "candidates", "candidate_images", "candidate_likes", "churches", "church_images", "church_likes", "accounts"] as const;
export type DataTable = typeof DATA_TABLES[number];
/** The photos of destinations, ideas and churches. The owner sees each photo a change adds, changes or deletes beside its record (TRA-122). */
export const PHOTO_TABLES: readonly DataTable[] = ["destination_images", "candidate_images", "church_images"];
/** A photo's large version and its widths (TRA-154), which come with the photo's bytes. */
const LARGE_VERSION = ["large", "photoWidth", "largeWidth"];
/**
 * Never read for a proposal: photo and thumbnail bytes (TRA-89), trips' headline image bytes (TRA-133), large versions with
 * their widths (TRA-154), and the Google account each authorization is bound to.
 */
export const UNREAD_COLUMNS: Record<DataTable, string[]> = {
  trips: [], trip_images: ["data", ...LARGE_VERSION], trip_shares: [], trip_tags: [], trip_order: [], trip_likes: [], trip_stops: [], legs: [], layover_plans: [], home_items: [], packing_items: [], destinations: [], destination_entry_requirements: [], destination_health_safety: [], destination_climate: [],
  destination_images: ["data", "thumbnail", ...LARGE_VERSION], destination_likes: [], candidates: [], candidate_images: ["data", "thumbnail", ...LARGE_VERSION], candidate_likes: [], churches: [], church_images: ["data", "thumbnail", ...LARGE_VERSION], church_likes: [], accounts: ["googleSubject"],
};

export type Value = string | number | null;
export type Row = Record<string, Value>;
/** Every row of each data table, keyed by its primary key's values as JSON. */
export type Tables = Record<DataTable, Map<string, Row>>;
/** One row a change adds, changes or deletes, by its table and key. A changed row has only the columns that changed. */
export interface Effect { table: DataTable; key: string; before: Row | null; after: Row | null }

export interface PreviewField { name: string; before: string | null; after: string | null }
/**
 * One record a change adds, changes or deletes. `photo` is a destination's, idea's or church's photo's ID, for the owner to
 * see it (TRA-122). `headline` names a trip's headline image before and after, for the owner to compare them (TRA-174):
 * the saved image by its version, and the image a proposal adds by the ID it keeps it under.
 */
export interface PreviewRecord { action: "Adds" | "Changes" | "Deletes"; record: string; fields: PreviewField[]; photo?: string; headline?: { before: string | null; after: string | null } }
/** One proposed change as the owner reviews it: what it does, and every record it adds, changes or deletes. */
export interface PreviewChange { operation: string; records: PreviewRecord[] }

/** How a column's values read. A record of monthly averages ("climate") reads as several fields, its source, reference years and every month (TRA-158). */
type Format = "text" | "number" | "order" | "money" | "flag" | "json" | "account" | "restaurantTypes" | "climate" | "accuracy" | "review";
/** An idea's and a church's coordinates (TRA-150), which the owner sees before approving, and whether they wait to be reviewed. */
const COORDINATE_COLUMNS: Record<string, [string, Format]> = {
  latitude: ["Latitude", "number"], longitude: ["Longitude", "number"], coordinatesAccuracy: ["Coordinates accuracy", "accuracy"], coordinatesReview: ["Coordinates to review", "review"],
};
/** How each kind of editable field reads (TRA-174). */
const FIELD_FORMATS: Record<EditableField["kind"], Format> = { text: "text", url: "text", amount: "money", boolean: "flag", whole: "number", number: "number", choice: "text", date: "text" };
/** A record's editable fields by their columns, each with its label and how it reads, or null where it isn't shown, from the contract (TRA-174). */
export function fieldColumns(fields: Record<string, EditableField>): Record<string, [string, Format] | null> {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [fieldColumn(name, field), field.label === null ? null : [field.label, FIELD_FORMATS[field.kind]]]));
}
/**
 * Each column's label in a preview and how its values read, or null for one people never see: IDs, keys, timestamps,
 * photo versions, destination photos' focal points, which proposals never change (TRA-53), trips' headline image crops,
 * which only the trip editor chooses (TRA-133), and values worked out from another column. Editable fields take theirs
 * from the contract (TRA-174). Hidden columns still count when approving: a proposal makes exactly the rows it previewed, or nothing.
 */
export const PREVIEW_COLUMNS: Record<DataTable, Record<string, [string, Format] | null>> = {
  // A trip's Best time to go reads as its section labels it (TRA-178).
  trips: {
    id: null, createdAt: null, ownerId: ["Owner", "account"], ...fieldColumns(EDITABLE_FIELDS.trips),
    bestTimeMonthsJson: ["Recommended months", "json"], bestTimeReasons: ["Why these months", "text"], bestTimeAvoid: ["Times to avoid", "text"],
  },
  // A headline image shows as its current and proposed images instead (TRA-174).
  trip_images: { tripId: null, version: null, cardFocusX: null, cardFocusY: null, cardZoom: null, bannerFocusX: null, bannerFocusY: null, bannerZoom: null },
  trip_shares: { tripId: null, accountId: null, sharedAt: null },
  trip_tags: { tripId: null, tagKey: null, name: null },
  trip_order: { accountId: null, tripId: null, position: ["Order", "order"] },
  // Each like's record names its item and the account that likes it (TRA-31). Proposals never like anything, but a trip,
  // destination, idea or church one deletes takes its likes with it.
  trip_likes: { tripId: null, accountId: null },
  trip_stops: { id: null, tripId: null, destinationId: null, position: ["Order", "order"], arrivalDate: ["Arrival", "text"], departureDate: ["Departure", "text"], legacyArrivalDate: null, legacyDepartureDate: null, ...fieldColumns(EDITABLE_FIELDS.trip_stops) },
  legs: { id: null, tripId: null, fromId: null, toId: null, itineraryJson: ["Itinerary", "json"], linksJson: ["Research links", "json"], ...fieldColumns(EDITABLE_FIELDS.legs) },
  layover_plans: {
    legId: null, layoverId: null, timeZone: ["Time zone", "text"], arrival: ["Arriving flight lands", "text"], departure: ["Connecting flight departs", "text"],
    immigrationMinutes: ["Immigration (minutes)", "number"], customsMinutes: ["Customs (minutes)", "number"], securityMinutes: ["Security (minutes)", "number"],
    transferMinutes: ["Terminal transfer (minutes)", "number"], boardingMinutes: ["Boarding (minutes)", "number"], returnMinutes: ["Travel back to the airport (minutes)", "number"],
    activitiesJson: ["Activities", "json"],
  },
  // Whether an item is done is kept as saved, but no longer shown or changed (TRA-146).
  home_items: { id: null, tripId: null, completed: null, createdAt: null, ...fieldColumns(EDITABLE_FIELDS.home_items) },
  // Whether a packing item is packed changes only with packingItem.pack (TRA-18).
  packing_items: { id: null, tripId: null, packed: ["Packed", "flag"], ...fieldColumns(EDITABLE_FIELDS.packing_items) },
  destinations: {
    id: null, ownerId: ["Owner", "account"], cityKey: null, cityFromSuggestion: ["City chosen from a suggestion", "flag"],
    miscCurrency: null, hotelCurrency: null, activitiesCurrency: null, foodCurrency: null, shoppingCurrency: null, churchEnabled: ["Church shown", "flag"],
    ...fieldColumns(EDITABLE_FIELDS.destinations),
  },
  destination_entry_requirements: { destinationId: null, requirementsJson: ["Entry requirements", "json"] },
  destination_health_safety: { destinationId: null, healthSafetyJson: ["Health and safety", "json"] },
  destination_climate: { destinationId: null, climateJson: ["Monthly averages", "climate"] },
  destination_images: { id: null, destinationId: null, version: null, position: ["Order", "order"], isMain: ["Primary photo", "flag"], focusX: null, focusY: null },
  destination_likes: { destinationId: null, accountId: null },
  candidates: { id: null, destinationId: null, category: null, linksJson: ["Research links", "json"], position: ["Order", "order"], restaurantTypesJson: ["Restaurant types", "restaurantTypes"], ...COORDINATE_COLUMNS, ...fieldColumns(EDITABLE_FIELDS.candidates) },
  candidate_images: { id: null, candidateId: null, version: null, position: ["Order", "order"], isMain: ["Main photo", "flag"] },
  candidate_likes: { candidateId: null, accountId: null },
  churches: { id: null, destinationId: null, massTimesJson: ["Mass times", "json"], ...COORDINATE_COLUMNS, ...fieldColumns(EDITABLE_FIELDS.churches) },
  church_images: { id: null, churchId: null, version: null, position: ["Order", "order"], isMain: ["Main photo", "flag"] },
  church_likes: { churchId: null, accountId: null },
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
  const travel = (legId: Value) => {
    const row = byId("legs", legId);
    const route = byId("trips", row.tripId);
    const from = row.fromId === null ? `the departing city${route.homeCity ? ` (${route.homeCity})` : ""}` : stopCity(row.fromId);
    const returning = route.returnCity ?? route.homeCity;
    const to = row.toId === null ? `the return city${returning ? ` (${returning})` : ""}` : stopCity(row.toId);
    return `${trip(row.tripId)}: travel from ${from} to ${to}`;
  };
  /** A layover's place, from its connection's itinerary after the change, or before it when the change removes the layover (TRA-45). */
  const layoverPlace = (legId: Value, layoverId: Value): string => {
    for (const tables of [after, before]) {
      const leg = tables.legs.get(JSON.stringify([legId]));
      const place = leg && (JSON.parse(String(leg.itineraryJson)) as { id: string; place: string }[]).find((stop) => stop.id === layoverId)?.place;
      if (place !== undefined) return place;
    }
    throw new Error(`A preview needs layover ${layoverId} of legs ${legId}, which is in neither reading.`);
  };
  const label = (table: DataTable, row: Row): string => {
    switch (table) {
      case "trips": return trip(row.id);
      case "trip_images": return `${trip(row.tripId)}: headline image`;
      case "trip_shares": return `${trip(row.tripId)}: shared with ${email(row.accountId)}`;
      case "trip_tags": return `${trip(row.tripId)}: tag “${row.name}”`;
      case "trip_order": return `${trip(row.tripId)}: place in ${email(row.accountId)}'s trip order`;
      case "trip_likes": return `${trip(row.tripId)}: liked by ${email(row.accountId)}`;
      case "trip_stops": return `${trip(row.tripId)}: stay in ${byId("destinations", row.destinationId).city}`;
      case "legs": return travel(row.id);
      case "layover_plans": return `${travel(row.legId)}: plan for the layover in ${layoverPlace(row.legId, row.layoverId)}`;
      case "home_items": return `${trip(row.tripId)}: At home item “${row.name}”`;
      case "packing_items": return `${trip(row.tripId)}: packing item “${row.name}”`;
      case "destinations": return destination(row.id);
      case "destination_entry_requirements": return `${destination(row.destinationId)}: entry requirements`;
      case "destination_health_safety": return `${destination(row.destinationId)}: health and safety`;
      case "destination_climate": return `${destination(row.destinationId)}: monthly averages`;
      case "destination_images": return `${destination(row.destinationId)}: photo`;
      case "destination_likes": return `${destination(row.destinationId)}: liked by ${email(row.accountId)}`;
      case "candidates": return idea(row.id);
      case "candidate_images": return `${idea(row.candidateId)}: photo`;
      case "candidate_likes": return `${idea(row.candidateId)}: liked by ${email(row.accountId)}`;
      case "churches": return church(row.id);
      case "church_images": return `${church(row.churchId)}: photo`;
      case "church_likes": return `${church(row.churchId)}: liked by ${email(row.accountId)}`;
      case "accounts": return `Account ${row.email}`;
    }
  };
  const records = effects.flatMap((effect): PreviewRecord[] => {
    const shown = (row: Row) => Object.keys(row).filter((column) => {
      if (!(column in PREVIEW_COLUMNS[effect.table])) throw new Error(`${effect.table}.${column} has no preview label.`);
      return PREVIEW_COLUMNS[effect.table][column] !== null;
    });
    const row = find(effect.table, effect.key);
    const record = label(effect.table, row);
    const photo = PHOTO_TABLES.includes(effect.table) ? { photo: String(row.id) } : {};
    // A trip's headline image before and after (TRA-174): the saved one by its version, and one a change adds by the ID its
    // proposal keeps it under. Only trip.image adds one, and replacing it changes no column the owner reads.
    const headline = effect.table === "trip_images" ? {
      headline: { before: effect.before && String(effect.before.version ?? row.version), after: effect.after && change.type === "trip.image" && change.image ? change.image.id : null },
    } : undefined;
    const fields = shown((effect.after ?? effect.before)!).flatMap((column): PreviewField[] => {
      const [name, format] = PREVIEW_COLUMNS[effect.table][column]!;
      const [before, after] = [effect.before?.[column] ?? null, effect.after?.[column] ?? null];
      // Monthly averages show whole, so the owner sees every value a record gives beside the one it replaces (TRA-158).
      if (format === "climate") return climateFields(before, after);
      const field = { name, before: display(format, before, email), after: display(format, after, email) };
      return field.before === field.after ? [] : [field];
    });
    if (effect.before && effect.after) return fields.length || headline ? [{ action: "Changes", record, fields, ...photo, ...headline }] : [];
    return [{ action: effect.after ? "Adds" : "Deletes", record, fields, ...photo, ...headline }];
  });
  return { operation: operationTitle(change), records };
}

/**
 * A record of monthly averages before and after a change, as the owner compares them (TRA-158): its source, its
 * reference years and each month's averages, January to December, every one shown, whether or not it changes.
 */
function climateFields(before: Value, after: Value): PreviewField[] {
  const [saved, proposed] = [before, after].map((json) => json === null ? null : climateFromJson(String(json)));
  const field = (name: string, read: (climate: MonthlyClimate) => string): PreviewField => ({ name, before: saved && read(saved), after: proposed && read(proposed) });
  return [
    field("Source", (climate) => climate.source),
    field("Reference years", formatReferenceYears),
    ...MONTHS.map((month, index) => field(month, (climate) => climateAveragesText(climate.months[index]))),
  ];
}

/** A value as the owner reads it, or null for none. Monthly averages read as several fields, with `climateFields`. */
function display(format: Exclude<Format, "climate">, value: Value, email: (accountId: Value) => string): string | null {
  if (value === null || value === "") return null;
  switch (format) {
    case "text": case "number": return String(value);
    case "order": return String(Number(value) + 1);
    case "money": return formatCurrency(Number(value), "USD");
    case "flag": return value === 1 ? "Yes" : "No";
    case "json": return jsonText(JSON.parse(String(value))) || null;
    case "account": return email(value);
    // As the restaurant's tags name them, or none.
    case "restaurantTypes": return (JSON.parse(String(value)) as RestaurantType[]).map((type) => RESTAURANT_TYPE_LABELS[type]).join(", ") || null;
    // Exact or Approximate (TRA-150).
    case "accuracy": return ACCURACY_LABELS[value as CoordinatesAccuracy];
    // Only coordinates waiting to be reviewed say so, so a place without any shows nothing (TRA-150).
    case "review": return value === 1 ? "Yes" : null;
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
    case "trip.image": return change.image ? "Set a trip's headline image" : "Remove a trip's headline image";
    case "trip.bestTime": return hasBestTime(change.bestTime) ? "Save a trip's best time to go" : "Clear a trip's best time to go";
    case "trip.share": return `Share a trip with ${change.email}`;
    case "trip.unshare": return `Stop sharing a trip with ${change.email}`;
    case "trip.tag": return `Tag a trip “${change.name}”`;
    case "trip.untag": return `Remove the tag “${change.name}” from a trip`;
    // Each person's own (TRA-16), so never proposed: aiChange refuses it.
    case "trip.order": return "Put trips in order";
    case "homeItem.save": return `${change.create ? "Add" : "Change"} the At home item “${change.name}”`;
    case "homeItem.delete": return "Delete an At home item";
    case "packingItem.save": return `${change.create ? "Add" : "Change"} the packing item “${change.name}”`;
    case "packingItem.pack": return change.packed ? "Mark a packing item packed" : "Mark a packing item not packed";
    case "packingItem.delete": return "Delete a packing item";
    case "packingList.add": return `Add ${change.items.length === 1 ? "1 item" : `${change.items.length} items`} to a packing list`;
    case "destination.save": return change.stopId === undefined ? "Change a destination" : "Change a destination and a trip's stay there";
    case "destination.create": return `Add the destination “${change.city}”`;
    case "destination.delete": return "Delete a destination";
    case "destination.entryRequirements": return change.requirements ? "Save a destination's entry requirements" : "Clear a destination's entry requirements";
    case "destination.healthSafety": return change.healthSafety ? "Save a destination's health and safety" : "Clear a destination's health and safety";
    case "destination.climate": return change.climate ? "Save a destination's monthly averages" : "Clear a destination's monthly averages";
    case "destination.churchVisibility": return change.enabled ? "Show a destination's Church section" : "Hide a destination's Church section";
    case "church.save": return `${change.create ? "Add" : "Change"} the church “${change.name}”`;
    case "church.delete": return "Delete a church";
    case "stop.add": return `Add ${change.city} to a trip`;
    case "stop.visit": return "Add a saved destination to a trip";
    case "stop.move": return `Move a stay ${change.direction === "up" ? "earlier" : "later"} in its trip`;
    case "stop.remove": return "Remove a stay from its trip";
    case "leg.save": return "Change travel between stops";
    case "leg.clear": return "Clear travel between stops";
    case "leg.layoverPlan": return change.plan ? "Save a layover plan" : "Remove a layover plan";
    case "candidate.save": return `${change.create ? "Add" : "Change"} the ${IDEA[change.category]} “${change.name}”`;
    case "candidate.move": return `Move an idea ${change.direction} its list`;
    case "candidate.mustDo": return change.mustDo ? "Mark an idea Must do" : "Unmark an idea Must do";
    case "candidate.include": return change.included ? "Include an idea" : "Leave out an idea";
    case "candidate.delete": return "Delete an idea";
    case "destination.photos": return "Change a destination's photos";
    case "candidate.photos": return "Change an idea's photos";
    case "church.photos": return "Change a church's photos";
    case "candidate.coordinates": return change.coordinates ? `Set an idea's ${change.coordinates.accuracy} coordinates` : "Remove an idea's coordinates";
    case "church.coordinates": return change.coordinates ? `Set a church's ${change.coordinates.accuracy} coordinates` : "Remove a church's coordinates";
    // Each person's own (TRA-31), so never proposed: aiChange refuses them.
    case "trip.like": case "destination.like": case "candidate.like": case "church.like":
      return (change.liked ? "Like " : "Remove a like from ") + LIKED[change.type];
  }
}
/** What each change that saves a like likes (TRA-31), as its title names it. */
const LIKED: Record<`${LikeKind}.like`, string> = { "trip.like": "a trip", "destination.like": "a destination", "candidate.like": "an idea", "church.like": "a church" };
