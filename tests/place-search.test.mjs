import assert from "node:assert/strict";
import test from "node:test";
import { AREA_KM, createPlaceSearch } from "../src/lib/place-search.ts";

// A destination's places are looked up with a stand-in for Nominatim (TRA-130), never the real service.
const vienna = { latitude: 48.20849, longitude: 16.37208 };
/** A result as Nominatim's jsonv2 format writes it: a point of interest by default, at a position near Vienna's center. */
const place = (name, latitude, longitude, extra = {}) => ({
  place_id: Math.floor(Math.random() * 1e9), lat: String(latitude), lon: String(longitude), category: "tourism", type: "attraction",
  place_rank: 30, name, display_name: name + ", Innere Stadt, Vienna, Austria", namedetails: { name }, ...extra,
});
const json = (data, status = 200) => Response.json(data, { status });

/**
 * A place search whose clock moves only as requests wait their turn, and whose stand-in answers each search by its `q`.
 * `answers` maps a search to its results, a Response, or a function returning either.
 */
function search(answers, options = {}) {
  let clock = 0;
  const requests = [];
  const { locateNear } = createPlaceSearch({
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    waitMs: 1000,
    ...options,
    fetcher: async (url, init) => {
      const q = url.searchParams.get("q");
      requests.push({ q, at: clock, url, init });
      const found = typeof answers[q] === "function" ? await answers[q]() : answers[q] ?? [];
      return found instanceof Response ? found : json(found);
    },
  });
  return { locateNear, requests, advance(ms) { clock += ms; } };
}

test("a saved address finds the building or point of interest it names, asking Nominatim as its policy asks", async () => {
  const sacher = place("Hotel Sacher", 48.20406, 16.36949, { category: "tourism", type: "hotel", display_name: "Hotel Sacher, 4, Philharmonikerstraße, Innere Stadt, Vienna, 1010, Austria" });
  const lookup = search({ "Philharmonikerstraße 4, 1010 Wien": [sacher] });
  const places = await lookup.locateNear(vienna, { hotel: { address: "  Philharmonikerstraße 4,\n 1010 Wien ", name: "The Sacher" } });
  assert.deepEqual(places, { hotel: { status: "found", latitude: 48.20406, longitude: 16.36949, label: "Hotel Sacher, 4, Philharmonikerstraße, Innere Stadt, Vienna, 1010, Austria" } });
  // Found by its address, the hotel isn't looked up by its name.
  assert.deepEqual(lookup.requests.map(({ q }) => q), ["Philharmonikerstraße 4, 1010 Wien"]);
  const [{ url, init }] = lookup.requests;
  assert.equal(url.origin + url.pathname, "https://nominatim.openstreetmap.org/search");
  assert.deepEqual(Object.fromEntries([...url.searchParams].filter(([key]) => key !== "viewbox" && key !== "q")), { format: "jsonv2", limit: "10", bounded: "1", namedetails: "1", "accept-language": "en" });
  assert.equal(init.headers["User-Agent"], "TravelPlanner/1.0");
  assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error");
  // The search is bounded to a box reaching AREA_KM from the destination's center each way.
  const [left, top, right, bottom] = url.searchParams.get("viewbox").split(",").map(Number);
  assert.ok(left < vienna.longitude && vienna.longitude < right && bottom < vienna.latitude && vienna.latitude < top);
  assert.ok(Math.abs((top - vienna.latitude) * 111.32 - AREA_KM) < 0.01 && Math.abs((vienna.latitude - bottom) * 111.32 - AREA_KM) < 0.01);
  assert.ok(Math.abs((right - vienna.longitude) * 111.32 * Math.cos(vienna.latitude * Math.PI / 180) - AREA_KM) < 0.01);
});

test("an address no building or point of interest has, such as a street or a neighborhood, leaves the name to find the place", async () => {
  const lookup = search({
    "Stephansplatz": [place("Stephansplatz", 48.2085, 16.3731, { category: "highway", type: "pedestrian", place_rank: 26 })],
    "Innere Stadt": [place("Innere Stadt", 48.2077, 16.3705, { category: "boundary", type: "administrative", place_rank: 18 })],
    // A cathedral found by its English name, which OpenStreetMap keeps beside its local one.
    "St. Stephen's Cathedral": [place("St. Stephen's Cathedral", 48.20857, 16.37307, { category: "amenity", type: "place_of_worship", namedetails: { name: "Stephansdom", "name:en": "St. Stephen's Cathedral" } })],
    "Stephansdom": [place("St. Stephen's Cathedral", 48.20857, 16.37307, { category: "amenity", type: "place_of_worship", namedetails: { name: "Stephansdom", "name:en": "St. Stephen's Cathedral" } })],
  });
  const places = await lookup.locateNear(vienna, {
    church: { address: "Stephansplatz", name: "St. Stephen's Cathedral" },
    tour: { address: "Innere Stadt", name: "Stephansdom" },
    nowhere: { address: "Nowhere Lane 12", name: "Not a real place" },
  });
  const cathedral = { status: "found", latitude: 48.20857, longitude: 16.37307, label: "St. Stephen's Cathedral, Innere Stadt, Vienna, Austria" };
  assert.deepEqual(places, { church: cathedral, tour: cathedral, nowhere: { status: "missing" } });
  assert.deepEqual(lookup.requests.map(({ q }) => q), ["Stephansplatz", "Innere Stadt", "Nowhere Lane 12", "St. Stephen's Cathedral", "Stephansdom", "Not a real place"]);
});

