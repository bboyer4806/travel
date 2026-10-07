import type { Budget, Snapshot } from "./types";

/** Prices are totals for the whole party, stored as integer USD cents. */
export function calculateBudget(snapshot: Snapshot, tripId: string): Budget {
  const budget: Budget = {
    totalCents: 0,
    travelCents: 0,
    hotelsCents: 0,
    activitiesCents: 0,
    restaurantsCents: 0,
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

  function add(price: number | null, category: "travelCents" | "hotelsCents" | "activitiesCents" | "restaurantsCents") {
    if (price === null) {
      budget.missingCount += 1;
    } else {
      budget[category] += price;
      budget.knownCount += 1;
    }
  }

  if (destinations.length) {
    const route: (string | null)[] = [null, ...destinations.map((item) => item.id), null];
    for (let index = 1; index < route.length; index += 1) {
      const leg = snapshot.legs.find((item) => item.tripId === tripId && item.fromId === route[index - 1] && item.toId === route[index]);
      add(leg?.priceCents ?? null, "travelCents");
    }
  }
  for (const destination of destinations) {
    const included = snapshot.candidates.filter((item) => item.destinationId === destination.id && item.included);
    if (!included.some((item) => item.category === "hotels")) budget.missingCount += 1;
    for (const candidate of included) {
      add(candidate.priceCents, `${candidate.category}Cents`);
    }
  }
  budget.totalCents = budget.travelCents + budget.hotelsCents + budget.activitiesCents + budget.restaurantsCents;
  budget.complete = budget.missingCount === 0;
  return budget;
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export function formatMoney(cents: number): string {
  return (cents % 100 === 0 ? wholeMoney : money).format(cents / 100);
}
