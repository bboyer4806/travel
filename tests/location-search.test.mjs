import assert from "node:assert/strict";
import test from "node:test";
import { createLocationSearch, LocationSearchError } from "../src/lib/location-search.ts";

const wooster = { id: 5177358, name: "Wooster", admin1: "Ohio", country: "United States" };
const json = (data, status = 200) => Response.json(data, { status });
const hasStatus = (status) => (error) => error instanceof LocationSearchError && error.status === status;

test("city lookup encodes qualifiers and normalizes, deduplicates, and bounds suggestions", async () => {
  let requestUrl;
  const search = createLocationSearch({ fetcher: async (url, options) => {
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
  const search = createLocationSearch({ fetcher: async () => { calls++; return json({ generationtime_ms: 0.2 }); } });
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
    const search = createLocationSearch({ fetcher: async () => response.clone() });
    await assert.rejects(search("Wooster"), hasStatus(status));
  }
  let calls = 0;
  const search = createLocationSearch({ fetcher: async () => {
    if (++calls === 1) throw new Error("Private upstream details");
    return json({ results: [wooster] });
  } });
  await assert.rejects(search("Wooster"), (error) => hasStatus(502)(error) && !error.message.includes("Private"));
  assert.equal((await search("Wooster"))[0].name, "Wooster");
});

test("lookup aborts slow requests and releases the pending entry", async () => {
  let calls = 0;
  const search = createLocationSearch({ timeoutMs: 5, fetcher: async (_url, { signal }) => {
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
  const search = createLocationSearch({ now: () => clock, fetcher: async () => {
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
  for (let i = 0; i < 200; i++) await search(`City ${i}`);
  await search("Wooster");
  assert.equal(calls, 203);
});

test("distinct concurrent requests have a fixed upper bound", async () => {
  const resolvers = [];
  const search = createLocationSearch({ fetcher: async () => {
    if (resolvers.length < 8) await new Promise((resolve) => resolvers.push(resolve));
    return json({ results: [] });
  } });
  const requests = Array.from({ length: 8 }, (_, i) => search(`City ${i}`));
  await assert.rejects(search("Another city"), hasStatus(503));
  resolvers.forEach((resolve) => resolve());
  await Promise.all(requests);
  assert.deepEqual(await search("Another city"), []);
});

test("country code metadata leaves full labels and distinct regions intact", async () => {
  const search = createLocationSearch({ fetcher: async () => json({ results: [
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
