import { formatSavedDestinationLabel } from "./destination-label.ts";
import { isFlight, transportationIcons, words } from "./transportation-methods.ts";
import { churchDateEligible } from "./trip-dates.ts";
import type { Destination, Snapshot, TripStop } from "./types";

/**
 * A trip's packing list (TRA-18): one list for everyone who can open the trip, each item in a category with how many to
 * pack for the whole party and whether it is packed. On request, Travel recommends items from what the trip already
 * holds: its stays' nights and dates, each destination's monthly averages or typical weather and entry requirements, the
 * activities, restaurants and churches saved for its destinations, and its travel. People review the recommendations
 * before any is added, and adding them never changes what is already on the list. Travel looks nothing up: a
 * recommendation follows only from these rules and the trip's saved details, and says what it assumed where they leave
 * something out. Nothing here reads or writes the database.
 */

/** The categories a packing item can be in, in the order the list shows them. */
export const PACKING_CATEGORIES = ["clothing", "toiletries", "electronics", "documents", "health-safety", "activity-gear", "other"] as const;
export type PackingCategory = typeof PACKING_CATEGORIES[number];
export const PACKING_CATEGORY_LABELS: Record<PackingCategory, string> = {
  clothing: "Clothing", toiletries: "Toiletries", electronics: "Electronics", documents: "Documents",
  "health-safety": "Health and safety", "activity-gear": "Activity-specific gear", other: "Other",
};
/** The most items one add from a review takes (`packingList.add`): more than Travel ever recommends at once. */
export const MAX_PACKING_ADD = 100;

/** A recommended item, how many to pack for the whole party, and why it is recommended, each reason in a few words. */
export interface PackingRecommendation { name: string; category: PackingCategory; quantity: number; reasons: string[] }
/** What Travel recommends for a trip, and what it assumed where the trip leaves something out. */
export interface PackingRecommendations { items: PackingRecommendation[]; assumptions: string[] }

/**
 * Every item Travel can recommend, by key, in the order a review lists them: by category, in the list's order of
 * categories. One for each traveler is packed per traveler; the rest, such as a first-aid kit, once for the whole party.
 */
const CATALOG = {
  underwear: { name: "Underwear", category: "clothing", perTraveler: true },
  socks: { name: "Socks", category: "clothing", perTraveler: true },
  tops: { name: "Shirts or tops", category: "clothing", perTraveler: true },
  bottoms: { name: "Pants or skirts", category: "clothing", perTraveler: true },
  shorts: { name: "Shorts", category: "clothing", perTraveler: true },
  sleepwear: { name: "Sleepwear", category: "clothing", perTraveler: true },
  walkingShoes: { name: "Comfortable walking shoes", category: "clothing", perTraveler: true },
  lightJacket: { name: "Light jacket or sweater", category: "clothing", perTraveler: true },
  warmCoat: { name: "Warm coat", category: "clothing", perTraveler: true },
  thermalLayers: { name: "Thermal base layers", category: "clothing", perTraveler: true },
  warmHat: { name: "Warm hat", category: "clothing", perTraveler: true },
  warmGloves: { name: "Warm gloves", category: "clothing", perTraveler: true },
  scarf: { name: "Scarf", category: "clothing", perTraveler: true },
  rainGear: { name: "Rain jacket or umbrella", category: "clothing", perTraveler: true },
  sunHat: { name: "Sun hat", category: "clothing", perTraveler: true },
  sunglasses: { name: "Sunglasses", category: "clothing", perTraveler: true },
  dressyOutfit: { name: "Dressy outfit", category: "clothing", perTraveler: true },
  dressShoes: { name: "Dress shoes", category: "clothing", perTraveler: true },
  massOutfit: { name: "Outfit for Mass", category: "clothing", perTraveler: true },
  toothbrush: { name: "Toothbrush", category: "toiletries", perTraveler: true },
  toothpaste: { name: "Toothpaste", category: "toiletries", perTraveler: false },
  deodorant: { name: "Deodorant", category: "toiletries", perTraveler: true },
  shampoo: { name: "Shampoo and conditioner", category: "toiletries", perTraveler: false },
  hairbrush: { name: "Hairbrush or comb", category: "toiletries", perTraveler: true },
  phoneCharger: { name: "Phone charger", category: "electronics", perTraveler: true },
  portableBattery: { name: "Portable battery", category: "electronics", perTraveler: false },
  headphones: { name: "Headphones", category: "electronics", perTraveler: true },
  powerAdapter: { name: "Power adapter", category: "electronics", perTraveler: false },
  passport: { name: "Passport", category: "documents", perTraveler: true },
  photoId: { name: "Photo ID", category: "documents", perTraveler: true },
  bookings: { name: "Booking confirmations", category: "documents", perTraveler: false },
  payment: { name: "Credit cards and some cash", category: "documents", perTraveler: false },
  driversLicense: { name: "Driver's license", category: "documents", perTraveler: false },
  medications: { name: "Prescription medications", category: "health-safety", perTraveler: false },
  firstAid: { name: "First-aid kit", category: "health-safety", perTraveler: false },
  sanitizer: { name: "Hand sanitizer", category: "health-safety", perTraveler: false },
  sunscreen: { name: "Sunscreen", category: "health-safety", perTraveler: false },
  insectRepellent: { name: "Insect repellent", category: "health-safety", perTraveler: false },
  hikingBoots: { name: "Hiking boots", category: "activity-gear", perTraveler: true },
  daypack: { name: "Daypack", category: "activity-gear", perTraveler: true },
  waterBottle: { name: "Reusable water bottle", category: "activity-gear", perTraveler: true },
  swimsuit: { name: "Swimsuit", category: "activity-gear", perTraveler: true },
  flipFlops: { name: "Flip-flops or water shoes", category: "activity-gear", perTraveler: true },
  skiGoggles: { name: "Ski goggles", category: "activity-gear", perTraveler: true },
  waterproofGloves: { name: "Waterproof gloves", category: "activity-gear", perTraveler: true },
} as const satisfies Record<string, { name: string; category: PackingCategory; perTraveler: boolean }>;
type ItemKey = keyof typeof CATALOG;
const CATALOG_ORDER = Object.keys(CATALOG) as ItemKey[];

