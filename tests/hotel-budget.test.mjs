import assert from "node:assert/strict";
import test from "node:test";
import { calculateBudget, calculateAccommodation } from "../src/lib/budget.ts";
import { setup, destination, tripInput, destinationInput, candidateInput, validateMoney } from "./budget-fixtures.mjs";

test("hotel estimates use entered nights, independently of dates, notes and party size", (t) => {
  const {store, tripId} = setup(t);
  const id = store.applyMutation(destinationInput(tripId, {nights:3, hotelNightlyAmount:"100.25"})).id;
  const total = () => calculateAccommodation(store.getSnapshot(), destination(store,id)).totalMinor;
  assert.equal(total(),30075);
  store.applyMutation(destinationInput(tripId,{id,nights:5})); assert.equal(total(),50125);
  store.applyMutation(tripInput({id:tripId,travelers:8,startDate:"2027-03-13"}));
  store.applyMutation(destinationInput(tripId,{id,stay:"One month"})); assert.equal(total(),50125);
  assert.equal(destination(store,id).departureDate,"2027-03-18");
  store.applyMutation(destinationInput(tripId,{id,nights:0})); assert.equal(total(),0);
  store.applyMutation(destinationInput(tripId,{id,hotelNightlyAmount:""})); assert.equal(total(),null);
  store.applyMutation(destinationInput(tripId,{id,nights:null,hotelNightlyAmount:"0"})); assert.equal(total(),null);
});
test("chosen hotels replace rather than add to the estimate; removal restores current nights", (t) => {
  const {store,tripId}=setup(t);
  const id=store.applyMutation(destinationInput(tripId,{nights:3,hotelNightlyAmount:"100.25"})).id;
  const first=store.applyMutation(candidateInput(id,"hotels",{included:false,price:"200.33"})).id;
  const second=store.applyMutation(candidateInput(id,"hotels",{included:false,price:"400"})).id;
  const total=()=>calculateAccommodation(store.getSnapshot(),destination(store,id));
  assert.equal(total().totalMinor,30075);
  store.applyMutation({type:"candidate.include",id:first,included:true}); assert.equal(total().totalMinor,20033);
  store.applyMutation({type:"candidate.include",id:second,included:true}); assert.equal(total().totalMinor,40000);
  assert.equal(store.getSnapshot().candidates.find(x=>x.id===first).included,false);
  store.applyMutation(destinationInput(tripId,{id,nights:5})); assert.equal(total().totalMinor,40000);
  store.applyMutation(candidateInput(id,"hotels",{id:second,price:""})); assert.equal(total().totalMinor,null);
  assert.equal(calculateBudget(store.getSnapshot(),tripId).hotelMissingCount,1);
  store.applyMutation(candidateInput(id,"hotels",{id:second,price:"0"})); assert.equal(total().totalMinor,0);
  store.applyMutation({type:"candidate.delete",id:second}); assert.equal(total().totalMinor,50125);
  store.applyMutation({type:"candidate.include",id:first,included:true});
  store.applyMutation({type:"candidate.include",id:first,included:false}); assert.equal(total().totalMinor,50125);
  assert.equal(destination(store,id).hotelNightlyMinor,10025);
});
test("hotel amount validation preserves the whole save",t=>validateMoney(t,"hotelNightlyAmount","hotelNightlyMinor","hotelCurrency"));
