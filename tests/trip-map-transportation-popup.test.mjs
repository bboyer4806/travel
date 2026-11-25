import assert from "node:assert/strict";
import test from "node:test";
import { connectionDetails, mapLayout, transitMinutes, tripJourney } from "../src/lib/trip-map.ts";
import { setup, tripInput } from "./budget-fixtures.mjs";
import { mapCanvas } from "./trip-map-canvas.mjs";

// TRA-175: each connection's transportation on the trip map opens a popup of the connection, with its saved details and
// View details. What it lists comes from the trip map's library, and how it opens and closes from the real map component
// with the stand-ins of trip-map-canvas.mjs.

const legSave = (id, overrides = {}) => ({ type: "leg.save", id, method: "", price: "", departure: "", arrival: "", url: "", notes: "", ...overrides });
const unsaved = { method: "", airline: "", flightNumber: "", departure: "", arrival: "" };

test("time in transit comes only from a departure and arrival saved as dates and times with their UTC offsets (TRA-175)", () => {
  // From New York to Vienna overnight: 8 h 30 min, though the clocks read 14 h 30 min apart.
  assert.equal(transitMinutes("2026-12-01T18:00-05:00", "2026-12-02T08:30+01:00"), 510);
  // A space for the T, Z for UTC, and seconds, rounded to the minute.
  assert.equal(transitMinutes("2026-12-01 18:00Z", "2026-12-01 19:45Z"), 105);
  assert.equal(transitMinutes("2026-12-01T18:00:00+05:30", "2026-12-01T19:00:40+05:30"), 61);
  // Without an offset, a time could be in any time zone, and without a date, on any day: no time is assumed.
  for (const [departure, arrival] of [
    ["2026-12-01T18:00", "2026-12-01T20:00"],
    ["2026-12-01T18:00-05:00", "2026-12-01T20:00"],
    ["18:00-05:00", "20:00-05:00"],
    ["Dec 1, 6:00 PM", "Dec 2, 8:30 AM"],
    ["6 PM EST", "8:30 AM CET"],
    ["Morning", "Evening"],
    ["", ""],
  ]) assert.equal(transitMinutes(departure, arrival), null, departure + " → " + arrival);
  // Dates and times that aren't real, and other ways of writing them, give none either.
  for (const [departure, arrival] of [
    ["2026-02-30T10:00Z", "2026-03-01T10:00Z"],
    ["2026-12-01T24:00Z", "2026-12-02T01:00Z"],
    ["2026-12-01T18:00+24:00", "2026-12-01T19:00Z"],
    ["2026-12-01t18:00z", "2026-12-01t19:00z"],
    ["2026-12-01T18:00 -05:00", "2026-12-01T20:00 -05:00"],
    ["0000-01-01T00:00Z", "0000-01-01T01:00Z"],
  ]) assert.equal(transitMinutes(departure, arrival), null, departure + " → " + arrival);
  // Arriving when or before it leaves isn't a time in transit.
  assert.equal(transitMinutes("2026-12-01T18:00Z", "2026-12-01T18:00Z"), null);
  assert.equal(transitMinutes("2026-12-01T18:00Z", "2026-12-01T13:00-05:00"), null, "the same instant");
  assert.equal(transitMinutes("2026-12-01T18:00Z", "2026-12-01T17:00Z"), null);
  assert.equal(transitMinutes("2026-12-01T18:00:00Z", "2026-12-01T18:00:20Z"), null, "less than a minute");
});

