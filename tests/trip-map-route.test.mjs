import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { airportByCode, airportName } from "../src/lib/airports.ts";
import { createLocationSearch } from "../src/lib/location-search.ts";
import { createStore } from "../src/lib/store.ts";
import * as tripMap from "../src/lib/trip-map.ts";
import { newItem } from "./budget-fixtures.mjs";

// Exercise the actual handler with a real store and a stand-in for Open-Meteo, without a Next server.
const compiled = ts.transpileModule(readFileSync(new URL("../src/app/api/trip-map/[tripId]/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function route({ account, store, fetcher }) {
  const exports = {};
  const imports = {
    "@/auth": {
      currentAccount: async () => account,
      signedOutResponse: () => Response.json({ error: "Your session has ended. Sign in again to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } }),
    },
    "@/lib/location-search": { locatePlaces: createLocationSearch({ fetcher }).locatePlaces },
    "@/lib/store": { getTripSnapshot: (accountId, tripId) => store.getTripSnapshot(accountId, tripId) },
    "@/lib/trip-map": tripMap,
  };
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports);
  return (tripId) => exports.GET(new Request(`http://localhost:3000/api/trip-map/${tripId}`), { params: Promise.resolve({ tripId }) });
}

test("a trip's map finds the places of a trip the account can open, and nothing of any other trip", async (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const owner = store.authorizeAccount("owner@example.com");
  const editor = store.authorizeAccount("editor@example.com");
  const outsider = store.authorizeAccount("outsider@example.com");
  const tripId = store.applyMutation(owner.id, { type: "trip.save", ...newItem(), name: "Austria", dateLabel: "", homeCity: "Wooster, OH", travelers: 2, notes: "" }).id;
  const vienna = store.applyMutation(owner.id, { type: "stop.add", tripId, city: "Vienna" }).id;
  const leg = store.getSnapshot().legs.find((item) => item.tripId === tripId && item.toId === vienna);
  store.applyMutation(owner.id, { type: "leg.save", id: leg.id, method: "Flight", price: "", departure: "", arrival: "", url: "", notes: "", itinerary: [{ id: crypto.randomUUID(), kind: "layover", place: "Nowhere Junction", arrival: "", departure: "", notes: "" }] });
  store.applyMutation(owner.id, { type: "trip.share", tripId, email: "editor@example.com" });

  const requests = [];
  const fetcher = async (url) => {
    const name = url.searchParams.get("name");
    requests.push(name);
    const results = {
      Wooster: [{ id: 5177358, name: "Wooster", latitude: 40.8, longitude: -81.9, country_code: "US", admin1: "Ohio", country: "United States" }],
      Vienna: [{ id: 2761369, name: "Vienna", latitude: 48.2, longitude: 16.4, country_code: "AT", admin1: "State of Vienna", country: "Austria" }],
    }[name];
    return Response.json(results ? { results } : {});
  };
  for (const account of [owner, editor]) {
    const response = await route({ account, store, fetcher })(tripId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { places: {
      "Wooster, OH": { status: "found", latitude: 40.8, longitude: -81.9, label: "Wooster, Ohio, United States" },
      Vienna: { status: "found", latitude: 48.2, longitude: 16.4, label: "Vienna, State of Vienna, Austria" },
      "Nowhere Junction": { status: "missing" },
    } }, `${account.email} sees the trip's places`);
  }
  assert.deepEqual(requests.sort(), ["Nowhere Junction", "Nowhere Junction", "Vienna", "Vienna", "Wooster", "Wooster"]);

  // Someone the trip isn't shared with, and a trip that doesn't exist, look the same, and nothing is looked up.
  requests.length = 0;
  for (const id of [tripId, "ffffffff-ffff-4fff-8fff-ffffffffffff"]) {
    const missing = await route({ account: outsider, store, fetcher })(id);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.deepEqual(await missing.json(), { error: "This trip is no longer here." });
  }
  const signedOut = await route({ account: null, store, fetcher })(tripId);
  assert.equal(signedOut.status, 401);
  assert.deepEqual(requests, []);
});

test("a trip's map finds its departure, return and layovers written as airport codes at the airport, without Open-Meteo (TRA-132)", async (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const owner = store.authorizeAccount("owner@example.com");
  const tripId = store.applyMutation(owner.id, { type: "trip.save", ...newItem(), name: "Gulf", dateLabel: "", homeCity: "CLE", travelers: 2, notes: "" }).id;
  // A destination is a city, so "UAE" is never taken for Mount Aue Airport's code, nor is a stop along the way.
  const uae = store.applyMutation(owner.id, { type: "stop.add", tripId, city: "UAE" }).id;
  const leg = store.getSnapshot().legs.find((item) => item.tripId === tripId && item.toId === uae);
  const entry = (kind, place) => ({ id: crypto.randomUUID(), kind, place, arrival: "", departure: "", notes: "" });
  store.applyMutation(owner.id, { type: "leg.save", id: leg.id, method: "Flight", price: "", departure: "", arrival: "", url: "", notes: "", itinerary: [entry("layover", "PHL"), entry("stop", "OBX")] });

  const requests = [];
  const fetcher = async (url) => { requests.push(url.searchParams.get("name")); return Response.json({}); };
  const response = await route({ account: owner, store, fetcher })(tripId);
  assert.equal(response.status, 200);
  const atAirport = (code) => {
    const airport = airportByCode(code);
    return { status: "found", latitude: airport.latitude, longitude: airport.longitude, label: airportName(airport) };
  };
  assert.deepEqual(await response.json(), { places: { CLE: atAirport("CLE"), PHL: atAirport("PHL"), UAE: { status: "missing" }, OBX: { status: "missing" } } });
  assert.deepEqual(requests.sort(), ["OBX", "UAE"]);
});
