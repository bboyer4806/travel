import assert from "node:assert/strict";
import test from "node:test";
import { formatDestinationLabel, formatSavedDestinationLabel } from "../src/lib/destination-label.ts";

test("US destinations show city and full state; international destinations show city and country", () => {
  assert.equal(formatDestinationLabel({ name: "Wooster", region: "Ohio", country: "United States", countryCode: "US" }), "Wooster, Ohio");
  assert.equal(formatDestinationLabel({ name: "Wooster", region: "OH", country: "United States" }), "Wooster, Ohio");
  assert.equal(formatDestinationLabel({ name: "Seattle", region: "wa", country: "US" }), "Seattle, Washington");
  assert.equal(formatDestinationLabel({ name: "Vienna", region: "Vienna", country: "Austria", countryCode: "AT" }), "Vienna, Austria");
  assert.equal(formatDestinationLabel({ name: "Paris", region: "Ile-de-France", country: "France" }), "Paris, France");
  assert.equal(formatDestinationLabel({ name: "Paris", region: "Ile-de-France", country: "FR" }), "Paris, France");
});

test("destination formatting trims, deduplicates, and handles missing US state information", () => {
  assert.equal(formatDestinationLabel({ name: "  New   York  ", region: "NY", country: "United States" }), "New York, New York");
  assert.equal(formatDestinationLabel({ name: " Singapore ", region: "Central Singapore", country: "singapore" }), "Singapore");
  assert.equal(formatDestinationLabel({ name: "Wooster", region: "", country: "United States", countryCode: "US" }), "Wooster, United States");
  assert.equal(formatDestinationLabel({ name: "Wooster", region: "  ", country: "US" }), "Wooster, United States");
  assert.equal(formatDestinationLabel({ name: "Wooster", region: "", country: "", countryCode: "US" }), "Wooster, United States");
});

test("destination labels stay within 120 characters without clipping place names", () => {
  const name = "A".repeat(115);
  assert.equal(formatDestinationLabel({ name, region: "Ohio", country: "United States" }), name);
  assert.equal(formatDestinationLabel({ name, region: "Somewhere", country: "Austria" }), name);
  assert.equal(formatDestinationLabel({ name: "A".repeat(120), region: "", country: "US" }).length, 120);
  assert.equal(formatDestinationLabel({ name: "A".repeat(121), region: "", country: "US" }), "");
});

test("structured saved destination labels shorten conservatively without rewriting storage", () => {
  assert.equal(formatSavedDestinationLabel("Wooster, Ohio, United States"), "Wooster, Ohio");
  assert.equal(formatSavedDestinationLabel("New York, New York, United States"), "New York, New York");
  assert.equal(formatSavedDestinationLabel("Los Angeles, CA, US"), "Los Angeles, California");
  assert.equal(formatSavedDestinationLabel("Seattle, Washington, United States of America"), "Seattle, Washington");
  assert.equal(formatSavedDestinationLabel("Vienna, Vienna, Austria"), "Vienna, Austria");
  assert.equal(formatSavedDestinationLabel("Paris, Ile-de-France, FR"), "Paris, France");
  assert.equal(formatSavedDestinationLabel("Kyoto, Kyoto, Japan"), "Kyoto, Japan");
  assert.equal(formatSavedDestinationLabel("London, England, United Kingdom"), "London, United Kingdom");
  assert.equal(formatSavedDestinationLabel("  Paris , Ile-de-France , France  "), "Paris, France");
});

test("manual and ambiguous destination labels remain exactly as entered", () => {
  for (const label of ["Vienna", "Paris, France", "Wooster, OH", "  My summer adventure  ", "Coast, mountains, perhaps", "Hotel, district, city, France", "City, , France", "Museum, Wing B, AA", "Town, state, The airport", "", "Somewhere, local area"]) {
    assert.equal(formatSavedDestinationLabel(label), label);
  }
});
