import assert from "node:assert/strict";
import test from "node:test";
import { createLocationSearch, LocationSearchError } from "../src/lib/location-search.ts";

const wooster = { id: 5177358, name: "Wooster", admin1: "Ohio", country: "United States" };
const json = (data, status = 200) => Response.json(data, { status });
const hasStatus = (status) => (error) => error instanceof LocationSearchError && error.status === status;

test("city lookup encodes qualifiers and normalizes, deduplicates, and bounds suggestions", async () => {
  let requestUrl;
  const { searchLocations: search } = createLocationSearch({ fetcher: async (url, options) => {
    requestUrl = url;
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    return json({ results: [
      { ...wooster, name: "  Wooster  " },
      { ...wooster, id: 1 },
      { ...wooster, name: "Same ID" },
      { id: 2, name: "Berlin", admin1: "Berlin", country: "Germany" },
      { id: 3, name: "A".repeat(110), admin1: "A long region", country: "A long country" },
      null, { id: "bad", name: "Bad city" }, { id: 4, name: "" }, { id: 5, name: "No country" },
      ...Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, name: `City ${i}`, country_code: "US" })),
    ] });
  } });
  const locations = await search("  Wooster,   OH  ");
  assert.equal(requestUrl.origin, "https://geocoding-api.open-meteo.com");
  assert.equal(requestUrl.pathname, "/v1/search");
  assert.equal(requestUrl.searchParams.get("name"), "Wooster, OH");
  assert.equal(requestUrl.searchParams.get("count"), "8");
  assert.equal(locations.length, 8);
  assert.deepEqual(locations[0], { id: "5177358", name: "Wooster", region: "Ohio", country: "United States", label: "Wooster, Ohio, United States" });
  assert.equal(locations[1].label, "Berlin, Germany");
  assert.ok(locations.every(({ label }) => label.length <= 120));
  assert.equal(locations[3].country, "US");
});

test("short or invalid queries never call the provider; empty results are valid", async () => {
  let calls = 0;
  const { searchLocations: search } = createLocationSearch({ fetcher: async () => { calls++; return json({ generationtime_ms: 0.2 }); } });
  for (const query of [null, "", " ", "a"]) assert.deepEqual(await search(query), []);
  await assert.rejects(search("a".repeat(121)), hasStatus(400));
  await assert.rejects(search("bad\u0000city"), hasStatus(400));
  assert.equal(calls, 0);
  assert.deepEqual(await search("Not a known place"), []);
  assert.equal(calls, 1);
});

test("lookup failures stay distinct from no matches and are not cached", async () => {
  for (const response of [json(null), json([]), json({ results: "bad" }), json({ error: true }), new Response("not json"), json({}, 500), json({}, 429)]) {
    const status = response.status === 429 ? 503 : 502;
    const { searchLocations: search } = createLocationSearch({ fetcher: async () => response.clone() });
    await assert.rejects(search("Wooster"), hasStatus(status));
  }
  let calls = 0;
  const { searchLocations: search } = createLocationSearch({ fetcher: async () => {
    if (++calls === 1) throw new Error("Private upstream details");
    return json({ results: [wooster] });
  } });
  await assert.rejects(search("Wooster"), (error) => hasStatus(502)(error) && !error.message.includes("Private"));
  assert.equal((await search("Wooster"))[0].name, "Wooster");
});

test("lookup aborts slow requests and releases the pending entry", async () => {
  let calls = 0;
  const { searchLocations: search } = createLocationSearch({ timeoutMs: 5, fetcher: async (_url, { signal }) => {
    if (++calls > 1) return json({ results: [wooster] });
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }));
  } });
  await assert.rejects(search("Wooster"), hasStatus(504));
  assert.equal((await search("Wooster"))[0].name, "Wooster");
});