/** Everyone's essentials, recommended for every trip without a reason of their own. */
const ESSENTIALS: readonly ItemKey[] = ["sleepwear", "walkingShoes", "toothbrush", "toothpaste", "deodorant", "shampoo", "hairbrush", "phoneCharger", "portableBattery", "bookings", "payment", "firstAid", "sanitizer"];

/**
 * The gear for kinds of activities, each named by terms matched as whole words or phrases, in any capitalization, in a
 * saved activity's name and what it is, as transportation's terms are matched. Formal occasions are matched in
 * restaurants' too.
 */
const ACTIVITY_GEAR: readonly { terms: readonly string[]; items: readonly ItemKey[]; restaurants?: true }[] = [
  { terms: ["hike", "hikes", "hiking", "trek", "treks", "trekking"], items: ["hikingBoots", "daypack", "waterBottle", "insectRepellent"] },
  {
    terms: ["swim", "swimming", "beach", "beaches", "pool", "pools", "snorkel", "snorkeling", "snorkelling", "scuba", "surf", "surfing", "water park", "water parks", "hot spring", "hot springs", "thermal bath", "thermal baths", "onsen"],
    items: ["swimsuit", "flipFlops", "sunscreen"],
  },
  { terms: ["ski", "skis", "skiing", "snowboard", "snowboarding", "snowshoe", "snowshoeing", "sledding"], items: ["skiGoggles", "waterproofGloves", "thermalLayers", "sunscreen"] },
  { terms: ["fine dining", "michelin", "opera", "ballet", "symphony", "philharmonic", "gala", "black tie"], items: ["dressyOutfit", "dressShoes"], restaurants: true },
];

/** Clothing for every day covers at most a week, with laundry on longer trips. */
const WEEK = 7;
/** Average highs from which sun protection is recommended, and from which shorts and a sun hat are, in °F. */
const WARM_F = 70;
const HOT_F = 80;
/** Average lows below which a light layer, a warm coat and winter clothing are recommended, in °F. */
const COOL_F = 60;
const COLD_F = 45;
const FREEZING_F = 32;
/** A month's average precipitation from which rain gear is recommended, in inches. */
const RAINY_IN = 2;

