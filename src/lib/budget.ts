import type { FoodBudgetMode, ActivitiesBudgetMode, Budget, Candidate, Category, Destination, DestinationVisit, Snapshot, TravelLeg, Trip, TripStop } from "./types";
import { nightsToBudgetDays } from "./destination-duration.ts";

type MiscellaneousInput = Pick<DestinationVisit, "nights" | "miscDailyMinor" | "miscCurrency">;
type FoodEstimateInput = Pick<DestinationVisit, "nights" | "foodDailyMinor" | "foodCurrency">;
export interface DailyAllowance {
  days: number | null;
  dailyMinor: number | null;
  currency: string | null;
  subtotalMinor: number | null;
}
type HotelEstimateInput = Pick<DestinationVisit, "nights" | "hotelNightlyMinor" | "hotelCurrency">;
export interface HotelEstimate {
  nights: number | null;
  nightlyMinor: number | null;
  currency: string | null;
  subtotalMinor: number | null;
}
export interface AccommodationBudget {
  estimate: HotelEstimate;
  source: "estimate" | "selectedHotel";
  hotel: Candidate | null;
  totalMinor: number | null;
  currency: string | null;
}
export interface DestinationBudget {
  totalsByCurrency: Record<string, number>;
  knownCount: number;
  missingCount: number;
  complete: boolean;
}

type CostCategory = "travel" | "transitMiscellaneous" | "entryVisaFees" | "hotels" | "activities" | "food" | "home" | "miscellaneous" | "shopping";
interface Cost { amount: number | null; currency: string | null; category: CostCategory; }

/**
 * A daily amount for the whole party, never multiplied per traveler: one budget day per night, and one
 * full day for a zero-night visit. A subtotal too large to stay exact is unknown, never shown inexact.
 */
function dailyAllowance(nights: number | null, dailyMinor: number | null, currency: string | null): DailyAllowance {
  const days = nightsToBudgetDays(nights);
  const subtotal = days === null || dailyMinor === null || currency === null ? null : Math.round(dailyMinor * days);
  const subtotalMinor = subtotal !== null && Number.isSafeInteger(subtotal) ? subtotal : null;
  return { days, dailyMinor, currency, subtotalMinor };
}

export function calculateMiscellaneous(destination: MiscellaneousInput): DailyAllowance {
  return dailyAllowance(destination.nights, destination.miscDailyMinor ?? null, destination.miscCurrency || null);
}

export function calculateFoodEstimate(destination: FoodEstimateInput): DailyAllowance {
  return dailyAllowance(destination.nights, destination.foodDailyMinor ?? null, destination.foodCurrency || null);
}

/** One nightly amount covers all rooms and travelers; the entered stay length determines nights. */
export function calculateHotelEstimate(destination: HotelEstimateInput): HotelEstimate {
  const nights = destination.nights ?? null;
  const nightlyMinor = destination.hotelNightlyMinor ?? null;
  const currency = destination.hotelCurrency || null;
  const subtotal = nights === null || nightlyMinor === null || currency === null ? null : nightlyMinor * nights;
  const subtotalMinor = subtotal !== null && Number.isSafeInteger(subtotal) ? subtotal : null;
  return { nights, nightlyMinor, currency, subtotalMinor };
}

/** A chosen hotel always replaces the estimate, including when its price is unknown. */
export function calculateAccommodation(snapshot: Snapshot, destination: DestinationVisit): AccommodationBudget {
  const estimate = calculateHotelEstimate(destination);
  const hotel = snapshot.candidates.find((item) => item.destinationId === destination.id && item.category === "hotels" && item.included) ?? null;
  return hotel
    ? { estimate, source: "selectedHotel", hotel, totalMinor: hotel.priceCents, currency: "USD" }
    : { estimate, source: "estimate", hotel: null, totalMinor: estimate.subtotalMinor, currency: estimate.currency };
}

function activityCosts(snapshot: Snapshot, destination: Destination): Cost[] {
  // Only an explicit destination edit switches sources. Dates and party size are irrelevant.
  if (destination.activitiesBudgetMode === "general") {
    return [{ amount: destination.activitiesGeneralMinor ?? null, currency: destination.activitiesCurrency || null, category: "activities" }];
  }
  return snapshot.candidates
    .filter((item) => item.destinationId === destination.id && item.category === "activities" && item.included)
    .map((item) => ({ amount: item.priceCents, currency: "USD", category: "activities" }));
}

