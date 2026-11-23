import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as destinationMap from "../src/lib/destination-map.ts";
import { createLocationSearch } from "../src/lib/location-search.ts";
import { createPlaceSearch } from "../src/lib/place-search.ts";
import { createStore } from "../src/lib/store.ts";
import { candidateInput, newItem } from "./budget-fixtures.mjs";

// Exercise the actual handler with a real store and stand-ins for Open-Meteo and Nominatim, without a Next server (TRA-130).
const compiled = ts.transpileModule(readFileSync(new URL("../src/app/api/destination-map/[destinationId]/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function route({ account, store, fetcher }) {
  const exports = {};
  const imports = {
    "@/auth": {
      currentAccount: async () => account,
      signedOutResponse: () => Response.json({ error: "Your session has ended. Sign in again to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } }),
    },
    "@/lib/destination-map": destinationMap,
    "@/lib/location-search": { locatePlaces: createLocationSearch({ fetcher }).locatePlaces },
    "@/lib/place-search": { locateNear: createPlaceSearch({ fetcher, sleep: async () => {} }).locateNear },
    "@/lib/store": { getDestinationSnapshot: (accountId, destinationId) => store.getDestinationSnapshot(accountId, destinationId) },
  };
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports);
  return (destinationId) => exports.GET(new Request(`http://localhost:3000/api/destination-map/${destinationId}`), { params: Promise.resolve({ destinationId }) });
}

const churchInput = (destinationId, overrides) => ({ type: "church.save", destinationId, address: "", denomination: "", url: "", massTimes: [], ...overrides, ...newItem(overrides) });
/** A stand-in for both providers: Open-Meteo answers by city, and Nominatim by search, as `places` says. */
function providers(places) {
  const requests = [];
  const fetcher = async (url) => {
    if (url.hostname === "geocoding-api.open-meteo.com") {
      const name = url.searchParams.get("name");
      requests.push("city: " + name);
      return Response.json(name === "Vienna" ? { results: [{ id: 2761369, name: "Vienna", latitude: 48.20849, longitude: 16.37208, country_code: "AT", admin1: "Vienna", country: "Austria" }] } : {});
    }
    assert.equal(url.hostname, "nominatim.openstreetmap.org");
    const q = url.searchParams.get("q");
    requests.push("place: " + q);
    return Response.json(places[q] ?? []);
  };
  return { fetcher, requests };
}
const poi = (name, lat, lon, extra = {}) => ({ lat: String(lat), lon: String(lon), category: "tourism", type: "attraction", place_rank: 30, name, display_name: name + ", Vienna, Austria", namedetails: { name }, ...extra });

test("a destination's map finds the saved places of a destination the account can open, keyed by their IDs, and nothing of any other", async (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const owner = store.authorizeAccount("owner@example.com");
  const editor = store.authorizeAccount("editor@example.com");
  const outsider = store.authorizeAccount("outsider@example.com");
  const tripId = store.applyMutation(owner.id, { type: "trip.save", ...newItem(), name: "Austria", dateLabel: "", homeCity: "Wooster, OH", travelers: 2, notes: "" }).id;
  const stopId = store.applyMutation(owner.id, { type: "stop.add", tripId, city: "Vienna" }).id;
  const destinationId = store.getSnapshot().stops.find((stop) => stop.id === stopId).destinationId;
  const add = (input) => store.applyMutation(owner.id, input).id;
  const hotel = add(candidateInput(destinationId, "hotels", { name: "Hotel Sacher", address: "Philharmonikerstraße 4, Wien", included: false }));
  const museum = add(candidateInput(destinationId, "activities", { name: "Albertina" }));
  const schnitzel = add(candidateInput(destinationId, "restaurants", { name: "Figlmüller" }));
  const church = add(churchInput(destinationId, { name: "St. Stephen's Cathedral", address: "Stephansplatz 3, Wien" }));
  store.applyMutation(owner.id, { type: "trip.share", tripId, email: "editor@example.com" });

  const { fetcher, requests } = providers({
    "Philharmonikerstraße 4, Wien": [poi("Hotel Sacher", 48.20406, 16.36949, { display_name: "Hotel Sacher, 4, Philharmonikerstraße, Vienna, Austria" })],
    "Albertina": [poi("Albertina", 48.20462, 16.36818)],
    "Figlmüller": [poi("Figlmüller", 48.20918, 16.37466, { category: "amenity" }), poi("Figlmüller", 48.20835, 16.37630, { category: "amenity" })],
    "Stephansplatz 3, Wien": [poi("St. Stephen's Cathedral", 48.20857, 16.37307, { category: "amenity", display_name: "St. Stephen's Cathedral, 3, Stephansplatz, Vienna, Austria" })],
  });
  const key = (place) => destinationMap.placeKey("Vienna", place);
  const expected = {
    area: "found",
    places: {
      [hotel]: { key: key({ name: "Hotel Sacher", address: "Philharmonikerstraße 4, Wien" }), status: "found", latitude: 48.20406, longitude: 16.36949, label: "Hotel Sacher, 4, Philharmonikerstraße, Vienna, Austria" },
      [museum]: { key: key({ name: "Albertina", address: "" }), status: "found", latitude: 48.20462, longitude: 16.36818, label: "Albertina, Vienna, Austria" },
      [schnitzel]: { key: key({ name: "Figlmüller", address: "" }), status: "ambiguous" },
      [church]: { key: key({ name: "St. Stephen's Cathedral", address: "Stephansplatz 3, Wien" }), status: "found", latitude: 48.20857, longitude: 16.37307, label: "St. Stephen's Cathedral, 3, Stephansplatz, Vienna, Austria" },
    },
  };
  for (const account of [owner, editor]) {
    const response = await route({ account, store, fetcher })(destinationId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), expected, `${account.email} sees the destination's places`);
  }
  // Each route here has its own providers' cache, as a fresh server would.
  assert.deepEqual(requests.filter((request) => request.startsWith("place: ")).sort(), ["Albertina", "Albertina", "Figlmüller", "Figlmüller", "Philharmonikerstraße 4, Wien", "Philharmonikerstraße 4, Wien", "Stephansplatz 3, Wien", "Stephansplatz 3, Wien"].map((q) => "place: " + q));

  // Someone the trip isn't shared with, and a destination that doesn't exist, look the same, and nothing is looked up.
  requests.length = 0;
  for (const id of [destinationId, "ffffffff-ffff-4fff-8fff-ffffffffffff"]) {
    const missing = await route({ account: outsider, store, fetcher })(id);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.deepEqual(await missing.json(), { error: "This destination is no longer here." });
  }
  const signedOut = await route({ account: null, store, fetcher })(destinationId);
  assert.equal(signedOut.status, 401);
  assert.deepEqual(requests, []);
  // Once the trip is no longer shared, its destination isn't the editor's to map either.
  store.applyMutation(owner.id, { type: "trip.unshare", tripId, email: "editor@example.com" });
  assert.equal((await route({ account: editor, store, fetcher })(destinationId)).status, 404);
  assert.deepEqual(requests, []);
});

test("a destination's own map in Destinations needs no trip, and a destination that can't be found has none of its places looked up", async (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const owner = store.authorizeAccount("owner@example.com");
  const vienna = store.applyMutation(owner.id, { type: "destination.create", city: "Vienna" }).id;
  const atlantis = store.applyMutation(owner.id, { type: "destination.create", city: "Atlantis" }).id;
  const museum = store.applyMutation(owner.id, candidateInput(vienna, "activities", { name: "Albertina" })).id;
  const temple = store.applyMutation(owner.id, candidateInput(atlantis, "activities", { name: "Temple of Poseidon" })).id;
  const { fetcher, requests } = providers({ "Albertina": [poi("Albertina", 48.20462, 16.36818)] });
  const map = route({ account: owner, store, fetcher });
  assert.deepEqual((await (await map(vienna)).json()).places[museum].status, "found");
  assert.deepEqual(await (await map(atlantis)).json(), { area: "missing", places: { [temple]: { key: destinationMap.placeKey("Atlantis", { name: "Temple of Poseidon", address: "" }), status: "missing" } } });
  assert.deepEqual(requests, ["city: Vienna", "place: Albertina", "city: Atlantis"]);

  // When Open-Meteo can't answer, neither can the map, until a later try.
  const failing = route({ account: owner, store, fetcher: async () => { throw new Error("Offline"); } });
  assert.deepEqual(await (await failing(vienna)).json(), { area: "unavailable", places: { [museum]: { key: destinationMap.placeKey("Vienna", { name: "Albertina", address: "" }), status: "unavailable" } } });
});

test("a place with coordinates is looked up by its address alone and shows where it is found, one without an address isn't looked up, and coordinates waiting for review are looked up as none (TRA-163)", async (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const owner = store.authorizeAccount("owner@example.com");
  const vienna = store.applyMutation(owner.id, { type: "destination.create", city: "Vienna" }).id;
  const add = (input) => store.applyMutation(owner.id, input).id;
  const SACHER = { latitude: 48.20406, longitude: 16.36949, accuracy: "exact" };
  const sacher = add(candidateInput(vienna, "hotels", { name: "Hotel Sacher", address: "Philharmonikerstraße 4", included: false, coordinates: SACHER }));
  const rental = add(candidateInput(vienna, "hotels", { name: "Leopoldstadt apartment", address: "Address withheld", coordinates: { latitude: 48.2167, longitude: 16.3958, accuracy: "approximate" } }));
  const abbey = add(candidateInput(vienna, "activities", { name: "Melk Abbey", address: "Abt-Berthold-Dietmayr-Straße 1, Melk", coordinates: { latitude: 48.22842, longitude: 15.33437, accuracy: "exact" } }));
  const museum = add(candidateInput(vienna, "activities", { name: "Albertina" }));
  const village = add(candidateInput(vienna, "activities", { name: "Dürnstein", coordinates: { latitude: 48.39538, longitude: 15.52014, accuracy: "approximate" } }));
  const cathedral = add(churchInput(vienna, { name: "St. Stephen's Cathedral", address: "Stephansplatz 3", coordinates: { latitude: 48.20857, longitude: 16.37307, accuracy: "exact" } }));
  const chapel = add(churchInput(vienna, { name: "Peterskirche", address: "Petersplatz", coordinates: { latitude: 48.20944, longitude: 16.36985, accuracy: "exact" } }));
  // The churches' new addresses leave their coordinates waiting for review, so they are looked up as places without any.
  store.applyMutation(owner.id, churchInput(vienna, { id: cathedral, name: "St. Stephen's Cathedral", address: "Stephansplatz 3, Wien" }));
  store.applyMutation(owner.id, churchInput(vienna, { id: chapel, name: "Peterskirche", address: "Petersplatz 1, Wien" }));
  const { fetcher, requests } = providers({
    "Philharmonikerstraße 4": [poi("Hotel Sacher", 48.20409, 16.36952, { display_name: "Hotel Sacher, 4, Philharmonikerstraße, Vienna, Austria" })],
    "Albertina": [poi("Albertina", 48.20462, 16.36818)],
    "Stephansplatz 3, Wien": [poi("St. Stephen's Cathedral", 48.20857, 16.37307, { category: "amenity" })],
    "Peterskirche": [poi("Peterskirche", 48.20944, 16.36985, { category: "amenity" })],
    // Nominatim would find these too, by name, but places with coordinates to show them at are never looked up by name.
    "Leopoldstadt apartment": [poi("Leopoldstadt apartment", 48.21, 16.39)],
    "Melk Abbey": [poi("Melk Abbey", 48.2, 16.4)],
  });
  const answer = await (await route({ account: owner, store, fetcher })(vienna)).json();
  const places = destinationMap.destinationPlaces(store.getDestinationSnapshot(owner.id, vienna).data, vienna);
  assert.deepEqual(Object.keys(answer.places).sort(), [sacher, rental, abbey, museum, cathedral, chapel].sort());
  assert.equal(answer.places[village], undefined, "no answer for Dürnstein, which has coordinates and no address");
  for (const place of places.filter((item) => item.id in answer.places)) assert.equal(answer.places[place.id].key, destinationMap.placeKey("Vienna", place), "keyed as the map keys " + place.name);
  assert.deepEqual(Object.fromEntries(Object.entries(answer.places).map(([id, { status }]) => [id, status])), {
    [sacher]: "found", [rental]: "missing", [abbey]: "missing", [museum]: "found", [cathedral]: "found", [chapel]: "found",
  });
  assert.deepEqual(requests.toSorted(), ["city: Vienna", "place: Abt-Berthold-Dietmayr-Straße 1, Melk", "place: Address withheld", "place: Albertina", "place: Peterskirche", "place: Petersplatz 1, Wien", "place: Philharmonikerstraße 4", "place: Stephansplatz 3, Wien"],
    "Nominatim is asked for the rental's and the abbey's addresses, never their names, and nothing about Dürnstein");
  // The hotel shows where its address was found, the rental and the abbey, whose addresses weren't, at their coordinates,
  // and Dürnstein at its coordinates without a lookup.
  const layout = destinationMap.destinationMapLayout(places, answer.places, destinationMap.MAP_CATEGORIES);
  assert.deepEqual(layout.markers.map((marker) => [marker.position, marker.places.map((place) => place.name)]), [
    [[48.20409, 16.36952], ["Hotel Sacher"]],
    [[48.2167, 16.3958], ["Leopoldstadt apartment"]],
    [[48.22842, 15.33437], ["Melk Abbey"]],
    [[48.20462, 16.36818], ["Albertina"]],
    [[48.39538, 15.52014], ["Dürnstein"]],
    [[48.20944, 16.36985], ["Peterskirche"]],
    [[48.20857, 16.37307], ["St. Stephen's Cathedral"]],
  ]);
  assert.deepEqual(layout.unmapped, []);
  // Finding the hotel elsewhere saves nothing: its coordinates are as they were.
  assert.deepEqual(store.getDestinationSnapshot(owner.id, vienna).data.candidates.find((item) => item.id === sacher).coordinates, { ...SACHER, review: false });
});
