import { comparable } from "./destination-label.ts";

/**
 * Where a saved hotel, activity, restaurant or church is on its destination's map (TRA-130): the one place found for it,
 * with the place's address as OpenStreetMap writes it, or why there is none. `missing` means no place near the
 * destination has its address or name, `ambiguous` that more than one does, and `unavailable` that the lookup couldn't
 * be made, so a later one may.
 */
export type PlaceMatch =
  | { status: "found"; latitude: number; longitude: number; label: string }
  | { status: "missing" }
  | { status: "ambiguous" }
  | { status: "unavailable" };

/** A saved place's answer so far: its match, or `pending` while its lookup waits its turn. */
export type PlaceAnswer = PlaceMatch | { status: "pending" };

/** What a saved place is looked up by: its saved address, empty without one, and its name, empty to look it up by its address alone. */
export interface PlaceText { address: string; name: string }

/** Where a destination is, as the trip map finds it, which its places are looked up around. */
export interface Center { latitude: number; longitude: number }

/** A place Nominatim found: where it is, its search rank and class, every name it has, and its address. */
type Result = Center & { rank: number; category: string; names: string[]; label: string };

class PlaceSearchError extends Error {
  constructor() {
    super("Places can't be looked up right now.");
    this.name = "PlaceSearchError";
  }
}

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
// Nominatim's usage policy asks each application to name itself. Travel's photo downloads use the same name.
const USER_AGENT = "TravelPlanner/1.0";
/** How far from its destination's center a place can be, in kilometers. */
export const AREA_KM = 50;
/** Matches this close together, in meters, are one place: a hotel's building and the hotel in it, or a place mapped twice. */
const SAME_PLACE_METERS = 100;
/** Nominatim's search rank for buildings, houses and points of interest. Streets, squares, neighborhoods and towns rank lower. */
const PRECISE_RANK = 30;
/** What a name never finds: streets and bus stops, stations and platforms, which are often named for the places beside them. */
const NOT_NAMED_PLACES = new Set(["highway", "railway", "public_transport", "aerialway"]);
const RESULTS = 10;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// Nominatim allows one application at most one request a second, made one at a time, and asks that results be kept.
const REQUEST_INTERVAL_MS = 1100;
const CACHE_TTL_MS = DAY_MS;
const MAX_CACHE_ENTRIES = 2000;
const COOLDOWN_MS = MINUTE_MS;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A latitude or longitude, which Nominatim writes as text. NaN when there is none. */
function coordinate(value: unknown): number {
  return typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
}