export function calculateActivitiesBudget(snapshot: Snapshot, destination: Destination): DestinationBudget & { mode: ActivitiesBudgetMode } {
  const budget = { mode: destination.activitiesBudgetMode ?? "itemized", totalsByCurrency: {}, knownCount: 0, missingCount: 0, complete: false };
  for (const cost of activityCosts(snapshot, destination)) addCost(budget, cost);
  budget.complete = budget.missingCount === 0;
  return budget;
}

function foodCosts(snapshot: Snapshot, destination: DestinationVisit): Cost[] {
  if (destination.foodBudgetMode === "daily") {
    const estimate = calculateFoodEstimate(destination);
    return [{ amount: estimate.subtotalMinor, currency: estimate.currency, category: "food" }];
  }
  return snapshot.candidates
    .filter((item) => item.destinationId === destination.id && item.category === "restaurants" && item.included)
    .map((item) => ({ amount: item.priceCents, currency: "USD", category: "food" }));
}

export function calculateFoodBudget(snapshot: Snapshot, destination: DestinationVisit): DestinationBudget & { mode: FoodBudgetMode } {
  const budget = { mode: destination.foodBudgetMode ?? "itemized", totalsByCurrency: {}, knownCount: 0, missingCount: 0, complete: false };
  for (const cost of foodCosts(snapshot, destination)) addCost(budget, cost);
  budget.complete = budget.missingCount === 0;
  return budget;
}

function destinationCosts(snapshot: Snapshot, destination: DestinationVisit): Cost[] {
  const accommodation = calculateAccommodation(snapshot, destination);
  const costs: Cost[] = [{ amount: accommodation.totalMinor, currency: accommodation.currency, category: "hotels" }];
  costs.push(...foodCosts(snapshot, destination));
  costs.push(...activityCosts(snapshot, destination));
  // Shopping is optional and already covers the whole party's entire stay.
  if (destination.shoppingMinor != null) {
    costs.push({ amount: destination.shoppingMinor, currency: destination.shoppingCurrency, category: "shopping" });
  }
  const miscellaneous = calculateMiscellaneous(destination);
  costs.push({ amount: miscellaneous.subtotalMinor, currency: miscellaneous.currency, category: "miscellaneous" });
  return costs;
}

function addCost(budget: DestinationBudget, cost: Cost) {
  if (cost.amount === null || cost.currency === null) {
    budget.missingCount += 1;
  } else {
    budget.totalsByCurrency[cost.currency] = (budget.totalsByCurrency[cost.currency] ?? 0) + cost.amount;
    budget.knownCount += 1;
  }
}

/** One stay's destination costs, with that stay's nights. They exclude transportation and at-home arrangements. */
export function calculateDestinationBudget(snapshot: Snapshot, visit: DestinationVisit): DestinationBudget {
  const budget: DestinationBudget = { totalsByCurrency: {}, knownCount: 0, missingCount: 0, complete: false };
  for (const cost of destinationCosts(snapshot, visit)) addCost(budget, cost);
  budget.complete = budget.missingCount === 0;
  return budget;
}

/** A trip's stops in route order, each with the destination it visits and that stay's nights. */
export function tripVisits(snapshot: Snapshot, tripId: string): { stop: TripStop; visit: DestinationVisit }[] {
  return snapshot.stops.filter((stop) => stop.tripId === tripId).sort((a, b) => a.position - b.position).map((stop) => {
    const destination = snapshot.destinations.find((item) => item.id === stop.destinationId);
    if (!destination) throw new Error("A trip's stop must come with the destination it visits.");
    return { stop, visit: { ...destination, nights: stop.nights } };
  });
}

/**
 * A trip's connections in route order, from the departing city through each of its `visits` to the return city: none
 * without a stop. A connection the snapshot has no row for is undefined.
 */
function routeLegs(snapshot: Snapshot, tripId: string, visits: { stop: TripStop }[]): (TravelLeg | undefined)[] {
  const route: (string | null)[] = visits.length ? [null, ...visits.map(({ stop }) => stop.id), null] : [];
  return route.slice(1).map((toId, index) => snapshot.legs.find((item) => item.tripId === tripId && item.fromId === route[index] && item.toId === toId));
}

/**
 * Currencies stay separate. Travel, miscellaneous spending in transit, entry and visa fees and at-home costs are always
 * USD, so they are totaled in cents.
 */