test("matching lookups share in-flight work and expire their bounded cache", async () => {
  let clock = 0;
  let calls = 0;
  let resolve;
  const { searchLocations: search } = createLocationSearch({ now: () => clock, fetcher: async () => {
    calls++;
    if (calls === 1) await new Promise((done) => { resolve = done; });
    return json({ results: [wooster] });
  } });
  const first = search("Wooster");
  const second = search(" wooster ");
  assert.equal(calls, 1);
  resolve();
  assert.deepEqual(await first, await second);
  await search("WOOSTER");
  assert.equal(calls, 1);
  clock = 10 * 60 * 1000;
  await search("Wooster");
  assert.equal(calls, 2);
  for (let i = 0; i < 200; i++) await search(`City ${i}`, `client-${i}`);
  await search("Wooster");
  assert.equal(calls, 203);
});

test("distinct concurrent requests have a fixed upper bound", async () => {
  const resolvers = [];
  const { searchLocations: search } = createLocationSearch({ fetcher: async () => {
    if (resolvers.length < 8) await new Promise((resolve) => resolvers.push(resolve));
    return json({ results: [] });
  } });
  const requests = Array.from({ length: 8 }, (_, i) => search(`City ${i}`, `client-${i}`));
  await assert.rejects(search("Another city"), hasStatus(503));
  resolvers.forEach((resolve) => resolve());
  await Promise.all(requests);
  assert.deepEqual(await search("Another city"), []);
});

test("rolling global minute budget survives client changes and recovers only expired capacity", async () => {
  let clock = 0;
  let calls = 0;
  const { searchLocations: search } = createLocationSearch({ now: () => clock, fetcher: async () => { calls++; return json({}); } });
  for (let i = 0; i < 150; i++) await search(`First city ${i}`, `first-${i}`);
  clock = 30_000;
  for (let i = 0; i < 150; i++) await search(`Second city ${i}`, `second-${i}`);
  for (const client of ["old-client", "new-cookie", "another-cookie"]) {
    await assert.rejects(search("Blocked city", client), hasStatus(503));
  }
  assert.equal(calls, 300);
  clock = 59_999;
  await assert.rejects(search("Still blocked", "fresh"), hasStatus(503));
  clock = 60_000;
  for (let i = 0; i < 150; i++) await search(`Recovered city ${i}`, `recovered-${i}`);
  await assert.rejects(search("No more capacity", "fresh"), hasStatus(503));
  assert.equal(calls, 450);
  clock = 90_000;
  await search("Next window", "fresh");
  assert.equal(calls, 451);
});

test("rolling hour budget rejects at 2500 attempts and restores expired capacity", async () => {
  let clock = 0;
  let calls = 0;
  const { searchLocations: search } = createLocationSearch({ now: () => clock, fetcher: async () => { calls++; return json({}); } });
  for (let batch = 0; batch < 25; batch++) {
    clock = batch * 60_000;
    for (let i = 0; i < 100; i++) await search(`City ${batch}-${i}`, `client-${i}`);
  }
  clock = 60 * 60_000 - 1;
  await assert.rejects(search("Hour exhausted", "fresh"), hasStatus(503));
  assert.equal(calls, 2500);
  clock++;
  for (let i = 0; i < 100; i++) await search(`Recovered city ${i}`, `client-${i}`);
  await assert.rejects(search("Hour still full", "fresh"), hasStatus(503));
  assert.equal(calls, 2600);
});

test("rolling daily budget rejects at 8000 attempts and recovers at the day boundary", async () => {
  let clock = 0;
  let calls = 0;
  const { searchLocations: search } = createLocationSearch({ now: () => clock, fetcher: async () => { calls++; return json({}); } });
  for (let batch = 0; batch < 40; batch++) {
    clock = batch * 6 * 60_000;
    for (let i = 0; i < 200; i++) await search(`City ${batch}-${i}`, `client-${i}`);
  }
  clock = 24 * 60 * 60_000 - 1;
  await assert.rejects(search("Day exhausted", "fresh"), hasStatus(503));
  assert.equal(calls, 8000);
  clock++;
  for (let i = 0; i < 200; i++) await search(`Recovered city ${i}`, `client-${i}`);
  await assert.rejects(search("Day still full", "fresh"), hasStatus(503));
  assert.equal(calls, 8200);
});