/** A result Nominatim answered with, or null without a valid position. */
function resultOf(value: unknown): Result | null {
  if (!object(value)) return null;
  const latitude = coordinate(value.lat), longitude = coordinate(value.lon);
  if (!(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) return null;
  const names = [value.name, ...(object(value.namedetails) ? Object.values(value.namedetails) : [])].filter((name): name is string => typeof name === "string" && name.trim() !== "");
  const label = typeof value.display_name === "string" ? value.display_name.trim() : "";
  return { latitude, longitude, rank: typeof value.place_rank === "number" ? value.place_rank : 0, category: typeof value.category === "string" ? value.category : "", names, label: label || names[0] || "" };
}

/** Nominatim's results, or an error when it answered with anything else. */
function resultsOf(data: unknown): Result[] {
  if (!Array.isArray(data)) throw new PlaceSearchError();
  return data.slice(0, 50).flatMap((value) => { const result = resultOf(value); return result ? [result] : []; });
}

/** The distance between two positions, in meters. */
function meters(from: Center, to: Center): number {
  const radians = Math.PI / 180;
  const latitude = (to.latitude - from.latitude) * radians, longitude = (to.longitude - from.longitude) * radians;
  const h = Math.sin(latitude / 2) ** 2 + Math.cos(from.latitude * radians) * Math.cos(to.latitude * radians) * Math.sin(longitude / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The box Nominatim searches, with every point within AREA_KM of the center in it, as its left, top, right and bottom edges. */
function viewbox({ latitude, longitude }: Center): string {
  const latitudeSpan = AREA_KM / 111.32;
  const longitudeSpan = Math.min(180, AREA_KM / (111.32 * Math.cos(latitude * Math.PI / 180)));
  return [Math.max(-180, longitude - longitudeSpan), Math.min(90, latitude + latitudeSpan), Math.min(180, longitude + longitudeSpan), Math.max(-90, latitude - latitudeSpan)]
    .map((edge) => edge.toFixed(5)).join(",");
}

/** Saved text as it is looked up, on one line, or empty when it has nothing to look up. */
function queryText(value: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  return /\p{Cc}/u.test(text) || !comparable(text) ? "" : text;
}

/** The match for the places that fit: none, one place, or more than one. */
function onePlace(matches: Result[]): PlaceMatch {
  const [first] = matches;
  if (!first) return { status: "missing" };
  if (matches.some((match) => meters(first, match) > SAME_PLACE_METERS)) return { status: "ambiguous" };
  return { status: "found", latitude: first.latitude, longitude: first.longitude, label: first.label };
}

/** An address's match: the building, house or point of interest near the center that has it. A street or area is too vague. */
function byAddress(results: Result[], center: Center): PlaceMatch {
  return onePlace(results.filter((result) => result.rank >= PRECISE_RANK && meters(center, result) <= AREA_KM * 1000));
}

/** A name's match: the place near the center with this name, among all its names, in any letter case and without accents. */
function byName(results: Result[], center: Center, name: string): PlaceMatch {
  const wanted = comparable(name);
  return onePlace(results.filter((result) => !NOT_NAMED_PLACES.has(result.category) && meters(center, result) <= AREA_KM * 1000 &&
    result.names.some((found) => comparable(found) === wanted)));
}

export function createPlaceSearch({
  fetcher = fetch,
  now = Date.now,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 5000,
  waitMs = 8000,
}: {
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  waitMs?: number;
} = {}) {
  const cache = new Map<string, { expiresAt: number; results: Result[] }>();
  const pending = new Map<string, Promise<Result[]>>();
  let line: Promise<unknown> = Promise.resolve();
  let lastRequest = -Infinity;
  let cooldownUntil = 0;
  // Each failed request starts a new round. Requests still waiting from an earlier round aren't made: once Nominatim
  // can't answer, the places not yet looked up are unavailable instead of waiting on more.
  let round = 0;

  /** Asks Nominatim once the requests before have been made, at least REQUEST_INTERVAL_MS after the last one started. */
  function request(url: URL): Promise<Result[]> {
    const joined = round;
    const turn = line.then(async () => {
      if (joined !== round || now() < cooldownUntil) throw new PlaceSearchError();
      const wait = lastRequest + REQUEST_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      lastRequest = now();
      try {
        return await answer(url);
      } catch (error) {
        round++;
        throw error;
      }
    });
    line = turn.catch(() => undefined);
    return turn;
  }

  async function answer(url: URL): Promise<Result[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let data: unknown;
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        redirect: "error",
      });
      // Too many requests, or refused: wait a minute before asking again.
      if (response.status === 429 || response.status === 403) cooldownUntil = Math.max(cooldownUntil, now() + COOLDOWN_MS);
      if (!response.ok) throw new PlaceSearchError();
      data = await response.json();
    } catch {
      throw new PlaceSearchError();
    } finally {
      clearTimeout(timeout);
    }
    return resultsOf(data);
  }

  /** The places Nominatim has for a search near the center, kept for a day, with one request shared by everyone waiting on it. */
  async function search(query: string, center: Center): Promise<Result[]> {
    const url = new URL(ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(RESULTS));
    url.searchParams.set("viewbox", viewbox(center));
    url.searchParams.set("bounded", "1");
    url.searchParams.set("namedetails", "1");
    url.searchParams.set("accept-language", "en");
    const key = url.href;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.results;
    cache.delete(key);
    const existing = pending.get(key);
    if (existing) return existing;
    const lookup = request(url);
    pending.set(key, lookup);
    try {
      const results = await lookup;
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(key, { expiresAt: now() + CACHE_TTL_MS, results });
      return results;
    } finally {
      pending.delete(key);
    }
  }

  /** Where one saved place is near the center: by its address, and by its name when it has no address or no place has it. */
  async function locatePlace(center: Center, place: PlaceText): Promise<PlaceMatch> {
    try {
      const address = queryText(place.address);
      if (address) {
        const match = byAddress(await search(address, center), center);
        if (match.status !== "missing") return match;
      }
      const name = queryText(place.name);
      return name ? byName(await search(name, center), center, name) : { status: "missing" };
    } catch (error) {
      if (error instanceof PlaceSearchError) return { status: "unavailable" };
      throw error;
    }
  }

  /**
   * Where each saved place is within AREA_KM of its destination's center (TRA-130), by the keys given, as far as known
   * within `waitMs`. A place is found only when exactly one place matches, and nothing is guessed. A lookup still waiting
   * its turn is `pending` and carries on, so asking again finds it.
   */
  async function locateNear(center: Center, places: Readonly<Record<string, PlaceText>>): Promise<Record<string, PlaceAnswer>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<PlaceAnswer>((resolve) => { timer = setTimeout(() => resolve({ status: "pending" }), waitMs); });
    try {
      const keys = Object.keys(places);
      const answers = await Promise.all(keys.map((key) => Promise.race([locatePlace(center, places[key]), late])));
      return Object.fromEntries(keys.map((key, index) => [key, answers[index]]));
    } finally {
      clearTimeout(timer);
    }
  }

  return { locateNear };
}

export const { locateNear } = createPlaceSearch();
