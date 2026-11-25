import { MONTHS, type Month } from "./typical-weather.ts";

/**
 * A trip's Best time to go (TRA-178), apart from its destinations' typical weather: the calendar months recommended for
 * taking the whole trip, considering every destination, why they are recommended, such as their weather, activities,
 * festivals and crowds, and the times to avoid and why. People enter it, or approve it from ChatGPT or Claude; Travel never
 * works one out, and saving one never changes the trip's dates, destinations or itinerary.
 */

/** A trip's Best time to go: its recommended months, each once, in calendar order, and its two notes, each empty for none. */
export interface BestTime { months: Month[]; reasons: string; avoid: string; }

/** The longest each note may be, in characters, which its editor, the store and the MCP schema share. */
export const BEST_TIME_NOTE_LENGTH = 4000;

/** What a record holds, and nothing else. */
const FIELDS = ["months", "reasons", "avoid"];

/** Whether a trip has any Best time to go: a recommended month, or either note. */
export function hasBestTime(bestTime: BestTime): boolean {
  return bestTime.months.length > 0 || bestTime.reasons !== "" || bestTime.avoid !== "";
}

/** One of a record's notes, trimmed, refused by `label` when it isn't text or is too long. */
function note(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > BEST_TIME_NOTE_LENGTH) throw new Error(`${label} must be ${BEST_TIME_NOTE_LENGTH} characters or fewer.`);
  return trimmed;
}

/**
 * Validate a complete replacement record: any of the 12 months, all of them or none, by their full names, each once and
 * in any order, which come back in calendar order, and both notes, empty for none, and nothing else. No months and empty
 * notes clear it.
 */
export function normalizeBestTime(value: unknown): BestTime {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Give the best time to go as its months, reasons and avoid.");
  const record = value as Record<string, unknown>;
  const other = Object.keys(record).find((key) => !FIELDS.includes(key));
  if (other !== undefined) throw new Error(`The best time to go takes only months, reasons and avoid: leave out ${other}.`);
  if (!Array.isArray(record.months)) throw new Error("Choose the recommended months from January to December.");
  const chosen = new Set<Month>();
  for (const month of record.months) {
    if (!MONTHS.includes(month)) throw new Error("Choose the recommended months from January to December, each written in full.");
    if (chosen.has(month)) throw new Error(`Choose ${month} only once.`);
    chosen.add(month);
  }
  return { months: MONTHS.filter((month) => chosen.has(month)), reasons: note(record.reasons, "Why these months"), avoid: note(record.avoid, "Times to avoid") };
}

/**
 * Whether a trip shows under All trips' month filter: with no month selected every trip does, whatever its Best time to
 * go, and otherwise only a trip recommended for at least one selected month, so a trip without recommended months doesn't.
 */
export function recommendedFor(months: readonly Month[], selected: readonly Month[]): boolean {
  return selected.length === 0 || selected.some((month) => months.includes(month));
}

/** The editor's record from its form: the months checked, in calendar order, and its notes as typed. The store validates it before saving. */
export function bestTimeFromForm(fields: FormData): BestTime {
  const checked = fields.getAll("months");
  return { months: MONTHS.filter((month) => checked.includes(month)), reasons: String(fields.get("reasons") ?? ""), avoid: String(fields.get("avoid") ?? "") };
}