test("client minute accounting includes failures, excludes cached and rejected requests, and expires", async () => {
  let clock = 0;
  let calls = 0;
  const { searchLocations: search } = createLocationSearch({ now: () => clock, fetcher: async () => {
    calls++;
    if (calls === 1) throw new Error("Unavailable");
    return json({ results: [wooster] });
  } });
  await assert.rejects(search("Failure", "busy-client"), hasStatus(502));
  for (let i = 0; i < 19; i++) await search(`City ${i}`, "busy-client");
  for (let i = 0; i < 5; i++) {
    await search("City 0", "busy-client");
    await assert.rejects(search("Not cached", "busy-client"), hasStatus(503));
  }
  assert.equal(calls, 20);
  await search("Other person's city", "other-client");
  assert.equal(calls, 21);
  clock = 59_999;
  await assert.rejects(search("Not cached", "busy-client"), hasStatus(503));
  clock++;
  for (let i = 0; i < 20; i++) await search(`Fresh city ${i}`, "busy-client");
  assert.equal(calls, 41);
  await assert.rejects(search("One too many", "busy-client"), hasStatus(503));
});

test("one client is limited to two concurrent lookups while other clients retain capacity", async () => {
  const resolvers = [];
  let calls = 0;
  const { searchLocations: search } = createLocationSearch({ fetcher: async () => {
    calls++;
    await new Promise((resolve) => resolvers.push(resolve));
    return json({});
  } });
  const first = search("First city", "busy-client");
  const shared = search(" FIRST   CITY ", "busy-client");
  const second = search("Second city", "busy-client");
  await assert.rejects(search("Third city", "busy-client"), hasStatus(503));
  assert.equal(calls, 2);
  const other = Array.from({ length: 6 }, (_, i) => search(`Other city ${i}`, `client-${Math.floor(i / 2)}`));
  await assert.rejects(search("Global full", "fresh"), hasStatus(503));
  assert.equal(calls, 8);
  resolvers.forEach((resolve) => resolve());
  await Promise.all([first, shared, second, ...other]);
  const next = search("Third city", "busy-client");
  assert.equal(calls, 9);
  resolvers.at(-1)();
  await next;
});

test("shared requests consume only the originating client's quota", async () => {
  let release;
  let calls = 0;
  const { searchLocations: search } = createLocationSearch({ fetcher: async () => {
    calls++;
    if (calls === 1) await new Promise((resolve) => { release = resolve; });
    return json({});
  } });
  const requests = [search("Shared city", "origin"), ...Array.from({ length: 25 }, () => search("Shared city", "joining"))];
  release();
  await Promise.all(requests);
  for (let i = 0; i < 20; i++) await search(`Joining city ${i}`, "joining");
  await assert.rejects(search("Joining full", "joining"), hasStatus(503));
  for (let i = 0; i < 19; i++) await search(`Origin city ${i}`, "origin");
  await assert.rejects(search("Origin full", "origin"), hasStatus(503));
  assert.equal(calls, 40);
});

