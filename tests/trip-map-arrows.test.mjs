import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { mapLayout, tripJourney } from "../src/lib/trip-map.ts";
import { setup, tripInput } from "./budget-fixtures.mjs";
import { onlyRule } from "./css-rules.mjs";
import { mapCanvas } from "./trip-map-canvas.mjs";

// TRA-176: arrows on the trip map's lines show the way each connection goes, from where it leaves toward where it
// arrives. Where they go comes from the trip map's library, and how the map draws them from the real map component with
// the stand-ins of trip-map-canvas.mjs.

const found = (latitude, longitude, label = "Found place") => ({ status: "found", latitude, longitude, label });
const legSave = (id, overrides = {}) => ({ type: "leg.save", id, method: "", price: "", departure: "", arrival: "", url: "", notes: "", ...overrides });
const entry = (kind, place) => ({ id: randomUUID(), kind, place, arrival: "", departure: "", notes: "" });

/**
 * Where Leaflet's Web Mercator map draws a position, in pixels at its first zoom, where the world is 256 pixels wide and
 * north is up. Every other zoom scales these alike, so a line points the same way at every zoom.
 */
function pixel([latitude, longitude]) {
  const sin = Math.sin((Math.max(-85.0511287798, Math.min(85.0511287798, latitude)) * Math.PI) / 180);
  return { x: (256 * (longitude + 180)) / 360, y: 128 - (256 * Math.log((1 + sin) / (1 - sin))) / (4 * Math.PI) };
}
/** The way the map's straight line from `from` to `to` points, in degrees clockwise from east. */
function heading(from, to) {
  const a = pixel(from), b = pixel(to);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}
/** How far along the map's straight line from `from` to `to` a position is, from 0 at `from` to 1 at `to`, and how far off it, in pixels. */
function onLine(position, from, to) {
  const a = pixel(from), b = pixel(to), p = pixel(position);
  const x = b.x - a.x, y = b.y - a.y, length = Math.hypot(x, y);
  return { along: ((p.x - a.x) * x + (p.y - a.y) * y) / length ** 2, off: Math.abs((p.x - a.x) * y - (p.y - a.y) * x) / length };
}
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual}, not ${expected}`);
/** The compass point nearest the way an arrow points on the map, with north up. */
const compass = (angle) => ["west", "northwest", "north", "northeast", "east", "southeast", "south", "southwest", "west"][Math.round(angle / 45) + 4];

const place = (key, kind, name, number = null) => ({ key, kind, place: name, label: name, target: key, number, connection: null, photo: null });
const leg = (id, method, from, to, places) => ({ id, method, from, to, details: [], places });
/** A journey from home by way of a layover to two destinations and back, as `tripJourney` builds one. */
const journey = {
  places: [place("departure", "departure", "Home"), place("layover", "layover", "Layover"), place("first", "destination", "First", 1), place("second", "destination", "Second", 2), place("return", "return", "Home")],
  legs: [
    leg("out", "Flight", "Home", "First", ["departure", "layover", "first"]),
    leg("between", "Train", "First", "Second", ["first", "second"]),
    leg("back", "Flight", "Second", "Home", ["second", "return"]),
  ],
};
const everywhere = { Home: found(40, -80), Layover: found(50, 8), First: found(48, 16), Second: found(47, 13) };

test("each connection has an arrow on each of its lines, five sixths of the way along, pointing toward where it arrives (TRA-176)", () => {
  const { lines } = mapLayout(journey, everywhere);
  assert.deepEqual(lines.map((line) => [line.id, line.points.length, line.arrows.length]), [["out", 3, 2], ["between", 2, 1], ["back", 2, 1]],
    "the way out has one to its layover and one on to First");
  for (const line of lines) {
    line.arrows.forEach((arrow, index) => {
      const from = line.points[index], to = line.points[index + 1];
      const { along, off } = onLine(arrow.position, from, to);
      close(along, 5 / 6, `${line.id}'s arrow ${index} is five sixths of the way along its line`);
      close(off, 0, `${line.id}'s arrow ${index} is on its line`);
      // Turned as the map draws the line, whose latitudes stretch toward the poles, so it points the same way at every zoom.
      close(arrow.angle, heading(from, to), `${line.id}'s arrow ${index} points the way its line goes`);
    });
  }
  assert.deepEqual(lines.flatMap((line) => line.arrows.map((arrow) => compass(arrow.angle))), ["east", "east", "southwest", "west"]);
});

