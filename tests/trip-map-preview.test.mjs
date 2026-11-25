import assert from "node:assert/strict";
import test from "node:test";
import { mapCanvas as drawMap, thumbnailUrl } from "./trip-map-canvas.mjs";

// TRA-143: the trip map's destination previews, from the real map component, with the stand-ins of trip-map-canvas.mjs.
const PHOTO = "0b6f1c2e-6f5a-4b7e-9a51-3c4d5e6f7a8b";
const photo = { destinationId: "vienna-id", id: PHOTO, version: "v2", focusX: 20, focusY: 80 };
const marker = (key, kind, position, label, details = {}) => ({ key, kind, position, label, number: null, target: key, found: label, photo: null, ...details });
/**
 * A trip from Wooster by way of Frankfurt to Vienna, with a primary photo, and Salzburg, without photos. Each position is
 * the point the stand-in's map draws it at, as [y, x] in pixels from its top left corner.
 */
const layout = {
  markers: [
    marker("departure", "roundTrip", [40, 60], "Wooster, OH", { target: "connection-out" }),
    marker("itinerary-out-fra", "layover", [120, 150], "Frankfurt (FRA)"),
    marker("itinerary-out-lunch", "stop", [140, 170], "Lunch in Frankfurt"),
    marker("destination-vienna", "destination", [250, 300], "Vienna, Austria", { number: 1, found: "Vienna, Vienna, Austria", photo }),
    marker("destination-salzburg", "destination", [30, 590], "Salzburg", { number: 2 }),
  ],
  lines: [{ id: "out", points: [[40, 60], [250, 300]], badge: [110, 140], arrows: [], method: "Flight", from: "Wooster, OH", to: "Vienna, Austria", target: "connection-out", details: [{ term: "Transportation", value: "Flight" }] }],
  unmapped: [],
};
const VIENNA = "Destination 1: Vienna, Austria", SALZBURG = "Destination 2: Salzburg";

/** The trip's map, 600 by 378 pixels, in a stand-in page whose elements record being scrolled to and focused. */
const mapCanvas = () => drawMap(layout);

test("hovering a destination's marker previews its name and primary photo, cropped as saved, above the marker (TRA-143)", () => {
  const map = mapCanvas();
  assert.deepEqual(map.previews(), []);
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.previews(), [{
    name: "Vienna, Austria",
    // The thumbnail the destination's gallery shows, cropped around its focal point. The name follows, so it is decorative.
    photo: { src: "/api/destination-images/vienna-id/" + PHOTO + "/thumbnail?v=v2", alt: "", position: "20% 80%" },
    // Screen readers have the destination's name from the marker's label, so the preview, which repeats it, is hidden.
    hidden: "true",
    // Centered 6 pixels above the 30-pixel marker at 300, 250.
    left: "200px", top: "97px",
  }]);
  assert.equal(map.previews()[0].photo.src, thumbnailUrl("vienna-id", photo));
});

test("a destination without photos previews its name alone, below its marker near the map's top and inside its edge (TRA-143)", () => {
  const map = mapCanvas();
  map.fire(SALZBURG, "pointerenter", { pointerType: "mouse" });
  // With no room above the marker at 590, 30, the name, 36 pixels tall, goes below it, 8 pixels inside the map's right edge.
  assert.deepEqual(map.previews(), [{ name: "Salzburg", photo: null, hidden: "true", left: "392px", top: "51px" }]);
});

test("the preview stays while the pointer moves between the marker and the preview, and closes a moment after it leaves both (TRA-143)", () => {
  const map = mapCanvas();
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  // Leaving the marker for the preview, across the gap between them.
  map.fire(VIENNA, "pointerleave");
  map.wait(150);
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.hoverPreview(true);
  map.wait(5000);
  assert.deepEqual(map.shown(), ["Vienna, Austria"], "open as long as the pointer is on the preview");
  // Back to the marker, then away from both.
  map.hoverPreview(false);
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  map.wait(5000);
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.fire(VIENNA, "pointerleave");
  map.wait(199);
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.wait(1);
  assert.deepEqual(map.shown(), [], "closed once the pointer has been off both for 200 ms");
  // A quick move straight from the marker onto the preview: React tells the preview first, then the marker hears of it.
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  map.hoverPreview(true);
  map.fire(VIENNA, "pointerleave", { relatedTarget: map.previewElement() });
  map.wait(5000);
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.hoverPreview(false);
  map.wait(200);
  assert.deepEqual(map.shown(), []);
  // From one destination's marker straight to another's, the preview follows at once and stays.
  map.fire(VIENNA, "pointerenter", { pointerType: "mouse" });
  map.fire(VIENNA, "pointerleave");
  map.fire(SALZBURG, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), ["Salzburg"]);
  map.wait(5000);
  assert.deepEqual(map.shown(), ["Salzburg"]);
});