test("upstream 429 pauses all new lookups for 60 seconds while cache and shared work remain available", async () => {
  let clock = 0;
  let calls = 0;
  let release;
  const { searchLocations: search } = createLocationSearch({ now: () => clock, fetcher: async (url) => {
    calls++;
    if (url.searchParams.get("name") === "Pending city") await new Promise((resolve) => { release = resolve; });
    if (url.searchParams.get("name") === "Rate limited") return json({}, 429);
    return json({ results: [wooster] });
  } });
  await search("Cached city", "cache-client");
  const pending = search("Pending city", "pending-client");
  clock = 10_000;
  await assert.rejects(search("Rate limited", "first"), hasStatus(503));
  for (let i = 0; i < 30; i++) await assert.rejects(search(`Blocked city ${i}`, `client-${i}`), hasStatus(503));
  const shared = search("Pending city", "joining-client");
  assert.deepEqual((await search("Cached city", "first"))[0].name, "Wooster");
  assert.equal(calls, 3);
  release();
  assert.deepEqual(await pending, await shared);
  clock = 69_999;
  await assert.rejects(search("Blocked until expiry", "first"), hasStatus(503));
  clock++;
  await search("Recovered city", "first");
  assert.equal(calls, 4);
});

test("country code metadata leaves full labels and distinct regions intact", async () => {
  const { searchLocations: search } = createLocationSearch({ fetcher: async () => json({ results: [
    { id: 201, name: "Springfield", admin1: "Illinois", country: "United States", country_code: " us " },
    { id: 202, name: "Springfield", admin1: "Massachusetts", country: "United States", country_code: "US" },
    { id: 203, name: "Paris", admin1: "Ile-de-France", country: "France", country_code: "FR" },
    { id: 204, name: "Paris", admin1: "Texas", country: "United States", country_code: "US" },
    { id: 205, name: "Missing metadata", admin1: "Region", country: "France" },
    { id: 206, name: "Invalid metadata", admin1: "Region", country: "France", country_code: "not a country code" },
    { id: 207, name: "New York", admin1: "New York", country: "United States", country_code: "US" },
    { id: 208, name: "Washington", admin1: "Washington", country: "United States" },
  ] }) });
  const locations = await search("Sample cities");
  assert.equal(locations.length, 8);
  assert.equal(locations[0].countryCode, "US");
  assert.equal(locations[0].label, "Springfield, Illinois, United States");
  assert.equal(locations[1].label, "Springfield, Massachusetts, United States");
  assert.equal(locations[2].countryCode, "FR");
  assert.equal(locations[2].label, "Paris, Ile-de-France, France");
  assert.equal(locations[3].label, "Paris, Texas, United States");
  assert.equal(locations[4].countryCode, undefined);
  assert.equal(locations[5].countryCode, undefined);
  assert.equal(locations[6].label, "New York, New York, United States");
  assert.equal(locations[7].label, "Washington, Washington, United States");
});

// Places a trip's map looks up (TRA-44), as Open-Meteo answers for each name.
const places = {
  Wooster: [
    { id: 4134999, name: "Wooster", latitude: 35.2, longitude: -92.45, country_code: "US", admin1: "Arkansas", admin2: "Faulkner", country: "United States" },
    { id: 5177358, name: "Wooster", latitude: 40.80517, longitude: -81.93646, country_code: "US", admin1: "Ohio", admin2: "Wayne", country: "United States" },
  ],
  Vienna: [
    { id: 2761369, name: "Vienna", latitude: 48.20849, longitude: 16.37208, country_code: "AT", admin1: "State of Vienna", country: "Austria" },
    { id: 4791259, name: "Vienna", latitude: 38.90122, longitude: -77.26526, country_code: "US", admin1: "Virginia", admin2: "Fairfax", country: "United States" },
  ],
  Frankfurt: [
    { id: 2925531, name: "Frankfurter Tor", latitude: 52.5158, longitude: 13.4537, country_code: "DE", admin1: "State of Berlin", country: "Germany" },
    { id: 2925533, name: "Frankfurt am Main", latitude: 50.11552, longitude: 8.68417, country_code: "DE", admin1: "Hesse", admin2: "Regierungsbezirk Darmstadt", country: "Germany" },
  ],
  London: [
    { id: 2643743, name: "London", latitude: 51.50853, longitude: -0.12574, country_code: "GB", admin1: "England", country: "United Kingdom" },
    { id: 6058560, name: "London", latitude: 42.98339, longitude: -81.23304, country_code: "CA", admin1: "Ontario", country: "Canada" },
  ],
  zurich: [{ id: 2657896, name: "Zürich", latitude: 47.36667, longitude: 8.55, country_code: "CH", admin1: "Zurich", country: "Switzerland" }],
  Pari: [{ id: 2988507, name: "Paris", latitude: 48.85341, longitude: 2.3488, country_code: "FR", admin1: "Île-de-France", country: "France" }],
  Broken: [{ id: 1, name: "Broken", latitude: "north", longitude: 5, country: "Nowhere" }, { id: 2, name: "Broken", latitude: 91, longitude: 5, country: "Nowhere" }],
};
const placeFetcher = (requests = []) => async (url) => {
  requests.push(url);
  return json({ results: places[url.searchParams.get("name")] });
};
const at = (result) => ({ status: "found", latitude: result.latitude, longitude: result.longitude, label: [result.name, result.admin1, result.country].join(", ") });

