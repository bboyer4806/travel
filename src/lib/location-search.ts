export type LocationSuggestion = {
  id: string;
  name: string;
  region: string;
  country: string;
  countryCode?: string;
  label: string;
};

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
const UNAVAILABLE = "City suggestions are unavailable. You can still enter your city.";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= MAX_QUERY_LENGTH && !/\p{Cc}/u.test(normalized) ? normalized : "";
}

function normalizeResults(data: unknown): LocationSuggestion[] {
  if (!object(data) || data.error || (data.results !== undefined && !Array.isArray(data.results))) {
    throw new LocationSearchError(UNAVAILABLE, 502);
  }
  // Open-Meteo omits results entirely when no locations match.
  const results = (data.results ?? []) as unknown[];
  const locations: LocationSuggestion[] = [];
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const result of results.slice(0, 100)) {
    if (!object(result) || typeof result.id !== "number" || !Number.isSafeInteger(result.id) || result.id < 1) continue;
    const id = String(result.id);
    const name = text(result.name);
    const region = text(result.admin1);
    const country = text(result.country) || text(result.country_code);
    const rawCountryCode = text(result.country_code).toUpperCase();
    const countryCode = /^[A-Z]{2}$/.test(rawCountryCode) ? rawCountryCode : undefined;
    if (!name || !country) continue;
    const isUnitedStates = countryCode === "US" || ["united states", "united states of america", "us", "usa"].includes(country.toLowerCase());
    const parts = [name, region, country].filter((part, index, all) => part && (isUnitedStates || all.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index));
    let label = parts.join(", ");
    // Keep suggestions within the existing city field limit without clipping a place name.
    if (label.length > MAX_QUERY_LENGTH) label = [name, country].join(", ");
    if (label.length > MAX_QUERY_LENGTH) label = name;
    const key = label.toLowerCase();
    if (ids.has(id) || labels.has(key)) continue;
    ids.add(id);
    labels.add(key);
    locations.push({ id, name, region, country, ...(countryCode ? { countryCode } : {}), label });
    if (locations.length === MAX_RESULTS) break;
  }
  return locations;
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
  let attempts: number[] = [];
  const clients = new Map<string, { attempts: number[]; pending: number }>();
  let cooldownUntil = 0;

  function reserve(clientId: string) {
    const time = now();
    attempts = attempts.filter((attempt) => attempt > time - DAY_MS);
    for (const [id, client] of clients) {
      client.attempts = client.attempts.filter((attempt) => attempt > time - MINUTE_MS);
      if (!client.attempts.length && !client.pending) clients.delete(id);
    }
    const client = clients.get(clientId) ?? { attempts: [], pending: 0 };
    if (time < cooldownUntil || pending.size >= MAX_PENDING_SEARCHES ||
      client.pending >= MAX_CLIENT_PENDING || client.attempts.length >= MAX_CLIENT_REQUESTS ||
      attempts.length >= 8000 || attempts.filter((attempt) => attempt > time - HOUR_MS).length >= 2500 ||
      attempts.filter((attempt) => attempt > time - MINUTE_MS).length >= 300) {
      throw new LocationSearchError(UNAVAILABLE, 503);
    }
    // Only the request that starts an upstream lookup consumes capacity.
    attempts.push(time);
    client.attempts.push(time);
    client.pending++;
    clients.set(clientId, client);
    return client;
  }

  async function lookup(query: string): Promise<LocationSuggestion[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set("name", query);
      url.searchParams.set("count", String(MAX_RESULTS));
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
      return normalizeResults(await response.json());
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

  return async function searchLocations(rawQuery: string | null, clientId = "anonymous"): Promise<LocationSuggestion[]> {
    const query = (rawQuery ?? "").trim().replace(/\s+/g, " ");
    if (query.length > MAX_QUERY_LENGTH || /\p{Cc}/u.test(query)) {
      throw new LocationSearchError("Enter a city using 120 characters or fewer.", 400);
    }
    if (query.length < 2) return [];
    const key = query.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.locations;
    cache.delete(key);
    const existing = pending.get(key);
    if (existing) return existing;
    const client = reserve(clientId);

    const request = lookup(query);
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
  };
}

export const searchLocations = createLocationSearch();
