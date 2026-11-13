import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PLANNER_UPDATED } from "../src/lib/planner-updated.ts";
import { candidateInput, destinationInput, newItem, setup, stop, tripInput } from "./budget-fixtures.mjs";
import { createOwnedStore } from "./owned-store.mjs";

const NOT_AVAILABLE = "This item no longer exists or isn't shared with you. Please refresh and try again.";
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const photo = () => ({ id: randomUUID(), data: webp });
const gallery = (...photos) => ({ add: photos, remove: [], mainImageId: photos[0].id });
const homeInput = (tripId, overrides = {}) => ({ type: "homeItem.save", tripId, name: "House sitting", price: "40", notes: "", completed: false, ...overrides, ...newItem(overrides) });
const churchInput = (destinationId, overrides = {}) => ({ type: "church.save", destinationId, name: "Duomo", address: "", denomination: "", url: "", massTimes: [], ...overrides, ...newItem(overrides) });

/** Saves a change, then sends it again, as Save does after a response is lost, and checks the second save changed nothing. */
function saveTwice(store, input) {
  const saved = store.applyMutation(input);
  const after = store.getSnapshot();
  assert.deepEqual(store.applyMutation(input), saved, input.type);
  assert.deepEqual(store.getSnapshot(), after, `${input.type} sent again changes nothing`);
  return saved.id;
}

test("a new trip, destination, idea, church or At home item sent again after a lost response is saved once", (t) => {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const tripId = saveTwice(store, tripInput({ startDate: "2027-05-01" }));
  // Adding Florence with a photo twice once saved two Florences, each with its own photo and connections.
  const florence = saveTwice(store, destinationInput(tripId, { city: "Florence", nights: 3, gallery: gallery(photo()) }));
  const idea = saveTwice(store, candidateInput(florence, "activities", { gallery: gallery(photo(), photo()) }));
  const church = saveTwice(store, churchInput(florence, { gallery: gallery(photo()) }));
  const homeItem = saveTwice(store, homeInput(tripId));
  const saved = store.getSnapshot();
  assert.deepEqual(saved.trips.map((item) => item.id), [tripId]);
  assert.deepEqual(saved.destinations.map((item) => [item.id, item.images.length]), [[florence, 1]]);
  assert.deepEqual(saved.stops.map((item) => [item.id, item.arrivalDate, item.departureDate]), [[florence, "2027-05-01", "2027-05-04"]]);
  assert.equal(saved.legs.length, 2, "one connection to Florence and one back");
  assert.deepEqual(saved.candidates.map((item) => [item.id, item.images.length]), [[idea, 2]]);
  assert.deepEqual(saved.churches.map((item) => [item.id, item.images.length]), [[church, 1]]);
  assert.deepEqual(saved.homeItems.map((item) => item.id), [homeItem]);
});

test("a new item sent again with changes saves them to that item, keeping the photos it already saved", (t) => {
  const { store, tripId } = setup(t);
  const first = photo(), second = photo();
  const florence = destinationInput(tripId, { city: "Florence", nights: 1, gallery: gallery(first) });
  store.applyMutation(florence);
  // The editor keeps its draft after a lost response, so saving again sends the same new item with any changes made since.
  store.applyMutation({ ...florence, city: "Florence, Tuscany, Italy", nights: 2, gallery: { add: [first, second], remove: [], mainImageId: second.id } });
  const destination = store.getSnapshot().destinations.find((item) => item.id === florence.id);
  assert.equal(destination.city, "Florence, Tuscany, Italy");
  assert.deepEqual([destination.images.map((item) => item.id), destination.mainImageId], [[first.id, second.id], second.id]);
  assert.equal(stop(store, florence.id).nights, 2);
  assert.equal(store.getSnapshot().stops.length, 1);

  const earlier = store.applyMutation(candidateInput(florence.id, "activities", { name: "Uffizi" })).id;
  const idea = candidateInput(florence.id, "activities", { name: "Boboli", gallery: gallery(first) });
  store.applyMutation(idea);
  store.applyMutation({ ...idea, name: "Boboli Gardens", gallery: { add: [first, second], remove: [], mainImageId: second.id } });
  const ideas = store.getSnapshot().candidates.filter((item) => item.category === "activities");
  assert.deepEqual(ideas.map((item) => [item.id, item.name]), [[earlier, "Uffizi"], [idea.id, "Boboli Gardens"]], "it keeps its place in the list");
  assert.deepEqual([ideas[1].images.map((item) => item.id), ideas[1].mainImageId], [[first.id, second.id], second.id]);
});

