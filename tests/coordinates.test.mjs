import assert from "node:assert/strict";
import test from "node:test";
import { coordinatesFromForm, enteredCoordinates, formatCoordinates, normalizeCoordinates, sameCoordinates } from "../src/lib/coordinates.ts";

// TRA-150: a place's coordinates as a change gives them, and as its editor's form holds them.

const RENTAL = { latitude: 48.2167, longitude: 16.3958, accuracy: "approximate" };

test("coordinates are a latitude and a longitude in range with an accuracy, or null to remove them", () => {
  assert.equal(normalizeCoordinates(null), null);
  assert.deepEqual(normalizeCoordinates({ ...RENTAL }), RENTAL);
  assert.deepEqual(normalizeCoordinates({ latitude: -90, longitude: 180, accuracy: "exact" }), { latitude: -90, longitude: 180, accuracy: "exact" });
  assert.ok(Object.is(normalizeCoordinates({ latitude: -0, longitude: 0, accuracy: "exact" }).latitude, 0), "-0 is 0");
  assert.deepEqual(Object.keys(normalizeCoordinates({ ...RENTAL, review: false, note: "x" })), ["latitude", "longitude", "accuracy"], "nothing else is kept");
  for (const [value, message] of [
    [undefined, "Enter coordinates as a latitude, a longitude and their accuracy, or remove them."],
    [{ latitude: 48.2, accuracy: "exact" }, "Enter both a latitude and a longitude, or remove the coordinates."],
    [{ latitude: 90.5, longitude: 0, accuracy: "exact" }, "Latitude must be a number from -90 to 90."],
    [{ latitude: 0, longitude: -180.5, accuracy: "exact" }, "Longitude must be a number from -180 to 180."],
    [{ latitude: 0, longitude: 0, accuracy: "near" }, "Choose whether the coordinates are exact or approximate."],
  ]) assert.throws(() => normalizeCoordinates(value), { message });
});

/** An editor's form with these fields. */
function form(fields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("an editor saves the coordinates entered, removes them once both are cleared, and keeps unchanged ones unless they are confirmed", () => {
  const saved = { ...RENTAL, review: false };
  const entered = form({ latitude: " 48.2167 ", longitude: "16.3958", accuracy: "approximate" });
  // A new place, or one without coordinates, saves those entered, or none.
  assert.deepEqual(coordinatesFromForm(entered, null), RENTAL);
  assert.equal(coordinatesFromForm(form({ latitude: "", longitude: "", accuracy: "exact" }), null), undefined);
  // Unchanged, they are kept as they are, waiting for review if the address changed, unless they are confirmed.
  assert.equal(coordinatesFromForm(entered, saved), undefined);
  assert.equal(coordinatesFromForm(form({ latitude: "48.21670", longitude: "16.3958", accuracy: "approximate" }), saved), undefined, "the same number written differently is unchanged");
  entered.set("coordinatesConfirmed", "on");
  assert.deepEqual(coordinatesFromForm(entered, { ...saved, review: true }), RENTAL);
  // Changed, they are saved, which is their review.
  assert.deepEqual(coordinatesFromForm(form({ latitude: "48.2167", longitude: "16.3958", accuracy: "exact" }), saved), { ...RENTAL, accuracy: "exact" });
  assert.deepEqual(coordinatesFromForm(form({ latitude: "-33.5", longitude: "151", accuracy: "exact" }), saved), { latitude: -33.5, longitude: 151, accuracy: "exact" });
  // Clearing both removes them, whatever accuracy is still chosen.
  assert.equal(coordinatesFromForm(form({ latitude: " ", longitude: "", accuracy: "approximate" }), saved), null);
  // One without the other is no number, never 0, so the store refuses it.
  const half = coordinatesFromForm(form({ latitude: "", longitude: "16.3958", accuracy: "approximate" }), saved);
  assert.ok(Number.isNaN(half.latitude) && half.longitude === 16.3958);
  assert.throws(() => normalizeCoordinates(half), { message: "Latitude must be a number from -90 to 90." });
});

test("entered coordinates compare as numbers, and read latitude first", () => {
  assert.deepEqual(enteredCoordinates("48.20", "16.3", "exact"), { latitude: 48.2, longitude: 16.3, accuracy: "exact" });
  assert.ok(Number.isNaN(enteredCoordinates("", "0", "exact").latitude), "a blank field isn't 0");
  assert.ok(sameCoordinates(RENTAL, enteredCoordinates("48.2167", "16.3958", "approximate")));
  assert.ok(!sameCoordinates(RENTAL, enteredCoordinates("48.2167", "16.3958", "exact")));
  assert.ok(!sameCoordinates({ latitude: 0, longitude: 0, accuracy: "exact" }, enteredCoordinates("", "", "exact")), "blank fields are never coordinates at 0, 0");
  assert.equal(formatCoordinates(RENTAL), "48.2167, 16.3958");
  assert.equal(formatCoordinates({ latitude: -33.85678, longitude: -70, accuracy: "exact" }), "-33.85678, -70");
});