test("a connection's popup lists its saved details in order, each only once saved, without inventing any (TRA-175)", () => {
  assert.deepEqual(connectionDetails({ method: "Flight", airline: "Delta", flightNumber: "DL 123", departure: "2026-12-01T18:00-05:00", arrival: "2026-12-02T08:30+01:00" }), [
    { term: "Transportation", value: "Flight" },
    { term: "Airline", value: "Delta" },
    { term: "Flight number", value: "DL 123" },
    { term: "Departure", value: "2026-12-01T18:00-05:00" },
    { term: "Arrival", value: "2026-12-02T08:30+01:00" },
    { term: "Time in transit", value: "8 h 30 min" },
  ]);
  // Departure and arrival as saved, without a time in transit they can't give.
  assert.deepEqual(connectionDetails({ ...unsaved, method: "Plane", flightNumber: "LH 4", departure: "Dec 1, 6:00 PM", arrival: "Dec 2, 8:30 AM" }).map(({ term, value }) => [term, value]), [
    ["Transportation", "Plane"], ["Flight number", "LH 4"], ["Departure", "Dec 1, 6:00 PM"], ["Arrival", "Dec 2, 8:30 AM"],
  ]);
  // An airline and flight number show only while the transportation names an airplane, as on the connection's card.
  assert.deepEqual(connectionDetails({ ...unsaved, method: "Train", airline: "Delta", flightNumber: "DL 123", arrival: "Noon" }).map(({ term }) => term), ["Transportation", "Arrival"]);
  assert.deepEqual(connectionDetails({ ...unsaved, method: "Rental car, then flight", airline: "Delta" }).map(({ term }) => term), ["Transportation", "Airline"]);
  // Without a Transportation, its airline isn't a flight's.
  assert.deepEqual(connectionDetails({ ...unsaved, airline: "Delta", departure: "9 AM" }).map(({ term }) => term), ["Departure"]);
  assert.deepEqual(connectionDetails(unsaved), [], "nothing saved, nothing listed");
});

test("each connection on the journey and the map carries its own saved details, which follow saved changes (TRA-175)", (t) => {
  const { store, tripId } = setup(t, tripInput({ homeCity: "Wooster, OH" }));
  const vienna = store.applyMutation({ type: "stop.add", tripId, city: "Vienna" }).id;
  const salzburg = store.applyMutation({ type: "stop.add", tripId, city: "Salzburg" }).id;
  const leg = (from, to) => store.getSnapshot().legs.find((item) => item.tripId === tripId && item.fromId === from && item.toId === to);
  const [out, between, back] = [leg(null, vienna), leg(vienna, salzburg), leg(salzburg, null)];
  store.applyMutation(legSave(out.id, { method: "Flight", airline: "Delta", flightNumber: "DL 123", departure: "2026-12-01T18:00-05:00", arrival: "2026-12-02T08:30+01:00" }));
  store.applyMutation(legSave(between.id, { method: "Train", departure: "Dec 3, morning" }));
  store.applyMutation(legSave(back.id, { method: "Flight", airline: "Austrian" }));
  const found = { "Wooster, OH": [40.8, -81.9], Vienna: [48.2, 16.4], Salzburg: [47.8, 13.0] };
  const locations = Object.fromEntries(Object.entries(found).map(([name, [latitude, longitude]]) => [name, { status: "found", latitude, longitude, label: name }]));
  const lines = () => mapLayout(tripJourney(store.getSnapshot(), tripId), locations).lines.map(({ id, method, from, to, target, details }) => [id, method, from, to, target, details.map(({ term, value }) => term + ": " + value)]);
  // Two flights each with their own details, and each opening its own card.
  assert.deepEqual(lines(), [
    [out.id, "Flight", "Wooster, OH", "Vienna", "connection-" + out.id, ["Transportation: Flight", "Airline: Delta", "Flight number: DL 123", "Departure: 2026-12-01T18:00-05:00", "Arrival: 2026-12-02T08:30+01:00", "Time in transit: 8 h 30 min"]],
    [between.id, "Train", "Vienna", "Salzburg", "connection-" + between.id, ["Transportation: Train", "Departure: Dec 3, morning"]],
    [back.id, "Flight", "Salzburg", "Wooster, OH", "connection-" + back.id, ["Transportation: Flight", "Airline: Austrian"]],
  ]);
  // A saved change shows once the trip's data is read again. Naming a train keeps the airline and flight number saved,
  // unshown, as the connection's card does, and the popup reads Travel's data without changing it.
  store.applyMutation(legSave(out.id, { method: "Train", departure: "2026-12-01T19:00-05:00", arrival: "2026-12-02T08:30+01:00" }));
  const snapshot = store.getSnapshot(), saved = structuredClone(snapshot);
  assert.deepEqual(lines()[0].at(-1), ["Transportation: Train", "Departure: 2026-12-01T19:00-05:00", "Arrival: 2026-12-02T08:30+01:00", "Time in transit: 7 h 30 min"]);
  assert.deepEqual([leg(null, vienna).airline, leg(null, vienna).flightNumber], ["Delta", "DL 123"]);
  tripJourney(snapshot, tripId);
  assert.deepEqual(snapshot, saved);
});

