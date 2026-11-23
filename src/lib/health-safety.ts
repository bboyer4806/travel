import { enteredLatLng, normalizeLatLng } from "./coordinates.ts";
import { isValidDate } from "./destination-duration.ts";
import type { LatLng } from "./coordinates";
import type { ResearchLink } from "./types";

/** Someone to call about the destination, such as emergency services, an embassy or a travel insurer. */
export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  notes: string;
}

/**
 * Whether a source confirmed something about a medical provider (TRA-172): that it offers consultations in English, or
 * that it sees visiting American patients. Unconfirmed is everything not verified, never "no".
 */
export const PROVIDER_CHECKS = ["unconfirmed", "verified"] as const;
export type ProviderCheck = typeof PROVIDER_CHECKS[number];
export const CHECK_LABELS: Record<ProviderCheck, string> = { unconfirmed: "Unconfirmed", verified: "Verified" };
/**
 * The soonest visit a source confirmed a medical provider offers (TRA-172): walk-in visits without an appointment,
 * same-day appointments, or appointments at short notice, or unconfirmed when none was. Never a guarantee.
 */
export const SHORT_NOTICE_CARE = ["unconfirmed", "walk-in", "same-day", "short-notice"] as const;
export type ShortNoticeCare = typeof SHORT_NOTICE_CARE[number];
export const SHORT_NOTICE_LABELS: Record<ShortNoticeCare, string> = { unconfirmed: "Unconfirmed", "walk-in": "Walk-in visits", "same-day": "Same-day appointments", "short-notice": "Short-notice appointments" };
/** Why a record's medical providers are refused: every record gives them, an empty list for none. */
export const GIVE_MEDICAL_PROVIDERS = "Give medicalProviders, the destination's non-emergency medical providers: the saved ones to keep them, or an empty list for none.";

/**
 * A doctor, medical clinic or outpatient facility for non-emergency care at the destination, as people researched it
 * (TRA-172). `coordinates` are its map location, or null. `englishConsultations`, `visitingAmericans` and `shortNotice`
 * are what a source confirmed, or unconfirmed. `sources` support what is recorded, and `lastVerifiedDate` is when it was
 * last checked, or null. Travel never finds, checks or changes any of it.
 */
export interface MedicalProvider {
  id: string;
  name: string;
  address: string;
  coordinates: LatLng | null;
  phone: string;
  website: string;
  services: string;
  notes: string;
  englishConsultations: ProviderCheck;
  visitingAmericans: ProviderCheck;
  shortNotice: ShortNoticeCare;
  sources: ResearchLink[];
  lastVerifiedDate: string | null;
}
/** A medical provider as its editor holds it: its latitude and longitude as typed, and everything else as saved. */
export type MedicalProviderDraft = Omit<MedicalProvider, "coordinates"> & { latitude: string; longitude: string };

/** The U.S. State Department's travel advisory levels (TRA-171). */
export const US_ADVISORY_LEVELS = [1, 2, 3, 4] as const;
export type UsAdvisoryLevel = typeof US_ADVISORY_LEVELS[number];
/** Each level's official description, as the State Department writes it. */
const US_ADVISORY_DESCRIPTIONS: Record<UsAdvisoryLevel, string> = { 1: "Exercise Normal Precautions", 2: "Exercise Increased Caution", 3: "Reconsider Travel", 4: "Do Not Travel" };
/** Why a record's U.S. travel advisory level is refused: every record gives it, as one of the levels or null for none. */
export const GIVE_US_ADVISORY_LEVEL = "Give the U.S. travel advisory level as 1, 2, 3 or 4, or null when it isn't set.";

/** A level with its official description, such as "Level 2: Exercise Increased Caution". */
export function usAdvisoryLabel(level: UsAdvisoryLevel): string {
  return `Level ${level}: ${US_ADVISORY_DESCRIPTIONS[level]}`;
}

