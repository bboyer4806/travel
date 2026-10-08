export type LocationSuggestion = {
  id: string;
  name: string;
  region: string;
  country: string;
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
    if (!name || !country) continue;
    const parts = [name, region, country].filter((part, index, all) => part && all.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index);
    let label = parts.join(", ");
    // Keep suggestions within the existing city field limit without clipping a place name.
    if (label.length > MAX_QUERY_LENGTH) label = [name, country].join(", ");
    if (label.length > MAX_QUERY_LENGTH) label = name;
    const key = label.toLowerCase();
    if (ids.has(id) || labels.has(key)) continue;
    ids.add(id);
    labels.add(key);
    locations.push({ id, name, region, country, label });
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

  return async function searchLocations(rawQuery: string | null): Promise<LocationSuggestion[]> {
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
    if (pending.size >= MAX_PENDING_SEARCHES) throw new LocationSearchError(UNAVAILABLE, 503);

    const request = lookup(query);
    pending.set(key, request);
    try {
      const locations = await request;
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(key, { expiresAt: now() + CACHE_TTL_MS, locations });
      return locations;
    } finally {
      pending.delete(key);
    }
  };
}

export const searchLocations = createLocationSearch();
