import { tripVisits } from "./budget.ts";
import { formatSavedDestinationLabel } from "./destination-label.ts";
import { addNights, routeDays, routeLegs } from "./trip-dates.ts";
import type { Snapshot } from "./types.ts";

/**
 * The most days a trip's calendar lists (TRA-185): a whole year, leap day included. A longer trip's later days are
 * counted rather than listed, so no saved number of nights makes its page too long to show.
 */
export const MAX_CALENDAR_DAYS = 366;

/**
 * A travel connection on a trip's calendar (TRA-185): its ID, where it leaves and arrives, named as the trip page names
 * them, its saved Transportation text, and its nights spent traveling.
 */
export interface CalendarLeg { id: string; from: string; to: string; method: string; travelNights: number }

/**
 * A stay on a trip's calendar (TRA-185): its stop's ID, its destination, named as the trip page names it, its nights, or
 * null while unknown, and the name of its destination's chosen hotel, or null without one.
 */
export interface CalendarStay { stopId: string; place: string; nights: number | null; hotel: string | null }

/**
 * Something that happens on one of a trip's days (TRA-185): arriving for a stay, a whole day there, departing after its
 * nights, or a same-day visit, which has none; a connection leaving, or a whole day spent traveling on it; or the trip's
 * end, arriving at its return city.
 */
export type CalendarEvent =
  | { kind: "arrive" | "stay" | "depart" | "visit"; stay: CalendarStay }
  | { kind: "travel" | "transit"; leg: CalendarLeg }
  | { kind: "end"; place: string };

/**
 * Where the night after a day is spent (TRA-185): at a stay, traveling on a connection, or not yet known, after arriving
 * for a stay whose nights are unknown.
 */
export type CalendarNight = { kind: "stay" | "unknown"; stay: CalendarStay } | { kind: "travel"; leg: CalendarLeg };

/**
 * One of a trip's days (TRA-185): its number, from Day 1, its date while the trip has a start date, what happens on it in
 * travel order, and where the night after it, the trip's night of the same number, is spent, or null on the last day.
 */
export interface CalendarDay { number: number; date: string | null; events: CalendarEvent[]; night: CalendarNight | null }

/** A connection or stay after a stay whose nights are unknown, which has no day until they are known (TRA-185). */
export type UnscheduledPart = { kind: "travel"; leg: CalendarLeg } | { kind: "stay"; stay: CalendarStay };

/**
 * A trip's calendar (TRA-185): its days, at most MAX_CALENDAR_DAYS of them, and how many more follow them unlisted. After
 * a stay whose nights are unknown, `waitingFor`, the rest of its route has no days: `unscheduled` lists it in travel order.
 */
export interface TripCalendar { days: CalendarDay[]; unlisted: number; waitingFor: CalendarStay | null; unscheduled: UnscheduledPart[] }

/**
 * A part of a trip's route that has days, with the days it begins and ends, in whole days after the trip's first: a
 * connection, or a stay, which has no end while its nights are unknown.
 */
type ScheduledPart = { kind: "travel"; leg: CalendarLeg; start: number; end: number } | { kind: "stay"; stay: CalendarStay; start: number; end: number | null };

/**
 * A trip's calendar (TRA-185), from its saved route alone, as its dates are (`routeDays`): its departure, each connection
 * and stay in route order, and its return. Day 1 is the day it departs, and the night after each day is spent at a stay
 * or traveling, never both, so nights spent traveling are no stay's nights. A connection without nights spent traveling
 * arrives the day it leaves, so it shares that day with the stays it joins. Nothing has a day after a stay whose nights
 * are unknown, and nothing is guessed.
 */
