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

// The other word forms (TRA-117): plane, fly, railway, drive, ride share and walk, and the plural of each term for a
// vehicle or a ride.
const WORD_FORMS = {
  airplane: ["Flights", "airplanes", "Plane", "planes", "Fly", "jets"],
  train: ["Trains", "Railway", "subways", "trams"],
  car: ["Cars", "Drive", "rental cars", "taxis", "rideshares", "Ride share", "ride shares", "Ubers", "Lyfts"],
  bus: ["Buses", "coaches", "shuttles"],
  boat: ["Boats", "Ferries", "cruises", "ships"],
  walking: ["Walk"],
  bicycle: ["bikes", "bicycles"],
};

/** Alternating capitals, such as "FlIgHtS". */
const mixedCase = (text) => [...text].map((letter, index) => index % 2 === 0 ? letter.toUpperCase() : letter.toLowerCase()).join("");

/** Each term shows its icon, alone or in a sentence, in any capitalization. */
function assertTermsShowIcons(terms) {
  assert.equal(Object.keys(terms).length, 7);
  for (const [icon, list] of Object.entries(terms)) {
    for (const term of list) {
      for (const method of [term, term.toLowerCase(), term.toUpperCase(), mixedCase(term), "Then " + term + " from the station"]) {
        assert.deepEqual(transportationIcons(method), [icon], method);
      }
    }
  }
}

test("every approved term shows its icon in any capitalization", () => {
  assertTermsShowIcons(APPROVED);
});

test("plurals and other word forms show their kind's icon in any capitalization", () => {
  assertTermsShowIcons(WORD_FORMS);
});

test("several kinds written as plurals or other word forms show in the order entered, each once", () => {
  assert.deepEqual(transportationIcons("Flights and trains"), ["airplane", "train"]);
  assert.deepEqual(transportationIcons("Drive to the port, ferries to the islands, then walk"), ["car", "boat", "walking"]);
  assert.deepEqual(transportationIcons("FLY, then buses and bikes"), ["airplane", "bus", "bicycle"]);
  assert.deepEqual(transportationIcons("Railway or ride-share"), ["train", "car"]);
  // A plural or other word form and a term of the same kind show that kind once.
  assert.deepEqual(transportationIcons("Plane, then flights and a jet"), ["airplane"]);
  assert.deepEqual(transportationIcons("Cars, taxis and a long drive"), ["car"]);
  assert.deepEqual(transportationIcons("Boats and a ferry"), ["boat"]);
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
  for (const method of ["Planet", "Butterfly", "Driveway", "Walker", "Oscars", "Flightless", "Trainspotting", "Railwayman", "Bikeshed"]) {
    assert.deepEqual(transportationIcons(method), ["route"], method);
  }
  // A phrase needs all its words, together and in order.
  for (const method of ["Rental", "Foot", "On the foot path", "Ride", "Share"]) assert.deepEqual(transportationIcons(method), ["route"], method);
  assert.deepEqual(transportationIcons("Car rental"), ["car"]);
  // Spaces, hyphens and punctuation separate words.
  assert.deepEqual(transportationIcons("Rental-car"), ["car"]);
  assert.deepEqual(transportationIcons("Ride-share"), ["car"]);
  assert.deepEqual(transportationIcons("on-foot"), ["walking"]);
  assert.deepEqual(transportationIcons("On   foot"), ["walking"]);
  assert.deepEqual(transportationIcons("Train/flight"), ["train", "airplane"]);
  assert.deepEqual(transportationIcons("Bus+ferry (Uber)"), ["bus", "boat", "car"]);
  assert.deepEqual(transportationIcons("Airport shuttle"), ["bus"]);
});

test("blank or unrecognized transportation shows the generic route icon", () => {
  for (const method of ["", "   ", "Gondola", "TBD", "Hovercraft or zip line", "Gondolas", "Tuk-tuks or zip lines"]) {
    assert.deepEqual(transportationIcons(method), ["route"], JSON.stringify(method));
  }
});