/** One of the trip's stays: its stop, its destination, and its city as Travel shows it. */
interface Stay { stop: TripStop; destination: Destination; city: string }
/**
 * The weather a stay's recommendations use, from its monthly averages or its typical weather: its warmest high, coldest
 * low and wettest month's precipitation, each where known. Typical weather has no precipitation in inches.
 */
interface StayWeather { stay: Stay; source: "monthly" | "typical"; highF: number | null; lowF: number | null; rainIn: number | null }

/** Names as a list, such as "Rome, Naples and Florence", naming at most `max` of them and how many more there are. */
function listed(names: readonly string[], max = names.length): string {
  const shown = names.length > max ? [...names.slice(0, max), `${names.length - max} more`] : names;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}
const cities = (stays: readonly Stay[]) => listed(stays.map((stay) => stay.city));

/** Whether text names any of the terms, each as whole words, in any capitalization. */
function mentions(text: string, terms: readonly string[]): boolean {
  const found = words(text);
  return terms.some((term) => {
    const phrase = words(term);
    return found.some((_, start) => phrase.every((word, offset) => found[start + offset] === word));
  });
}

/** The months a stay is in, 0 for January, from its arrival's to its departure's, each once. */
function stayMonths(arrivalDate: string, departureDate: string): number[] {
  const months: number[] = [];
  let year = Number(arrivalDate.slice(0, 4));
  let month = Number(arrivalDate.slice(5, 7)) - 1;
  const lastYear = Number(departureDate.slice(0, 4));
  const lastMonth = Number(departureDate.slice(5, 7)) - 1;
  while ((year < lastYear || (year === lastYear && month <= lastMonth)) && months.length < 12) {
    months.push(month);
    month = (month + 1) % 12;
    if (month === 0) year++;
  }
  return months;
}

/**
 * A stay's weather: from its destination's monthly averages for the months of its dates, or else from its typical
 * weather, or null without either. Monthly averages need the stay's dates.
 */
function stayWeather(stay: Stay): StayWeather | null {
  const { stop, destination } = stay;
  if (destination.climate && stop.arrivalDate && stop.departureDate) {
    const months = stayMonths(stop.arrivalDate, stop.departureDate).map((index) => destination.climate!.months[index]);
    return { stay, source: "monthly", highF: Math.max(...months.map((month) => month.highF)), lowF: Math.min(...months.map((month) => month.lowF)), rainIn: Math.max(...months.map((month) => month.precipitationIn)) };
  }
  if (destination.weatherHighF !== null || destination.weatherLowF !== null) return { stay, source: "typical", highF: destination.weatherHighF, lowF: destination.weatherLowF, rainIn: null };
  return null;
}

/** The stay whose `value` is greatest, by `sign` 1, or least, by -1, among those that know it. */
function extreme(weathers: readonly StayWeather[], value: (weather: StayWeather) => number | null, sign: 1 | -1): (StayWeather & { value: number }) | undefined {
  let found: (StayWeather & { value: number }) | undefined;
  for (const weather of weathers) {
    const known = value(weather);
    if (known !== null && (found === undefined || sign * known > sign * found.value)) found = { ...weather, value: known };
  }
  return found;
}

/**
 * Travel's packing recommendations for a trip in `snapshot`: each item once, however many stays, activities or rules call
 * for it, with the largest quantity any calls for and every reason, in the list's order of categories. `assumptions` say
 * what the trip leaves out and what was assumed instead.
 */
