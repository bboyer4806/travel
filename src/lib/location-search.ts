import { airportByCode, airportName, type Airport } from "./airports.ts";
import { comparable, countryName, describes } from "./destination-label.ts";

/**
 * A city, or an airport suggested for its IATA code (TRA-132), and the `label` choosing it saves. An airport's name
 * includes its code, its region is the city it serves, its label is its code, and `airport` marks it as one.
 */
export type LocationSuggestion = {
  id: string;
  name: string;
  region: string;
  country: string;
  countryCode?: string;
  label: string;
  airport?: true;
};

/**
 * Where a saved place is on a trip's map (TRA-44): the place found for it, with that place's suggestion label, or why
 * there is none. `missing` means no place matches it; `unavailable` that the lookup couldn't be made, so a later one may.
 */
export type PlaceLocation =
  | { status: "found"; latitude: number; longitude: number; label: string }
  | { status: "missing" }
  | { status: "unavailable" };

/** A place Open-Meteo has by a searched name: where it is, its suggestion label, and the regions and country it is in. */
type PlaceCandidate = { latitude: number; longitude: number; label: string; region: string; areas: string[]; countryCode?: string };

export class LocationSearchError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LocationSearchError";
    this.status = status;
  }
}

const ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const MAX_QUERY_LENGTH = 120;
const MAX_RESULTS = 8;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const MAX_PENDING_SEARCHES = 8;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MAX_CLIENT_REQUESTS = 20;
const MAX_CLIENT_PENDING = 2;
// A saved place's name is looked up with more results than a suggestion list, so the region or country written after
// it can choose among same-named places. Saved names are few and places don't move, so they are kept for a day.
const PLACE_RESULTS = 20;
const PLACE_CACHE_TTL_MS = DAY_MS;
const MAX_PLACE_CACHE_ENTRIES = 500;
// A map's lookups run a few at a time, leaving room within MAX_PENDING_SEARCHES for suggestions.
const PLACE_WORKERS = 3;
const UNAVAILABLE = "City suggestions are unavailable. You can still enter your city.";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= MAX_QUERY_LENGTH && !/\p{Cc}/u.test(normalized) ? normalized : "";
}

/** Open-Meteo's results, or an error when it answered with anything else. */
function resultsOf(data: unknown): unknown[] {
  if (!object(data) || data.error || (data.results !== undefined && !Array.isArray(data.results))) {
    throw new LocationSearchError(UNAVAILABLE, 502);
  }
  // Open-Meteo omits results entirely when no locations match.
  return ((data.results ?? []) as unknown[]).slice(0, 100);
}

/** A result as a suggestion, or null when it has no valid ID, name or country. */
function suggestionOf(result: Record<string, unknown>): LocationSuggestion | null {
  if (typeof result.id !== "number" || !Number.isSafeInteger(result.id) || result.id < 1) return null;
  const name = text(result.name);
  const region = text(result.admin1);
  const country = text(result.country) || text(result.country_code);
  const rawCountryCode = text(result.country_code).toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(rawCountryCode) ? rawCountryCode : undefined;
  if (!name || !country) return null;
  const isUnitedStates = countryCode === "US" || ["united states", "united states of america", "us", "usa"].includes(country.toLowerCase());
  const parts = [name, region, country].filter((part, index, all) => part && (isUnitedStates || all.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index));
  let label = parts.join(", ");
  // Keep suggestions within the existing city field limit without clipping a place name.
  if (label.length > MAX_QUERY_LENGTH) label = [name, country].join(", ");
  if (label.length > MAX_QUERY_LENGTH) label = name;
  return { id: String(result.id), name, region, country, ...(countryCode ? { countryCode } : {}), label };
}

/** An airport suggested for its IATA code (TRA-132). Choosing it saves the code, which the trip map finds. */
function airportSuggestion(airport: Airport): LocationSuggestion {
  const { code, city, countryCode } = airport;
  return { id: code, name: airportName(airport), region: city, country: countryName(countryCode), countryCode, label: code, airport: true };
}

/**
 * The airport whose three-letter IATA code `code` is, in any letter case, anywhere in the world, as a suggestion
 * (TRA-132). It needs no lookup, so it counts against no limits. Any other text, an ICAO code included, suggests none.
 */
export function airportSuggestions(code: string): LocationSuggestion[] {
  const text = code.trim();
  const airport = /^[a-z]{3}$/i.test(text) ? airportByCode(text.toUpperCase()) : undefined;
  return airport ? [airportSuggestion(airport)] : [];
}

