import { MAX_NIGHTS } from "./trip-dates.ts";
import { ACTIVITIES_BUDGET_MODES, FOOD_BUDGET_MODES } from "./types.ts";

/**
 * Travel's editable fields (TRA-174): the ordinary fields of each record, each a single value that a save checks on its
 * own and writes to one column. People's saves and ChatGPT's and Claude's proposals change them by the same rules: the
 * store checks a save's fields by their kinds (`readFields` in store.ts), assistants are told about them from here
 * (`propose_changes` in mcp-tools.ts), and the owner reviews a proposal's changes to them under their labels
 * (`PREVIEW_COLUMNS` in ai-preview.ts). So a field added here, with its column, the read that gives it and the save that
 * writes it, is read, proposed, checked and previewed with no code of its own for assistants.
 *
 * A save writes each of its fields, and does whatever else a field's new value calls for, such as clearing the travel
 * from a new departing city. A list, a record of its own, an ID or a photo isn't an ordinary field: each has explicit
 * support, as every other change does, and an assistant can propose nothing else.
 */

interface Field {
  /** Its name on a proposal's page, or null where that page shows it through another column, as research links show a link. */
  label: string | null;
  /** What assistants are told it is. */
  description: string;
  /** The column it is saved in, when that isn't its name, as an amount's whole cents are. */
  column?: string;
  /** A save may leave it out, keeping the saved value. Otherwise every save of its record gives it. */
  keep?: true;
}

export type EditableField = Field & (
  // Trimmed text of up to maxLength characters. `filled` refuses blank text, and `nullable` takes null, which its save
  // gives a meaning. `invalid` and `tooLong` replace the usual messages.
  | { kind: "text"; maxLength: number; filled?: true; nullable?: true; invalid?: string; tooLong?: string }
  // A website, https:// or http://, or empty for none.
  | { kind: "url" }
  // A USD amount as text, such as "125.50", or empty when unknown, checked by money.ts's rules, whose messages call it `noun`.
  | { kind: "amount"; noun: string }
  | { kind: "boolean" }
  // A whole number from min to max, or with `nullable` null when unknown.
  | { kind: "whole"; min: number; max: number; nullable?: true; invalid: string }
  // Any finite number, or null when unknown.
  | { kind: "number"; invalid: string }
  | { kind: "choice"; values: readonly string[]; invalid: string }
  // A date, YYYY-MM-DD, or null for none, as empty text is too.
  | { kind: "date"; invalid: string }
);

