import { isValidDate } from "./destination-duration.ts";
import type { ResearchLink } from "./types";

/** Someone to call about the destination, such as emergency services, an embassy or a travel insurer. */
export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  notes: string;
}

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
const MAX_SOURCES = 20;
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
    if (!/^[0-9+() .-]+$/.test(phone) || !/[0-9]/.test(phone)) throw new Error("Enter each phone number using only digits, spaces, plus signs, parentheses, hyphens, and periods.");
    return { id, name, phone, notes: text(contact.notes, "Emergency contact notes", EMERGENCY_CONTACT_MAX_LENGTH.notes) };
  });
}

function normalizeSources(value: unknown): ResearchLink[] {
  const list = value === undefined ? [] : value;
  if (!Array.isArray(list) || list.length > MAX_SOURCES) throw new Error(`You can save up to ${MAX_SOURCES} health and safety sources.`);
  const ids = new Set<string>();
  return list.map((item): ResearchLink => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Each health and safety source must include a website address.");
    const link = item as Record<string, unknown>;
    const id = entryId(link.id, ids, "source");
    const address = text(link.url, "Source website address", 2048);
    let url: URL;
    try {
      url = new URL(address);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error("Invalid URL");
    } catch {
      throw new Error("Enter a source link starting with https:// or http://, without a username or password.");
    }
    return { id, url: url.toString(), description: text(link.description, "Source description", 160) };
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
  const lastCheckedDate = input.lastCheckedDate == null ? null : text(input.lastCheckedDate, "Last checked date", 10) || null;
  if (lastCheckedDate !== null && !isValidDate(lastCheckedDate)) throw new Error("Enter a valid last checked date in YYYY-MM-DD format.");
  // The level comes last, where schema 44 added it to the records saved before it.
  return { ...fields, emergencyContacts: normalizeContacts(input.emergencyContacts), sources: normalizeSources(input.sources), lastCheckedDate, usAdvisoryLevel: normalizeUsAdvisoryLevel(input.usAdvisoryLevel) };
}

/** Extract the editor draft; the store validates it before writing. Not set, the dropdown's empty choice, is null. */
export function healthSafetyFromForm(fields: FormData, emergencyContacts: EmergencyContact[], sources: ResearchLink[]): HealthSafety {
  const values = Object.fromEntries(HEALTH_SAFETY_FIELDS.map((field) => [field.name, String(fields.get(field.name) ?? "")])) as HealthSafetyText;
  const level = String(fields.get("usAdvisoryLevel") ?? "");
  return { ...values, emergencyContacts, sources, lastCheckedDate: String(fields.get("lastCheckedDate") ?? "") || null, usAdvisoryLevel: level === "" ? null : Number(level) as UsAdvisoryLevel };
}
