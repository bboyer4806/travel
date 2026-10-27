import type { FoodBudgetMode, ActivitiesBudgetMode, Budget, Candidate, Destination, Snapshot } from "./types";
import { budgetDays, stayNights } from "./destination-duration.ts";

type MiscellaneousInput = Pick<Destination, "arrivalDate" | "departureDate" | "miscDailyMinor" | "miscCurrency">;
export interface MiscellaneousBudget {
  days: number | null;
  dailyMinor: number | null;
  currency: string | null;
  subtotalMinor: number | null;
}
type FoodEstimateInput = Pick<Destination, "arrivalDate" | "departureDate" | "foodDailyMinor" | "foodCurrency">;
export interface FoodEstimate {
  days: number | null;
  dailyMinor: number | null;
  currency: string | null;
  subtotalMinor: number | null;
}
type HotelEstimateInput = Pick<Destination, "arrivalDate" | "departureDate" | "hotelNightlyMinor" | "hotelCurrency">;
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

type CostCategory = "travelCents" | "hotelsCents" | "activitiesCents" | "restaurantsCents" | "homeCents" | "miscellaneous" | "shopping";
interface Cost { amount: number | null; currency: string | null; category: CostCategory; }

/** Daily spending covers the whole party. Round each destination's half minor unit up. */
export function calculateMiscellaneous(destination: MiscellaneousInput): MiscellaneousBudget {
  const days = budgetDays(destination.arrivalDate, destination.departureDate);
  const dailyMinor = destination.miscDailyMinor ?? null;
  const currency = destination.miscCurrency || null;
  const subtotalMinor = days === null || dailyMinor === null || currency === null ? null : Math.round(dailyMinor * days);
  return { days, dailyMinor, currency, subtotalMinor };
}

/** Same half-day allowance as miscellaneous; round once per destination, never per traveler. */
export function calculateFoodEstimate(destination: FoodEstimateInput): FoodEstimate {
  const days = budgetDays(destination.arrivalDate, destination.departureDate);
  const dailyMinor = destination.foodDailyMinor ?? null;
  const currency = destination.foodCurrency || null;
  const subtotal = days === null || dailyMinor === null || currency === null ? null : Math.round(dailyMinor * days);
  const subtotalMinor = subtotal !== null && Number.isSafeInteger(subtotal) ? subtotal : null;
  return { days, dailyMinor, currency, subtotalMinor };
}

/** One nightly amount covers all rooms and travelers; dates determine calendar nights. */
export function calculateHotelEstimate(destination: HotelEstimateInput): HotelEstimate {
  const nights = stayNights(destination.arrivalDate, destination.departureDate);
  const nightlyMinor = destination.hotelNightlyMinor ?? null;
  const currency = destination.hotelCurrency || null;
  const subtotal = nights === null || nightlyMinor === null || currency === null ? null : nightlyMinor * nights;
  const subtotalMinor = subtotal !== null && Number.isSafeInteger(subtotal) ? subtotal : null;
  return { nights, nightlyMinor, currency, subtotalMinor };
}

/** A chosen hotel always replaces the estimate, including when its price is unknown. */
export function calculateAccommodation(snapshot: Snapshot, destination: Destination): AccommodationBudget {
  const estimate = calculateHotelEstimate(destination);
  const hotel = snapshot.candidates.find((item) => item.destinationId === destination.id && item.category === "hotels" && item.included) ?? null;
  return hotel
    ? { estimate, source: "selectedHotel", hotel, totalMinor: hotel.priceCents, currency: "USD" }
    : { estimate, source: "estimate", hotel: null, totalMinor: estimate.subtotalMinor, currency: estimate.currency };
}

function activityCosts(snapshot: Snapshot, destination: Destination): Cost[] {
  // Only an explicit destination edit switches sources. Dates and party size are irrelevant.
  if (destination.activitiesBudgetMode === "general") {
    return [{ amount: destination.activitiesGeneralMinor ?? null, currency: destination.activitiesCurrency || null, category: "activitiesCents" }];
  }
  return snapshot.candidates
    .filter((item) => item.destinationId === destination.id && item.category === "activities" && item.included)
    .map((item) => ({ amount: item.priceCents, currency: "USD", category: "activitiesCents" }));
}

export function calculateActivitiesBudget(snapshot: Snapshot, destination: Destination): DestinationBudget & { mode: ActivitiesBudgetMode } {
  const budget = { mode: destination.activitiesBudgetMode ?? "itemized", totalsByCurrency: {}, knownCount: 0, missingCount: 0, complete: false };
  for (const cost of activityCosts(snapshot, destination)) addCost(budget, cost);
  budget.complete = budget.missingCount === 0;
  return budget;
}

function foodCosts(snapshot: Snapshot, destination: Destination): Cost[] {
  if (destination.foodBudgetMode === "daily") {
    const estimate = calculateFoodEstimate(destination);
    return [{ amount: estimate.subtotalMinor, currency: estimate.currency, category: "restaurantsCents" }];
  }
  return snapshot.candidates
    .filter((item) => item.destinationId === destination.id && item.category === "restaurants" && item.included)
    .map((item) => ({ amount: item.priceCents, currency: "USD", category: "restaurantsCents" }));
}