const marker = (key, kind, position, label, extra = {}) => ({ key, kind, position, label, number: null, target: key, found: label, photo: null, ...extra });
const line = (id, method, from, to, points, badge, saved = {}) => ({ id, method, from, to, points, badge, target: "connection-" + id, details: connectionDetails({ ...unsaved, method, ...saved }) });
// The way out's flight, with every detail saved.
const FLIGHT = { airline: "Delta", flightNumber: "DL 123", departure: "2026-12-01T18:00-05:00", arrival: "2026-12-02T08:30+01:00" };
/**
 * A trip from Wooster to Vienna by a flight with every detail saved, to Salzburg by train, and home by a flight with
 * fewer. Each position is the point the stand-in's map draws it at, as [y, x] in pixels from its top left corner.
 */
const trip = {
  markers: [
    marker("departure", "roundTrip", [40, 60], "Wooster, OH", { target: "connection-out" }),
    marker("destination-vienna", "destination", [250, 300], "Vienna, Austria", { number: 1 }),
    marker("destination-salzburg", "destination", [260, 520], "Salzburg", { number: 2 }),
  ],
  lines: [
    line("out", "Flight", "Wooster, OH", "Vienna, Austria", [[40, 60], [250, 300]], [110, 140], FLIGHT),
    line("between", "Train", "Vienna, Austria", "Salzburg", [[250, 300], [260, 520]], [253, 373], { departure: "Dec 3, morning" }),
    line("back", "Flight", "Salzburg", "Wooster, OH", [[260, 520], [40, 60]], [187, 367], { airline: "Austrian", departure: "Dec 9, 11:05 AM", arrival: "Dec 9, 5:40 PM" }),
  ],
  unmapped: [],
};
// The transportation's labels, with the stand-in's label for each transportation its text.
const OUT = "Flight from Wooster, OH to Vienna, Austria", BETWEEN = "Train from Vienna, Austria to Salzburg", BACK = "Flight from Salzburg to Wooster, OH";
const VIENNA = "Destination 1: Vienna, Austria";
const ROUTE = { out: "Wooster, OH to Vienna, Austria", between: "Vienna, Austria to Salzburg", back: "Salzburg to Wooster, OH" };
const expanded = (map) => [OUT, BETWEEN, BACK].map((label) => map.marker(label).element.attributes["aria-expanded"]);

test("pointing to a connection's transportation opens its popup beside it: its route, saved details and View details (TRA-175)", () => {
  const map = mapCanvas(trip);
  assert.deepEqual(map.popups(), []);
  // Screen readers hear that each transportation opens a dialog, and whether it is open.
  assert.deepEqual([OUT, BETWEEN, BACK].map((label) => map.marker(label).element.attributes["aria-haspopup"]), ["dialog", "dialog", "dialog"]);
  assert.deepEqual(expanded(map), ["false", "false", "false"]);
  map.fire(OUT, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.popups(), [{
    icons: "Flight",
    route: ROUTE.out,
    details: [["Transportation", "Flight"], ["Airline", "Delta"], ["Flight number", "DL 123"], ["Departure", "2026-12-01T18:00-05:00"], ["Arrival", "2026-12-02T08:30+01:00"], ["Time in transit", "8 h 30 min"]],
    button: "View details for travel from " + ROUTE.out,
    // A dialog named by its route and described by its details.
    role: "dialog", labelledBy: true, describedBy: true,
    // With no room above the 22-pixel transportation at 140, 110, the 240 by 168 popup goes 6 pixels below it.
    left: "20px", top: "127px",
  }]);
  assert.deepEqual(expanded(map), ["true", "false", "false"]);
  // Pointing neither goes to the connection's card nor takes focus.
  assert.equal(map.page["connection-out"], undefined);
  assert.equal(map.activeElement(), null);
  // A pen points as a mouse does, and one connection's popup shows at a time.
  map.fire(OUT, "pointerleave");
  map.fire(BETWEEN, "pointerenter", { pointerType: "pen" });
  assert.deepEqual(map.popups().map(({ route, left, top }) => [route, left, top]), [[ROUTE.between, "253px", "148px"]], "above the train, with room there");
  assert.deepEqual(expanded(map), ["false", "true", "false"]);
  // Its popup shows what a tooltip would, so the transportation has none. Places keep theirs.
  assert.equal(map.marker(OUT).options.title, "");
  assert.equal(map.marker(VIENNA).options.title, VIENNA + "\nShown at Vienna, Austria");
});

