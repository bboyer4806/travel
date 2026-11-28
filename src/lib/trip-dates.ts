import { containsSunday, isValidDate, stayNights } from "./destination-duration.ts";
import type { TravelLeg } from "./types";

export const MAX_NIGHTS = 3652058; // Entire supported calendar, years 0001–9999.

export function addNights(date: string, nights: number): string {
  if (!isValidDate(date) || !Number.isInteger(nights) || nights < 0) {
    throw new Error("Enter a valid start date and a nonnegative whole number of nights.");
  }
  // More nights than the whole supported calendar reach past its end from any date (TRA-185).
  const result = nights > MAX_NIGHTS ? null : new Date(Date.parse(date + "T00:00:00.000Z") + nights * 86400000).toISOString().slice(0, 10);
  if (result === null || !isValidDate(result)) throw new Error("This stay extends beyond December 31, 9999. Reduce the nights or change the trip start date.");
  return result;
}

/** A travel connection's place in its trip's route, and its nights spent traveling, which its trip's days count (TRA-185). */
export type RouteLeg = Pick<TravelLeg, "fromId" | "toId" | "travelNights">;

/**
 * A trip's travel connections in route order (TRA-185): from the departing city to its first stay, from each stay to the
 * next, and from its last stay to the return city, or none without a stay. Every connection in the route must be given.
 */
export function routeLegs<Leg extends Pick<TravelLeg, "fromId" | "toId">>(stops: readonly { id: string }[], legs: readonly Leg[]): Leg[] {
  const route = stops.length ? [null, ...stops.map((stop) => stop.id), null] : [];
  return route.slice(1).map((toId, index) => {
    const leg = legs.find((item) => item.fromId === route[index] && item.toId === toId);
    if (!leg) throw new Error("A trip's days need every travel connection in its route.");
    return leg;
  });
}

/**
 * Where a trip's route falls among its days (TRA-185), in whole days after its first day, 0: when each connection leaves
 * and arrives, in route order, when each stay arrives and departs, and the trip's last day, when the return connection
 * arrives. A connection leaves the day the stay before it departs, or on the first day, and arrives its nights spent
 * traveling later. A stay departs its nights after it arrives, so its nights are never the connections'. After a stay
 * whose nights are unknown, nothing has a day: that stay has its arrival alone, and the trip has no last day.
 */
export function routeDays(stops: readonly { id: string; nights: number | null }[], legs: readonly RouteLeg[]) {
  const route = routeLegs(stops, legs);
  const connections: { leaves: number | null; arrives: number | null }[] = [];
  const stays: { arrives: number | null; departs: number | null }[] = [];
  // The day the next connection leaves.
  let day: number | null = 0;
  const travel = (leg: RouteLeg) => {
    const arrives = day === null ? null : day + leg.travelNights;
    connections.push({ leaves: day, arrives });
    return arrives;
  };
  stops.forEach((stop, index) => {
    const arrives = travel(route[index]);
    const departs = arrives === null || stop.nights === null ? null : arrives + stop.nights;
    stays.push({ arrives, departs });
    day = departs;
  });
  return { connections, stays, end: stops.length ? travel(route[stops.length]) : null };
}

/**
 * A trip's dates from its start date, its stays in route order with their nights, and its connections' nights spent
 * traveling (TRA-185), which move every later date without counting as a stay's nights: each stay's arrival and
 * departure, and the day the trip ends, when its return connection arrives.
 */
export function sequenceDates(startDate: string | null, stops: readonly { id: string; nights: number | null }[], legs: readonly RouteLeg[]) {
  const days = routeDays(stops, legs);
  const date = (day: number | null) => startDate === null || day === null ? null : addNights(startDate, day);
  const destinations = stops.map((stop, index) => {
    // A stay's arrival is checked even while its nights are unknown, so every day a trip's calendar lists has a date.
    const arrivalDate = date(days.stays[index].arrives);
    // An incomplete stay has no calculated range; all later dates also remain unknown.
    return days.stays[index].departs === null ? { id: stop.id, arrivalDate: null, departureDate: null } : { id: stop.id, arrivalDate, departureDate: date(days.stays[index].departs) };
  });
  return { destinations, endDate: date(days.end) };
}

/** One-time, conservative backfill. Historical dates are retained separately by the store. */
export function backfillDates(stops: readonly { id: string; arrivalDate: string | null; departureDate: string | null }[]) {
  const nights = stops.map((stop) => stayNights(stop.arrivalDate, stop.departureDate));
  const conflicting = new Set<number>();
  for (let i = 1; i < stops.length; i++) {
    const previous = stops[i - 1].departureDate;
    const arrival = stops[i].arrivalDate;
    if (previous && arrival && previous !== arrival) {
      conflicting.add(i - 1);
      conflicting.add(i);
    }
  }
  // Cross-check nonadjacent recorded dates whenever the intervening lengths are known.
  for (let i = 0; i < stops.length; i++) {
    let expected = stops[i].arrivalDate;
    if (!expected || !isValidDate(expected)) continue;
    for (let j = i; j < stops.length && expected; j++) {
      if (stops[j].arrivalDate && stops[j].arrivalDate !== expected) conflicting.add(j);
      const length = nights[j];
      if (length === null) break;
      try { expected = addNights(expected, length); }
      catch { conflicting.add(j); break; }
      if (stops[j].departureDate && stops[j].departureDate !== expected) conflicting.add(j);
    }
  }
  const complete = stops.length > 0 && nights.every((value) => value !== null) && conflicting.size === 0;
  return {
    startDate: complete ? stops[0].arrivalDate : null,
    destinations: stops.map((stop, index) => ({ id: stop.id, nights: conflicting.has(index) ? null : nights[index] })),
  };
}

const calendarDateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export function formatCalendarDate(date: string | null | undefined): string {
  return date ? calendarDateFormatter.format(new Date(date + "T00:00:00.000Z")) : "Not yet calculable";
}

export function churchDateEligible(destination: { arrivalDate: string | null; departureDate: string | null }): boolean {
  return !destination.arrivalDate || !destination.departureDate || containsSunday(destination.arrivalDate, destination.departureDate);
}

/** All Sundays in the inclusive stay, or null when its date range is unknown. */
export function churchSundayDates(destination: { arrivalDate: string | null; departureDate: string | null }): string[] | null {
  const nights = stayNights(destination.arrivalDate, destination.departureDate);
  if (nights === null || !destination.arrivalDate) return null;
  const arrivalDay = new Date(destination.arrivalDate + "T00:00:00.000Z").getUTCDay();
  const sundays: string[] = [];
  for (let offset = (7 - arrivalDay) % 7; offset <= nights; offset += 7) {
    sundays.push(addNights(destination.arrivalDate, offset));
  }
  return sundays;
}
