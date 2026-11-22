/**
 * A destination's typical weather (TRA-13) and its monthly climate averages (TRA-135). People record both, or approve
 * them from ChatGPT or Claude; Travel never looks weather up, estimates it or fills in a missing value.
 */

/** The months a climate record covers, in calendar order. */
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export type Month = typeof MONTHS[number];

/**
 * One month's historical averages, named by its month (TRA-158): the average daily high and low in °F, and the month's
 * average total precipitation in inches.
 */
export interface ClimateMonth { month: Month; highF: number; lowF: number; precipitationIn: number; }

/**
 * A destination's monthly climate averages (TRA-135): one entry for each month, January to December, every value given,
 * from one named source, averaged over the reference years it names. It is kept apart from the seasonal typical weather
 * fields, so saving or clearing either one keeps the other.
 */
export interface MonthlyClimate { months: ClimateMonth[]; source: string; firstYear: number; lastYear: number; }

/**
 * What a record and each of its months hold, and nothing else (TRA-158). Their names carry their units, so a value given
 * in another unit, such as °C or millimeters, is refused rather than saved as °F or inches.
 */
const RECORD_FIELDS = ["months", "source", "firstYear", "lastYear"];
const MONTH_FIELDS = ["month", "highF", "lowF", "precipitationIn"];
/** Why a month's averages without its full name, such as an assistant's "Jan" or 1, are refused (TRA-158). */
export const NAME_EACH_MONTH = "Give each month's averages with its month, written in full, from January to December.";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Names as a list, such as "March, April and May". */
function listed(names: readonly string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** One month's averages: its month by name, and its three averages in °F and inches, without anything else. */
function climateMonth(value: unknown): ClimateMonth {
  if (!isRecord(value) || !MONTHS.includes(value.month as Month)) throw new Error(NAME_EACH_MONTH);
  const month = value.month as Month;
  const other = Object.keys(value).find((key) => !MONTH_FIELDS.includes(key));
  if (other !== undefined) throw new Error(`${month}'s averages take only month, highF, lowF and precipitationIn, in °F and inches: convert or leave out ${other}.`);
  const { highF, lowF, precipitationIn } = value;
  const { minF, maxF, maxPrecipitationIn } = CLIMATE_LIMITS;
  if (!finite(highF, minF, maxF)) throw new Error(`Enter ${month}'s average high in °F, from ${minF} to ${maxF}.`);
  if (!finite(lowF, minF, maxF)) throw new Error(`Enter ${month}'s average low in °F, from ${minF} to ${maxF}.`);
  if (highF < lowF) throw new Error(`${month}'s average high must be at least its average low.`);
  if (!finite(precipitationIn, 0, maxPrecipitationIn)) throw new Error(`Enter ${month}'s average precipitation in inches, from 0 to ${maxPrecipitationIn}.`);
  return { month, highF, lowF, precipitationIn };
}

/**
 * Validate the complete replacement record: every month once, by its name and in any order, with its three averages, and
 * the record's source and reference years, all required, and nothing else (TRA-158). The months come back in calendar
 * order. A null value explicitly clears it.
 */
export function normalizeMonthlyClimate(value: unknown): MonthlyClimate | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("Enter monthly averages, or clear the saved ones.");
  const other = Object.keys(value).find((key) => !RECORD_FIELDS.includes(key));
  if (other !== undefined) throw new Error(`Monthly averages take only months, source, firstYear and lastYear, with every month in °F and inches: leave out ${other}.`);
  if (!Array.isArray(value.months)) throw new Error("Enter averages for all 12 months, January to December.");
  const given = new Map<Month, ClimateMonth>();
  for (const entry of value.months) {
    const month = climateMonth(entry);
    if (given.has(month.month)) throw new Error(`Give ${month.month}'s averages only once.`);
    given.set(month.month, month);
  }
  const missing = MONTHS.filter((month) => !given.has(month));
  if (missing.length) throw new Error(`Enter averages for all 12 months, January to December: ${listed(missing)} ${missing.length === 1 ? "is" : "are"} missing.`);
  const months = MONTHS.map((month) => given.get(month)!);
  if (typeof value.source !== "string" || !value.source.trim()) throw new Error("Enter where the monthly averages are from.");
  const source = value.source.trim();
  if (source.length > CLIMATE_LIMITS.sourceLength) throw new Error(`The monthly averages' source must be ${CLIMATE_LIMITS.sourceLength} characters or fewer.`);
  const { firstYear, lastYear } = value;
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

/** Extract the editor draft, one row per month in calendar order, each named by its month; the store validates it before writing. */
export function monthlyClimateFromForm(fields: FormData): MonthlyClimate {
  const [highs, lows, precipitation] = ["climateHighF", "climateLowF", "climatePrecipitationIn"].map((name) => fields.getAll(name).map(entered));
  return {
    months: highs.map((highF, index) => ({ month: MONTHS[index], highF, lowF: lows[index], precipitationIn: precipitation[index] })),
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
/** One month's averages in words, as its place on the chart reads aloud. */
export function climateMonthText(climate: MonthlyClimate, index: number): string {
  const month = climate.months[index];
  return `${MONTHS[index]}: average high ${formatFahrenheit(month.highF)}, average low ${formatFahrenheit(month.lowF)}, precipitation ${formatInches(month.precipitationIn)}`;
}
/** One month's averages in words, as a proposal's page shows them beside their month (TRA-158). */
export function climateAveragesText(month: ClimateMonth): string {
  return `Average high ${formatFahrenheit(month.highF)}, average low ${formatFahrenheit(month.lowF)}, precipitation ${formatInches(month.precipitationIn)}`;
}

/**
 * A record as its row of `destination_climate` keeps it (TRA-135): its months in calendar order, as
 * normalizeMonthlyClimate gives them, without their names, which their places give back when it is read (TRA-158).
 */
export function climateJson(climate: MonthlyClimate): string {
  const months = climate.months.map(({ highF, lowF, precipitationIn }) => ({ highF, lowF, precipitationIn }));
  return JSON.stringify({ months, source: climate.source, firstYear: climate.firstYear, lastYear: climate.lastYear });
}
/** A saved record, each month named by its place in the year. */
export function climateFromJson(json: string): MonthlyClimate {
  const saved = JSON.parse(json) as Omit<MonthlyClimate, "months"> & { months: Omit<ClimateMonth, "month">[] };
  return {
    months: saved.months.map(({ highF, lowF, precipitationIn }, index) => ({ month: MONTHS[index], highF, lowF, precipitationIn })),
    source: saved.source, firstYear: saved.firstYear, lastYear: saved.lastYear,
  };
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

/** A chart's precipitation axis (TRA-164): its top in inches, from 0 at the bottom, and its gridlines, bottom first. */
export interface PrecipitationScale { max: number; ticks: number[]; }
/** Steps between gridlines in inches, smallest first. Within CLIMATE_LIMITS, 200 reaches the wettest month in one interval. */
const PRECIPITATION_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];

/**
 * The precipitation axis beside a temperature axis of `intervals` gridline intervals: from 0 in as many intervals, so
 * each of its gridlines is one of the temperature's, in the smallest step that reaches the wettest month.
 */
export function precipitationScale(months: readonly ClimateMonth[], intervals: number): PrecipitationScale {
  const wettest = Math.max(...months.map((month) => month.precipitationIn));
  const step = PRECIPITATION_STEPS.find((size) => size * intervals >= wettest)!;
  // Rounded to tenths, so steps of 0.1 and 0.2 make ticks such as 0.3, not 0.30000000000000004.
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => Math.round(index * step * 10) / 10);
  return { max: ticks[intervals], ticks };
}
