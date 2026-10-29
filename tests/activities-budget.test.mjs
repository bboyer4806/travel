import assert from "node:assert/strict";
import test from "node:test";
import { calculateActivitiesBudget } from "../src/lib/budget.ts";
import { setup, destination, destinationInput, candidateInput, validateMoney, verifyPersistence } from "./budget-fixtures.mjs";

test("activities methods preserve general estimates, items and selections without double-counting", (t)=>{
  const {store,tripId}=setup(t);
  const id=store.applyMutation(destinationInput(tripId,{nights:3})).id;
  assert.equal(destination(store,id).activitiesBudgetMode,"itemized");
  const item=store.applyMutation(candidateInput(id,"activities")).id;
  const unknown=store.applyMutation(candidateInput(id,"activities",{price:""})).id;
  store.applyMutation(candidateInput(id,"activities",{price:"99999",included:false}));
  const budget=()=>calculateActivitiesBudget(store.getSnapshot(),destination(store,id));
  const before=budget();
  assert.deepEqual(before.totalsByCurrency,{USD:1225}); assert.equal(before.missingCount,1);
  store.applyMutation(destinationInput(tripId,{id,activitiesGeneralAmount:"80.25"})); assert.deepEqual(budget(),before);
  store.applyMutation(destinationInput(tripId,{id,activitiesBudgetMode:"general"}));
  assert.deepEqual(budget().totalsByCurrency,{USD:8025}); assert.equal(budget().missingCount,0);
  const candidates=store.getSnapshot().candidates;
  store.applyMutation(destinationInput(tripId,{id,activitiesBudgetMode:"itemized"})); assert.deepEqual(budget(),before);
  store.applyMutation(destinationInput(tripId,{id,activitiesBudgetMode:"general"}));
  assert.deepEqual(store.getSnapshot().candidates,candidates);
  for(const mutation of [candidateInput(id,"activities",{id:item,price:"20"}),{type:"candidate.include",id:unknown,included:false},{type:"candidate.delete",id:item}]){
    store.applyMutation(mutation); assert.deepEqual(budget().totalsByCurrency,{USD:8025});
    assert.equal(destination(store,id).activitiesBudgetMode,"general");
  }
  store.applyMutation(destinationInput(tripId,{id,activitiesGeneralAmount:""})); assert.equal(budget().missingCount,1);
  store.applyMutation(destinationInput(tripId,{id,activitiesBudgetMode:"itemized"})); assert.equal(budget().missingCount,0);
  assert.deepEqual(budget().totalsByCurrency,{});
});
test("activities amount and mode validation is atomic",t=>{
  validateMoney(t,"activitiesGeneralAmount","activitiesGeneralMinor","activitiesCurrency");
  const {store,tripId}=setup(t); const before=store.getSnapshot();
  assert.throws(()=>store.applyMutation(destinationInput(tripId,{activitiesBudgetMode:"invalid"}))); assert.deepEqual(store.getSnapshot(),before);
});
test("activities persists and upgrades additively with migration replay",t=>verifyPersistence(t,"activitiesGeneralAmount","activitiesGeneralMinor","activitiesCurrency",9,["activitiesBudgetMode","activitiesGeneralMinor","activitiesCurrency"],{activitiesBudgetMode:"general"}));