export function calculateBudget(snapshot: Snapshot, tripId: string): Budget {
  const budget: Budget = {
    homeCents: 0,
    travelCents: 0,
    transitMiscCents: null,
    entryVisaFeesCents: null,
    totalsByCurrency: {},
    miscellaneousByCurrency: {},
    shoppingByCurrency: {},
    hotelsByCurrency: {},
    activitiesByCurrency: {},
    foodByCurrency: {},
    travelMissingCount: 0,
    foodMissingCount: 0,
    activitiesMissingCount: 0,
    hotelMissingCount: 0,
    miscMissingCount: 0,
    knownCount: 0,
    missingCount: 0,
    complete: false,
  };
  const trip = snapshot.trips.find((item) => item.id === tripId);
  if (!trip) return { ...budget, missingCount: 1 };
  const visits = tripVisits(snapshot, tripId);
  // A trip still needs a destination. The departing city is not an amount: the travel from and to it is counted with
  // every other connection, so a blank one never makes an estimate partial (TRA-85).
  if (!visits.length) budget.missingCount += 1;

  function add(cost: Cost) {
    addCost(budget, cost);
    if (cost.category === "miscellaneous") {
      if (cost.amount === null || cost.currency === null) budget.miscMissingCount += 1;
      else budget.miscellaneousByCurrency[cost.currency] = (budget.miscellaneousByCurrency[cost.currency] ?? 0) + cost.amount;
    } else if (cost.category === "shopping") {
      if (cost.amount !== null && cost.currency !== null) budget.shoppingByCurrency[cost.currency] = (budget.shoppingByCurrency[cost.currency] ?? 0) + cost.amount;
    } else if (cost.category === "home") {
      if (cost.amount !== null) budget.homeCents += cost.amount;
    } else if (cost.category === "travel") {
      if (cost.amount === null || cost.currency === null) budget.travelMissingCount += 1;
      else budget.travelCents += cost.amount;
    } else if (cost.category === "transitMiscellaneous") {
      if (cost.amount !== null) budget.transitMiscCents = (budget.transitMiscCents ?? 0) + cost.amount;
    } else if (cost.category === "entryVisaFees") {
      budget.entryVisaFeesCents = cost.amount;
    } else if (cost.category === "food") {
      if (cost.amount === null || cost.currency === null) budget.foodMissingCount += 1;
      else budget.foodByCurrency[cost.currency] = (budget.foodByCurrency[cost.currency] ?? 0) + cost.amount;
    } else if (cost.category === "activities") {
      if (cost.amount === null || cost.currency === null) budget.activitiesMissingCount += 1;
      else budget.activitiesByCurrency[cost.currency] = (budget.activitiesByCurrency[cost.currency] ?? 0) + cost.amount;
    } else if (cost.category === "hotels") {
      if (cost.amount === null || cost.currency === null) budget.hotelMissingCount += 1;
      else budget.hotelsByCurrency[cost.currency] = (budget.hotelsByCurrency[cost.currency] ?? 0) + cost.amount;
    }
  }

  for (const leg of routeLegs(snapshot, tripId, visits)) {
    add({ amount: leg?.priceCents ?? null, currency: "USD", category: "travel" });
    // Miscellaneous spending on the way is optional: blank adds no cost and is not a missing estimate (TRA-26).
    if (leg?.miscCents != null) add({ amount: leg.miscCents, currency: "USD", category: "transitMiscellaneous" });
  }
  for (const { visit } of visits) {
    for (const cost of destinationCosts(snapshot, visit)) add(cost);
  }
  // A blank home-item price is an optional task without a cost, not a missing estimate.
  for (const item of snapshot.homeItems) {
    if (item.tripId === tripId && item.priceCents !== null) add({ amount: item.priceCents, currency: "USD", category: "home" });
  }
  // Entry and visa fees are one optional amount for the whole trip, counted once: blank adds no cost and is not a missing
  // estimate, so a trip without them keeps its total and completeness (TRA-159).
  if (trip.entryVisaFeesCents !== null) add({ amount: trip.entryVisaFeesCents, currency: "USD", category: "entryVisaFees" });
  budget.complete = budget.missingCount === 0;
  return budget;
}

/**
 * The trip estimate's categories with amounts to enter in an editor (TRA-165). At home has none: a blank price there is a
 * task without a cost, not an amount the estimate lacks.
 */
