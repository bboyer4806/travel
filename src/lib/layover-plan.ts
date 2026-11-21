import { isValidDate } from "./destination-duration.ts";

/**
 * Layover plans (TRA-45): what a traveler plans to do during one layover of a travel connection, timed against the
 * flight that lands there and the connecting flight that leaves. The traveler enters all of it: both flights' scheduled
 * times in the airport's time zone, their own estimates of the airport's processing times, and their activities, each
 * with where it is, how long it takes and, outside the airport, how long getting there takes. Travel suggests no
 * activities and supplies no estimates of its own. It works out the schedule, the time to spare and the warnings from
 * what is entered alone, and shows them as estimates, never as guarantees.
 */

/** The most activities one layover plan holds. */
export const MAX_LAYOVER_ACTIVITIES = 20;
/** The most minutes any one estimate, travel time or activity takes: a day. */
export const MAX_LAYOVER_MINUTES = 1440;

/** An activity the traveler adds to a layover plan, in the plan's order. */
export interface LayoverActivity {
  id: string;
  /** What it is, such as "Lunch at the Römer". */
  name: string;
  /** Where it is, such as an address or "Terminal 1, near gate B20". Empty for none. */
  place: string;
  /** Whether it is outside the airport, which means leaving the airport for it. */
  outside: boolean;
  /** How long it takes, in minutes. */
  minutes: number;
  /** Outside the airport, how long getting there takes, from the airport or the activity before it, in minutes. Null in the airport. */
  travelMinutes: number | null;
  notes: string;
}

/**
 * A layover's plan. `arrival` and `departure` are the times the arriving flight is scheduled to land and the connecting
 * flight to depart, as the airport's clocks show them (YYYY-MM-DDTHH:MM), in the IANA time zone `timeZone`. The minutes
 * are the traveler's own estimates, 0 for any that don't apply. `returnMinutes` is the travel back to the airport after
 * the activities outside it, and null when every activity is in the airport.
 */
export interface LayoverPlan {
  timeZone: string;
  arrival: string;
  departure: string;
  immigrationMinutes: number;
  customsMinutes: number;
  securityMinutes: number;
  transferMinutes: number;
  boardingMinutes: number;
  returnMinutes: number | null;
  activities: LayoverActivity[];
}

/** A layover plan as saved, with the ID of the layover in its connection's itinerary that it plans. */
export type SavedLayoverPlan = LayoverPlan & { layoverId: string };

/**
 * The airport time a plan deducts, each the traveler's own estimate in minutes, in the order the schedule takes them:
 * immigration and customs right after landing, security and the terminal transfer once back from any activities outside
 * the airport, and boarding before departure. `hint` says what each covers, in its editor.
 */
export const LAYOVER_BUFFERS = [
  { name: "immigrationMinutes", label: "Immigration", hint: "Passport control as you enter the country." },
  { name: "customsMinutes", label: "Customs", hint: "Customs, and collecting any bags you must." },
  { name: "securityMinutes", label: "Security", hint: "Screening for the connecting flight, with any exit passport control." },
  { name: "transferMinutes", label: "Terminal transfer", hint: "Getting to the connecting flight's terminal and gate." },
  { name: "boardingMinutes", label: "Boarding", hint: "How long before departure to be at the gate." },
] as const;
export type LayoverBuffer = typeof LAYOVER_BUFFERS[number]["name"];

type Input = Record<string, unknown>;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d$/;
/** An IANA name's shape, such as Europe/Berlin or UTC. Intl also takes offsets, such as +01:00, which plans don't use. */
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const MINUTE_MS = 60_000;

/** Whether `name` is a time zone Intl knows by its IANA name. */
export function isTimeZone(name: string): boolean {
  if (!ZONE_NAME.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
/** The time zone's offset from UTC at an instant, in milliseconds: its clocks' reading, taken as UTC, less the instant. */
function offsetAt(instant: number, timeZone: string): number {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    zoneFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]));
  // setUTCFullYear, unlike Date.UTC, reads years before 100 as written.
  const clock = new Date(0);
  clock.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  clock.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return clock.getTime() - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a time zone's clocks show `local` (YYYY-MM-DDTHH:MM), in milliseconds since the epoch, or null when they
 * never show it, as in the hour skipped when they go forward. When they show it twice, as in the hour repeated when they
 * go back, it is the earlier.
 */
