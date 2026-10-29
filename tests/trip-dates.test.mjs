import assert from "node:assert/strict";
import test from "node:test";
import { backup, DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { addNights, backfillDates, churchDateEligible, formatCalendarDate, sequenceDates } from "../src/lib/trip-dates.ts";
import { createStore, ValidationError } from "../src/lib/store.ts";
import { setup, tripInput, destinationInput, destination, fileDatabase, candidateInput } from "./budget-fixtures.mjs";

test("automatic sequence, calendar boundaries, same-day and unknown lengths", () => {
  const stops = [{ id: "Paris", nights: 3 }, { id: "Rome", nights: 2 }];
  assert.deepEqual(sequenceDates("2027-06-01", stops), { endDate: "2027-06-06", destinations: [
    { id: "Paris", arrivalDate: "2027-06-01", departureDate: "2027-06-04" }, { id: "Rome", arrivalDate: "2027-06-04", departureDate: "2027-06-06" },
  ] });
  for (const [start, nights, end] of [["2027-03-13",2,"2027-03-15"],["2027-11-06",2,"2027-11-08"],["2028-02-28",2,"2028-03-01"],["2027-12-31",1,"2028-01-01"],["0001-01-01",0,"0001-01-01"],["9999-12-31",0,"9999-12-31"]]) assert.equal(addNights(start,nights),end);
  assert.throws(() => addNights("9999-12-31",1));
  for (const start of [null,"2027-06-01"]) {
    const result = sequenceDates(start,[{id:"one",nights:0},{id:"two",nights:null},{id:"three",nights:3}]);
    assert.equal(result.endDate,null);
    assert.equal(result.destinations[1].arrivalDate,null);
    assert.equal(result.destinations[2].departureDate,null);
    if (start) assert.equal(result.destinations[0].arrivalDate,result.destinations[0].departureDate);
  }
  assert.match(formatCalendarDate("2027-06-06"),/^Sun,/);
});

test("night/order/start edits recalculate the entire affected sequence and preserve saved options", t => {
  const {store,tripId}=setup(t);
  store.applyMutation(tripInput({id:tripId,startDate:"2027-06-01"}));
  const first=store.applyMutation(destinationInput(tripId,{city:"Paris",nights:3})).id;
  const second=store.applyMutation(destinationInput(tripId,{city:"Rome",nights:2})).id;
  const third=store.applyMutation(destinationInput(tripId,{city:"Venice",nights:0})).id;
  store.applyMutation(candidateInput(second,"activities"));
  const items=store.getSnapshot().candidates;
  assert.equal(store.getSnapshot().trips[0].endDate,"2027-06-06");
  store.applyMutation(destinationInput(tripId,{id:first,city:"Paris",nights:4}));
  assert.equal(destination(store,second).arrivalDate,"2027-06-05");
  store.applyMutation({type:"destination.move",id:second,direction:"up"});
  assert.equal(destination(store,second).arrivalDate,"2027-06-01");
  assert.equal(destination(store,first).arrivalDate,"2027-06-03");
  store.applyMutation(tripInput({id:tripId,startDate:"2028-02-28"}));
  assert.equal(destination(store,first).arrivalDate,"2028-03-01");
  store.applyMutation({type:"destination.delete",id:first});
  assert.equal(destination(store,third).arrivalDate,"2028-03-01");
  store.applyMutation(destinationInput(tripId,{id:second,city:"Rome",nights:null}));
  assert.equal(destination(store,second).arrivalDate,null);
  assert.equal(destination(store,third).arrivalDate,null);
  assert.equal(store.getSnapshot().trips[0].endDate,null);
  assert.deepEqual(store.getSnapshot().candidates,items);
});

test("server rejects date overrides, invalid start/nights and overflow atomically", t => {
  const {store,tripId}=setup(t);
  store.applyMutation(tripInput({id:tripId,startDate:"9999-12-30"}));
  const id=store.applyMutation(destinationInput(tripId,{nights:1})).id;
  const before=store.getSnapshot();
  for(const fields of [{nights:-1},{nights:1.5},{nights:"3"},{nights:NaN},{nights:3652059},{nights:2},{arrivalDate:"2027-06-01"},{departureDate:null}]) {
    assert.throws(()=>store.applyMutation(destinationInput(tripId,{id,...fields})),ValidationError);
    assert.deepEqual(store.getSnapshot(),before);
  }
  for(const fields of [{startDate:"2027-02-29"},{startDate:"0000-01-01"},{startDate:"9999-12-31"},{startDate:42},{endDate:"2027-06-04"}]) {
    assert.throws(()=>store.applyMutation(tripInput({id:tripId,...fields})),ValidationError);
    assert.deepEqual(store.getSnapshot(),before);
  }
});

test("church placement uses inclusive Sundays and respects hiding through every date change",t=>{
  const {store,tripId}=setup(t);
  const first=store.applyMutation(destinationInput(tripId,{nights:1})).id;
  const second=store.applyMutation(destinationInput(tripId,{nights:0})).id;
  const visible=id=>destination(store,id).churchEnabled && churchDateEligible(destination(store,id));
  assert.equal(visible(first),true); assert.equal(visible(second),true,"unknown dates show Church");
  store.applyMutation(tripInput({id:tripId,startDate:"2027-06-05"}));
  assert.equal(visible(first),true); assert.equal(visible(second),true,"shared Sunday counts at both endpoints");
  const churchId=store.applyMutation({type:"church.save",destinationId:second,name:"Chapel",address:"",denomination:"",url:"",massTimes:[]}).id;
  store.applyMutation({type:"destination.churchVisibility",id:second,enabled:false});
  for(const startDate of ["2027-06-12",null,"2027-06-01","2027-06-05"]) {
    store.applyMutation(tripInput({id:tripId,startDate})); assert.equal(visible(second),false);
  }
  store.applyMutation({type:"destination.churchVisibility",id:second,enabled:true});
  store.applyMutation(tripInput({id:tripId,startDate:"2027-06-01"}));
  assert.equal(visible(second),false,"manual enabling cannot override a known Sunday-free stay");
  store.applyMutation(destinationInput(tripId,{id:first,nights:20})); assert.equal(visible(first),true);
  assert.equal(store.getSnapshot().churches[0].id,churchId);
});

test("backfill never guesses from partial, inconsistent, invalid or missing date ranges",()=>{
  const ranges=(pairs)=>pairs.map(([arrivalDate,departureDate],i)=>({id:String(i),arrivalDate,departureDate}));
  for(const pairs of [
    [["2027-06-01","2027-06-04"],["2027-06-05","2027-06-07"]],
    [["2027-06-01","2027-06-04"],["2027-06-03","2027-06-07"]],
    [["2027-06-05","2027-06-01"]], [["2027-02-29","2027-03-01"]],
    [["2027-06-01",null]], [[null,"2027-06-01"]], [[null,null]],
    [["9999-12-30","9999-12-31"],["0001-01-01","9999-12-31"]],
  ]) assert.equal(backfillDates(ranges(pairs)).startDate,null,JSON.stringify(pairs));
  assert.deepEqual(backfillDates(ranges([["2027-06-01","2027-06-04"],["2027-06-04","2027-06-04"],["2027-06-04","2027-06-06"]])),{startDate:"2027-06-01",destinations:[{id:"0",nights:3},{id:"1",nights:0},{id:"2",nights:2}]});
});

for (const consistent of [true,false]) test(`schema 14 date backfill, originals, replay and online backup (${consistent ? "consistent" : "gapped"})`,async t=>{
  const path=fileDatabase(t);
  let store=createStore(path);
  const tripId=store.applyMutation(tripInput()).id;
  const first=store.applyMutation(destinationInput(tripId,{hotelNightlyAmount:"123.45",weatherHighF:0,weatherLowF:-12.5})).id;
  const second=store.applyMutation(destinationInput(tripId,{city:"Rome"})).id;
  const candidateId=store.applyMutation(candidateInput(first,"hotels")).id;
  const image=new Uint8Array([82,73,70,70,4,0,0,0,87,69,66,80]);
  store.applyMutation({type:"church.save",destinationId:first,name:"Chapel",address:"",denomination:"",url:"",massTimes:[],gallery:{add:[{id:randomUUID(),data:image}],remove:[]}});
  const old=store.getSnapshot();
  store.close();
  let db=new DatabaseSync(path);
  db.prepare("UPDATE destinations SET arrivalDate=?,departureDate=? WHERE id=?").run("2027-06-01","2027-06-04",first);
  db.prepare("UPDATE destinations SET arrivalDate=?,departureDate=? WHERE id=?").run(consistent?"2027-06-04":"2027-06-05","2027-06-06",second);
  db.exec("ALTER TABLE trips DROP COLUMN startDate; ALTER TABLE destinations DROP COLUMN nights; ALTER TABLE destinations DROP COLUMN legacyArrivalDate; ALTER TABLE destinations DROP COLUMN legacyDepartureDate; PRAGMA user_version=14;"); db.close();
  store=createStore(path);
  try {
    const saved=store.getSnapshot();
    assert.equal(saved.trips[0].startDate,consistent?"2027-06-01":null);
    assert.equal(destination(store,first).nights,consistent?3:null);
    assert.equal(destination(store,first).legacyArrivalDate,"2027-06-01");
    assert.equal(destination(store,second).legacyArrivalDate,consistent?"2027-06-04":"2027-06-05");
    assert.equal(destination(store,first).hotelNightlyMinor,12345);
    assert.equal(destination(store,first).weatherHighF,0);
    assert.deepEqual(saved.candidates,old.candidates); assert.equal(saved.candidates[0].id,candidateId);
    assert.deepEqual(saved.legs,old.legs); assert.deepEqual(saved.churches,old.churches);
    assert.equal(saved.trips[0].dateLabel,old.trips[0].dateLabel); assert.equal(destination(store,first).stay,"Stay notes");
    store.applyMutation(tripInput({id:tripId,startDate:"2028-02-28"}));
    store.applyMutation(destinationInput(tripId,{id:first,nights:0}));
    store.applyMutation(destinationInput(tripId,{id:second,city:"Rome",nights:2}));
    store.applyMutation({type:"destination.churchVisibility",id:first,enabled:false});
    const edited=store.getSnapshot();
    store.close(); db=new DatabaseSync(path); db.exec("PRAGMA user_version=14"); db.close();
    store=createStore(path); assert.deepEqual(store.getSnapshot(),edited);
    db=new DatabaseSync(path,{readOnly:true}); await backup(db,path+".backup"); db.close();
    const restored=createStore(path+".backup");
    try { assert.deepEqual(restored.getSnapshot(),edited); } finally { restored.close(); }
    db=new DatabaseSync(path,{readOnly:true}); assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok"); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]); db.close();
  } finally { store.close(); }
});

test("contrary legacy currency aborts the upgrade without relabeling amounts or advancing schema",t=>{
  const path=fileDatabase(t); let store=createStore(path);
  const tripId=store.applyMutation(tripInput()).id;
  const id=store.applyMutation(destinationInput(tripId,{shoppingAmount:"123.45"})).id;
  store.close(); const db=new DatabaseSync(path);
  db.prepare("UPDATE destinations SET shoppingCurrency='KWD' WHERE id=?").run(id); db.exec("PRAGMA user_version=14");
  assert.throws(()=>createStore(path),/Unexpected non-USD data/);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version,14);
  assert.equal(db.prepare("SELECT shoppingMinor FROM destinations WHERE id=?").get(id).shoppingMinor,12345);
  assert.equal(db.prepare("SELECT shoppingCurrency FROM destinations WHERE id=?").get(id).shoppingCurrency,"KWD"); db.close();
});
