import { isValidDate } from "./destination-duration.ts";
import type { ResearchLink } from "./types";

export interface EntryRequirements {
  passportNationality: string;
  travelPurpose: string;
  travelerCircumstances: string;
  visaRequirements: string;
  passportValidity: string;
  requiredDocuments: string;
  transitRequirements: string;
  notes: string;
  sources: ResearchLink[];
  lastCheckedDate: string | null;
}

export const ENTRY_REQUIREMENT_FIELDS = [
  { name: "passportNationality", label: "Passport nationality", maxLength: 240 },
  { name: "travelPurpose", label: "Purpose of travel", maxLength: 500 },
  { name: "travelerCircumstances", label: "Traveler circumstances", maxLength: 4000 },
  { name: "visaRequirements", label: "Visa / electronic authorization requirements", maxLength: 8000 },
  { name: "passportValidity", label: "Passport validity requirements", maxLength: 4000 },
  { name: "requiredDocuments", label: "Required documents / health requirements", maxLength: 8000 },
  { name: "transitRequirements", label: "Transit requirements", maxLength: 8000 },
  { name: "notes", label: "Additional notes", maxLength: 8000 },
] as const;

function text(value: unknown, label: string, maxLength: number): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

/** Validate the complete replacement record. A null value explicitly clears it. */
export function normalizeEntryRequirements(value: unknown): EntryRequirements | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter entry requirements, or clear the saved record.");
  const input = value as Record<string, unknown>;
  const fields = Object.fromEntries(ENTRY_REQUIREMENT_FIELDS.map((field) => [field.name, text(input[field.name], field.label, field.maxLength)])) as Pick<EntryRequirements, typeof ENTRY_REQUIREMENT_FIELDS[number]["name"]>;
  const rawSources = input.sources === undefined ? [] : input.sources;
  if (!Array.isArray(rawSources) || rawSources.length > 20) throw new Error("You can save up to 20 entry requirement sources.");
  const ids = new Set<string>();
  const sources = rawSources.map((source): ResearchLink => {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Each entry requirement source must include a website address.");
    const link = source as Record<string, unknown>;
    const id = text(link.id, "Source identifier", 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("This source has an invalid identifier. Please remove it and add it again.");
    if (ids.has(id.toLowerCase())) throw new Error("Each entry requirement source must have a unique identifier.");
    ids.add(id.toLowerCase());
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
  const lastCheckedDate = input.lastCheckedDate == null ? null : text(input.lastCheckedDate, "Last checked date", 10) || null;
  if (lastCheckedDate !== null && !isValidDate(lastCheckedDate)) throw new Error("Enter a valid last checked date in YYYY-MM-DD format.");
  return { ...fields, sources, lastCheckedDate };
}

/** Extract the editor draft; the store validates it before writing. */
export function entryRequirementsFromForm(fields: FormData, sources: ResearchLink[]): EntryRequirements {
  const values = Object.fromEntries(ENTRY_REQUIREMENT_FIELDS.map((field) => [field.name, String(fields.get(field.name) ?? "")])) as Pick<EntryRequirements, typeof ENTRY_REQUIREMENT_FIELDS[number]["name"]>;
  return { ...values, sources, lastCheckedDate: String(fields.get("lastCheckedDate") ?? "") || null };
}