test("arrows point east, north, west and south as their lines go on the map (TRA-176)", () => {
  // Around a square from the equator: east, north, west, then south back home.
  const square = {
    places: [place("departure", "departure", "A"), place("b", "destination", "B", 1), place("c", "destination", "C", 2), place("d", "destination", "D", 3), place("return", "return", "A")],
    legs: [["departure", "b"], ["b", "c"], ["c", "d"], ["d", "return"]].map(([from, to], index) => leg("leg-" + index, "Train", from, to, [from, to])),
  };
  const { lines } = mapLayout(square, { A: found(0, 0), B: found(0, 10), C: found(10, 10), D: found(10, 0) });
  // In degrees clockwise from east, as CSS turns an arrowhead drawn pointing east.
  assert.deepEqual(lines.map((line) => line.arrows.map((arrow) => arrow.angle)), [[0], [-90], [180], [90]]);
});

test("arrows follow the trip's saved route from its departure through each destination to its return, and its changes (TRA-176)", (t) => {
  const { store, tripId } = setup(t, tripInput({ homeCity: "Wooster, OH" }));
  const vienna = store.applyMutation({ type: "stop.add", tripId, city: "Vienna" }).id;
  const salzburg = store.applyMutation({ type: "stop.add", tripId, city: "Salzburg" }).id;
  const locations = { "Wooster, OH": found(40.8, -81.9), Vienna: found(48.2, 16.4), Salzburg: found(47.8, 13.04), Frankfurt: found(50.1, 8.7) };
  /** Each connection's route, and the way its arrows point. */
  const ways = () => {
    const snapshot = store.getSnapshot(), saved = structuredClone(snapshot);
    const { lines } = mapLayout(tripJourney(snapshot, tripId), locations);
    assert.deepEqual(snapshot, saved, "the trip's data is only read");
    return lines.map((line) => [line.from + " → " + line.to, line.arrows.map((arrow) => compass(arrow.angle))]);
  };
  assert.deepEqual(ways(), [["Wooster, OH → Vienna", ["east"]], ["Vienna → Salzburg", ["west"]], ["Salzburg → Wooster, OH", ["west"]]]);

  // Reordered, the way between the destinations turns around, and the trip's ends follow.
  store.applyMutation({ type: "stop.move", id: salzburg, direction: "up" });
  assert.deepEqual(ways(), [["Wooster, OH → Salzburg", ["east"]], ["Salzburg → Vienna", ["east"]], ["Vienna → Wooster, OH", ["west"]]]);

  // A layover on the way out adds an arrow to each of its lines, and removing it takes one away.
  const out = store.getSnapshot().legs.find((item) => item.tripId === tripId && item.fromId === null);
  store.applyMutation(legSave(out.id, { method: "Flight", itinerary: [entry("layover", "Frankfurt")] }));
  assert.deepEqual(ways()[0], ["Wooster, OH → Salzburg", ["east", "southeast"]]);
  store.applyMutation(legSave(out.id, { method: "Flight", itinerary: [] }));
  assert.deepEqual(ways()[0], ["Wooster, OH → Salzburg", ["east"]]);

  // Removing a destination removes its connections' arrows, and the trip goes straight on.
  store.applyMutation({ type: "stop.remove", id: vienna });
  assert.deepEqual(ways(), [["Wooster, OH → Salzburg", ["east"]], ["Salzburg → Wooster, OH", ["west"]]]);
});