test("a name finds only a place with exactly that name, in any letter case, accents and punctuation aside", async () => {
  const lookup = search({
    "cafe central": [place("Café Central", 48.21036, 16.36564, { category: "amenity", type: "cafe" })],
    "Hotel Sacher": [place("Hotel Sacher Wien", 48.20406, 16.36949)],
    "Sacher": [place("Sacher Eck", 48.2041, 16.3697), place("Café Sacher Wien", 48.20406, 16.36949)],
  });
  const places = await lookup.locateNear(vienna, {
    cafe: { address: "", name: "cafe central" },
    hotel: { address: "", name: "Hotel Sacher" },
    torte: { address: "", name: "Sacher" },
  });
  assert.deepEqual(places, {
    cafe: { status: "found", latitude: 48.21036, longitude: 16.36564, label: "Café Central, Innere Stadt, Vienna, Austria" },
    hotel: { status: "missing" },
    torte: { status: "missing" },
  });
});

test("more than one place matching is ambiguous, while one place mapped twice is one place", async () => {
  const lookup = search({
    // Two restaurants of the same name, about 150 m apart.
    "Figlmüller": [place("Figlmüller", 48.20918, 16.37466, { category: "amenity" }), place("Figlmüller", 48.20835, 16.37630, { category: "amenity" })],
    // A museum's building and the museum in it, a few meters apart.
    "Albertina": [place("Albertina", 48.20462, 16.36818), place("Albertina", 48.20470, 16.36840, { category: "building" })],
    // An address two buildings near Vienna have, in different towns.
    "Hauptstraße 5": [place("", 48.0061, 16.2309, { category: "building", name: "", namedetails: null, display_name: "5, Hauptstraße, Baden, Austria" }), place("", 48.3375, 16.7225, { category: "building", name: "", namedetails: null, display_name: "5, Hauptstraße, Deutsch-Wagram, Austria" })],
    "Heuriger Hauptstraße": [place("Heuriger Hauptstraße", 48.0061, 16.2309, { category: "amenity" })],
  });
  const places = await lookup.locateNear(vienna, {
    schnitzel: { address: "", name: "Figlmüller" },
    museum: { address: "", name: "Albertina" },
    wine: { address: "Hauptstraße 5", name: "Heuriger Hauptstraße" },
  });
  assert.deepEqual(places, {
    schnitzel: { status: "ambiguous" },
    museum: { status: "found", latitude: 48.20462, longitude: 16.36818, label: "Albertina, Innere Stadt, Vienna, Austria" },
    // An address that leads to more than one place isn't settled by the name.
    wine: { status: "ambiguous" },
  });
  assert.ok(!lookup.requests.some(({ q }) => q === "Heuriger Hauptstraße"));
});

test("places beyond 50 km of the destination, and streets, stations and stops named like a place, are never matches", async () => {
  const lookup = search({
    // Melk Abbey is about 80 km from Vienna, outside the area even when the provider returns it.
    "Melk Abbey": [place("Melk Abbey", 48.2283, 15.3317)],
    "Abt-Berthold-Dietmayr-Straße 1, Melk": [place("", 48.2283, 15.3317, { category: "building", name: "", namedetails: null })],
    // The market, the street beside it and the bus stop named after it.
    "Naschmarkt": [
      place("Naschmarkt", 48.19840, 16.36310, { category: "highway", type: "bus_stop" }),
      place("Naschmarkt", 48.19870, 16.36190, { category: "public_transport", type: "platform" }),
      place("Naschmarkt", 48.19920, 16.36290, { category: "amenity", type: "marketplace" }),
      place("Naschmarkt", 48.19960, 16.36000, { category: "highway", type: "residential", place_rank: 26 }),
    ],
    "Schönbrunn": [place("Schönbrunn", 48.18620, 16.31890, { category: "railway", type: "station" })],
  });
  const places = await lookup.locateNear(vienna, {
    abbey: { address: "Abt-Berthold-Dietmayr-Straße 1, Melk", name: "Melk Abbey" },
    market: { address: "", name: "Naschmarkt" },
    palace: { address: "", name: "Schönbrunn" },
  });
  assert.deepEqual(places, {
    abbey: { status: "missing" },
    market: { status: "found", latitude: 48.1992, longitude: 16.3629, label: "Naschmarkt, Innere Stadt, Vienna, Austria" },
    palace: { status: "missing" },
  });
});