export function zonedInstant(local: string, timeZone: string): number | null {
  const clock = Date.parse(local + ":00.000Z");
  // The offsets in effect a day either side cover any one change of the clocks near this time.
  const candidates = [...new Set([offsetAt(clock - 86_400_000, timeZone), offsetAt(clock + 86_400_000, timeZone)])]
    .map((offset) => clock - offset)
    .filter((instant) => instant + offsetAt(instant, timeZone) === clock);
  return candidates.length ? Math.min(...candidates) : null;
}

/** Text as saved, trimmed. `missing` is the message for a blank one, which only required text has; optional text may be left out. */
function text(value: unknown, label: string, maxLength: number, missing?: string): string {
  if (value === undefined && !missing) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (missing && !trimmed) throw new Error(missing);
  if (trimmed.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

function wholeMinutes(value: unknown, message: string, min = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > MAX_LAYOVER_MINUTES) throw new Error(message);
  return value;
}

const clockFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
/** A plan's local time as people read it, such as "Mar 8, 2026, 2:30 AM", without changing its time zone. */
function readLocal(local: string): string {
  return clockFormatter.format(Date.parse(local + ":00.000Z"));
}

/** A flight's scheduled local time, checked: a real date and time, which the airport's clocks show. */
function flightTime(value: unknown, timeZone: string, flight: string): { local: string; instant: number } {
  const local = typeof value === "string" ? value.trim() : "";
  const match = LOCAL_TIME.exec(local);
  if (!match || !isValidDate(match[1])) throw new Error(`Enter the date and time the ${flight}, as the airport's clocks show it.`);
  const instant = zonedInstant(local, timeZone);
  if (instant === null) throw new Error(`The clocks in ${timeZone} skip ${readLocal(local)}, when the ${flight}. Check the time.`);
  return { local, instant };
}

/**
 * A complete layover plan, checked, or null to remove the saved one. Every activity outside the airport comes in one
 * trip out of it, one after another, so the plan leaves the airport once and travels back once.
 */
export function normalizeLayoverPlan(value: unknown): LayoverPlan | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter the layover plan, or remove it.");
  const input = value as Input;
  const timeZone = typeof input.timeZone === "string" ? input.timeZone.trim() : "";
  if (!isTimeZone(timeZone)) throw new Error("Choose the airport's time zone.");
  const arrival = flightTime(input.arrival, timeZone, "arriving flight lands");
  const departure = flightTime(input.departure, timeZone, "connecting flight departs");
  if (departure.instant <= arrival.instant) throw new Error("The connecting flight must depart after the arriving flight lands.");
  const buffers = Object.fromEntries(LAYOVER_BUFFERS.map(({ name, label }) =>
    [name, wholeMinutes(input[name], `${label} must be a whole number of minutes from 0 to ${MAX_LAYOVER_MINUTES}. Enter 0 when it doesn't apply.`)])) as Record<LayoverBuffer, number>;
  if (!Array.isArray(input.activities) || input.activities.length > MAX_LAYOVER_ACTIVITIES) throw new Error(`A layover plan can have up to ${MAX_LAYOVER_ACTIVITIES} activities.`);
  const ids = new Set<string>();
  const activities = input.activities.map((item): LayoverActivity => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Enter what each activity is and how long it takes.");
    const activity = item as Input;
    const id = typeof activity.id === "string" ? activity.id : "";
    if (!ID.test(id)) throw new Error("An activity has an invalid identifier. Please refresh and try again.");
    if (ids.has(id.toLowerCase())) throw new Error("Each activity must have a unique identifier.");
    ids.add(id.toLowerCase());
    if (typeof activity.outside !== "boolean") throw new Error("Choose whether each activity is in the airport or outside it.");
    const travel = `Enter how long getting to each activity outside the airport takes, in whole minutes from 0 to ${MAX_LAYOVER_MINUTES}.`;
    if (!activity.outside && activity.travelMinutes !== null && activity.travelMinutes !== undefined) throw new Error("Only activities outside the airport have a travel time.");
    return {
      id,
      name: text(activity.name, "What an activity is", 160, "Enter what each activity is."),
      place: text(activity.place, "Where an activity is", 300),
      outside: activity.outside,
      minutes: wholeMinutes(activity.minutes, `Enter how long each activity takes, in whole minutes from 1 to ${MAX_LAYOVER_MINUTES}.`, 1),
      travelMinutes: activity.outside ? wholeMinutes(activity.travelMinutes, travel) : null,
      notes: text(activity.notes, "An activity's notes", 2000),
    };
  });
  const first = activities.findIndex((activity) => activity.outside);
  const last = activities.findLastIndex((activity) => activity.outside);
  if (activities.slice(first, last + 1).some((activity) => !activity.outside)) {
    throw new Error("Plan the activities outside the airport one after another, in a single trip out of the airport.");
  }
  let returnMinutes: number | null = null;
  if (first >= 0) returnMinutes = wholeMinutes(input.returnMinutes, `Enter how long the travel back to the airport takes, in whole minutes from 0 to ${MAX_LAYOVER_MINUTES}.`);
  else if (input.returnMinutes !== null && input.returnMinutes !== undefined) throw new Error("Only a plan with activities outside the airport travels back to it.");
  return { timeZone, arrival: arrival.local, departure: departure.local, ...buffers, returnMinutes, activities };
}