test("a way out and back along the same line show their arrows apart, each near where it arrives, clear of both transportations (TRA-176)", () => {
  const roundTrip = { places: [journey.places[0], journey.places[2], journey.places[4]], legs: [
    leg("out", "Flight", "Home", "First", ["departure", "first"]),
    leg("back", "Flight", "First", "Home", ["first", "return"]),
  ] };
  const [out, back] = mapLayout(roundTrip, everywhere).lines;
  const [home, first] = out.points;
  assert.deepEqual(back.points, [first, home]);
  // From home: the way back's arrow, the way out's transportation, the way back's, then the way out's arrow, a sixth of
  // the line from First. Each arrow is as far from the other way's transportation as from the place it arrives at.
  const spots = [back.arrows[0].position, out.badge, back.badge, out.arrows[0].position].map((position) => onLine(position, home, first));
  spots.forEach(({ along, off }, index) => {
    close(along, [1 / 6, 1 / 3, 2 / 3, 5 / 6][index], `spot ${index} along the line`);
    close(off, 0, `spot ${index} is on the line`);
  });
  close(out.arrows[0].angle, heading(home, first), "the way out points toward First");
  close(back.arrows[0].angle, heading(first, home), "the way back points toward home");
  close(Math.abs(out.arrows[0].angle - back.arrows[0].angle), 180, "they point opposite ways");

  // Through the same layover both ways, each line the two share has an arrow near each of its ends.
  const viaLayover = { places: journey.places.filter((item) => item.key !== "second"), legs: [
    leg("out", "Flight", "Home", "First", ["departure", "layover", "first"]),
    leg("back", "Flight", "First", "Home", ["first", "layover", "return"]),
  ] };
  const [there, again] = mapLayout(viaLayover, everywhere).lines;
  assert.deepEqual(again.points, [...there.points].reverse());
  there.arrows.forEach((arrow, index) => {
    const from = there.points[index], to = there.points[index + 1];
    const returning = again.arrows[again.arrows.length - 1 - index];
    close(onLine(arrow.position, from, to).along, 5 / 6, `the way out's arrow ${index}`);
    close(onLine(returning.position, from, to).along, 1 / 6, `the way back's arrow on the same line`);
  });
});

test("lines the map can't draw have no arrows, and no arrow stands in for a missing place (TRA-176)", () => {
  // The layover isn't found, so the way out's one line goes from home straight to First, with its arrow toward First.
  const withoutLayover = mapLayout(journey, { ...everywhere, Layover: { status: "missing" } });
  assert.deepEqual(withoutLayover.lines.map((line) => [line.id, line.points.length, line.arrows.length]), [["out", 2, 1], ["between", 2, 1], ["back", 2, 1]]);
  const [home, first] = withoutLayover.lines[0].points;
  close(withoutLayover.lines[0].arrows[0].angle, heading(home, first), "toward First");
  // Without the layover and First, the way out and the train have no line, so no arrow; the way back has its own.
  const withoutFirst = mapLayout(journey, { ...everywhere, Layover: { status: "missing" }, First: { status: "unavailable" } });
  assert.deepEqual(withoutFirst.lines.map((line) => [line.id, line.arrows.length]), [["back", 1]]);
  // Lookups that haven't answered show no lines, so no arrows.
  assert.deepEqual(mapLayout(journey, {}).lines, []);
  assert.deepEqual(mapLayout(journey, { Home: found(40, -80) }).lines, []);
  // A layover found where First is goes no way from there, so only the line to the layover has an arrow.
  const atFirst = mapLayout(journey, { ...everywhere, Layover: found(48, 16) });
  assert.deepEqual(atFirst.lines[0].points, [[40, -80], [48, 16], [48, 16]]);
  assert.equal(atFirst.lines[0].arrows.length, 1);
  close(atFirst.lines[0].arrows[0].angle, heading([40, -80], [48, 16]), "toward the layover and First");
});

