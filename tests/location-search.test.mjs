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
  for (let i = 0; i < 200; i++) await search(`City ${i}`, `client-${i}`);
  await search("Wooster");
  assert.equal(calls, 203);
});

test("distinct concurrent requests have a fixed upper bound", async () => {
  const resolvers = [];
  const search = createLocationSearch({ fetcher: async () => {
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
  const search = createLocationSearch({ now: () => clock, fetcher: async () => { calls++; return json({}); } });
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
  const search = createLocationSearch({ now: () => clock, fetcher: async () => { calls++; return json({}); } });
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
  const search = createLocationSearch({ now: () => clock, fetcher: async () => { calls++; return json({}); } });
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
  const search = createLocationSearch({ now: () => clock, fetcher: async () => {
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
  const search = createLocationSearch({ fetcher: async () => {
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
  const search = createLocationSearch({ fetcher: async () => {
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
  const search = createLocationSearch({ now: () => clock, fetcher: async (url) => {
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