export type EstimateCategory = "travel" | "transitMiscellaneous" | "entryVisaFees" | "hotels" | "activities" | "food" | "shopping" | "miscellaneous";
/** The categories of one stay's destination budget. */
export type StayCategory = Exclude<EstimateCategory, "travel" | "transitMiscellaneous" | "entryVisaFees">;
/**
 * An amount an estimate shows as Not set or Not estimated, by what it belongs to and the field that enters it (TRA-165): a
 * connection's price or miscellaneous spending, the trip's entry and visa fees (TRA-159), the price of a hotel, activity
 * or restaurant chosen for the budget, or a stay's nights or one of its destination's amounts, for one of the stay's
 * categories.
 */
export type UnsetAmount =
  | { kind: "leg"; leg: TravelLeg; field: "price" | "miscAmount" }
  | { kind: "trip"; trip: Trip; field: "entryVisaFeesAmount" }
  | { kind: "idea"; idea: Candidate }
  | { kind: "stay"; category: StayCategory; stop: TripStop; visit: DestinationVisit; field: "nights" | "hotelNightlyAmount" | "activitiesGeneralAmount" | "foodDailyAmount" | "shoppingAmount" | "miscDailyAmount" };

/**
 * What a stay's category lacks before the estimate has it, or null once it has it (TRA-165): the chosen hotel's price,
 * which replaces the nightly estimate; in itemized mode, the first included idea without a price, in saved order; or else
 * the category's amount, and once that is known, the stay's nights that multiply it. Shopping is optional, so it is unset
 * rather than missing.
 */
export function unsetStayAmount(snapshot: Snapshot, stop: TripStop, visit: DestinationVisit, category: StayCategory): UnsetAmount | null {
  const amount = (field: Extract<UnsetAmount, { kind: "stay" }>["field"]): UnsetAmount => ({ kind: "stay", category, stop, visit, field });
  // A nightly or daily amount's subtotal is unknown until both the amount and the nights are.
  const multiplied = (subtotal: number | null, rate: number | null, field: "hotelNightlyAmount" | "foodDailyAmount" | "miscDailyAmount") =>
    subtotal !== null ? null : amount(rate !== null && visit.nights === null ? "nights" : field);
  const unpriced = (ideas: Category): UnsetAmount | null => {
    const idea = snapshot.candidates.find((item) => item.destinationId === visit.id && item.category === ideas && item.included && item.priceCents === null);
    return idea ? { kind: "idea", idea } : null;
  };
  switch (category) {
    case "hotels": {
      const accommodation = calculateAccommodation(snapshot, visit);
      if (accommodation.hotel) return accommodation.hotel.priceCents === null ? { kind: "idea", idea: accommodation.hotel } : null;
      return multiplied(accommodation.totalMinor, visit.hotelNightlyMinor, "hotelNightlyAmount");
    }
    case "activities":
      if (visit.activitiesBudgetMode !== "general") return unpriced("activities");
      return visit.activitiesGeneralMinor === null ? amount("activitiesGeneralAmount") : null;
    case "food":
      if (visit.foodBudgetMode !== "daily") return unpriced("restaurants");
      return multiplied(calculateFoodEstimate(visit).subtotalMinor, visit.foodDailyMinor, "foodDailyAmount");
    case "shopping": return visit.shoppingMinor === null ? amount("shoppingAmount") : null;
    case "miscellaneous": return multiplied(calculateMiscellaneous(visit).subtotalMinor, visit.miscDailyMinor, "miscDailyAmount");
  }
}

/**
 * The first amount a category of a trip's estimate lacks, in route order, or null when it has every one (TRA-165): the
 * connections from the departing city to the return city, then each stay's as above. Shopping and miscellaneous spending
 * in transit are optional, so theirs is the first stay or connection without one. Entry and visa fees are the trip's own
 * optional amount, entered in its editor (TRA-159).
 */
export function unsetTripAmount(snapshot: Snapshot, tripId: string, category: EstimateCategory): UnsetAmount | null {
  if (category === "entryVisaFees") {
    const trip = snapshot.trips.find((item) => item.id === tripId);
    return trip && trip.entryVisaFeesCents === null ? { kind: "trip", trip, field: "entryVisaFeesAmount" } : null;
  }
  const visits = tripVisits(snapshot, tripId);
  if (category === "travel" || category === "transitMiscellaneous") {
    const field = category === "travel" ? "price" : "miscAmount";
    const leg = routeLegs(snapshot, tripId, visits).find((item) => item && (field === "price" ? item.priceCents : item.miscCents) === null);
    return leg ? { kind: "leg", leg, field } : null;
  }
  for (const { stop, visit } of visits) {
    const unset = unsetStayAmount(snapshot, stop, visit, category);
    if (unset) return unset;
  }
  return null;
}