test("arrows take the shorter way across the 180th meridian, as their lines do (TRA-176)", () => {
  const pacific = { places: [place("departure", "departure", "Los Angeles"), place("tokyo", "destination", "Tokyo", 1), place("sydney", "destination", "Sydney", 2), place("return", "return", "Los Angeles")], legs: [
    leg("a", "Flight", "Los Angeles", "Tokyo", ["departure", "tokyo"]),
    leg("b", "Flight", "Tokyo", "Sydney", ["tokyo", "sydney"]),
    leg("c", "Flight", "Sydney", "Los Angeles", ["sydney", "return"]),
  ] };
  const { lines } = mapLayout(pacific, { "Los Angeles": found(34.05, -118.24), Tokyo: found(35.69, 139.69), Sydney: found(-33.87, 151.21) });
  // West across the Pacific to Tokyo, south to Sydney, and northeast back across it.
  assert.deepEqual(lines.map((line) => line.arrows.map((arrow) => compass(arrow.angle))), [["west"], ["south"], ["northeast"]]);
  for (const line of lines) close(onLine(line.arrows[0].position, ...line.points).along, 5 / 6, line.id + " along its line");
  assert.ok(lines[0].arrows[0].position[1] < -180, "over the Pacific, west of Los Angeles, not over Asia's far side");
});

// The map itself, on the stand-in's map, whose positions are [y, x] in pixels from its top left corner.
const marker = (key, kind, position, label, extra = {}) => ({ key, kind, position, label, number: null, target: key, found: label, photo: null, ...extra });
const line = (id, method, from, to, points, badge, arrows) => ({ id, method, from, to, points, badge, arrows, target: "connection-" + id, details: [{ term: "Transportation", value: method }] });
/**
 * A trip from Wooster by way of Frankfurt to Vienna, on to Salzburg by train and home again. Each arrow is where the trip
 * map's library puts it, five sixths of the way along its line and turned the way it goes, rounded.
 */
const trip = {
  markers: [
    marker("departure", "roundTrip", [40, 60], "Wooster, OH", { target: "connection-out" }),
    marker("itinerary-out-fra", "layover", [100, 250], "Frankfurt (FRA)"),
    marker("destination-vienna", "destination", [250, 300], "Vienna, Austria", { number: 1 }),
    marker("destination-salzburg", "destination", [260, 520], "Salzburg", { number: 2 }),
  ],
  lines: [
    line("out", "Flight", "Wooster, OH", "Vienna, Austria", [[40, 60], [100, 250], [250, 300]], [60, 123], [{ position: [90, 218], angle: 17.5 }, { position: [225, 292], angle: 71.6 }]),
    line("between", "Train", "Vienna, Austria", "Salzburg", [[250, 300], [260, 520]], [253, 373], [{ position: [258, 483], angle: 2.6 }]),
    line("back", "Flight", "Salzburg", "Wooster, OH", [[260, 520], [40, 60]], [187, 367], [{ position: [77, 137], angle: -154.4 }]),
  ],
  unmapped: [],
};
const drawn = (map) => map.arrows().map(({ position, transform }) => [position, transform]);
const PLACES = ["Departure and return: Wooster, OH", "Layover: Frankfurt (FRA)", "Destination 1: Vienna, Austria", "Destination 2: Salzburg"];
const TRANSPORTATION = ["Flight from Wooster, OH to Vienna, Austria", "Train from Vienna, Austria to Salzburg", "Flight from Salzburg to Wooster, OH"];

test("the map draws each arrow where its line has it, turned the way it goes, the same size at every zoom and width (TRA-176)", () => {
  const map = mapCanvas(trip);
  assert.deepEqual(drawn(map), [[[90, 218], "rotate(17.5deg)"], [[225, 292], "rotate(71.6deg)"], [[258, 483], "rotate(2.6deg)"], [[77, 137], "rotate(-154.4deg)"]]);
  // Leaflet keeps a marker's size as the map zooms, and the arrowhead fills it on every screen.
  assert.ok(map.arrows().every((arrow) => arrow.size[0] === 16 && arrow.size[1] === 16));
  const style = onlyRule("../src/components/trip-map.module.css", ".arrow");
  assert.deepEqual([style.width, style.height], ["16px", "16px"]);
  // The same arrowhead for every transportation, in the lines' green.
  assert.equal(style.fill, "var(--green)");
});