test("a popup opened by pointing stays while the pointer moves to it, and closes a moment after the pointer leaves both (TRA-175)", () => {
  const map = mapCanvas(trip);
  map.fire(OUT, "pointerenter", { pointerType: "mouse" });
  // Leaving the transportation for the popup, across the gap between them.
  map.fire(OUT, "pointerleave");
  map.wait(150);
  assert.deepEqual(map.opened(), [ROUTE.out]);
  map.hoverPopup(true);
  map.wait(5000);
  assert.deepEqual(map.opened(), [ROUTE.out], "open as long as the pointer is on the popup, to select View details");
  // Back to the transportation, then away from both.
  map.hoverPopup(false);
  map.fire(OUT, "pointerenter", { pointerType: "mouse" });
  map.wait(5000);
  assert.deepEqual(map.opened(), [ROUTE.out]);
  map.fire(OUT, "pointerleave");
  map.wait(199);
  assert.deepEqual(map.opened(), [ROUTE.out]);
  map.wait(1);
  assert.deepEqual(map.opened(), [], "closed once the pointer has been off both for 200 ms");
  assert.deepEqual(expanded(map), ["false", "false", "false"]);
  // A quick move straight from the transportation onto the popup: React tells the popup first, then the marker hears of it.
  map.fire(OUT, "pointerenter", { pointerType: "mouse" });
  map.hoverPopup(true);
  map.fire(OUT, "pointerleave", { relatedTarget: map.popupElement() });
  map.wait(5000);
  assert.deepEqual(map.opened(), [ROUTE.out]);
  map.hoverPopup(false);
  map.wait(200);
  assert.deepEqual(map.opened(), []);
  // Once the keyboard reaches View details in it, it stays when the pointer leaves, so focus never goes with it.
  map.fire(OUT, "pointerenter", { pointerType: "mouse" });
  map.focusPopup();
  map.fire(OUT, "pointerleave");
  map.wait(5000);
  assert.deepEqual(map.opened(), [ROUTE.out]);
});

test("a click or tap on a connection's transportation opens its popup instead of going to its card, with focus on View details (TRA-175)", () => {
  const map = mapCanvas(trip);
  map.click(OUT);
  assert.deepEqual(map.opened(), [ROUTE.out]);
  assert.equal(map.page["connection-out"], undefined, "the trip page stays where it is");
  // Focus moves to View details, so the keyboard and screen readers carry on there, without scrolling the page.
  assert.equal(map.activeElement(), map.popupElement().button);
  assert.equal(map.activeElement().focusOptions.preventScroll, true);
  // Selected, it stays open once the pointer leaves.
  map.fire(OUT, "pointerleave");
  map.wait(5000);
  assert.deepEqual(map.opened(), [ROUTE.out]);
  // Pointing to it again, or clicking it again, keeps it open.
  map.fire(OUT, "pointerenter", { pointerType: "mouse" });
  map.fire(OUT, "pointerleave");
  map.click(OUT);
  map.wait(5000);
  assert.deepEqual(map.opened(), [ROUTE.out]);

  // Touch has no hover: a tap opens the popup, as a click does, and replaces the one open.
  map.fire(BETWEEN, "pointerenter", { pointerType: "touch" });
  assert.deepEqual(map.opened(), [ROUTE.out]);
  map.click(BETWEEN);
  map.fire(BETWEEN, "pointerleave", { pointerType: "touch" });
  map.wait(5000);
  assert.deepEqual(map.opened(), [ROUTE.between]);
  assert.equal(map.activeElement(), map.popupElement().button);
  assert.deepEqual(expanded(map), ["false", "true", "false"]);
  // Hovering then clicking keeps a popup open after the pointer leaves, as clicking alone does.
  map.fire(BACK, "pointerenter", { pointerType: "mouse" });
  map.click(BACK);
  map.fire(BACK, "pointerleave");
  map.wait(5000);
  assert.deepEqual(map.opened(), [ROUTE.back]);
});