/**
 * A destination's health and safety research. People record and update all of it; Travel never retrieves or changes it.
 * `usAdvisoryLevel` is the U.S. State Department's travel advisory level someone chose, or null while none is chosen
 * (TRA-171). It is apart from `advisoryLevel`, the advisory level as typed, and Travel never reads one from the other.
 * `medicalProviders` are doctors and clinics for non-emergency care, apart from `emergencyContacts` (TRA-172).
 */
export interface HealthSafety {
  advisoryLevel: string;
  advisoryWarnings: string;
  healthPrecautions: string;
  localSafety: string;
  emergencyContacts: EmergencyContact[];
  sources: ResearchLink[];
  lastCheckedDate: string | null;
  usAdvisoryLevel: UsAdvisoryLevel | null;
  medicalProviders: MedicalProvider[];
}

export const HEALTH_SAFETY_FIELDS = [
  { name: "advisoryLevel", label: "Travel advisory level", maxLength: 240 },
  { name: "advisoryWarnings", label: "Travel advisory warnings", maxLength: 8000 },
  { name: "healthPrecautions", label: "Health precautions", maxLength: 8000 },
  { name: "localSafety", label: "Local safety", maxLength: 8000 },
] as const;
type HealthSafetyText = Pick<HealthSafety, typeof HEALTH_SAFETY_FIELDS[number]["name"]>;

export const MAX_EMERGENCY_CONTACTS = 20;
export const EMERGENCY_CONTACT_MAX_LENGTH = { name: 160, phone: 40, notes: 500 } as const;
/** The longest each of a medical provider's text fields can be (TRA-172). How many providers there are has no limit. */
export const MEDICAL_PROVIDER_MAX_LENGTH = { name: 160, address: 500, phone: 40, website: 2048, services: 500, notes: 2000 } as const;
/** The most sources the record, and each medical provider, can have. */
export const MAX_SOURCES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, label: string, maxLength: number): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

/** A list entry's ID, which must be a UUID used once in its list. */
function entryId(value: unknown, ids: Set<string>, noun: string): string {
  const id = text(value, "Identifier", 36);
  if (!UUID.test(id)) throw new Error(`This ${noun} has an invalid identifier. Please remove it and add it again.`);
  if (ids.has(id.toLowerCase())) throw new Error(`Each ${noun} must have a unique identifier.`);
  ids.add(id.toLowerCase());
  return id;
}

function normalizeContacts(value: unknown): EmergencyContact[] {
  const list = value === undefined ? [] : value;
  if (!Array.isArray(list) || list.length > MAX_EMERGENCY_CONTACTS) throw new Error(`You can save up to ${MAX_EMERGENCY_CONTACTS} emergency contacts.`);
  const ids = new Set<string>();
  return list.map((item): EmergencyContact => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Each emergency contact needs a name and phone number.");
    const contact = item as Record<string, unknown>;
    const id = entryId(contact.id, ids, "emergency contact");
    const name = text(contact.name, "Emergency contact name", EMERGENCY_CONTACT_MAX_LENGTH.name);
    if (!name) throw new Error("Enter a name for each emergency contact.");
    const phone = text(contact.phone, "Emergency contact phone number", EMERGENCY_CONTACT_MAX_LENGTH.phone);
    if (!phone) throw new Error("Enter a phone number for each emergency contact.");
    return { id, name, phone: checkPhone(phone), notes: text(contact.notes, "Emergency contact notes", EMERGENCY_CONTACT_MAX_LENGTH.notes) };
  });
}

/** A phone number as typed: digits, and the separators phone numbers are written with. */
function checkPhone(phone: string): string {
  if (!/^[0-9+() .-]+$/.test(phone) || !/[0-9]/.test(phone)) throw new Error("Enter each phone number using only digits, spaces, plus signs, parentheses, hyphens, and periods.");
  return phone;
}

/** A website's address as the URL parser writes it: http or https, with a host and no username or password. */
function webAddress(address: string, message: string): string {
  let url: URL;
  try {
    url = new URL(address);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error("Invalid URL");
  } catch {
    throw new Error(message);
  }
  return url.toString();
}

