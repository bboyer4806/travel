import assert from "node:assert/strict";
import test from "node:test";
import { transportationIcons } from "../src/lib/transportation-methods.ts";

// The approved terms for each icon (TRA-112).
const APPROVED = {
  airplane: ["Flight", "airplane", "flying", "air", "jet"],
  train: ["Train", "rail", "subway", "tram"],
  car: ["Car", "driving", "rental car", "taxi", "rideshare", "road", "Uber", "Lyft"],
  bus: ["Bus", "coach", "shuttle"],
  boat: ["Boat", "ferry", "cruise", "ship", "sea", "water"],
  walking: ["Walking", "on foot"],
  bicycle: ["Bike", "bicycle", "cycling"],
};

test("every approved term shows its icon in any capitalization", () => {
  assert.equal(Object.keys(APPROVED).length, 7);
  for (const [icon, terms] of Object.entries(APPROVED)) {
    for (const term of terms) {
      for (const method of [term, term.toLowerCase(), term.toUpperCase(), "Then " + term + " from the station"]) {
        assert.deepEqual(transportationIcons(method), [icon], method);
      }
    }
  }
});

test("several kinds of transportation show in the order entered", () => {
  assert.deepEqual(transportationIcons("Train and flight"), ["train", "airplane"]);
  assert.deepEqual(transportationIcons("Flight and train"), ["airplane", "train"]);
  assert.deepEqual(transportationIcons("Uber to the airport, jet to Vienna, then subway"), ["car", "airplane", "train"]);
  assert.deepEqual(transportationIcons("On foot to the pier, ferry, then shuttle and bike"), ["walking", "boat", "bus", "bicycle"]);
  assert.deepEqual(transportationIcons("TRAIN OR BUS"), ["train", "bus"]);
});

test("each kind of transportation shows once however many of its terms are entered", () => {
  assert.deepEqual(transportationIcons("Flight, connecting jet, then another flight"), ["airplane"]);
  assert.deepEqual(transportationIcons("Taxi, train, then rental car and Lyft"), ["car", "train"]);
  assert.deepEqual(transportationIcons("Cruise ship by sea, then ferry across the water"), ["boat"]);
  assert.deepEqual(transportationIcons("Bus, coach or shuttle"), ["bus"]);
});

test("terms match only as complete words or phrases", () => {
  for (const method of ["Airbnb", "Seattle", "Business class", "Training", "Oscar", "Coaching", "Watershed", "Shipment", "Tramp", "Roadmap", "Busy", "Biker"]) {
    assert.deepEqual(transportationIcons(method), ["route"], method);
  }
  // A phrase needs all its words, together and in order.
  for (const method of ["Rental", "Foot", "On the foot path"]) assert.deepEqual(transportationIcons(method), ["route"], method);
  assert.deepEqual(transportationIcons("Car rental"), ["car"]);
  // Spaces, hyphens and punctuation separate words.
  assert.deepEqual(transportationIcons("Rental-car"), ["car"]);
  assert.deepEqual(transportationIcons("on-foot"), ["walking"]);
  assert.deepEqual(transportationIcons("On   foot"), ["walking"]);
  assert.deepEqual(transportationIcons("Train/flight"), ["train", "airplane"]);
  assert.deepEqual(transportationIcons("Bus+ferry (Uber)"), ["bus", "boat", "car"]);
  assert.deepEqual(transportationIcons("Airport shuttle"), ["bus"]);
});

test("blank or unrecognized transportation shows the generic route icon", () => {
  for (const method of ["", "   ", "Gondola", "TBD", "Hovercraft or zip line"]) {
    assert.deepEqual(transportationIcons(method), ["route"], JSON.stringify(method));
  }
});