export function tripCalendar(snapshot: Snapshot, tripId: string): TripCalendar {
  const trip = snapshot.trips.find((item) => item.id === tripId);
  if (!trip) throw new Error("A trip's calendar needs the trip.");
  const visits = tripVisits(snapshot, tripId);
  const stops = visits.map(({ stop }) => stop);
  const tripLegs = snapshot.legs.filter((leg) => leg.tripId === tripId);
  const days = routeDays(stops, tripLegs);
  const stays: CalendarStay[] = visits.map(({ stop, visit }) => ({
    stopId: stop.id, place: formatSavedDestinationLabel(visit) || "Destination", nights: stop.nights,
    hotel: snapshot.candidates.find((item) => item.destinationId === visit.id && item.category === "hotels" && item.included)?.name ?? null,
  }));
  // The same names the connections show on the trip page: a trip returns to its departing city unless it has a return city.
  const returnCity = trip.returnCity ?? trip.homeCity;
  const legs: CalendarLeg[] = routeLegs(stops, tripLegs).map((leg, index) => ({
    id: leg.id, method: leg.method, travelNights: leg.travelNights,
    from: index === 0 ? trip.homeCity || "Departing city" : stays[index - 1].place,
    to: index === stays.length ? returnCity || "Return city" : stays[index].place,
  }));
  // The route in travel order: each connection, then the stay it reaches, with their days while they have them.
  const scheduled: ScheduledPart[] = [];
  const unscheduled: UnscheduledPart[] = [];
  legs.forEach((leg, index) => {
    const { leaves, arrives } = days.connections[index];
    if (leaves === null || arrives === null) unscheduled.push({ kind: "travel", leg });
    else scheduled.push({ kind: "travel", leg, start: leaves, end: arrives });
    if (index === stays.length) return;
    const { arrives: start, departs: end } = days.stays[index];
    if (start === null) unscheduled.push({ kind: "stay", stay: stays[index] });
    else scheduled.push({ kind: "stay", stay: stays[index], start, end });
  });
  // Arriving for a stay whose nights are unknown is the last day the calendar can list.
  const waiting = scheduled.find((part) => part.kind === "stay" && part.end === null);
  const last = days.end ?? waiting?.start ?? null;
  const count = last === null ? 0 : last + 1;
  return {
    days: Array.from({ length: Math.min(count, MAX_CALENDAR_DAYS) }, (_, day) => calendarDay(day, scheduled, trip.startDate, days.end, legs)),
    unlisted: Math.max(0, count - MAX_CALENDAR_DAYS),
    waitingFor: waiting?.kind === "stay" ? waiting.stay : null,
    unscheduled,
  };
}

/**
 * One day of a trip's calendar, `day` days after its first: what happens in each part of the route it falls in, in travel
 * order, and the part whose time the night after it is spent in, or none on the trip's last day, `end`.
 */
function calendarDay(day: number, scheduled: readonly ScheduledPart[], startDate: string | null, end: number | null, legs: readonly CalendarLeg[]): CalendarDay {
  const events: CalendarEvent[] = [];
  let night: CalendarNight | null = null;
  for (const part of scheduled) {
    if (part.kind === "travel") {
      // A connection's arrival shows as the stay it reaches, or the trip's end.
      if (day === part.start) events.push({ kind: "travel", leg: part.leg });
      else if (day > part.start && day < part.end) events.push({ kind: "transit", leg: part.leg });
      if (day >= part.start && day < part.end) night = { kind: "travel", leg: part.leg };
    } else if (part.end === null) {
      // Arriving for a stay whose nights are unknown, the last day listed.
      if (day === part.start) { events.push({ kind: "arrive", stay: part.stay }); night = { kind: "unknown", stay: part.stay }; }
    } else {
      if (day === part.start) events.push({ kind: part.start === part.end ? "visit" : "arrive", stay: part.stay });
      else if (day > part.start && day < part.end) events.push({ kind: "stay", stay: part.stay });
      else if (day === part.end) events.push({ kind: "depart", stay: part.stay });
      if (day >= part.start && day < part.end) night = { kind: "stay", stay: part.stay };
    }
  }
  if (day === end) events.push({ kind: "end", place: legs[legs.length - 1].to });
  return { number: day + 1, date: startDate === null ? null : addNights(startDate, day), events, night };
}