/** Each record's editable fields, by its table, in the order a save checks them. */
export const EDITABLE_FIELDS = {
  trips: {
    name: { kind: "text", maxLength: 120, filled: true, label: "Name", description: "Its name." },
    tagline: { kind: "text", maxLength: 120, keep: true, label: "Tagline", description: "A short line shown in capitals above the trip's name on its page, saved as written. Empty for Travel's default heading. Left out keeps the saved one." },
    startDate: { kind: "date", keep: true, invalid: "Enter a valid trip start date in YYYY-MM-DD format.", label: "Start date", description: "The first day, YYYY-MM-DD, or null for none. Each stay's dates follow from it and the nights before it. Left out keeps the saved one." },
    dateLabel: { kind: "text", maxLength: 120, label: "Dates", description: "When, in words, such as \"Spring 2027\". Empty for none." },
    homeCity: { kind: "text", maxLength: 120, label: "Departing city", description: "The departing city. Empty for none." },
    returnCity: {
      kind: "text", maxLength: 120, filled: true, nullable: true, keep: true, invalid: "Enter a return city, or use the departing city for your return.", tooLong: "Return city must be 120 characters or fewer.",
      label: "Return city", description: "The return city, or null when it is the departing city. Left out keeps the saved one.",
    },
    travelers: { kind: "whole", min: 1, max: 999, invalid: "Number of travelers must be a whole number between 1 and 999.", label: "Travelers", description: "How many people travel." },
    notes: { kind: "text", maxLength: 8000, label: "Notes", description: "Notes. Empty for none." },
  },
  home_items: {
    name: { kind: "text", maxLength: 160, filled: true, label: "Name", description: "What it is." },
    price: { kind: "amount", noun: "Estimated price", column: "priceCents", label: "Price", description: "What it costs." },
    notes: { kind: "text", maxLength: 8000, label: "Notes", description: "Notes. Empty for none." },
  },
  destinations: {
    city: { kind: "text", maxLength: 120, filled: true, keep: true, label: "City", description: "The city." },
    tagline: { kind: "text", maxLength: 120, keep: true, label: "Tagline", description: "A short line shown in capitals above the destination's name on its page, saved as written. Empty for Travel's default heading." },
    notes: { kind: "text", maxLength: 8000, keep: true, label: "Notes", description: "Notes. Empty for none." },
    miscDailyAmount: { kind: "amount", noun: "Daily miscellaneous amount", keep: true, column: "miscDailyMinor", label: "Daily miscellaneous", description: "Daily miscellaneous spending for the whole party." },
    hotelNightlyAmount: { kind: "amount", noun: "Nightly hotel amount", keep: true, column: "hotelNightlyMinor", label: "Nightly hotel estimate", description: "The nightly hotel estimate, used until a hotel is chosen." },
    activitiesBudgetMode: { kind: "choice", values: ACTIVITIES_BUDGET_MODES, keep: true, invalid: "Choose General budget or Itemized activity costs.", label: "Activities budget method", description: "itemized adds up included activities; general uses activitiesGeneralAmount." },
    activitiesGeneralAmount: { kind: "amount", noun: "General activities amount", keep: true, column: "activitiesGeneralMinor", label: "General activities budget", description: "The activities budget for a stay." },
    foodBudgetMode: { kind: "choice", values: FOOD_BUDGET_MODES, keep: true, invalid: "Choose Daily food budget or Itemized restaurant costs.", label: "Food budget method", description: "itemized adds up included restaurants; daily uses foodDailyAmount." },
    foodDailyAmount: { kind: "amount", noun: "Daily food amount", keep: true, column: "foodDailyMinor", label: "Daily food budget", description: "Daily food spending for the whole party." },
    shoppingAmount: { kind: "amount", noun: "Shopping amount", keep: true, column: "shoppingMinor", label: "Shopping budget", description: "The shopping budget for a stay." },
    weatherHighF: { kind: "number", keep: true, invalid: "Typical high must be a number in °F, or left blank.", label: "Typical high (°F)", description: "Typical high in °F, or null." },
    weatherLowF: { kind: "number", keep: true, invalid: "Typical low must be a number in °F, or left blank.", label: "Typical low (°F)", description: "Typical low in °F, or null." },
    weatherRainfall: { kind: "text", maxLength: 4000, keep: true, label: "Typical rainfall", description: "Typical rainfall. Empty for none." },
    weatherPeriod: { kind: "text", maxLength: 120, keep: true, label: "Weather period", description: "The weather's time of year. Empty for none." },
    weatherSource: { kind: "text", maxLength: 2048, keep: true, label: "Weather source", description: "Where the weather is from. Empty for none." },
  },
  // A trip's stay at a destination, which a destination's save changes along with it when it names the stay.
  trip_stops: {
    stay: { kind: "text", maxLength: 120, keep: true, label: "Stay notes", description: "Stay notes for the trip's stay, with stopId. Empty for none." },
    nights: { kind: "whole", min: 0, max: MAX_NIGHTS, nullable: true, keep: true, invalid: `Nights must be a whole number between 0 and ${MAX_NIGHTS}, or left blank.`, label: "Nights", description: "Nights of the trip's stay, with stopId, or null when unknown." },
  },
  churches: {
    name: { kind: "text", maxLength: 160, filled: true, label: "Name", description: "Its name." },
    address: { kind: "text", maxLength: 500, label: "Address", description: "Its address. Empty for none." },
    denomination: { kind: "text", maxLength: 160, label: "Denomination", description: "Its denomination. Empty for none." },
    url: { kind: "url", label: "Website", description: "Its website, https:// or http://. Empty for none." },
  },
  legs: {
    method: { kind: "text", maxLength: 120, label: "Method", description: "How, such as Flight or Train. Empty for none." },
    airline: { kind: "text", maxLength: 120, keep: true, label: "Airline", description: "A flight's airline, such as Delta. Empty for none. Left out keeps the saved one." },
    flightNumber: { kind: "text", maxLength: 120, keep: true, label: "Flight number", description: "A flight's flight number, such as DL 123. Empty for none. Left out keeps the saved one." },
    price: { kind: "amount", noun: "Estimated price", column: "priceCents", label: "Price", description: "What it costs for the whole party." },
    miscAmount: {
      kind: "amount", noun: "Miscellaneous spending", keep: true, column: "miscCents", label: "Miscellaneous spending",
      description: "Miscellaneous spending on the way, such as airport meals, drinks and layover purchases, for the whole party and the whole connection, apart from its price. Left out keeps the saved amount.",
    },
    departure: { kind: "text", maxLength: 120, label: "Departure", description: "When it leaves. Empty for none." },
    arrival: { kind: "text", maxLength: 120, label: "Arrival", description: "When it arrives. Empty for none." },
    // Its first research link, which the proposal's page shows with the others.
    url: { kind: "url", label: null, description: "A booking or research link, https:// or http://. Empty for none." },
    notes: { kind: "text", maxLength: 8000, label: "Notes", description: "Notes. Empty for none." },
  },
  candidates: {
    name: { kind: "text", maxLength: 160, filled: true, label: "Name", description: "Its name." },
    description: {
      kind: "text", maxLength: 120, keep: true, label: "What it is",
      description: "What it is, in a few words, such as \"Boutique hotel\", \"Historic cathedral\" or \"Traditional Italian restaurant\", shown below its name on its cards. Empty for none. Left out keeps the saved one.",
    },
    price: { kind: "amount", noun: "Estimated price", column: "priceCents", label: "Price", description: "Its cost for the whole party: a hotel's for the whole stay." },
    address: { kind: "text", maxLength: 500, label: "Address", description: "Its address. Empty for none." },
    // Its first research link, which the proposal's page shows with the others.
    url: { kind: "url", label: null, description: "A website, https:// or http://. Empty for none." },
    notes: { kind: "text", maxLength: 8000, label: "Notes", description: "Notes. Empty for none." },
    included: { kind: "boolean", label: "Included", description: "Whether it is in the budget: for a hotel, whether it is the chosen one." },
    mustDo: { kind: "boolean", keep: true, label: "Must do", description: "Must do, for activities and restaurants only. Left out keeps it." },
  },
} as const satisfies Record<string, Record<string, EditableField>>;

/** The column a field is saved in. */
export function fieldColumn(name: string, field: EditableField): string {
  return field.column ?? name;
}

/** The value of one field as a save gives it. */
type FieldValue<F> =
  F extends { kind: "text"; nullable: true } ? string | null :
  F extends { kind: "text" | "url" | "amount" } ? string :
  F extends { kind: "boolean" } ? boolean :
  F extends { kind: "whole"; nullable: true } ? number | null :
  F extends { kind: "whole" } ? number :
  F extends { kind: "number" } ? number | null :
  F extends { kind: "date" } ? string | null :
  F extends { kind: "choice"; values: readonly (infer V)[] } ? V :
  never;
/** The fields of a record that a save may leave out. */
type Kept<T> = { [K in keyof T]: T[K] extends { keep: true } ? K : never }[keyof T];
/** A save's values for a record's editable fields: those it must give, and those it may leave out to keep the saved values. */
export type FieldValues<T extends Record<string, EditableField>> =
  { -readonly [K in Exclude<keyof T, Kept<T>>]: FieldValue<T[K]> } & { -readonly [K in Kept<T>]?: FieldValue<T[K]> };
