import type { Budget, Destination, Snapshot } from "./types";
import { budgetDays } from "./destination-duration.ts";

type MiscellaneousInput = Pick<Destination, "arrivalDate" | "departureDate" | "miscDailyMinor" | "miscCurrency">;
export interface MiscellaneousBudget {
  days: number | null;
  dailyMinor: number | null;
  currency: string | null;
  subtotalMinor: number | null;
}
export interface DestinationBudget {
  totalsByCurrency: Record<string, number>;
  knownCount: number;
  missingCount: number;
  complete: boolean;
}

type CostCategory = "travelCents" | "hotelsCents" | "activitiesCents" | "restaurantsCents" | "homeCents" | "miscellaneous";
interface Cost { amount: number | null; currency: string | null; category: CostCategory; }

/** Daily spending covers the whole party. Round each destination's half minor unit up. */
export function calculateMiscellaneous(destination: MiscellaneousInput): MiscellaneousBudget {
  const days = budgetDays(destination.arrivalDate, destination.departureDate);
  const dailyMinor = destination.miscDailyMinor ?? null;
  const currency = destination.miscCurrency || null;
  const subtotalMinor = days === null || dailyMinor === null || currency === null ? null : Math.round(dailyMinor * days);
  return { days, dailyMinor, currency, subtotalMinor };
}

function destinationCosts(snapshot: Snapshot, destination: Destination): Cost[] {
  const included = snapshot.candidates.filter((item) => item.destinationId === destination.id && item.included);
  const costs: Cost[] = included.map((item) => ({ amount: item.priceCents, currency: "USD", category: `${item.category}Cents` }));
  if (!included.some((item) => item.category === "hotels")) costs.push({ amount: null, currency: "USD", category: "hotelsCents" });
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
    } else if (cost.amount !== null) {
      budget[cost.category] += cost.amount;
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