/** What a step of a layover's schedule is. "spare" is the time left before the gate, when there is any. */
export type LayoverStepKind = "land" | "immigration" | "customs" | "activity" | "travel" | "return" | "security" | "transfer" | "spare" | "gate" | "depart";
/** One step of a layover's schedule: when it starts, as an instant, and how many minutes it takes. */
export interface LayoverStep {
  kind: LayoverStepKind;
  label: string;
  start: number;
  minutes: number;
  /** Whether it ends after the time to be at the gate. */
  late: boolean;
  /** The activity it is, or travels to. */
  activityId?: string;
}
/**
 * A layover's schedule, worked out from its plan. `spareMinutes` is the time left between the end of the plan and the
 * time to be at the gate, negative when the plan runs past it, and `missesFlight` says it runs past departure.
 */
export interface LayoverSchedule {
  layoverMinutes: number;
  airportMinutes: number;
  travelMinutes: number;
  activityMinutes: number;
  spareMinutes: number;
  leavesAirport: boolean;
  missesFlight: boolean;
  steps: LayoverStep[];
}

/**
 * The schedule of a checked plan, from landing to departure, in order of time: immigration and customs, any airport
 * activities listed before those outside it, then each activity outside the airport after the travel to it, the travel
 * back, security and the terminal transfer, then the other airport activities, any time to spare, and the gate before
 * departure. A step that takes no time, as an estimate of 0, is left out.
 */
export function layoverSchedule(plan: LayoverPlan): LayoverSchedule {
  const arrivesAt = zonedInstant(plan.arrival, plan.timeZone);
  const departsAt = zonedInstant(plan.departure, plan.timeZone);
  // A saved plan's times exist, unless the time zone data reading it says otherwise, as an outdated browser's can.
  if (arrivesAt === null || departsAt === null) throw new Error(`This plan's flight times don't exist in ${plan.timeZone} as this device's time zone data has it.`);
  const gateAt = departsAt - plan.boardingMinutes * MINUTE_MS;
  const steps: LayoverStep[] = [{ kind: "land", label: "Arriving flight lands", start: arrivesAt, minutes: 0, late: false }];
  let clock = arrivesAt;
  const add = (kind: LayoverStepKind, label: string, minutes: number, activityId?: string) => {
    if (minutes === 0 && kind !== "activity") return;
    steps.push({ kind, label, start: clock, minutes, late: clock + minutes * MINUTE_MS > gateAt, ...(activityId && { activityId }) });
    clock += minutes * MINUTE_MS;
  };
  const first = plan.activities.findIndex((activity) => activity.outside);
  const outing = first >= 0 ? plan.activities.filter((activity) => activity.outside) : [];
  const before = first >= 0 ? plan.activities.slice(0, first) : [];
  const after = plan.activities.slice(before.length + outing.length);
  add("immigration", "Immigration", plan.immigrationMinutes);
  add("customs", "Customs", plan.customsMinutes);
  for (const activity of before) add("activity", activity.name, activity.minutes, activity.id);
  for (const activity of outing) {
    add("travel", "Travel to " + activity.name, activity.travelMinutes!, activity.id);
    add("activity", activity.name, activity.minutes, activity.id);
  }
  if (outing.length) add("return", "Travel back to the airport", plan.returnMinutes!);
  add("security", "Security", plan.securityMinutes);
  add("transfer", "Terminal transfer", plan.transferMinutes);
  for (const activity of after) add("activity", activity.name, activity.minutes, activity.id);
  const spareMinutes = Math.round((gateAt - clock) / MINUTE_MS);
  if (spareMinutes > 0) add("spare", "Time to spare", spareMinutes);
  if (plan.boardingMinutes > 0) steps.push({ kind: "gate", label: "At the gate for boarding", start: gateAt, minutes: plan.boardingMinutes, late: spareMinutes < 0 });
  steps.push({ kind: "depart", label: "Connecting flight departs", start: departsAt, minutes: 0, late: false });
  // The gate and the departure keep their places in time, so a plan that runs late shows the steps they cut into. Steps
  // that start together keep their order.
  steps.sort((a, b) => a.start - b.start);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  return {
    layoverMinutes: Math.round((departsAt - arrivesAt) / MINUTE_MS),
    airportMinutes: sum(LAYOVER_BUFFERS.map(({ name }) => plan[name])),
    travelMinutes: sum(outing.map((activity) => activity.travelMinutes!)) + (plan.returnMinutes ?? 0),
    activityMinutes: sum(plan.activities.map((activity) => activity.minutes)),
    spareMinutes,
    leavesAirport: outing.length > 0,
    missesFlight: clock > departsAt,
    steps,
  };
}

