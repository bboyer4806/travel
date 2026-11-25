import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as destinationsMap from "../src/lib/destinations-map.ts";
import { createLocationSearch } from "../src/lib/location-search.ts";
import { createStore } from "../src/lib/store.ts";
import { newItem } from "./budget-fixtures.mjs";

// Exercise the actual handler with a real store and a stand-in for Open-Meteo, without a Next server (TRA-180).
const compiled = ts.transpileModule(readFileSync(new URL("../src/app/api/destinations-map/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function route({ account, store, fetcher }) {
  const exports = {};
  const imports = {
    "@/auth": {
      currentAccount: async () => account,
      signedOutResponse: () => Response.json({ error: "Your session has ended. Sign in again to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } }),
    },
    "@/lib/destinations-map": destinationsMap,
    "@/lib/location-search": { locatePlaces: createLocationSearch({ fetcher }).locatePlaces },
    "@/lib/store": { getDestinationsOverview: (accountId) => store.getDestinationsOverview(accountId) },
  };
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports);
  return () => exports.GET(new Request("http://localhost:3000/api/destinations-map"));
}

// Open-Meteo's places for the names the stand-in knows, each name's in Open-Meteo's order.
const places = {
  Vienna: [{ id: 2761369, name: "Vienna", latitude: 48.20849, longitude: 16.37208, country_code: "AT", admin1: "Vienna", country: "Austria" }],
  Salzburg: [{ id: 2766824, name: "Salzburg", latitude: 47.79941, longitude: 13.04399, country_code: "AT", admin1: "Salzburg", country: "Austria" }],
  Graz: [{ id: 2778067, name: "Graz", latitude: 47.06667, longitude: 15.45, country_code: "AT", admin1: "Styria", country: "Austria" }],
  Portland: [
    { id: 5746545, name: "Portland", latitude: 45.52345, longitude: -122.67621, country_code: "US", admin1: "Oregon", country: "United States" },
    { id: 4975802, name: "Portland", latitude: 43.66147, longitude: -70.25533, country_code: "US", admin1: "Maine", country: "United States" },
  ],
};
/** A stand-in for Open-Meteo that answers by name, as `places` says, and records each name asked for. */
function openMeteo() {
  const requests = [];
  const fetcher = async (url) => {
    assert.equal(url.hostname, "geocoding-api.open-meteo.com");
    const name = url.searchParams.get("name");
    requests.push(name);
    return Response.json(places[name] ? { results: places[name] } : {});
  };
  return { fetcher, requests };
}
const at = (name, label, index = 0) => ({ status: "found", latitude: places[name][index].latitude, longitude: places[name][index].longitude, label });

test("the Destinations map finds every destination the account can open, each once by its ID, and nothing of any other", async (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const owner = store.authorizeAccount("owner@example.com");
  const editor = store.authorizeAccount("editor@example.com");
  const outsider = store.authorizeAccount("outsider@example.com");
  const save = (account, input) => store.applyMutation(account.id, input).id;
  const trip = (name) => save(owner, { type: "trip.save", ...newItem(), name, dateLabel: "", homeCity: "Wooster, OH", travelers: 2, notes: "" });
  const destinationOf = (stopId) => store.getSnapshot().stops.find((stop) => stop.id === stopId).destinationId;
  const austria = trip("Austria"), alps = trip("Alps");
  const vienna = destinationOf(save(owner, { type: "stop.add", tripId: austria, city: "Vienna" }));
  const salzburg = destinationOf(save(owner, { type: "stop.add", tripId: austria, city: "Salzburg" }));
  // Salzburg is in both trips, and Graz and Atlantis in neither.
  assert.equal(destinationOf(save(owner, { type: "stop.add", tripId: alps, city: "Salzburg" })), salzburg);
  const graz = save(owner, { type: "destination.create", city: "Graz" });
  const atlantis = save(owner, { type: "destination.create", city: "Atlantis" });
  save(owner, { type: "trip.share", tripId: austria, email: "editor@example.com" });
  // The editor's own Vienna, apart from the owner's.
  const editorVienna = save(editor, { type: "destination.create", city: "Vienna" });

  const { fetcher, requests } = openMeteo();
  const ownerAnswer = await route({ account: owner, store, fetcher })();
  assert.equal(ownerAnswer.status, 200);
  assert.equal(ownerAnswer.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ownerAnswer.json(), { destinations: {
    [vienna]: { ...at("Vienna", "Vienna, Austria"), city: "Vienna" },
    [salzburg]: { ...at("Salzburg", "Salzburg, Austria"), city: "Salzburg" },
    [graz]: { ...at("Graz", "Graz, Styria, Austria"), city: "Graz" },
    [atlantis]: { status: "missing", city: "Atlantis" },
  } }, "the owner's destinations, in trips or not, Salzburg once");
  assert.deepEqual(requests.toSorted(), ["Atlantis", "Graz", "Salzburg", "Vienna"], "each city looked up once");

  // The editor sees the shared trip's destinations and their own, and not the owner's others.
  const editorAnswer = await (await route({ account: editor, store, fetcher })()).json();
  assert.deepEqual(editorAnswer, { destinations: {
    [vienna]: { ...at("Vienna", "Vienna, Austria"), city: "Vienna" },
    [editorVienna]: { ...at("Vienna", "Vienna, Austria"), city: "Vienna" },
    [salzburg]: { ...at("Salzburg", "Salzburg, Austria"), city: "Salzburg" },
  } });

  // Someone with no trip shared and no destination of their own is told of none, and nothing is looked up for them.
  requests.length = 0;
  const outsiderAnswer = await route({ account: outsider, store, fetcher })();
  assert.equal(outsiderAnswer.status, 200);
  assert.deepEqual(await outsiderAnswer.json(), { destinations: {} });
  const signedOut = await route({ account: null, store, fetcher })();
  assert.equal(signedOut.status, 401);
  assert.equal(signedOut.headers.get("cache-control"), "no-store");
  assert.deepEqual(await signedOut.json(), { error: "Your session has ended. Sign in again to continue." });
  assert.deepEqual(requests, []);

  // Once the trip is no longer shared, its destinations aren't the editor's to map, and a deleted destination is gone.
  save(owner, { type: "trip.unshare", tripId: austria, email: "editor@example.com" });
  assert.deepEqual(Object.keys((await (await route({ account: editor, store, fetcher })()).json()).destinations), [editorVienna]);
  store.applyMutation(owner.id, { type: "destination.delete", id: atlantis });
  assert.deepEqual(Object.keys((await (await route({ account: owner, store, fetcher })()).json()).destinations).toSorted(), [vienna, salzburg, graz].toSorted());
  // Mapping changes nothing saved.
  assert.deepEqual(store.getSnapshot().destinations.map((item) => item.city).toSorted(), ["Graz", "Salzburg", "Vienna", "Vienna"]);
});

test("each destination is found by its saved city, the region or country written after a name choosing among same-named places, and an outage leaves every destination unavailable", async (t) => {
  const store = createStore(":memory:", "owner@example.com");
  t.after(() => store.close());
  const owner = store.authorizeAccount("owner@example.com");
  const save = (input) => store.applyMutation(owner.id, input).id;
  const oregon = save({ type: "destination.create", city: "Portland, Oregon, United States", cityFromSuggestion: true });
  const maine = save({ type: "destination.create", city: "Portland, ME" });
  const plain = save({ type: "destination.create", city: "Portland" });
  const { fetcher, requests } = openMeteo();
  assert.deepEqual(await (await route({ account: owner, store, fetcher })()).json(), { destinations: {
    [oregon]: { ...at("Portland", "Portland, Oregon, United States"), city: "Portland, Oregon, United States" },
    [maine]: { ...at("Portland", "Portland, Maine, United States", 1), city: "Portland, ME" },
    // Without a region or country, the first place Open-Meteo has by the name.
    [plain]: { ...at("Portland", "Portland, Oregon, United States"), city: "Portland" },
  } });
  assert.deepEqual(requests, ["Portland"], "one lookup for the name, shared by all three");

  const failing = route({ account: owner, store, fetcher: async () => { throw new Error("Offline"); } });
  const answer = await failing();
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { destinations: {
    [oregon]: { status: "unavailable", city: "Portland, Oregon, United States" },
    [maine]: { status: "unavailable", city: "Portland, ME" },
    [plain]: { status: "unavailable", city: "Portland" },
  } });
});
