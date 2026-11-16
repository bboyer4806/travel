import assert from "node:assert/strict";
import test from "node:test";
import data from "../src/lib/airports.json" with { type: "json" };
import { airportByCode, airportName } from "../src/lib/airports.ts";

// Airports on every continent, with their names, countries and positions from sources other than OurAirports.
const verified = {
  CLE: [/Cleveland Hopkins/, "US", 41.4117, -81.8497],
  JFK: [/John F\. Kennedy/, "US", 40.6397, -73.7789],
  LHR: [/Heathrow/, "GB", 51.4775, -0.4614],
  HND: [/Haneda/, "JP", 35.5533, 139.7811],
  SYD: [/Sydney/, "AU", -33.9461, 151.1772],
  GRU: [/Guarulhos/, "BR", -23.4356, -46.4731],
  JNB: [/Tambo/, "ZA", -26.1337, 28.2422],
  DXB: [/Dubai/, "AE", 25.2528, 55.3644],
};

test("the airport list has one airport for each three-letter IATA code, with a name, country and position (TRA-132)", () => {
  const countries = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  assert.ok(data.length > 5000, "airports around the world");
  let previous = "";
  for (const airport of data) {
    const [code, name, city, country, latitude, longitude] = airport;
    assert.equal(airport.length, 6, code);
    assert.match(code, /^[A-Z]{3}$/);
    assert.ok(code > previous, `${code} follows ${previous}, once, in code order`);
    previous = code;
    assert.ok(name && name === name.trim().replace(/\s+/g, " "), `${code} has a name`);
    assert.equal(city, city.trim().replace(/\s+/g, " "), `${code}'s city`);
    assert.ok(/^[A-Z]{2}$/.test(country) && countries.of(country), `${code}'s country`);
    assert.ok(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180, `${code}'s position`);
  }
});

test("an airport is found by its IATA code in capitals on every continent, and other text finds none (TRA-132)", () => {
  for (const [code, [name, country, latitude, longitude]] of Object.entries(verified)) {
    const airport = airportByCode(code);
    assert.equal(airport.code, code);
    assert.match(airport.name, name);
    assert.equal(airport.countryCode, country);
    // Within about 5 kilometers, inside the airport.
    assert.ok(Math.abs(airport.latitude - latitude) < 0.05 && Math.abs(airport.longitude - longitude) < 0.05, `${code} is where it is`);
  }
  assert.match(airportName(airportByCode("HND")), /^Tokyo Haneda .*Airport \(HND\)$/);
  // Searches capitalize what's typed first. ICAO codes, city codes and unknown codes name no airport.
  for (const text of ["cle", "Cle", " CLE", "KCLE", "RJTT", "NYC", "LON", "ZZZ", "CL", ""]) assert.equal(airportByCode(text), undefined, text);
});