/** Minutes as people read them: "45 min", "2 h" or "1 h 5 min". A negative amount reads as its size. */
export function formatMinutes(minutes: number): string {
  const size = Math.abs(minutes);
  const hours = Math.floor(size / 60);
  const rest = size % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const clockFormatters = new Map<string, { time: Intl.DateTimeFormat; day: Intl.DateTimeFormat }>();
function formattersFor(timeZone: string) {
  let formatters = clockFormatters.get(timeZone);
  if (!formatters) {
    formatters = {
      time: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }),
      day: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }),
    };
    clockFormatters.set(timeZone, formatters);
  }
  return formatters;
}
/** An instant as the plan's airport's clocks show it, such as "7:35 AM". */
export function formatLayoverTime(instant: number, timeZone: string): string {
  return formattersFor(timeZone).time.format(instant);
}
/** The airport's date at an instant, such as "Mon, May 10". */
export function formatLayoverDay(instant: number, timeZone: string): string {
  return formattersFor(timeZone).day.format(instant);
}

/** A time zone's offset from UTC at an instant, as people read it: "UTC", "UTC+2" or "UTC−3:30". */
export function formatUtcOffset(timeZone: string, instant: number): string {
  const minutes = Math.round(offsetAt(instant, timeZone) / MINUTE_MS);
  if (minutes === 0) return "UTC";
  const size = Math.abs(minutes);
  return `UTC${minutes > 0 ? "+" : "−"}${Math.floor(size / 60)}${size % 60 ? ":" + String(size % 60).padStart(2, "0") : ""}`;
}

/** A layover plan as its editor holds it while it is typed: numbers as entered, so a field can be blank on the way. */
export interface LayoverActivityDraft { id: string; name: string; place: string; outside: boolean; minutes: string; travelMinutes: string; notes: string }
export type LayoverPlanDraft = Record<LayoverBuffer, string> & { timeZone: string; arrival: string; departure: string; returnMinutes: string; activities: LayoverActivityDraft[] };

const entered = (value: number | null) => value === null ? "" : String(value);
/** A plan's editor's draft: the saved plan, or for a new one blank times and every estimate at 0, since Travel supplies none. */
export function layoverPlanDraft(plan: LayoverPlan | undefined): LayoverPlanDraft {
  return {
    timeZone: plan?.timeZone ?? "", arrival: plan?.arrival ?? "", departure: plan?.departure ?? "",
    ...Object.fromEntries(LAYOVER_BUFFERS.map(({ name }) => [name, entered(plan?.[name] ?? 0)])) as Record<LayoverBuffer, string>,
    returnMinutes: entered(plan?.returnMinutes ?? null),
    activities: (plan?.activities ?? []).map((activity) => ({ ...activity, minutes: entered(activity.minutes), travelMinutes: entered(activity.travelMinutes) })),
  };
}

/** A blank field is no number, rather than 0, so checking the plan asks for it. */
const minutesEntered = (value: string) => value.trim() === "" ? NaN : Number(value);
/**
 * The plan an editor's draft saves, for `normalizeLayoverPlan` to check. An activity in the airport has no travel time,
 * and a plan without activities outside it no travel back, whatever its hidden fields last held.
 */
export function layoverPlanFromDraft(draft: LayoverPlanDraft): LayoverPlan {
  const leaves = draft.activities.some((activity) => activity.outside);
  return {
    timeZone: draft.timeZone, arrival: draft.arrival, departure: draft.departure,
    ...Object.fromEntries(LAYOVER_BUFFERS.map(({ name }) => [name, minutesEntered(draft[name])])) as Record<LayoverBuffer, number>,
    returnMinutes: leaves ? minutesEntered(draft.returnMinutes) : null,
    activities: draft.activities.map((activity) => ({
      id: activity.id, name: activity.name, place: activity.place, outside: activity.outside, notes: activity.notes,
      minutes: minutesEntered(activity.minutes), travelMinutes: activity.outside ? minutesEntered(activity.travelMinutes) : null,
    })),
  };
}