test("the keyboard reaching a destination's marker previews it until the keyboard moves on or Escape closes it (TRA-143)", () => {
  const map = mapCanvas();
  // A click or tap focuses the marker too, on its way to the destination, without a preview.
  map.focus(VIENNA, false);
  assert.deepEqual(map.shown(), []);
  map.fire(VIENNA, "blur");
  map.focus(VIENNA, true);
  assert.deepEqual(map.previews().map((preview) => [preview.name, preview.left, preview.top]), [["Vienna, Austria", "200px", "97px"]], "the same preview as hovering shows");
  map.fire(VIENNA, "blur");
  map.focus(SALZBURG, true);
  assert.deepEqual(map.shown(), ["Salzburg"]);
  map.fire(SALZBURG, "blur");
  assert.deepEqual(map.shown(), []);
  // Escape closes it with the keyboard still on the marker. Other keys don't.
  map.focus(VIENNA, true);
  map.key("Shift");
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.key("Escape");
  assert.deepEqual(map.shown(), []);
  assert.equal(map.listening(), 0, "Escape is listened for only while a preview shows");
  // Escape closes a hovered preview too, which shows again once the pointer comes back.
  map.fire(SALZBURG, "pointerenter", { pointerType: "mouse" });
  map.key("Escape");
  assert.deepEqual(map.shown(), []);
  map.fire(SALZBURG, "pointerleave");
  map.fire(SALZBURG, "pointerenter", { pointerType: "mouse" });
  assert.deepEqual(map.shown(), ["Salzburg"]);
});

test("while the map moves, as when Leaflet brings a marker the keyboard reaches into view, the preview waits for it (TRA-143)", () => {
  const map = mapCanvas();
  // Leaflet starts moving the map as the marker takes focus, before the map's own listener hears of it.
  map.mapEvent("movestart");
  map.focus(VIENNA, true);
  assert.deepEqual(map.shown(), []);
  // Once it stops, the preview shows above the marker where the map moved it.
  map.mapEvent("moveend", { x: -100, y: 50 });
  assert.deepEqual(map.previews().map((preview) => [preview.left, preview.top]), [["100px", "147px"]]);
  map.mapEvent("zoomstart");
  assert.deepEqual(map.shown(), []);
  map.mapEvent("moveend", { x: 0, y: 0 });
  assert.deepEqual(map.previews().map((preview) => [preview.left, preview.top]), [["200px", "97px"]]);
});

test("touch shows no preview, and selecting a destination's marker goes to its card as before (TRA-143)", () => {
  const map = mapCanvas();
  map.fire(VIENNA, "pointerenter", { pointerType: "touch" });
  assert.deepEqual(map.shown(), [], "a tap has no hover");
  const card = () => map.page["destination-vienna"];
  map.marker(VIENNA).handlers.click();
  assert.equal(card().visits, 1);
  assert.equal(card().focusOptions.preventScroll, true);
  let prevented = 0;
  for (const key of ["Enter", " "]) map.marker(VIENNA).handlers.keydown({ originalEvent: { key, preventDefault() { prevented++; } } });
  assert.deepEqual([card().visits, prevented], [3, 2]);
  // A pen hovers as a mouse does, and selecting the marker while its preview shows still goes to the card.
  map.fire(VIENNA, "pointerenter", { pointerType: "pen" });
  assert.deepEqual(map.shown(), ["Vienna, Austria"]);
  map.marker(VIENNA).handlers.click();
  assert.equal(card().visits, 4);
});

test("only destinations' markers have previews: the trip's ends, layovers and stops are as they were, and transportation has a popup instead (TRA-143, TRA-175)", () => {
  const map = mapCanvas();
  assert.deepEqual(map.markers.map((item) => [item.element.attributes["aria-label"], Object.keys(item.element.listeners)]), [
    ["Departure and return: Wooster, OH", []],
    ["Layover: Frankfurt (FRA)", []],
    ["Stop along the way: Lunch in Frankfurt", []],
    [VIENNA, ["pointerenter", "pointerleave", "focus", "blur"]],
    [SALZBURG, ["pointerenter", "pointerleave", "focus", "blur"]],
    // Pointing to a connection's transportation opens its popup, which tests/trip-map-transportation-popup.test.mjs tests.
    ["Flight from Wooster, OH to Vienna, Austria", ["pointerenter", "pointerleave"]],
  ]);
  assert.deepEqual(map.previews(), []);
  // A destination's marker still names, in its tooltip, the place the map found for it.
  assert.equal(map.marker(VIENNA).options.title, VIENNA + "\nShown at Vienna, Vienna, Austria");
  assert.ok(map.markers.every((item) => item.options.keyboard && item.options.interactive));
});