export function recommendPacking(snapshot: Snapshot, tripId: string): PackingRecommendations {
  const trip = snapshot.trips.find((item) => item.id === tripId);
  if (!trip) throw new Error("This trip isn't loaded, so nothing can be recommended for it.");
  const stays: Stay[] = snapshot.stops.filter((stop) => stop.tripId === tripId).sort((a, b) => a.position - b.position).map((stop) => {
    const destination = snapshot.destinations.find((item) => item.id === stop.destinationId);
    if (!destination) throw new Error("A destination of this trip isn't loaded, so nothing can be recommended for it.");
    return { stop, destination, city: formatSavedDestinationLabel(destination) };
  });
  const items = new Map<ItemKey, PackingRecommendation>();
  const assumptions: string[] = [];
  /** Recommends an item, `each` for every traveler or once for the party, with why, keeping the largest quantity asked for. */
  const add = (key: ItemKey, reason?: string, each = 1) => {
    const { name, category, perTraveler } = CATALOG[key];
    const quantity = perTraveler ? each * trip.travelers : each;
    const recommended = items.get(key);
    if (!recommended) items.set(key, { name, category, quantity, reasons: reason ? [reason] : [] });
    else {
      recommended.quantity = Math.max(recommended.quantity, quantity);
      if (reason && !recommended.reasons.includes(reason)) recommended.reasons.push(reason);
    }
  };

  // How long the trip is: its nights and the day it ends, when every stay's nights are known.
  const unknownNights = stays.filter(({ stop }) => stop.nights === null);
  const days = stays.length > 0 && unknownNights.length === 0 ? stays.reduce((sum, { stop }) => sum + stop.nights!, 0) + 1 : null;
  const covered = Math.min(days ?? WEEK, WEEK);
  const forDays = days !== null && days <= WEEK ? `For ${days === 1 ? "1 day" : `${days} days`}` : "For a week";
  for (const key of ["underwear", "socks", "tops"] as const) add(key, forDays, covered);
  add("bottoms", forDays, Math.ceil(covered / 3));
  add("medications", days === null ? "Enough for every day, plus extra" : `Enough for ${days === 1 ? "1 day" : `${days} days`}, plus extra`);
  for (const key of ESSENTIALS) add(key);
  if (stays.length === 0) assumptions.push("This trip has no destinations yet, so these are a week's essentials, without weather or activity gear.");
  else if (unknownNights.length > 0) assumptions.push(`${cities(unknownNights)} ${unknownNights.length === 1 ? "has" : "have"} no nights set, so quantities assume a week.`);
  else if (days! > WEEK) assumptions.push(`Clothing covers a week of this ${days}-day trip, assuming laundry along the way.`);
  if (trip.travelers > 1) assumptions.push(`Quantities are for all ${trip.travelers} travelers together.`);

  // The weather: each stay's, then the warmest, coldest and wettest of them.
  const weathers = stays.map(stayWeather).filter((weather) => weather !== null);
  const hottest = extreme(weathers, (weather) => weather.highF, 1);
  if (hottest && hottest.value >= WARM_F) {
    const reason = `Highs around ${Math.round(hottest.value)} °F in ${hottest.stay.city}`;
    add("sunglasses", reason);
    add("sunscreen", reason);
    if (hottest.value >= HOT_F) {
      add("shorts", reason, Math.ceil(covered / 3));
      add("sunHat", reason);
    }
  }
  const coldest = extreme(weathers, (weather) => weather.lowF, -1);
  if (coldest && coldest.value < COOL_F) {
    const reason = `Lows around ${Math.round(coldest.value)} °F in ${coldest.stay.city}`;
    add("lightJacket", reason);
    if (coldest.value < COLD_F) add("warmCoat", reason);
    if (coldest.value < FREEZING_F) for (const key of ["thermalLayers", "warmHat", "warmGloves", "scarf"] as const) add(key, reason);
  }
  const wettest = extreme(weathers, (weather) => weather.rainIn, 1);
  if (wettest && wettest.value >= RAINY_IN) add("rainGear", `About ${Math.round(wettest.value * 10) / 10} in of rain a month in ${wettest.stay.city}`);
  const undated = stays.filter(({ stop, destination }) => destination.climate && !(stop.arrivalDate && stop.departureDate));
  const typical = weathers.filter((weather) => weather.source === "typical").map((weather) => weather.stay);
  const unknown = stays.filter((stay) => !weathers.some((weather) => weather.stay === stay));
  if (unknown.length > 0) add("lightJacket", `No weather saved for ${cities(unknown)}`);
  if (undated.length > 0) assumptions.push(`Monthly averages for ${cities(undated)} weren't used, since ${undated.length === 1 ? "its stay has" : "their stays have"} no dates yet. Dates come from the trip's start date and each stay's nights.`);
  if (typical.length > 0) assumptions.push(`Weather for ${cities(typical)} is the typical weather saved for ${typical.length === 1 ? "it" : "them"}, which may not match your dates.`);
  if (unknown.length > 0) assumptions.push(`No weather is saved for ${cities(unknown)}, so a light layer stands in for weather-specific clothing.`);

  // The activities, restaurants and churches saved for the trip's destinations.
  const cityOf = (destinationId: string) => stays.find(({ destination }) => destination.id === destinationId)!.city;
  // In the trip's route order, each destination's in their saved order, so reasons name them as the trip visits them.
  const ideas = stays.flatMap(({ destination }) => snapshot.candidates.filter((idea) => idea.destinationId === destination.id));
  for (const { terms, items: gear, restaurants } of ACTIVITY_GEAR) {
    const matched = ideas.filter((idea) => (idea.category === "activities" || (restaurants && idea.category === "restaurants")) && mentions(`${idea.name} ${idea.description}`, terms));
    if (matched.length === 0) continue;
    const reason = `For ${listed(matched.map((idea) => `${idea.name} in ${cityOf(idea.destinationId)}`), 3)}`;
    for (const key of gear) add(key, reason);
  }
  if (stays.length > 0 && !ideas.some((idea) => idea.category === "activities")) assumptions.push("No activities are saved for this trip's destinations, so no activity gear is recommended.");
  const mass = stays.filter(({ stop, destination }) => destination.churchEnabled && churchDateEligible(stop) && snapshot.churches.some((church) => church.destinationId === destination.id));
  if (mass.length > 0) add("massOutfit", `For Mass in ${cities(mass)}`);

  // Travel between the places, and crossing borders.
  const legs = snapshot.legs.filter((leg) => leg.tripId === tripId);
  if (legs.some((leg) => isFlight(leg.method))) add("headphones", "For flights");
  if (legs.some((leg) => transportationIcons(leg.method).includes("car"))) add("driversLicense", "For travel by car");
  const abroad = stays.filter(({ destination }) => destination.entryRequirements !== null);
  if (abroad.length > 0) {
    add("passport", `Entry requirements are saved for ${cities(abroad)}`);
    add("powerAdapter", `Outlets may differ in ${cities(abroad)}`);
  } else {
    add("photoId");
    if (stays.length > 0) assumptions.push("No destination has entry requirements saved, so a photo ID stands in for a passport, and no power adapter is recommended.");
  }

  return { items: CATALOG_ORDER.filter((key) => items.has(key)).map((key) => items.get(key)!), assumptions };
}