test("map lookups search a place's name and choose by the region or country written after it", async () => {
  const requests = [];
  const { locatePlaces } = createLocationSearch({ fetcher: placeFetcher(requests) });
  const located = await locatePlaces([
    "Wooster, OH", "Wooster, Ohio, United States", "Wooster", "Wooster, Texas",
    "Vienna, Virginia", "Vienna, State of Vienna, Austria", "Vienna, AT", "Vienna",
    "Frankfurt (FRA)", "Frankfurt (FRA), Germany", "London, UK", "London, Ontario", "zurich, CH", "Pari", "Broken",
  ]);
  const [arkansas, ohio] = places.Wooster;
  const [austria, virginia] = places.Vienna;
  assert.deepEqual(located, {
    "Wooster, OH": at(ohio),
    "Wooster, Ohio, United States": at(ohio),
    // Without a region or country, the first place Open-Meteo has by the name.
    Wooster: at(arkansas),
    "Wooster, Texas": { status: "missing" },
    "Vienna, Virginia": at(virginia),
    // A suggestion's label names its region and country.
    "Vienna, State of Vienna, Austria": at(austria),
    "Vienna, AT": at(austria),
    Vienna: at(austria),
    // An airport code in parentheses is left out, and the name may be the start of the place's, as whole words.
    "Frankfurt (FRA)": at(places.Frankfurt[1]),
    "Frankfurt (FRA), Germany": at(places.Frankfurt[1]),
    "London, UK": at(places.London[0]),
    "London, Ontario": at(places.London[1]),
    // Letter case and accents don't matter.
    "zurich, CH": at(places.zurich[0]),
    // Part of a word is not a name, and a place without a position is never shown.
    Pari: { status: "missing" },
    Broken: { status: "missing" },
  });
  // Each name is looked up once, with more results than suggestions, and only the name is sent.
  assert.deepEqual(requests.map((url) => [url.searchParams.get("name"), url.searchParams.get("count")]).sort(), [
    ["Broken", "20"], ["Frankfurt", "20"], ["London", "20"], ["Pari", "20"], ["Vienna", "20"], ["Wooster", "20"], ["zurich", "20"],
  ]);
});

test("a place without a name to search is missing without a lookup", async () => {
  let calls = 0;
  const { locatePlaces } = createLocationSearch({ fetcher: async () => { calls++; return json({}); } });
  assert.deepEqual(await locatePlaces(["A", "(FRA)", ", Ohio", "Line\nbreak", "x".repeat(121)]), {
    A: { status: "missing" }, "(FRA)": { status: "missing" }, ", Ohio": { status: "missing" }, "Line\nbreak": { status: "missing" }, ["x".repeat(121)]: { status: "missing" },
  });
  assert.deepEqual(await locatePlaces([]), {});
  assert.equal(calls, 0);
});