/** A calendar date, YYYY-MM-DD, or null for none. */
function calendarDate(value: unknown, label: string): string | null {
  const date = value == null ? null : text(value, label, 10) || null;
  if (date !== null && !isValidDate(date)) throw new Error(`Enter a valid ${label.toLowerCase()} in YYYY-MM-DD format.`);
  return date;
}

/** Exactly one of `values`. Anything else, a value left out included, is refused with `message`. */
function oneOf<T extends string>(values: readonly T[], value: unknown, message: string): T {
  if (!values.includes(value as T)) throw new Error(message);
  return value as T;
}

/** Source links, each a website address with an optional description. `limit` says how many there can be. */
function normalizeSources(value: unknown, limit: string): ResearchLink[] {
  const list = value === undefined ? [] : value;
  if (!Array.isArray(list) || list.length > MAX_SOURCES) throw new Error(limit);
  const ids = new Set<string>();
  return list.map((item): ResearchLink => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Each health and safety source must include a website address.");
    const link = item as Record<string, unknown>;
    const id = entryId(link.id, ids, "source");
    const url = webAddress(text(link.url, "Source website address", 2048), "Enter a source link starting with https:// or http://, without a username or password.");
    return { id, url, description: text(link.description, "Source description", 160) };
  });
}

/** A medical provider's map location: a latitude and a longitude together, or null for none. */
function mapLocation(value: unknown): LatLng | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Enter each medical provider's map location as a latitude and a longitude, or remove it.");
  const { latitude, longitude } = value as Record<string, unknown>;
  return normalizeLatLng(latitude, longitude);
}

/**
 * Medical providers for non-emergency care (TRA-172), as many as are worth keeping. Each needs a name, and gives each of
 * its checks as verified or unconfirmed; everything else is optional, and what isn't known stays blank.
 */
function normalizeProviders(value: unknown): MedicalProvider[] {
  if (!Array.isArray(value)) throw new Error(GIVE_MEDICAL_PROVIDERS);
  const ids = new Set<string>();
  return value.map((item): MedicalProvider => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Each medical provider needs a name.");
    const provider = item as Record<string, unknown>;
    const id = entryId(provider.id, ids, "medical provider");
    const name = text(provider.name, "Medical provider name", MEDICAL_PROVIDER_MAX_LENGTH.name);
    if (!name) throw new Error("Enter a name for each medical provider.");
    const phone = text(provider.phone, "Medical provider phone number", MEDICAL_PROVIDER_MAX_LENGTH.phone);
    const website = text(provider.website, "Medical provider website", MEDICAL_PROVIDER_MAX_LENGTH.website);
    return {
      id, name,
      address: text(provider.address, "Medical provider address", MEDICAL_PROVIDER_MAX_LENGTH.address),
      coordinates: mapLocation(provider.coordinates),
      phone: phone && checkPhone(phone),
      website: website && webAddress(website, "Enter each medical provider's website starting with https:// or http://, without a username or password."),
      services: text(provider.services, "Medical specialty or services", MEDICAL_PROVIDER_MAX_LENGTH.services),
      notes: text(provider.notes, "Medical provider notes", MEDICAL_PROVIDER_MAX_LENGTH.notes),
      englishConsultations: oneOf(PROVIDER_CHECKS, provider.englishConsultations, "Choose whether it is verified or unconfirmed that each medical provider offers consultations in English."),
      visitingAmericans: oneOf(PROVIDER_CHECKS, provider.visitingAmericans, "Choose whether it is verified or unconfirmed that each medical provider sees visiting American patients."),
      shortNotice: oneOf(SHORT_NOTICE_CARE, provider.shortNotice, "Choose the soonest visit verified for each medical provider: walk-in, same-day, short-notice, or unconfirmed."),
      sources: normalizeSources(provider.sources, `You can save up to ${MAX_SOURCES} sources for each medical provider.`),
      lastVerifiedDate: calendarDate(provider.lastVerifiedDate, "Last verified date"),
    };
  });
}

