import { containsSunday, isValidDate, stayNights } from "./destination-duration.ts";

export const MAX_NIGHTS = 3652058; // Entire supported calendar, years 0001–9999.

export function addNights(date: string, nights: number): string {
  if (!isValidDate(date) || !Number.isInteger(nights) || nights < 0 || nights > MAX_NIGHTS) {
    throw new Error("Enter a valid start date and a nonnegative whole number of nights.");
  }
  const result = new Date(Date.parse(date + "T00:00:00.000Z") + nights * 86400000).toISOString().slice(0, 10);
  if (!isValidDate(result)) throw new Error("This stay extends beyond December 31, 9999. Reduce the nights or change the trip start date.");
  return result;
}

export function sequenceDates(startDate: string | null, stops: readonly { id: string; nights: number | null }[]) {
  let next = startDate;
  const destinations = stops.map((stop) => {
    // An incomplete stay has no calculated range; all later dates also remain unknown.
    if (!next || stop.nights === null) {
      next = null;
      return { id: stop.id, arrivalDate: null, departureDate: null };
    }
    const arrivalDate = next;
    const departureDate = addNights(arrivalDate, stop.nights);
    next = departureDate;
    return { id: stop.id, arrivalDate, departureDate };
  });
  return { destinations, endDate: stops.length ? next : null };
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

export function formatCalendarDate(date: string | null | undefined): string {
  return date ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T00:00:00.000Z")) : "Not yet calculable";
}

export function churchDateEligible(destination: { arrivalDate: string | null; departureDate: string | null }): boolean {
  return !destination.arrivalDate || !destination.departureDate || containsSunday(destination.arrivalDate, destination.departureDate);
}