test("only a new item's save adds it, and a new item's ID can't be another item's", (t) => {
  const { store, tripId } = setup(t);
  const otherTripId = store.applyMutation(tripInput({ name: "Other trip" })).id;
  const florence = store.applyMutation(destinationInput(tripId, { city: "Florence" })).id;
  const rome = store.applyMutation(destinationInput(otherTripId, { city: "Rome" })).id;
  const homeItem = store.applyMutation(homeInput(otherTripId)).id;
  const idea = store.applyMutation(candidateInput(rome, "hotels")).id;
  const church = store.applyMutation(churchInput(rome)).id;
  const before = store.getSnapshot();
  // A change names a saved item. One that no longer exists is refused, never added.
  const missing = randomUUID();
  for (const input of [tripInput({ id: missing }), homeInput(tripId, { id: missing }), candidateInput(florence, "hotels", { id: missing }), churchInput(florence, { id: missing }), { type: "destination.save", id: missing, notes: "Missing" }]) {
    assert.throws(() => store.applyMutation(input), { name: "ValidationError", message: NOT_AVAILABLE }, input.type);
  }
  // A page opened before saves named their new items adds one without an ID. Nothing is saved, and it is asked to reload.
  const outdated = { id: undefined, create: undefined };
  for (const input of [{ ...tripInput(), ...outdated }, { ...homeInput(tripId), ...outdated }, { ...destinationInput(tripId, { city: "Elsewhere" }), ...outdated }, { ...churchInput(florence), ...outdated }, { ...candidateInput(florence, "hotels"), ...outdated }]) {
    assert.throws(() => store.applyMutation(input), { name: "ValidationError", message: PLANNER_UPDATED }, input.type);
  }
  // `create` is only ever true.
  assert.throws(() => store.applyMutation({ ...tripInput(), create: false }), { name: "ValidationError", message: "create must be true or left out." });
  // A new item's ID never saves over another item, even one in the account's other trip.
  for (const [input, message] of [
    [homeInput(tripId, { id: homeItem, create: true }), "This home item belongs to a different trip."],
    [candidateInput(florence, "hotels", { id: idea, create: true }), "This idea belongs to a different destination or list."],
    [churchInput(florence, { id: church, create: true }), "This church belongs to a different destination."],
    [destinationInput(tripId, { id: rome, create: true, city: "Elsewhere" }), NOT_AVAILABLE],
  ]) {
    assert.throws(() => store.applyMutation(input), { name: "ValidationError", message }, input.type);
  }
  assert.deepEqual(store.getSnapshot(), before, "nothing was saved");
});

test("photos added by a change whose response was lost are kept once when it is saved again", (t) => {
  const { store, tripId } = setup(t);
  const florence = store.applyMutation(destinationInput(tripId, { city: "Florence" })).id;
  const rome = store.applyMutation(destinationInput(tripId, { city: "Rome", gallery: gallery(photo()) })).id;
  const idea = store.applyMutation(candidateInput(florence, "hotels")).id;
  const romePhotoOfIdea = photo();
  store.applyMutation(candidateInput(rome, "hotels", { gallery: gallery(romePhotoOfIdea) }));
  const church = store.applyMutation(churchInput(florence)).id;
  const [destinationPhoto, ideaPhoto, churchPhoto] = [photo(), photo(), photo()];
  saveTwice(store, { type: "destination.save", id: florence, gallery: gallery(destinationPhoto) });
  saveTwice(store, candidateInput(florence, "hotels", { id: idea, gallery: gallery(ideaPhoto) }));
  saveTwice(store, churchInput(florence, { id: church, gallery: gallery(churchPhoto) }));
  const saved = store.getSnapshot();
  assert.deepEqual(saved.destinations.find((item) => item.id === florence).images.map((item) => item.id), [destinationPhoto.id]);
  assert.deepEqual(saved.candidates.find((item) => item.id === idea).images.map((item) => item.id), [ideaPhoto.id]);
  assert.deepEqual(saved.churches.find((item) => item.id === church).images.map((item) => item.id), [churchPhoto.id]);
  // A photo another item has is still refused.
  const romePhoto = saved.destinations.find((item) => item.id === rome).images[0];
  assert.throws(() => store.applyMutation({ type: "destination.save", id: florence, gallery: { add: [{ id: romePhoto.id, data: webp }], remove: [] } }), { name: "ValidationError", message: "This destination photo already exists. Refresh and try again." });
  assert.throws(() => store.applyMutation(candidateInput(florence, "hotels", { id: idea, gallery: { add: [romePhotoOfIdea], remove: [] } })), { name: "ValidationError", message: "This photo already exists. Refresh and try again." });
  assert.deepEqual(store.getSnapshot(), saved);
});