test("Enter or Space on a connection's transportation opens its popup with focus on View details, and Escape returns focus (TRA-175)", () => {
  const map = mapCanvas(trip);
  // Other keys leave it for the map.
  assert.equal(map.press(OUT, "Tab"), false);
  assert.deepEqual(map.opened(), []);
  assert.equal(map.press(OUT, "Enter"), true);
  assert.deepEqual(map.opened(), [ROUTE.out]);
  assert.equal(map.activeElement(), map.popupElement().button);
  // Escape closes it and returns focus to its transportation, without scrolling the page.
  map.key("Escape");
  assert.deepEqual(map.opened(), []);
  assert.equal(map.activeElement(), map.marker(OUT).element);
  assert.equal(map.marker(OUT).element.focusOptions.preventScroll, true);
  assert.equal(map.listening(), 0, "Escape is listened for only while a popup shows");
  assert.equal(map.press(BACK, " "), true);
  assert.deepEqual(map.opened(), [ROUTE.back]);
  map.key("Shift");
  assert.deepEqual(map.opened(), [ROUTE.back], "only Escape closes it");
  // Enter on another connection's transportation opens its popup instead.
  map.press(BETWEEN, "Enter");
  assert.deepEqual(map.opened(), [ROUTE.between]);
  assert.equal(map.activeElement(), map.popupElement().button);
  // Escape closes a popup opened by pointing too, leaving focus where it is.
  map.key("Escape");
  map.fire(OUT, "pointerenter", { pointerType: "mouse" });
  map.key("Escape");
  assert.deepEqual(map.opened(), []);
  assert.equal(map.activeElement(), map.marker(BETWEEN).element);
});

test("a click or tap elsewhere on the map, or on another place, closes a popup; dragging the map and its controls don't (TRA-175)", () => {
  const map = mapCanvas(trip);
  map.click(OUT);
  // Leaflet tells the map of a click or tap on it, but not of one ending a drag or on its zoom buttons or credits.
  map.mapEvent("preclick");
  assert.deepEqual(map.opened(), []);
  assert.deepEqual(expanded(map), ["false", "false", "false"]);
  // On a destination, which goes to its card as before.
  map.click(BACK);
  map.click(VIENNA);
  assert.deepEqual(map.opened(), []);
  assert.equal(map.page["destination-vienna"].visits, 1);
  // A popup opened by pointing closes too.
  map.fire(BETWEEN, "pointerenter", { pointerType: "mouse" });
  map.mapEvent("preclick");
  assert.deepEqual(map.opened(), []);
});

test("View details goes to the connection's card on the trip page, focused, and closes the popup (TRA-175)", () => {
  const map = mapCanvas(trip);
  map.fire(BETWEEN, "pointerenter", { pointerType: "mouse" });
  map.hoverPopup(true);
  map.viewDetails();
  const card = map.page["connection-between"];
  assert.equal(card.visits, 1);
  assert.equal(card.focusOptions.preventScroll, true);
  assert.equal(map.activeElement(), card);
  assert.deepEqual(map.opened(), []);
  assert.equal(map.listening(), 0);
  // From a popup opened by Enter, too.
  map.press(BACK, "Enter");
  map.viewDetails();
  assert.equal(map.page["connection-back"].visits, 1);
  assert.deepEqual(map.opened(), []);
});

test("each connection's popup shows its own details, including two connections by the same transportation (TRA-175)", () => {
  const map = mapCanvas(trip);
  const details = (label) => { map.click(label); return map.popups().map(({ icons, route, details, button }) => ({ icons, route, details, button })); };
  assert.deepEqual(details(BACK), [{
    icons: "Flight",
    route: ROUTE.back,
    // Departure and arrival as saved, without a time in transit, which they can't give.
    details: [["Transportation", "Flight"], ["Airline", "Austrian"], ["Departure", "Dec 9, 11:05 AM"], ["Arrival", "Dec 9, 5:40 PM"]],
    button: "View details for travel from " + ROUTE.back,
  }]);
  assert.deepEqual(details(BETWEEN), [{ icons: "Train", route: ROUTE.between, details: [["Transportation", "Train"], ["Departure", "Dec 3, morning"]], button: "View details for travel from " + ROUTE.between }]);
  assert.deepEqual(details(OUT)[0].details.map(([term]) => term), ["Transportation", "Airline", "Flight number", "Departure", "Arrival", "Time in transit"]);
});

