import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { calculateBudget, calculateDestinationBudget, calculateFoodEstimate, calculateHotelEstimate, calculateMiscellaneous } from "../src/lib/budget.ts";
import { setup, tripInput, destinationInput, candidateInput, stopEdit, visit } from "./budget-fixtures.mjs";

// The largest amount the store accepts, in cents, and the most nights it can multiply while the subtotal stays exact.
const largestAmountMinor = 10_000_000_000;
const exactNights = Math.floor(Number.MAX_SAFE_INTEGER / largestAmountMinor);

test("daily food and miscellaneous use zero = one full day, otherwise nights, including unknown dates",()=>{
 for(const nights of [0,1,3,null]) for(const amount of [null,0,101,10000]) {
  const days=nights===null?null:Math.max(1,nights);
  const subtotal=days===null||amount===null?null:days*amount;
  assert.deepEqual(calculateMiscellaneous({nights,miscDailyMinor:amount,miscCurrency:"USD"}),{days,dailyMinor:amount,currency:"USD",subtotalMinor:subtotal});
  assert.deepEqual(calculateFoodEstimate({nights,foodDailyMinor:amount,foodCurrency:"USD"}),{days,dailyMinor:amount,currency:"USD",subtotalMinor:subtotal});
 }
});
test("miscellaneous and food subtotals too large to stay exact are unknown, never inexact money",()=>{
 for(const [nights,amount] of [[3,Number.MAX_SAFE_INTEGER],[exactNights+1,largestAmountMinor]]) {
  assert.equal(calculateMiscellaneous({nights,miscDailyMinor:amount,miscCurrency:"USD"}).subtotalMinor,null);
  assert.equal(calculateFoodEstimate({nights,foodDailyMinor:amount,foodCurrency:"USD"}).subtotalMinor,null);
 }
 assert.equal(calculateMiscellaneous({nights:exactNights,miscDailyMinor:largestAmountMinor,miscCurrency:"USD"}).subtotalMinor,exactNights*largestAmountMinor);
 assert.equal(calculateFoodEstimate({nights:exactNights,foodDailyMinor:largestAmountMinor,foodCurrency:"USD"}).subtotalMinor,exactNights*largestAmountMinor);
});
test("all USD categories reconcile exactly once, isolate trips, and retain active-source semantics",t=>{
 const {store,tripId}=setup(t);
 const id=store.applyMutation(destinationInput(tripId,{nights:3,hotelNightlyAmount:"100",miscDailyAmount:"10",foodBudgetMode:"daily",foodDailyAmount:"40",activitiesBudgetMode:"general",activitiesGeneralAmount:"50",shoppingAmount:"25"})).id;
 const other=store.applyMutation(tripInput({name:"Other"})).id;
 store.applyMutation(destinationInput(other,{city:"Lyon",nights:99,hotelNightlyAmount:"9999"}));
 store.applyMutation(candidateInput(id,"restaurants",{price:"9999"}));
 store.applyMutation(candidateInput(id,"activities",{price:""}));
 store.applyMutation(candidateInput(id,"hotels",{price:"9999",included:false}));
 for(const leg of store.getSnapshot().legs.filter(x=>x.tripId===tripId)) store.applyMutation({type:"leg.save",id:leg.id,method:"Train",price:"10.01",departure:"",arrival:"",url:"",notes:""});
 for(const price of ["2.02","","0"]) store.applyMutation({type:"homeItem.save",tripId,name:"Task",price,notes:"",completed:true});
 const budget=()=>calculateBudget(store.getSnapshot(),tripId);
 assert.deepEqual(calculateDestinationBudget(store.getSnapshot(),visit(store,id)).totalsByCurrency,{USD:52500});
 assert.equal(budget().totalsByCurrency.USD,54704); assert.equal(budget().complete,true);
 assert.equal(budget().travelCents,2002); assert.equal(budget().homeCents,202);
 store.applyMutation(stopEdit(id, {nights:0}));
 assert.equal(budget().totalsByCurrency.USD,14704); // $0 hotel + $40 food + $10 misc + $50 activities + $25 shopping + travel/home
 store.applyMutation(stopEdit(id, {nights:1})); assert.equal(budget().totalsByCurrency.USD,24704);
 store.applyMutation(stopEdit(id, {nights:3})); assert.equal(budget().totalsByCurrency.USD,54704);
 store.applyMutation(tripInput({id:tripId,travelers:999,startDate:"2028-02-28"})); assert.equal(budget().totalsByCurrency.USD,54704);
 store.applyMutation(stopEdit(id, {stay:"Several months"})); assert.equal(budget().totalsByCurrency.USD,54704);
 store.applyMutation(stopEdit(id, {nights:null}));
 assert.equal(budget().totalsByCurrency.USD,9704); assert.equal(budget().missingCount,3);
});
for (const [label, amount, message, subtotal] of [
 ["miscellaneous", "miscDailyAmount", /miscellaneous subtotal is too large/, (item) => calculateMiscellaneous(item).subtotalMinor],
 ["food", "foodDailyAmount", /food subtotal is too large/, (item) => calculateFoodEstimate(item).subtotalMinor],
 ["hotel", "hotelNightlyAmount", /hotel estimate is too large/, (item) => calculateHotelEstimate(item).subtotalMinor],
]) test(`destination saves reject a ${label} subtotal too large to stay exact, keeping saved data`, t => {
 const { store, tripId } = setup(t);
 const tooLarge = { name: "ValidationError", message };
 const empty = store.getSnapshot();
 assert.throws(() => store.applyMutation(destinationInput(tripId, { nights: exactNights + 1, [amount]: "100000000" })), tooLarge);
 assert.deepEqual(store.getSnapshot(), empty, "no partial destination is created");
 const id = store.applyMutation(destinationInput(tripId, { nights: exactNights, [amount]: "100000000" })).id;
 assert.equal(subtotal(visit(store, id)), exactNights * largestAmountMinor, "the largest exact subtotal is accepted");
 const saved = store.getSnapshot();
 assert.throws(() => store.applyMutation(stopEdit(id, { nights: exactNights + 1 })), tooLarge);
 assert.deepEqual(store.getSnapshot(), saved, "a rejected nights edit keeps the saved destination");
});
test("budgets for an unknown trip count one missing estimate and are never complete, and a stop needs its destination", t => {
 const { store, tripId } = setup(t);
 store.applyMutation(destinationInput(tripId, { nights: 3, hotelNightlyAmount: "100", miscDailyAmount: "10" }));
 const snapshot = store.getSnapshot();
 assert.throws(() => calculateBudget({ ...snapshot, destinations: [] }, tripId), /must come with the destination it visits/);
 const budget = calculateBudget(snapshot, randomUUID());
 assert.equal(budget.missingCount, 1);
 assert.equal(budget.knownCount, 0);
 assert.equal(budget.complete, false);
 assert.deepEqual(budget.totalsByCurrency, {});
});