export function calculateFoodBudget(snapshot: Snapshot, destination: Destination): DestinationBudget & { mode: FoodBudgetMode } {
  const budget = { mode: destination.foodBudgetMode ?? "itemized", totalsByCurrency: {}, knownCount: 0, missingCount: 0, complete: false };
  for (const cost of foodCosts(snapshot, destination)) addCost(budget, cost);
  budget.complete = budget.missingCount === 0;
  return budget;
}

function destinationCosts(snapshot: Snapshot, destination: Destination): Cost[] {
  const accommodation = calculateAccommodation(snapshot, destination);
  const costs: Cost[] = [{ amount: accommodation.totalMinor, currency: accommodation.currency, category: "hotelsCents" }];
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

/** Destination costs exclude transportation and at-home arrangements. */
export function calculateDestinationBudget(snapshot: Snapshot, destinationId: string): DestinationBudget {
  const budget: DestinationBudget = { totalsByCurrency: {}, knownCount: 0, missingCount: 0, complete: false };
  const destination = snapshot.destinations.find((item) => item.id === destinationId);
  if (!destination) return { ...budget, missingCount: 1 };
  for (const cost of destinationCosts(snapshot, destination)) addCost(budget, cost);
  budget.complete = budget.missingCount === 0;
  return budget;
}

/** Currencies stay separate; legacy *Cents fields contain only the USD portions. */
export function calculateBudget(snapshot: Snapshot, tripId: string): Budget {
  const budget: Budget = {
    totalCents: 0,
    homeCents: 0,
    travelCents: 0,
    hotelsCents: 0,
    activitiesCents: 0,
    restaurantsCents: 0,
    totalsByCurrency: {},
    miscellaneousByCurrency: {},
    shoppingByCurrency: {},
    hotelsByCurrency: {},
    activitiesByCurrency: {},
    foodByCurrency: {},
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
  const destinations = snapshot.destinations
    .filter((item) => item.tripId === tripId)
    .sort((a, b) => a.position - b.position);
  if (!trip.homeCity.trim()) budget.missingCount += 1;
  if (!destinations.length) budget.missingCount += 1;

  function add(cost: Cost) {
    addCost(budget, cost);
    if (cost.category === "miscellaneous") {
      if (cost.amount === null || cost.currency === null) budget.miscMissingCount += 1;
      else budget.miscellaneousByCurrency[cost.currency] = (budget.miscellaneousByCurrency[cost.currency] ?? 0) + cost.amount;
    } else if (cost.category === "shopping") {
      if (cost.amount !== null && cost.currency !== null) budget.shoppingByCurrency[cost.currency] = (budget.shoppingByCurrency[cost.currency] ?? 0) + cost.amount;
    } else if (cost.amount !== null && cost.currency === "USD") {
      budget[cost.category] += cost.amount;
    }
    if (cost.category === "restaurantsCents") {
      if (cost.amount === null || cost.currency === null) budget.foodMissingCount += 1;
      else budget.foodByCurrency[cost.currency] = (budget.foodByCurrency[cost.currency] ?? 0) + cost.amount;
    }
    if (cost.category === "activitiesCents") {
      if (cost.amount === null || cost.currency === null) budget.activitiesMissingCount += 1;
      else budget.activitiesByCurrency[cost.currency] = (budget.activitiesByCurrency[cost.currency] ?? 0) + cost.amount;
    }
    if (cost.category === "hotelsCents") {
      if (cost.amount === null || cost.currency === null) budget.hotelMissingCount += 1;
      else budget.hotelsByCurrency[cost.currency] = (budget.hotelsByCurrency[cost.currency] ?? 0) + cost.amount;
    }
  }

  if (destinations.length) {
    const route: (string | null)[] = [null, ...destinations.map((item) => item.id), null];
    for (let index = 1; index < route.length; index += 1) {
      const leg = snapshot.legs.find((item) => item.tripId === tripId && item.fromId === route[index - 1] && item.toId === route[index]);
      add({ amount: leg?.priceCents ?? null, currency: "USD", category: "travelCents" });
    }
  }
  for (const destination of destinations) {
    for (const cost of destinationCosts(snapshot, destination)) add(cost);
  }
  // A blank home-item price is an optional task without a cost, not a missing estimate.
  for (const item of snapshot.homeItems) {
    if (item.tripId === tripId && item.priceCents !== null) add({ amount: item.priceCents, currency: "USD", category: "homeCents" });
  }
  budget.totalCents = budget.totalsByCurrency.USD ?? 0;
  budget.complete = budget.missingCount === 0;
  return budget;
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export function formatMoney(cents: number): string {
  return (cents % 100 === 0 ? wholeMoney : money).format(cents / 100);
}
