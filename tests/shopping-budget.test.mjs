import assert from "node:assert/strict";
import test from "node:test";
import { calculateBudget, calculateActivitiesBudget } from "../src/lib/budget.ts";
import { setup, destination, tripInput, destinationInput, validateMoney, verifyPersistence } from "./budget-fixtures.mjs";

test("optional shopping distinguishes unset and zero without requiring dates",t=>{
 const {store,tripId}=setup(t); const id=store.applyMutation(destinationInput(tripId)).id;
 const before=calculateBudget(store.getSnapshot(),tripId);
 store.applyMutation(destinationInput(tripId,{id,shoppingAmount:"0"}));
 const zero=calculateBudget(store.getSnapshot(),tripId);
 assert.deepEqual(zero.shoppingByCurrency,{USD:0}); assert.equal(zero.missingCount,before.missingCount); assert.equal(zero.knownCount,before.knownCount+1);
 for(const nights of [0,1,30,null]) {
  store.applyMutation(destinationInput(tripId,{id,nights,shoppingAmount:"12.34",activitiesBudgetMode:"general",activitiesGeneralAmount:"56.78"}));
  store.applyMutation(tripInput({id:tripId,travelers:999}));
  assert.deepEqual(calculateBudget(store.getSnapshot(),tripId).shoppingByCurrency,{USD:1234});
  assert.deepEqual(calculateActivitiesBudget(store.getSnapshot(),destination(store,id)).totalsByCurrency,{USD:5678});
 }
 store.applyMutation(destinationInput(tripId,{id,shoppingAmount:""}));
 assert.deepEqual(calculateBudget(store.getSnapshot(),tripId).shoppingByCurrency,{});
});
test("shopping validates USD precision and ownership",t=>validateMoney(t,"shoppingAmount","shoppingMinor","shoppingCurrency"));
test("shopping migration, reopen and replay preserve other data",t=>verifyPersistence(t,"shoppingAmount","shoppingMinor","shoppingCurrency",11,["shoppingMinor","shoppingCurrency"]));