test("arrows are only drawn: below every place and transportation, and nothing selects, reaches or hears them (TRA-176)", () => {
  const map = mapCanvas(trip);
  const arrows = map.arrows();
  assert.equal(arrows.length, 4);
  // No tooltip, label or listener, and the arrowhead is hidden from screen readers, which hear each connection's route in
  // its transportation's label.
  for (const { zIndexOffset, keyboard, interactive, title, label, listeners, hidden } of arrows) {
    assert.deepEqual({ zIndexOffset, keyboard, interactive, title, label, listeners, hidden }, { zIndexOffset: -1000, keyboard: false, interactive: false, title: "", label: undefined, listeners: [], hidden: "true" });
  }
  // Leaflet stacks markers by their offsets and how far down the map they are, so on this map, 378 pixels tall, every
  // arrow is below every place and transportation, wherever they meet.
  const others = map.markers.filter((item) => item.element.attributes["aria-label"]);
  assert.deepEqual(others.map((item) => item.element.attributes["aria-label"]), [...PLACES, ...TRANSPORTATION]);
  assert.ok(arrows.every((arrow) => others.every((item) => arrow.zIndexOffset + 378 < item.options.zIndexOffset)));
});

test("places, previews and transportation popups work as before with arrows on the map, which stay put as it moves (TRA-176)", () => {
  const map = mapCanvas(trip);
  // The keyboard reaches the places in travel order, then each connection's transportation, and no arrow.
  assert.deepEqual(map.markers.filter((item) => item.options.keyboard).map((item) => item.element.attributes["aria-label"]), [...PLACES, ...TRANSPORTATION]);
  map.fire(PLACES[2], "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.fire(PLACES[2], "pointerleave");
  map.wait(200);
  map.click(TRANSPORTATION[1]);
  assert.deepEqual(map.opened(), ["Vienna, Austria to Salzburg"]);
  assert.equal(map.activeElement(), map.popupElement().button, "focus on View details");
  map.key("Escape");
  assert.deepEqual(map.opened(), []);
  map.click(PLACES[3]);
  assert.equal(map.page["destination-salzburg"].visits, 1, "Salzburg's marker goes to its card");
  // Moving the map moves its markers, arrows among them, and draws nothing again.
  const before = drawn(map);
  map.mapEvent("movestart");
  map.mapEvent("moveend", { x: 40, y: -25 });
  assert.deepEqual(drawn(map), before);
});

test("the map's arrows follow its layout when it is drawn again, as after a saved change (TRA-176)", () => {
  const map = mapCanvas(trip);
  // Salzburg before Vienna: the train between them goes the other way, and so does its arrow.
  map.redraw({
    markers: [trip.markers[0], { ...trip.markers[3], number: 1 }, { ...trip.markers[2], number: 2 }],
    lines: [
      line("out", "Flight", "Wooster, OH", "Salzburg", [[40, 60], [260, 520]], [113, 213], [{ position: [223, 443], angle: 25.6 }]),
      line("between", "Train", "Salzburg", "Vienna, Austria", [[260, 520], [250, 300]], [257, 447], [{ position: [252, 337], angle: -177.4 }]),
      line("back", "Flight", "Vienna, Austria", "Wooster, OH", [[250, 300], [40, 60]], [180, 220], [{ position: [75, 100], angle: -138.8 }]),
    ],
    unmapped: [],
  });
  assert.deepEqual(drawn(map), [[[223, 443], "rotate(25.6deg)"], [[252, 337], "rotate(-177.4deg)"], [[75, 100], "rotate(-138.8deg)"]]);
  // A connection removed takes its arrows with it.
  map.redraw({ ...trip, lines: trip.lines.filter((item) => item.id !== "out") });
  assert.deepEqual(drawn(map), [[[258, 483], "rotate(2.6deg)"], [[77, 137], "rotate(-154.4deg)"]]);
  map.redraw({ ...trip, lines: [] });
  assert.deepEqual(map.arrows(), []);
});
