import { recognizedCountry } from "./destination-label.ts";
import { stayNights } from "./destination-duration.ts";
import type { Budget, Destination, Trip, TripStop } from "./types";

/**
 * How All trips orders the trips it shows (TRA-177): Custom order, the account's own order, which only dragging changes
 * (TRA-16), or by one of the trips' saved details, for as long as the page is open.
 */
export type TripSort = "custom" | "mostDestinations" | "fewestDestinations" | "mostCountries" | "fewestCountries" | "highestCost" | "lowestCost" | "completeness" | "longest" | "shortest";

/** Each sort's name, in the order Sort by lists them. */
export const TRIP_SORTS: Record<TripSort, string> = {
  custom: "Custom order",
  mostDestinations: "Most destinations",
  fewestDestinations: "Fewest destinations",
  mostCountries: "Most countries",
  fewestCountries: "Fewest countries",
  highestCost: "Highest estimated cost",
  lowestCost: "Lowest estimated cost",
  completeness: "Budget completeness",
  longest: "Longest trip",
  shortest: "Shortest trip",
};

/** What All trips has to sort its trips by beyond the trips themselves: their stops, the destinations those visit, and each trip's estimate. */
export interface TripDetails {
  stops: readonly Pick<TripStop, "tripId" | "destinationId">[];
  destinations: readonly Pick<Destination, "id" | "city" | "cityFromSuggestion">[];
  budgets: Readonly<Record<string, Budget>>;
}

/** A trip's value for a sort, or null when Travel doesn't know it. */
type Measure = (trip: Trip, details: TripDetails) => number | null;

/**
 * The ISO code of the country a destination is in, or undefined when its saved city doesn't say. Only the label of a
 * city suggestion chosen for it does (TRA-76), which ends with the suggestion's country; it counts only when
 * `recognizedCountry` recognizes it. A city typed any other way is never read for a country.
 */
export function destinationCountry(destination: Pick<Destination, "city" | "cityFromSuggestion">): string | undefined {
  return destination.cityFromSuggestion ? recognizedCountry(destination.city.slice(destination.city.lastIndexOf(",") + 1)) : undefined;
}

/** How many destinations a trip's route has: one for each of its stops, as its page numbers them. */
function destinationCount(trip: Trip, details: TripDetails): number {
  return details.stops.filter((stop) => stop.tripId === trip.id).length;
}

/**
 * How many different countries a trip's destinations are in, counting only those whose countries are known. A trip
 * with destinations but no known country has an unknown count, never none; a trip without destinations has none.
 */
function countryCount(trip: Trip, details: TripDetails): number | null {
  const countries = new Set<string>();
  let unknown = false;
  for (const stop of details.stops.filter((item) => item.tripId === trip.id)) {
    const destination = details.destinations.find((item) => item.id === stop.destinationId);
    if (!destination) throw new Error("A trip's stop must come with the destination it visits.");
    const country = destinationCountry(destination);
    if (country === undefined) unknown = true;
    else countries.add(country);
  }
  return countries.size === 0 && unknown ? null : countries.size;
}

/** A trip's estimate, as its card on All trips shows it. */
function estimateOf(trip: Trip, details: TripDetails): Budget {
  const budget = details.budgets[trip.id];
  if (!budget) throw new Error("A trip on All trips must come with its estimate.");
  return budget;
}

/**
 * A trip's estimated total in USD cents, as its card shows it, a partial estimate's included, or null without one to
 * compare: no amount estimated yet, or any amount in another currency, which Travel never converts.
 */
function estimatedCost(trip: Trip, details: TripDetails): number | null {
  const totals = estimateOf(trip, details).totalsByCurrency;
  const currencies = Object.keys(totals);
  return currencies.length === 1 && currencies[0] === "USD" ? totals.USD : null;
}

/** 0 for a fully estimated trip, 1 for a partially estimated one and 2 for one not estimated, as its card says. */
function estimateStage(trip: Trip, details: TripDetails): number {
  const budget = estimateOf(trip, details);
  return budget.complete ? 0 : budget.knownCount ? 1 : 2;
}

/** A trip's length in calendar days, its first and last included, or null without both its start and end dates. */
function tripDays(trip: Trip): number | null {
  const nights = stayNights(trip.startDate, trip.endDate);
  return nights === null ? null : nights + 1;
}

/** What each sort but Custom order sorts trips by, and which way. */
const MEASURES: Record<Exclude<TripSort, "custom">, [Measure, "ascending" | "descending"]> = {
  mostDestinations: [destinationCount, "descending"],
  fewestDestinations: [destinationCount, "ascending"],
  mostCountries: [countryCount, "descending"],
  fewestCountries: [countryCount, "ascending"],
  highestCost: [estimatedCost, "descending"],
  lowestCost: [estimatedCost, "ascending"],
  completeness: [estimateStage, "ascending"],
  longest: [tripDays, "descending"],
  shortest: [tripDays, "ascending"],
};

/**
 * `trips`, in the account's own order, in the order `sort` shows them (TRA-177). Custom order keeps them as they are.
 * Every other sort orders them by its value, trips whose value is unknown last either way, and trips with the same
 * value, or none, in the account's own order. Sorting saves nothing, so the account's own order stays as it is.
 */
export function sortTrips(trips: readonly Trip[], sort: TripSort, details: TripDetails): readonly Trip[] {
  if (sort === "custom") return trips;
  const [measure, order] = MEASURES[sort];
  const direction = order === "descending" ? -1 : 1;
  // Array sorting is stable, so trips the comparison can't tell apart keep the order they came in.
  return trips.map((trip) => ({ trip, value: measure(trip, details) }))
    .sort((a, b) => a.value === null || b.value === null ? Number(a.value === null) - Number(b.value === null) : direction * (a.value - b.value))
    .map(({ trip }) => trip);
}