/** A U.S. travel advisory level: exactly one of the levels, as a number, or null for none. Anything else is refused, a missing level included. */
function normalizeUsAdvisoryLevel(value: unknown): UsAdvisoryLevel | null {
  if (value === null) return null;
  if (!US_ADVISORY_LEVELS.includes(value as UsAdvisoryLevel)) throw new Error(GIVE_US_ADVISORY_LEVEL);
  return value as UsAdvisoryLevel;
}

/** Validate the complete replacement record. A null value explicitly clears it. */
export function normalizeHealthSafety(value: unknown): HealthSafety | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter health and safety information, or clear the saved record.");
  const input = value as Record<string, unknown>;
  const fields = Object.fromEntries(HEALTH_SAFETY_FIELDS.map((field) => [field.name, text(input[field.name], field.label, field.maxLength)])) as HealthSafetyText;
  const lastCheckedDate = calendarDate(input.lastCheckedDate, "Last checked date");
  // The level and the medical providers come last, where schemas 44 and 45 added them to the records saved before them.
  return {
    ...fields, emergencyContacts: normalizeContacts(input.emergencyContacts), sources: normalizeSources(input.sources, `You can save up to ${MAX_SOURCES} health and safety sources.`),
    lastCheckedDate, usAdvisoryLevel: normalizeUsAdvisoryLevel(input.usAdvisoryLevel), medicalProviders: normalizeProviders(input.medicalProviders),
  };
}

/** Extract the editor draft; the store validates it before writing. Not set, the dropdown's empty choice, is null. */
export function healthSafetyFromForm(fields: FormData, emergencyContacts: EmergencyContact[], sources: ResearchLink[], medicalProviders: MedicalProviderDraft[]): HealthSafety {
  const values = Object.fromEntries(HEALTH_SAFETY_FIELDS.map((field) => [field.name, String(fields.get(field.name) ?? "")])) as HealthSafetyText;
  const level = String(fields.get("usAdvisoryLevel") ?? "");
  return { ...values, emergencyContacts, sources, lastCheckedDate: String(fields.get("lastCheckedDate") ?? "") || null, usAdvisoryLevel: level === "" ? null : Number(level) as UsAdvisoryLevel, medicalProviders: medicalProviders.map(providerFromDraft) };
}

/** A new medical provider as its editor starts it (TRA-172): nothing recorded, and nothing verified. */
export function newProviderDraft(id: string): MedicalProviderDraft {
  return { id, name: "", address: "", latitude: "", longitude: "", phone: "", website: "", services: "", notes: "", englishConsultations: "unconfirmed", visitingAmericans: "unconfirmed", shortNotice: "unconfirmed", sources: [], lastVerifiedDate: null };
}

/** A saved medical provider as its editor starts it. */
export function providerDraft({ coordinates, ...provider }: MedicalProvider): MedicalProviderDraft {
  return { ...provider, latitude: coordinates ? String(coordinates.latitude) : "", longitude: coordinates ? String(coordinates.longitude) : "" };
}

/** A medical provider from its editor's draft, which the store validates before writing. Clearing both degrees removes its map location. */
export function providerFromDraft({ latitude, longitude, ...provider }: MedicalProviderDraft): MedicalProvider {
  return { ...provider, coordinates: latitude.trim() === "" && longitude.trim() === "" ? null : enteredLatLng(latitude, longitude) };
}

/** Medical providers as their section lists them (TRA-172): those verified to offer consultations in English first, each group as saved. */
export function providersInOrder(providers: MedicalProvider[]): MedicalProvider[] {
  const rank = (provider: MedicalProvider) => provider.englishConsultations === "verified" ? 0 : 1;
  return [...providers].sort((a, b) => rank(a) - rank(b));
}

/** A link that calls a phone number as typed: its digits, after a plus sign when it has one. */
export function telephoneHref(phone: string): string {
  return "tel:" + (phone.includes("+") ? "+" : "") + phone.replace(/\D/g, "");
}

/** A link that opens Google Maps at `query`: an address, or a latitude and longitude as "48.20849,16.37208". */
export function mapHref(query: string): string {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
}
