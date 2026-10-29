import assert from "node:assert/strict";
import test from "node:test";
import { calculateFoodBudget } from "../src/lib/budget.ts";
import { setup, destination, destinationInput, candidateInput, validateMoney, verifyPersistence } from "./budget-fixtures.mjs";

test("food methods preserve general estimates, items and selections without double-counting", (t)=>{
  const {store,tripId}=setup(t);
  const id=store.applyMutation(destinationInput(tripId,{nights:3})).id;
  assert.equal(destination(store,id).foodBudgetMode,"itemized");
  const item=store.applyMutation(candidateInput(id,"restaurants")).id;
  const unknown=store.applyMutation(candidateInput(id,"restaurants",{price:""})).id;
  store.applyMutation(candidateInput(id,"restaurants",{price:"99999",included:false}));
  const budget=()=>calculateFoodBudget(store.getSnapshot(),destination(store,id));
  const before=budget();
  assert.deepEqual(before.totalsByCurrency,{USD:1225}); assert.equal(before.missingCount,1);
  store.applyMutation(destinationInput(tripId,{id,foodDailyAmount:"80.25"})); assert.deepEqual(budget(),before);
  store.applyMutation(destinationInput(tripId,{id,foodBudgetMode:"daily"}));
  assert.deepEqual(budget().totalsByCurrency,{USD:24075}); assert.equal(budget().missingCount,0);
  const candidates=store.getSnapshot().candidates;
  store.applyMutation(destinationInput(tripId,{id,foodBudgetMode:"itemized"})); assert.deepEqual(budget(),before);
  store.applyMutation(destinationInput(tripId,{id,foodBudgetMode:"daily"}));
  assert.deepEqual(store.getSnapshot().candidates,candidates);
  for(const mutation of [candidateInput(id,"restaurants",{id:item,price:"20"}),{type:"candidate.include",id:unknown,included:false},{type:"candidate.delete",id:item}]){
    store.applyMutation(mutation); assert.deepEqual(budget().totalsByCurrency,{USD:24075});
    assert.equal(destination(store,id).foodBudgetMode,"daily");
  }
  store.applyMutation(destinationInput(tripId,{id,foodDailyAmount:""})); assert.equal(budget().missingCount,1);
  store.applyMutation(destinationInput(tripId,{id,foodBudgetMode:"itemized"})); assert.equal(budget().missingCount,0);
  assert.deepEqual(budget().totalsByCurrency,{});
});
test("food amount and mode validation is atomic",t=>{
  validateMoney(t,"foodDailyAmount","foodDailyMinor","foodCurrency");
  const {store,tripId}=setup(t); const before=store.getSnapshot();
  assert.throws(()=>store.applyMutation(destinationInput(tripId,{foodBudgetMode:"invalid"}))); assert.deepEqual(store.getSnapshot(),before);
});
test("food persists and upgrades additively with migration replay",t=>verifyPersistence(t,"foodDailyAmount","foodDailyMinor","foodCurrency",10,["foodBudgetMode","foodDailyMinor","foodCurrency"],{foodBudgetMode:"daily"}));