/** A packing item's name as names are compared: trimmed, single-spaced and lowercase, so "Socks" and " socks " are one item. */
function packingKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A review of recommendations (TRA-18): each recommendation not yet on the list, by name, with the new ID it is added
 * under, given once as the review opens, so adding again after a lost response adds nothing more; those already on the
 * list, which adding leaves as they are, quantity and whether packed included; and what was assumed.
 */
export interface PackingReview { items: (PackingRecommendation & { id: string })[]; onList: PackingRecommendation[]; assumptions: string[] }

/** A review of `recommendations` for a list that already holds `saved`, giving each new item an ID from `newId`. */
export function packingReview(recommendations: PackingRecommendations, saved: readonly { name: string }[], newId: () => string): PackingReview {
  const names = new Set(saved.map((item) => packingKey(item.name)));
  return {
    items: recommendations.items.filter((item) => !names.has(packingKey(item.name))).map((item) => ({ ...item, id: newId() })),
    onList: recommendations.items.filter((item) => names.has(packingKey(item.name))),
    assumptions: recommendations.assumptions,
  };
}

/** The items of a review whose IDs were chosen, in its order, as a packing list add takes them. */
export function chosenItems(review: PackingReview, chosen: readonly string[]): { id: string; name: string; category: PackingCategory; quantity: number }[] {
  return review.items.filter((item) => chosen.includes(item.id)).map(({ id, name, category, quantity }) => ({ id, name, category, quantity }));
}

/** How much of a list is packed: its packed and total items, and the percentage packed, rounded down, so 100% means every item. */
export function packingProgress(items: readonly { packed: boolean }[]): { packed: number; total: number; percent: number } {
  const packed = items.filter((item) => item.packed).length;
  return { packed, total: items.length, percent: items.length === 0 ? 0 : Math.floor((packed * 100) / items.length) };
}

/** Items grouped by category, in the list's order of categories, each group in the items' own order, without empty groups. */
export function byCategory<T extends { category: PackingCategory }>(items: readonly T[]): { category: PackingCategory; items: T[] }[] {
  return PACKING_CATEGORIES.map((category) => ({ category, items: items.filter((item) => item.category === category) })).filter((group) => group.items.length > 0);
}
