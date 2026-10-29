import assert from "node:assert/strict";
import test from "node:test";
import { calculateBudget, calculateDestinationBudget, calculateFoodEstimate, calculateMiscellaneous } from "../src/lib/budget.ts";
import { setup, tripInput, destinationInput, candidateInput } from "./budget-fixtures.mjs";

test("daily food and miscellaneous use zero = one full day, otherwise nights, including unknown dates",()=>{
 for(const nights of [0,1,3,null]) for(const amount of [null,0,101,10000]) {
  const days=nights===null?null:Math.max(1,nights);
  const subtotal=days===null||amount===null?null:days*amount;
  assert.deepEqual(calculateMiscellaneous({nights,miscDailyMinor:amount,miscCurrency:"USD"}),{days,dailyMinor:amount,currency:"USD",subtotalMinor:subtotal});
  assert.deepEqual(calculateFoodEstimate({nights,foodDailyMinor:amount,foodCurrency:"USD"}),{days,dailyMinor:amount,currency:"USD",subtotalMinor:subtotal});
 }
});
test("all USD categories reconcile exactly once, isolate trips, and retain active-source semantics",t=>{
 const {store,tripId}=setup(t);
 const id=store.applyMutation(destinationInput(tripId,{nights:3,hotelNightlyAmount:"100",miscDailyAmount:"10",foodBudgetMode:"daily",foodDailyAmount:"40",activitiesBudgetMode:"general",activitiesGeneralAmount:"50",shoppingAmount:"25"})).id;
 const other=store.applyMutation(tripInput({name:"Other"})).id;
 store.applyMutation(destinationInput(other,{nights:99,hotelNightlyAmount:"9999"}));
 store.applyMutation(candidateInput(id,"restaurants",{price:"9999"}));
 store.applyMutation(candidateInput(id,"activities",{price:""}));
 store.applyMutation(candidateInput(id,"hotels",{price:"9999",included:false}));
 for(const leg of store.getSnapshot().legs.filter(x=>x.tripId===tripId)) store.applyMutation({type:"leg.save",id:leg.id,method:"Train",price:"10.01",departure:"",arrival:"",url:"",notes:""});
 for(const price of ["2.02","","0"]) store.applyMutation({type:"homeItem.save",tripId,name:"Task",price,notes:"",completed:true});
 const budget=()=>calculateBudget(store.getSnapshot(),tripId);
 assert.deepEqual(calculateDestinationBudget(store.getSnapshot(),id).totalsByCurrency,{USD:52500});
 assert.equal(budget().totalCents,54704); assert.equal(budget().complete,true);
 assert.equal(budget().travelCents,2002); assert.equal(budget().homeCents,202);
 store.applyMutation(destinationInput(tripId,{id,nights:0}));
 assert.equal(budget().totalCents,14704); // $0 hotel + $40 food + $10 misc + $50 activities + $25 shopping + travel/home
 store.applyMutation(destinationInput(tripId,{id,nights:1})); assert.equal(budget().totalCents,24704);
 store.applyMutation(destinationInput(tripId,{id,nights:3})); assert.equal(budget().totalCents,54704);
 store.applyMutation(tripInput({id:tripId,travelers:999,startDate:"2028-02-28"})); assert.equal(budget().totalCents,54704);
 store.applyMutation(destinationInput(tripId,{id,stay:"Several months"})); assert.equal(budget().totalCents,54704);
 store.applyMutation(destinationInput(tripId,{id,nights:null}));
 assert.equal(budget().totalCents,9704); assert.equal(budget().missingCount,3);
});
