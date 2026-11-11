import assert from "node:assert/strict";
import test from "node:test";
import { MAX_AMOUNT_CENTS, MAX_AMOUNT_DOLLARS, parseMinorAmount } from "../src/lib/money.ts";
import { candidateInput, destinationInput, setup } from "./budget-fixtures.mjs";

const formatMessage = (label) => `${label} must be a positive USD amount or zero, with up to 2 decimal places. Leave it blank if unknown.`;
const limitMessage = (label) => `${label} must be $100,000,000 or less.`;

test("the amount limit is $100,000,000, in dollars for inputs and in cents for saved amounts", () => {
  assert.equal(MAX_AMOUNT_DOLLARS, 100_000_000);
  assert.equal(MAX_AMOUNT_CENTS, 10_000_000_000);
  assert.equal(parseMinorAmount("100000000", "USD", "Estimated price"), MAX_AMOUNT_CENTS);
  assert.equal(parseMinorAmount(" 100000000.00 ", "USD", "Estimated price"), MAX_AMOUNT_CENTS);
  assert.throws(() => parseMinorAmount("100000000.01", "USD", "Estimated price"), { message: limitMessage("Estimated price") });
});

test("destination amounts and estimated prices reject equivalent amounts with one message, named for the field", (t) => {
  const { store, tripId } = setup(t);
  const destinationId = store.applyMutation(destinationInput(tripId, { nights: 3 })).id;
  const legId = store.getSnapshot().legs[0].id;
  const fields = [
    ["Estimated price", (price) => candidateInput(destinationId, "activities", { price })],
    ["Estimated price", (price) => ({ type: "leg.save", id: legId, method: "Train", price, departure: "", arrival: "", url: "", notes: "" })],
    ["Estimated price", (price) => ({ type: "homeItem.save", tripId, name: "Pet sitter", price, notes: "", completed: false })],
    ["Daily miscellaneous amount", (miscDailyAmount) => destinationInput(tripId, { id: destinationId, miscDailyAmount })],
    ["Nightly hotel amount", (hotelNightlyAmount) => destinationInput(tripId, { id: destinationId, hotelNightlyAmount })],
    ["General activities amount", (activitiesGeneralAmount) => destinationInput(tripId, { id: destinationId, activitiesGeneralAmount })],
    ["Daily food amount", (foodDailyAmount) => destinationInput(tripId, { id: destinationId, foodDailyAmount })],
    ["Shopping amount", (shoppingAmount) => destinationInput(tripId, { id: destinationId, shoppingAmount })],
  ];
  for (const [label, save] of fields) {
    const before = store.getSnapshot();
    for (const value of ["-1", "1.001", "1e2", "$1", "1,000"]) {
      assert.throws(() => store.applyMutation(save(value)), { name: "ValidationError", message: formatMessage(label) });
    }
    assert.throws(() => store.applyMutation(save("100000000.01")), { name: "ValidationError", message: limitMessage(label) });
    assert.deepEqual(store.getSnapshot(), before, "a rejected amount saves nothing");
    for (const value of ["", "0", "100000000"]) store.applyMutation(save(value));
  }
});