function normalizeResults(results: unknown[]): LocationSuggestion[] {
  const locations: LocationSuggestion[] = [];
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const result of results) {
    const location = object(result) ? suggestionOf(result) : null;
    if (!location) continue;
    const key = location.label.toLowerCase();
    if (ids.has(location.id) || labels.has(key)) continue;
    ids.add(location.id);
    labels.add(key);
    locations.push(location);
    if (locations.length === MAX_RESULTS) break;
  }
  return locations;
}

/** The results named `name`, or with a name that begins with it as whole words, such as "Frankfurt am Main" for "Frankfurt", in Open-Meteo's order. */
function placeCandidates(results: unknown[], name: string): PlaceCandidate[] {
  const wanted = comparable(name);
  return results.flatMap((result) => {
    const place = object(result) ? suggestionOf(result) : null;
    if (!place || !object(result)) return [];
    const { latitude, longitude } = result;
    if (typeof latitude !== "number" || typeof longitude !== "number" || !(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) return [];
    const found = comparable(place.name);
    if (found !== wanted && !found.startsWith(wanted + " ")) return [];
    const areas = [result.admin1, result.admin2, result.admin3, result.admin4, result.country].map(text).filter(Boolean);
    return [{ latitude, longitude, label: place.label, region: place.region, areas, ...(place.countryCode ? { countryCode: place.countryCode } : {}) }];
  });
}

/**
 * The name a saved place is looked up by, and the regions or countries written after it: the text before its first
 * comma, and after it, without anything in parentheses, such as an airport code. Null when the name can't be searched.
 */
function placeQuery(place: string): { name: string; qualifiers: string[] } | null {
  if (/\p{Cc}/u.test(place)) return null;
  const [name = "", ...qualifiers] = place.replace(/\([^()]*\)/g, " ").split(",").map((part) => part.trim().replace(/\s+/g, " "));
  return name.length < 2 || name.length > MAX_QUERY_LENGTH ? null : { name, qualifiers: qualifiers.filter(Boolean) };
}

export function createLocationSearch({
  fetcher = fetch,
  now = Date.now,
  timeoutMs = 4000,
}: {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
} = {}) {
  const cache = new Map<string, { expiresAt: number; locations: LocationSuggestion[] }>();
  const pending = new Map<string, Promise<LocationSuggestion[]>>();
  const places = new Map<string, { expiresAt: number; candidates: PlaceCandidate[] }>();
  const placesPending = new Map<string, Promise<PlaceCandidate[]>>();
  let attempts: number[] = [];
  const clients = new Map<string, { attempts: number[]; pending: number }>();
  let cooldownUntil = 0;

  function prune(time: number) {
    attempts = attempts.filter((attempt) => attempt > time - DAY_MS);
    for (const [id, client] of clients) {
      client.attempts = client.attempts.filter((attempt) => attempt > time - MINUTE_MS);
      if (!client.attempts.length && !client.pending) clients.delete(id);
    }
  }

  /** Whether the provider's limits, which suggestions and maps share, leave no room for another lookup now. */
  function full(time: number) {
    return time < cooldownUntil || pending.size + placesPending.size >= MAX_PENDING_SEARCHES ||
      attempts.length >= 8000 || attempts.filter((attempt) => attempt > time - HOUR_MS).length >= 2500 ||
      attempts.filter((attempt) => attempt > time - MINUTE_MS).length >= 300;
  }

  function reserve(clientId: string) {
    const time = now();
    prune(time);
    const client = clients.get(clientId) ?? { attempts: [], pending: 0 };
    if (full(time) || client.pending >= MAX_CLIENT_PENDING || client.attempts.length >= MAX_CLIENT_REQUESTS) {
      throw new LocationSearchError(UNAVAILABLE, 503);
    }
    // Only the request that starts an upstream lookup consumes capacity.
    attempts.push(time);
    client.attempts.push(time);
    client.pending++;
    clients.set(clientId, client);
    return client;
  }

  /** A map's lookup counts against the shared limits only: its names are saved, and each is looked up once a day. */
  function reservePlace() {
    const time = now();
    prune(time);
    if (full(time)) throw new LocationSearchError(UNAVAILABLE, 503);
    attempts.push(time);
  }

  async function lookup(query: string, count: number): Promise<unknown[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set("name", query);
      url.searchParams.set("count", String(count));
      url.searchParams.set("language", "en");
      url.searchParams.set("format", "json");
      const response = await fetcher(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
        redirect: "error",
      });
      if (!response.ok) {
        if (response.status === 429) cooldownUntil = Math.max(cooldownUntil, now() + MINUTE_MS);
        throw new LocationSearchError(UNAVAILABLE, response.status === 429 ? 503 : 502);
      }
      return resultsOf(await response.json());
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LocationSearchError("City suggestions took too long. Try again or enter your city.", 504);
      }
      if (error instanceof LocationSearchError) throw error;
      throw new LocationSearchError(UNAVAILABLE, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Suggestions for a search of at least two characters: the places Open-Meteo has for it, after the airport whose IATA
   * code it is, in any letter case (TRA-132).
   */
  async function searchLocations(rawQuery: string | null, clientId = "anonymous"): Promise<LocationSuggestion[]> {
    const query = (rawQuery ?? "").trim().replace(/\s+/g, " ");
    if (query.length > MAX_QUERY_LENGTH || /\p{Cc}/u.test(query)) {
      throw new LocationSearchError("Enter a city using 120 characters or fewer.", 400);
    }
    if (query.length < 2) return [];
    const places = await placeSuggestions(query, clientId);
    return [...airportSuggestions(query), ...places].slice(0, MAX_RESULTS);
  }

  /** The places Open-Meteo has for a search, kept for ten minutes, with one upstream lookup shared by everyone searching it. */
  async function placeSuggestions(query: string, clientId: string): Promise<LocationSuggestion[]> {
    const key = query.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.locations;
    cache.delete(key);
    const existing = pending.get(key);
    if (existing) return existing;
    const client = reserve(clientId);

    const request = lookup(query, MAX_RESULTS).then(normalizeResults);
    pending.set(key, request);
    try {
      const locations = await request;
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(key, { expiresAt: now() + CACHE_TTL_MS, locations });
      return locations;
    } finally {
      pending.delete(key);
      client.pending--;
    }
  }

  function cachedCandidates(key: string): PlaceCandidate[] | undefined {
    const cached = places.get(key);
    if (cached && cached.expiresAt > now()) return cached.candidates;
    places.delete(key);
  }

  /** The places Open-Meteo has by a name, kept for a day, with one upstream lookup shared by everyone looking it up. */
  async function candidatesFor(key: string, name: string): Promise<PlaceCandidate[]> {
    const existing = placesPending.get(key);
    if (existing) return existing;
    reservePlace();
    const request = lookup(name, PLACE_RESULTS).then((results) => placeCandidates(results, name));
    placesPending.set(key, request);
    try {
      const candidates = await request;
      if (places.size >= MAX_PLACE_CACHE_ENTRIES) places.delete(places.keys().next().value!);
      places.set(key, { expiresAt: now() + PLACE_CACHE_TTL_MS, candidates });
      return candidates;
    } finally {
      placesPending.delete(key);
    }
  }

  /**
   * Where each saved place is (TRA-44). A place among `airportNames` that is an airport's IATA code in capitals, such as
   * "PHL", is at that airport (TRA-132). Any other place is found when Open-Meteo has a place whose name is the place's
   * name, or begins with it as whole words, in every region and country written after it, and the first such place in
   * Open-Meteo's order is used. Nothing is guessed. Once a lookup fails, names not yet looked up are unavailable
   * instead of waiting on more.
   */
  async function locatePlaces(saved: readonly string[], airportNames: readonly string[] = []): Promise<Record<string, PlaceLocation>> {
    const located: Record<string, PlaceLocation> = {};
    const byName = new Map<string, { name: string; places: { place: string; qualifiers: string[] }[] }>();
    const codes = new Set(airportNames);
    for (const place of new Set(saved)) {
      const airport = codes.has(place) ? airportByCode(place) : undefined;
      if (airport) {
        located[place] = { status: "found", latitude: airport.latitude, longitude: airport.longitude, label: airportName(airport) };
        continue;
      }
      const query = placeQuery(place);
      if (!query) {
        located[place] = { status: "missing" };
        continue;
      }
      const key = query.name.toLowerCase();
      const group = byName.get(key) ?? { name: query.name, places: [] };
      group.places.push({ place, qualifiers: query.qualifiers });
      byName.set(key, group);
    }
    const waiting = [...byName];
    let failed = false;
    async function work() {
      for (let next = waiting.shift(); next; next = waiting.shift()) {
        const [key, group] = next;
        let candidates = cachedCandidates(key) ?? null;
        if (!candidates && !failed) {
          try {
            candidates = await candidatesFor(key, group.name);
          } catch (error) {
            if (!(error instanceof LocationSearchError)) throw error;
            failed = true;
          }
        }
        for (const { place, qualifiers } of group.places) {
          const match = candidates?.find((candidate) => qualifiers.every((qualifier) => describes(qualifier, candidate)));
          located[place] = !candidates ? { status: "unavailable" }
            : match ? { status: "found", latitude: match.latitude, longitude: match.longitude, label: match.label }
            : { status: "missing" };
        }
      }
    }
    await Promise.all(Array.from({ length: PLACE_WORKERS }, work));
    return located;
  }

  return { searchLocations, locatePlaces };
}

export const { searchLocations, locatePlaces } = createLocationSearch();
