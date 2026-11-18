/**
 * A destination's typical weather (TRA-13) and its monthly climate averages (TRA-135). People record both, or approve
 * them from ChatGPT or Claude; Travel never looks weather up, estimates it or fills in a missing value.
 */

/** The months a climate record covers, in calendar order. */
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** One month's historical averages: the average daily high and low in °F, and the month's average total precipitation in inches. */
export interface ClimateMonth { highF: number; lowF: number; precipitationIn: number; }

/**
 * A destination's monthly climate averages (TRA-135): one entry for each month, January to December, every value given,
 * from one named source, averaged over the reference years it names. It is kept apart from the seasonal typical weather
 * fields, so saving or clearing either one keeps the other.
 */
export interface MonthlyClimate { months: ClimateMonth[]; source: string; firstYear: number; lastYear: number; }

/** What a monthly climate record accepts, which its editor, the store and the MCP schema share. */
export const CLIMATE_LIMITS = { minF: -150, maxF: 150, maxPrecipitationIn: 200, minYear: 1000, maxYear: 9999, sourceLength: 2048 } as const;

/** A weather source written as an http or https address, without credentials, as a link to open. A source's name has none. */
export function sourceHref(source: string): string | undefined {
  try {
    const url = new URL(source);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Source names are plain text. */ }
}

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function climateMonth(value: unknown, month: string): ClimateMonth {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter averages for all 12 months, January to December.");
  const { highF, lowF, precipitationIn } = value as Record<string, unknown>;
  const { minF, maxF, maxPrecipitationIn } = CLIMATE_LIMITS;
  if (!finite(highF, minF, maxF)) throw new Error(`Enter ${month}'s average high in °F, from ${minF} to ${maxF}.`);
  if (!finite(lowF, minF, maxF)) throw new Error(`Enter ${month}'s average low in °F, from ${minF} to ${maxF}.`);
  if (highF < lowF) throw new Error(`${month}'s average high must be at least its average low.`);
  if (!finite(precipitationIn, 0, maxPrecipitationIn)) throw new Error(`Enter ${month}'s average precipitation in inches, from 0 to ${maxPrecipitationIn}.`);
  return { highF, lowF, precipitationIn };
}

/** Validate the complete replacement record: every month's three averages, its source and its reference years. A null value explicitly clears it. */
export function normalizeMonthlyClimate(value: unknown): MonthlyClimate | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter monthly averages, or clear the saved ones.");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.months) || input.months.length !== MONTHS.length) throw new Error("Enter averages for all 12 months, January to December.");
  const months = input.months.map((month, index) => climateMonth(month, MONTHS[index]));
  if (typeof input.source !== "string" || !input.source.trim()) throw new Error("Enter where the monthly averages are from.");
  const source = input.source.trim();
  if (source.length > CLIMATE_LIMITS.sourceLength) throw new Error(`The monthly averages' source must be ${CLIMATE_LIMITS.sourceLength} characters or fewer.`);
  const { firstYear, lastYear } = input;
  const year = (entered: unknown): entered is number => Number.isInteger(entered) && finite(entered, CLIMATE_LIMITS.minYear, CLIMATE_LIMITS.maxYear);
  if (!year(firstYear) || !year(lastYear)) throw new Error("Enter the first and last reference years as four-digit years.");
  if (firstYear > lastYear) throw new Error("The first reference year must be no later than the last.");
  return { months, source, firstYear, lastYear };
}

/** One of the editor's numbers, or NaN when it is blank, which the store refuses: a blank is never zero. */
function entered(value: FormDataEntryValue | null): number {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? Number.NaN : Number(text);
}

/** Extract the editor draft, one row per month in calendar order; the store validates it before writing. */
export function monthlyClimateFromForm(fields: FormData): MonthlyClimate {
  const [highs, lows, precipitation] = ["climateHighF", "climateLowF", "climatePrecipitationIn"].map((name) => fields.getAll(name).map(entered));
  return {
    months: highs.map((highF, index) => ({ highF, lowF: lows[index], precipitationIn: precipitation[index] })),
    source: String(fields.get("climateSource") ?? ""),
    firstYear: entered(fields.get("climateFirstYear")),
    lastYear: entered(fields.get("climateLastYear")),
  };
}

export function formatFahrenheit(value: number): string { return `${value} °F`; }
export function formatInches(value: number): string { return `${value} in`; }
/** The years a record's averages cover, such as 1991–2020, or one year. */
export function formatReferenceYears(climate: Pick<MonthlyClimate, "firstYear" | "lastYear">): string {
  return climate.firstYear === climate.lastYear ? String(climate.firstYear) : `${climate.firstYear}–${climate.lastYear}`;
}
/** One month's averages in words, as its place on the chart reads aloud and a proposal shows them. */
export function climateMonthText(climate: MonthlyClimate, index: number): string {
  const month = climate.months[index];
  return `${MONTHS[index]}: average high ${formatFahrenheit(month.highF)}, average low ${formatFahrenheit(month.lowF)}, precipitation ${formatInches(month.precipitationIn)}`;
}
/** A whole record in words, for the owner reviewing a proposal. */
export function monthlyClimateText(climate: MonthlyClimate): string {
  return [`Historical averages for ${formatReferenceYears(climate)} from ${climate.source}`, ...MONTHS.map((_, index) => climateMonthText(climate, index))].join("; ");
}

/** The month a calendar date (YYYY-MM-DD) falls in, 0 for January, or null without a date. */
export function monthOf(date: string | null): number | null {
  return date === null ? null : Number(date.slice(5, 7)) - 1;
}

/** A chart's temperature axis: its rounded bottom and top in °F, and the gridlines between them, bottom first. */
export interface TemperatureScale { min: number; max: number; ticks: number[]; }
/** Steps between gridlines, smallest first. Within CLIMATE_LIMITS, 50 °F always takes six or fewer. */
const TICK_STEPS = [5, 10, 20, 25, 50];

/**
 * The temperature axis for a record's highs and lows: the smallest step that spans them in six gridline intervals or
 * fewer, from the step at or below the lowest low to the one at or above the highest high, and at least one interval.
 */
export function temperatureScale(months: readonly ClimateMonth[]): TemperatureScale {
  const low = Math.min(...months.map((month) => month.lowF));
  const high = Math.max(...months.map((month) => month.highF));
  const step = TICK_STEPS.find((size) => Math.ceil(high / size) - Math.floor(low / size) <= 6)!;
  const bottom = Math.floor(low / step);
  const top = Math.max(Math.ceil(high / step), bottom + 1);
  return { min: bottom * step, max: top * step, ticks: Array.from({ length: top - bottom + 1 }, (_, index) => (bottom + index) * step) };
}