test("requests wait their turn, more than a second apart, and their answers are kept for a day and shared", async () => {
  const lookup = search({ "Albertina": [place("Albertina", 48.20462, 16.36818)], "Belvedere": [place("Belvedere", 48.19155, 16.38077)], "Prater": [] });
  const places = { a: { address: "", name: "Albertina" }, b: { address: "", name: "Belvedere" }, c: { address: "", name: "Prater" } };
  // Two maps asking at once share each request.
  const [first, second] = await Promise.all([lookup.locateNear(vienna, places), lookup.locateNear(vienna, { b: places.b, a: places.a })]);
  assert.deepEqual(second, { b: first.b, a: first.a });
  assert.equal(first.c.status, "missing");
  const times = lookup.requests.map(({ at }) => at);
  assert.equal(times.length, 3);
  for (let index = 1; index < times.length; index++) assert.ok(times[index] - times[index - 1] >= 1100, "a second and more apart");
  // Asking again within a day makes no request, even for a place no one found; after a day each is asked again.
  lookup.advance(23 * 60 * 60 * 1000);
  assert.deepEqual(await lookup.locateNear(vienna, places), first);
  assert.equal(lookup.requests.length, 3);
  lookup.advance(2 * 60 * 60 * 1000);
  assert.deepEqual(await lookup.locateNear(vienna, places), first);
  assert.equal(lookup.requests.length, 6);
});

test("a lookup still waiting its turn after the time allowed is pending, and carries on to be found when asked again", async () => {
  let release;
  const lookup = search({ "Albertina": () => new Promise((resolve) => { release = () => resolve(json([place("Albertina", 48.20462, 16.36818)])); }) }, { waitMs: 20 });
  const places = { museum: { address: "", name: "Albertina" } };
  assert.deepEqual(await lookup.locateNear(vienna, places), { museum: { status: "pending" } });
  // Asking again joins the request already made.
  const again = lookup.locateNear(vienna, places);
  release();
  assert.deepEqual(await again, { museum: { status: "found", latitude: 48.20462, longitude: 16.36818, label: "Albertina, Innere Stadt, Vienna, Austria" } });
  assert.equal(lookup.requests.length, 1);
});

test("an outage is unavailable, is not kept, and the places waiting behind it aren't looked up until asked again", async () => {
  for (const failure of [() => { throw new Error("Private upstream details"); }, () => json({ error: "bad" }), () => json([], 500), () => new Response("not json")]) {
    let failing = true;
    const answers = { "Albertina": () => failing ? failure() : json([place("Albertina", 48.20462, 16.36818)]), "Belvedere": [place("Belvedere", 48.19155, 16.38077)] };
    const lookup = search(answers);
    const places = { a: { address: "", name: "Albertina" }, b: { address: "", name: "Belvedere" } };
    assert.deepEqual(await lookup.locateNear(vienna, places), { a: { status: "unavailable" }, b: { status: "unavailable" } });
    assert.deepEqual(lookup.requests.map(({ q }) => q), ["Albertina"], "the place waiting behind the failure isn't looked up");
    failing = false;
    const found = await lookup.locateNear(vienna, places);
    assert.equal(found.a.status, "found");
    assert.equal(found.b.status, "found");
  }
});

test("a slow answer times out as unavailable, and too many requests or a refusal pause lookups for a minute", async () => {
  // The stand-in answers only by failing once its request is aborted, as fetch does when it times out.
  const slow = createPlaceSearch({
    timeoutMs: 5,
    fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true })),
  });
  assert.deepEqual(await slow.locateNear(vienna, { a: { address: "", name: "Albertina" } }), { a: { status: "unavailable" } });

  for (const status of [429, 403]) {
    const lookup = search({ "Albertina": json([], status), "Belvedere": [place("Belvedere", 48.19155, 16.38077)] });
    assert.deepEqual(await lookup.locateNear(vienna, { a: { address: "", name: "Albertina" } }), { a: { status: "unavailable" } });
    assert.deepEqual(await lookup.locateNear(vienna, { b: { address: "", name: "Belvedere" } }), { b: { status: "unavailable" } }, "paused");
    assert.equal(lookup.requests.length, 1);
    lookup.advance(60_000);
    assert.equal((await lookup.locateNear(vienna, { b: { address: "", name: "Belvedere" } })).b.status, "found");
    assert.equal(lookup.requests.length, 2);
  }
});

test("saved text with nothing to look up is never sent", async () => {
  const lookup = search({});
  assert.deepEqual(await lookup.locateNear(vienna, { blank: { address: "  ", name: "—" }, control: { address: "Main\u0000Street", name: "?!" } }), { blank: { status: "missing" }, control: { status: "missing" } });
  assert.deepEqual(lookup.requests, []);
});