test("a connection with nothing saved shows its transportation's icon, its route and View details alone (TRA-175)", () => {
  const map = mapCanvas({ ...trip, lines: [line("out", "", "Wooster, OH", "Vienna, Austria", [[40, 60], [250, 300]], [110, 140])] });
  map.click(" from Wooster, OH to Vienna, Austria");
  // No empty details or placeholders, and nothing to describe it beyond its name.
  assert.deepEqual(map.popups(), [{ icons: "", route: ROUTE.out, details: [], button: "View details for travel from " + ROUTE.out, role: "dialog", labelledBy: true, describedBy: undefined, left: "20px", top: "45px" }]);
});

test("while the map moves, the popup waits, then shows beside the transportation where the map moved it (TRA-175)", () => {
  const map = mapCanvas(trip);
  map.click(OUT);
  map.mapEvent("movestart");
  assert.deepEqual(map.opened(), []);
  assert.deepEqual(expanded(map), ["true", "false", "false"], "still open, waiting for the map");
  // Moved down and across, the transportation at 240, 210 has room above it.
  map.mapEvent("moveend", { x: 100, y: 100 });
  assert.deepEqual(map.popups().map(({ left, top }) => [left, top]), [["120px", "25px"]]);
  // A popup opened while the map moves, as when Leaflet brings the transportation the keyboard reaches into view, takes
  // focus once it shows.
  map.mapEvent("preclick");
  map.marker(BACK).element.focus();
  map.mapEvent("movestart");
  map.press(BACK, "Enter");
  assert.deepEqual(map.opened(), []);
  assert.equal(map.activeElement(), map.marker(BACK).element);
  map.mapEvent("moveend", { x: 0, y: 0 });
  assert.deepEqual(map.popups().map(({ route, left, top }) => [route, left, top]), [[ROUTE.back, "247px", "42px"]]);
  assert.equal(map.activeElement(), map.popupElement().button);
});

test("on a phone's shorter map, a popup with room neither above nor below its transportation goes beside it, never over it (TRA-175)", () => {
  // The flight's six details make its popup 168 pixels tall, for a map 298 pixels tall.
  const phone = { x: 343, y: 298 };
  const map = mapCanvas({ ...trip, lines: [line("out", "Flight", "Wooster, OH", "Vienna, Austria", [[40, 60], [150, 330]], [150, 300], FLIGHT)] }, phone);
  map.click(OUT);
  // On the left of the 29-pixel transportation at 300, 150, 6 pixels from it, and centered on it.
  assert.deepEqual(map.popups().map(({ details, left, top }) => [details.length, left, top]), [[6, "40px", "66px"]]);
  // With room on no side, as close to it as the map allows, as a destination's preview would be.
  const middle = mapCanvas({ ...trip, lines: [line("out", "Flight", "Wooster, OH", "Vienna, Austria", [[40, 60], [150, 330]], [150, 171], FLIGHT)] }, phone);
  middle.click(OUT);
  assert.deepEqual(middle.popups().map(({ left, top }) => [left, top]), [["51px", "8px"]]);
});

test("a popup follows the trip's saved data when it's read again, and closes with its connection (TRA-175)", () => {
  const map = mapCanvas(trip);
  map.click(OUT);
  const changed = { ...trip, lines: trip.lines.map((item) => item.id === "out" ? line("out", "Flight", "Wooster, OH", "Vienna, Austria", item.points, item.badge, { airline: "United", flightNumber: "UA 9" }) : item) };
  map.redraw(changed);
  assert.deepEqual(map.popups().map(({ route, details }) => [route, details]), [[ROUTE.out, [["Transportation", "Flight"], ["Airline", "United"], ["Flight number", "UA 9"]]]]);
  assert.deepEqual(expanded(map), ["true", "false", "false"]);
  map.redraw({ ...trip, lines: trip.lines.filter((item) => item.id !== "out") });
  assert.deepEqual(map.popups(), []);
});

test("destinations' previews are as they were while a connection's popup shows (TRA-143, TRA-175)", () => {
  const map = mapCanvas(trip);
  map.click(OUT);
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  assert.deepEqual(map.opened(), [ROUTE.out]);
  map.fire(VIENNA, "pointerleave");
  map.wait(200);
  assert.deepEqual([map.shown(), map.opened()], [[], [ROUTE.out]]);
  // Escape closes both.
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  map.key("Escape");
  assert.deepEqual([map.shown(), map.opened()], [[], []]);
});