test("map lookups are kept for a day, and a failed lookup stops the rest without hiding what is known", async () => {
  let clock = 0;
  let failing = false;
  const requests = [];
  const { locatePlaces } = createLocationSearch({ now: () => clock, fetcher: async (url) => {
    requests.push(url.searchParams.get("name"));
    return failing ? json({}, 500) : placeFetcher()(url);
  } });
  await locatePlaces(["Wooster, OH"]);
  clock = 24 * 60 * 60 * 1000 - 1;
  failing = true;
  const located = await locatePlaces(["Wooster, OH", "Vienna", "London", "Frankfurt", "zurich"]);
  assert.deepEqual(located["Wooster, OH"], at(places.Wooster[1]), "a kept lookup still answers");
  assert.deepEqual(["Vienna", "London", "Frankfurt", "zurich"].map((name) => located[name].status), ["unavailable", "unavailable", "unavailable", "unavailable"]);
  assert.ok(requests.length <= 1 + 3, "only the lookups already started when the first failed are made");
  // A failure isn't kept, and a kept lookup expires after a day.
  failing = false;
  clock++;
  requests.length = 0;
  assert.deepEqual((await locatePlaces(["Vienna", "Wooster, OH"])).Vienna.status, "found");
  assert.deepEqual(requests.sort(), ["Vienna", "Wooster"]);
});

test("map lookups share the provider's limits with suggestions, without a client's", async () => {
  let clock = 0;
  let calls = 0;
  let limited = false;
  const { searchLocations, locatePlaces } = createLocationSearch({ now: () => clock, fetcher: async (url) => {
    calls++;
    return limited ? json({}, 429) : json({ results: [{ id: calls, name: url.searchParams.get("name"), latitude: 1, longitude: 2, country: "Somewhere" }] });
  } });
  // One map looks up more names than a client may search in a minute.
  const names = Array.from({ length: 25 }, (_, i) => `Town ${i}`);
  assert.ok(Object.values(await locatePlaces(names)).every((place) => place.status === "found"));
  assert.equal(calls, 25);
  for (let i = 0; i < 275; i++) await searchLocations(`City ${i}`, `client-${i}`);
  assert.equal(calls, 300);
  assert.deepEqual(await locatePlaces(["Over budget"]), { "Over budget": { status: "unavailable" } }, "the minute's shared budget is spent");
  await assert.rejects(searchLocations("Also over", "fresh"), hasStatus(503));
  clock = 60_000;
  limited = true;
  assert.deepEqual(await locatePlaces(["Rate limited"]), { "Rate limited": { status: "unavailable" } });
  limited = false;
  await assert.rejects(searchLocations("Paused", "fresh"), hasStatus(503), "Open-Meteo's 429 pauses suggestions too");
  assert.deepEqual(await locatePlaces(["Still paused"]), { "Still paused": { status: "unavailable" } });
  clock = 120_000;
  assert.equal((await locatePlaces(["Recovered"])).Recovered.status, "found");
});

test("a map looks up a few names at a time and shares lookups already under way", async () => {
  let running = 0, most = 0, calls = 0;
  const releases = [];
  const { locatePlaces } = createLocationSearch({ fetcher: async (url) => {
    calls++;
    running++;
    most = Math.max(most, running);
    await new Promise((resolve) => releases.push(resolve));
    running--;
    return json({ results: [{ id: calls, name: url.searchParams.get("name"), latitude: 1, longitude: 2, country: "Somewhere" }] });
  } });
  const first = locatePlaces(["One", "Two", "Three", "Four", "Five"]);
  const second = locatePlaces(["One"]);
  while (calls < 5 || releases.length) {
    await new Promise((resolve) => setImmediate(resolve));
    releases.shift()?.();
  }
  const [many, one] = await Promise.all([first, second]);
  assert.equal(most, 3);
  assert.equal(calls, 5, "the second map waits for the first map's lookup of the same name");
  assert.deepEqual(one.One, many.One);
});
