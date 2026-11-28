import assert from "node:assert/strict";
import test from "node:test";
import { backup, DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { addNights, backfillDates, churchDateEligible, churchSundayDates, formatCalendarDate, routeDays, sequenceDates } from "../src/lib/trip-dates.ts";
import { ValidationError } from "../src/lib/store.ts";
import { createOwnedStore, UNDO_SCHEMA_21 } from "./owned-store.mjs";
import { newItem, prepared, setup, tripInput, addDestination, destination, fileDatabase, candidateInput, destinationEdit, stopEdit, stop } from "./budget-fixtures.mjs";

/**
 * A trip's connections for `stops` in route order, from the departing city to the return city, each with its nights spent
 * traveling from `travelNights`, in the same order, or none (TRA-185).
 */
const connections = (stops, travelNights = []) => {
  const route = [null, ...stops.map((stop) => stop.id), null];
  return route.slice(1).map((toId, index) => ({ fromId: route[index], toId, travelNights: travelNights[index] ?? 0 }));
};

test("automatic sequence, calendar boundaries, same-day and unknown lengths", () => {
  const stops = [{ id: "Paris", nights: 3 }, { id: "Rome", nights: 2 }];
  assert.deepEqual(sequenceDates("2027-06-01", stops, connections(stops)), { endDate: "2027-06-06", destinations: [
    { id: "Paris", arrivalDate: "2027-06-01", departureDate: "2027-06-04" }, { id: "Rome", arrivalDate: "2027-06-04", departureDate: "2027-06-06" },
  ] });
  for (const [start, nights, end] of [["2027-03-13",2,"2027-03-15"],["2027-11-06",2,"2027-11-08"],["2028-02-28",2,"2028-03-01"],["2027-12-31",1,"2028-01-01"],["0001-01-01",0,"0001-01-01"],["9999-12-31",0,"9999-12-31"]]) assert.equal(addNights(start,nights),end);
  assert.throws(() => addNights("9999-12-31",1));
  for (const start of [null,"2027-06-01"]) {
    const unknown = [{id:"one",nights:0},{id:"two",nights:null},{id:"three",nights:3}];
    const result = sequenceDates(start,unknown,connections(unknown));
    assert.equal(result.endDate,null);
    assert.equal(result.destinations[1].arrivalDate,null);
    assert.equal(result.destinations[2].departureDate,null);
    if (start) assert.equal(result.destinations[0].arrivalDate,result.destinations[0].departureDate);
  }
  assert.match(formatCalendarDate("2027-06-06"),/^Sun,/);
});

test("nights spent traveling move every later day and date, before the first stay, between stays and on the way home, and are no stay's nights (TRA-185)", () => {
  const stops = [{ id: "Paris", nights: 3 }, { id: "Rome", nights: 2 }];
  // One night flying to Paris, two on a night train to Rome and one flying home.
  const overnight = connections(stops, [1, 2, 1]);
  assert.deepEqual(routeDays(stops, overnight), {
    connections: [{ leaves: 0, arrives: 1 }, { leaves: 4, arrives: 6 }, { leaves: 8, arrives: 9 }],
    stays: [{ arrives: 1, departs: 4 }, { arrives: 6, departs: 8 }], end: 9,
  }, "Day 1 leaves, Paris is Days 2 to 5, Rome Days 7 to 9, and the trip ends on Day 10");
  assert.deepEqual(sequenceDates("2027-06-05", stops, overnight), { endDate: "2027-06-14", destinations: [
    { id: "Paris", arrivalDate: "2027-06-06", departureDate: "2027-06-09" }, { id: "Rome", arrivalDate: "2027-06-11", departureDate: "2027-06-13" },
  ] }, "the start date stays the first day, and each stay keeps its nights");
  // A connection without them arrives the day it leaves, as before.
  assert.deepEqual(routeDays(stops, connections(stops)).stays, [{ arrives: 0, departs: 3 }, { arrives: 3, departs: 5 }]);
  assert.deepEqual(sequenceDates(null, stops, overnight), { endDate: null, destinations: stops.map(({ id }) => ({ id, arrivalDate: null, departureDate: null })) }, "without a start date the days have no dates");
  // A stay without nights has its arrival day, and nothing after it has one, nor a date.
  const unknown = [{ id: "Paris", nights: 3 }, { id: "Rome", nights: null }, { id: "Venice", nights: 2 }];
  assert.deepEqual(routeDays(unknown, connections(unknown, [1, 1, 0, 0])), {
    connections: [{ leaves: 0, arrives: 1 }, { leaves: 4, arrives: 5 }, { leaves: null, arrives: null }, { leaves: null, arrives: null }],
    stays: [{ arrives: 1, departs: 4 }, { arrives: 5, departs: null }, { arrives: null, departs: null }], end: null,
  });
  assert.deepEqual(sequenceDates("2027-06-05", unknown, connections(unknown, [1, 1, 0, 0])).destinations.map(({ arrivalDate, departureDate }) => [arrivalDate, departureDate]),
    [["2027-06-06", "2027-06-09"], [null, null], [null, null]], "an incomplete stay still has no calculated range");
  assert.deepEqual(routeDays([], []), { connections: [], stays: [], end: null }, "a trip without stays has no days");
  // Every connection in the route is needed, and none may be left out.
  assert.throws(() => sequenceDates("2027-06-05", stops, overnight.slice(1)), { message: "A trip's days need every travel connection in its route." });
  // The calendar's last date, 9999-12-31, still bounds them, even before a stay whose nights are unknown.
  const beyond = { message: "This stay extends beyond December 31, 9999. Reduce the nights or change the trip start date." };
  assert.equal(sequenceDates("9999-12-25", stops, connections(stops, [0, 0, 1])).endDate, "9999-12-31");
  assert.throws(() => sequenceDates("9999-12-25", stops, connections(stops, [0, 0, 2])), beyond);
  assert.throws(() => sequenceDates("9999-12-30", [{ id: "Paris", nights: null }], connections([{ id: "Paris" }], [2, 0])), beyond);
  assert.throws(() => addNights("0001-01-01", 3652059), beyond, "more nights than the whole calendar reach past it from any date");
});

test("a connection's nights spent traveling move its trip's later dates and end, keeping its start date and every stay's nights (TRA-185)", (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-06-05" }));
  const paris = addDestination(store, tripId, { city: "Paris", nights: 3 });
  const rome = addDestination(store, tripId, { city: "Rome", nights: 2 });
  const legs = store.getSnapshot().legs;
  const leg = (fromId, toId) => legs.find((item) => item.fromId === fromId && item.toId === toId).id;
  const travel = (id, travelNights) => store.applyMutation({ type: "leg.save", id, method: "Flight", price: "", departure: "", arrival: "", url: "", notes: "", travelNights });
  const schedule = () => { const all = store.getSnapshot(); return [all.trips[0].startDate, ...[paris, rome].flatMap((id) => { const { arrivalDate, departureDate, nights } = all.stops.find((item) => item.id === id); return [arrivalDate, departureDate, nights]; }), all.trips[0].endDate]; };
  assert.deepEqual(schedule(), ["2027-06-05", "2027-06-05", "2027-06-08", 3, "2027-06-08", "2027-06-10", 2, "2027-06-10"], "a new connection has none");
  travel(leg(null, paris), 1);
  assert.deepEqual(schedule(), ["2027-06-05", "2027-06-06", "2027-06-09", 3, "2027-06-09", "2027-06-11", 2, "2027-06-11"], "an overnight flight to Paris");
  travel(leg(paris, rome), 2);
  assert.deepEqual(schedule(), ["2027-06-05", "2027-06-06", "2027-06-09", 3, "2027-06-11", "2027-06-13", 2, "2027-06-13"], "two nights on the train to Rome");
  travel(leg(rome, null), 1);
  assert.deepEqual(schedule(), ["2027-06-05", "2027-06-06", "2027-06-09", 3, "2027-06-11", "2027-06-13", 2, "2027-06-14"], "and one flying home moves only the end");
  travel(leg(paris, rome), 0);
  assert.deepEqual(schedule(), ["2027-06-05", "2027-06-06", "2027-06-09", 3, "2027-06-09", "2027-06-11", 2, "2027-06-12"], "taking nights away moves the dates back");
  // The home page's trips, and a trip's page, end where the trip does.
  assert.equal(store.getHomeOverview().data.trips[0].endDate, "2027-06-12");
  assert.equal(store.getTripSnapshot(tripId).data.trips[0].endDate, "2027-06-12");
  // A start date changed later keeps every connection's nights spent traveling.
  store.applyMutation(tripInput({ id: tripId, startDate: "2027-07-01" }));
  assert.deepEqual(schedule(), ["2027-07-01", "2027-07-02", "2027-07-05", 3, "2027-07-05", "2027-07-07", 2, "2027-07-08"]);
});

test("nights spent traveling are a whole number from 0, and a refused one, or one past the calendar's end, changes nothing (TRA-185)", (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "9999-12-20" }));
  const paris = addDestination(store, tripId, { city: "Paris", nights: 3 });
  const outbound = store.getSnapshot().legs.find((leg) => leg.toId === paris).id;
  const save = (travelNights) => ({ type: "leg.save", id: outbound, method: "Flight", price: "", departure: "", arrival: "", url: "", notes: "", travelNights });
  store.applyMutation(save(2));
  const before = store.getSnapshot();
  const invalid = { name: "ValidationError", message: "Nights spent traveling must be a whole number between 0 and 3652058." };
  for (const travelNights of [-1, 1.5, "1", null, NaN, Infinity, 3652059, true]) {
    assert.throws(() => store.applyMutation(save(travelNights)), invalid, JSON.stringify(travelNights));
    assert.deepEqual(store.getSnapshot(), before, "no partial change is saved");
  }
  // Paris then departs on 9999-12-25, so six nights home end on the calendar's last day, and seven would pass it.
  store.applyMutation({ type: "leg.save", id: store.getSnapshot().legs.find((leg) => leg.fromId === paris).id, method: "", price: "", departure: "", arrival: "", url: "", notes: "", travelNights: 6 });
  assert.equal(store.getSnapshot().trips[0].endDate, "9999-12-31");
  const latest = store.getSnapshot();
  assert.throws(() => store.applyMutation(save(3)), { name: "ValidationError", message: "This stay extends beyond December 31, 9999. Reduce the nights or change the trip start date." });
  assert.deepEqual(store.getSnapshot(), latest);
  // A save without them, as from a page opened before them, keeps them.
  store.applyMutation({ ...save(undefined), notes: "Window seats" });
  assert.equal(store.getSnapshot().legs.find((leg) => leg.id === outbound).travelNights, 2);
});

test("Clear, a new city and a new route take nights spent traveling with the rest of a connection's plan, and the dates follow (TRA-185)", (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-06-05" }));
  const paris = addDestination(store, tripId, { city: "Paris", nights: 3 });
  const rome = addDestination(store, tripId, { city: "Rome", nights: 2 });
  const legOf = (fromId, toId) => store.getSnapshot().legs.find((item) => item.tripId === tripId && item.fromId === fromId && item.toId === toId);
  const overnight = (fromId, toId) => store.applyMutation({ type: "leg.save", id: legOf(fromId, toId).id, method: "Flight", price: "", departure: "", arrival: "", url: "", notes: "", travelNights: 1 });
  const end = () => store.getSnapshot().trips[0].endDate;
  overnight(null, paris); overnight(paris, rome); overnight(rome, null);
  assert.equal(end(), "2027-06-13");
  store.applyMutation({ type: "leg.clear", id: legOf(paris, rome).id });
  assert.deepEqual([legOf(paris, rome).travelNights, stop(store, rome).arrivalDate, end()], [0, "2027-06-09", "2027-06-12"], "Clear takes them, and the later dates move back");
  assert.deepEqual([legOf(null, paris).travelNights, legOf(rome, null).travelNights], [1, 1], "other connections keep theirs");
  // A new departing city clears the connection from it, and a new city for a destination the connections to and from it.
  store.applyMutation(tripInput({ id: tripId, homeCity: "Chicago", returnCity: "Boston", startDate: "2027-06-05" }));
  assert.deepEqual([legOf(null, paris).travelNights, stop(store, paris).arrivalDate, end()], [0, "2027-06-05", "2027-06-11"]);
  overnight(paris, rome);
  store.applyMutation(destinationEdit(rome, { city: "Naples" }));
  assert.deepEqual([legOf(paris, rome).travelNights, legOf(rome, null).travelNights, stop(store, rome).arrivalDate, end()], [0, 0, "2027-06-08", "2027-06-10"]);
  // Moving a destination replaces the connections that change, which start with none; the stays keep their nights.
  overnight(null, paris); overnight(paris, rome); overnight(rome, null);
  store.applyMutation({ type: "stop.move", id: rome, direction: "up" });
  assert.deepEqual([legOf(null, rome).travelNights, legOf(rome, paris).travelNights, legOf(paris, null).travelNights], [0, 0, 0]);
  assert.deepEqual([stop(store, rome).arrivalDate, stop(store, paris).arrivalDate, end()], ["2027-06-05", "2027-06-07", "2027-06-10"]);
  assert.deepEqual([stop(store, rome).nights, stop(store, paris).nights], [2, 3]);
});

test("church Sunday dates include every Sunday and both stay endpoints", () => {
  const sundays = (arrivalDate, departureDate) => churchSundayDates({ arrivalDate, departureDate });
  assert.deepEqual(sundays("2027-06-06", "2027-06-20"), ["2027-06-06", "2027-06-13", "2027-06-20"]);
  assert.deepEqual(sundays("2027-06-05", "2027-06-06"), ["2027-06-06"], "departure Sunday counts");
  assert.deepEqual(sundays("2027-06-06", "2027-06-07"), ["2027-06-06"], "arrival Sunday counts");
  assert.deepEqual(sundays("2027-06-06", "2027-06-06"), ["2027-06-06"], "zero-night Sunday counts");
  assert.deepEqual(sundays("2027-06-07", "2027-06-07"), [], "zero-night Monday has no Sunday");
  assert.deepEqual(sundays("2027-06-07", "2027-06-12"), []);
  assert.deepEqual(sundays("2027-03-13", "2027-03-22"), ["2027-03-14", "2027-03-21"], "UTC dates survive spring DST");
  assert.deepEqual(sundays("2027-11-06", "2027-11-15"), ["2027-11-07", "2027-11-14"], "UTC dates survive fall DST");
  assert.deepEqual(sundays("9999-12-26", "9999-12-31"), ["9999-12-26"], "calendar limit does not overflow");
});

test("unknown or invalid ranges do not fabricate Sunday dates", () => {
  for (const [arrivalDate, departureDate] of [
    [null, null], ["2027-06-06", null], [null, "2027-06-06"],
    ["2027-02-29", "2027-03-01"], ["2027-06-07", "2027-06-06"],
  ]) assert.equal(churchSundayDates({ arrivalDate, departureDate }), null);
});

test("church Sunday dates follow start, nights and order edits without changing church details", t => {
  const { store, tripId } = setup(t);
  const first = addDestination(store, tripId, { city: "Paris", nights: 7 });
  const second = addDestination(store, tripId, { city: "Rome", nights: 1 });
  store.applyMutation({ type: "church.save", ...newItem(), destinationId: second, name: "Chapel", address: "", denomination: "", url: "", massTimes: [{ id: randomUUID(), day: "Sunday", time: "9:00 AM" }] });
  const churches = store.getSnapshot().churches;
  const sundays = id => churchSundayDates(stop(store, id));
  assert.equal(sundays(second), null);
  store.applyMutation(tripInput({ id: tripId, startDate: "2027-06-05" }));
  assert.deepEqual(sundays(first), ["2027-06-06"]);
  assert.deepEqual(sundays(second), ["2027-06-13"]);
  store.applyMutation(stopEdit(first, { city: "Paris", nights: 14 }));
  assert.deepEqual(sundays(first), ["2027-06-06", "2027-06-13"]);
  assert.deepEqual(sundays(second), ["2027-06-20"]);
  store.applyMutation({ type: "stop.move", id: second, direction: "up" });
  assert.deepEqual(sundays(second), ["2027-06-06"]);
  assert.deepEqual(sundays(first), ["2027-06-06", "2027-06-13", "2027-06-20"]);
  store.applyMutation(tripInput({ id: tripId, startDate: "2027-06-06" }));
  assert.deepEqual(sundays(second), ["2027-06-06"]);
  assert.deepEqual(sundays(first), ["2027-06-13", "2027-06-20"]);
  store.applyMutation(stopEdit(second, { city: "Rome", nights: null }));
  assert.equal(sundays(second), null);
  assert.equal(sundays(first), null);
  assert.deepEqual(store.getSnapshot().churches, churches);
});

test("night/order/start edits recalculate the entire affected sequence and preserve saved options", t => {
  const {store,tripId}=setup(t);
  store.applyMutation(tripInput({id:tripId,startDate:"2027-06-01"}));
  const first=addDestination(store, tripId,{city:"Paris",nights:3});
  const second=addDestination(store, tripId,{city:"Rome",nights:2});
  const third=addDestination(store, tripId,{city:"Venice",nights:0});
  store.applyMutation(candidateInput(second,"activities"));
  const items=store.getSnapshot().candidates;
  assert.equal(store.getSnapshot().trips[0].endDate,"2027-06-06");
  store.applyMutation(stopEdit(first, {city:"Paris",nights:4}));
  assert.equal(stop(store, second).arrivalDate,"2027-06-05");
  store.applyMutation({type:"stop.move",id:second,direction:"up"});
  assert.equal(stop(store, second).arrivalDate,"2027-06-01");
  assert.equal(stop(store, first).arrivalDate,"2027-06-03");
  store.applyMutation(tripInput({id:tripId,startDate:"2028-02-28"}));
  assert.equal(stop(store, first).arrivalDate,"2028-03-01");
  store.applyMutation({type:"stop.remove",id:first});
  assert.equal(stop(store, third).arrivalDate,"2028-03-01");
  store.applyMutation(stopEdit(second, {city:"Rome",nights:null}));
  assert.equal(stop(store, second).arrivalDate,null);
  assert.equal(stop(store, third).arrivalDate,null);
  assert.equal(store.getSnapshot().trips[0].endDate,null);
  assert.deepEqual(store.getSnapshot().candidates,items);
});

test("server rejects date overrides, invalid start/nights and overflow atomically", t => {
  const {store,tripId}=setup(t);
  store.applyMutation(tripInput({id:tripId,startDate:"9999-12-30"}));
  const id=addDestination(store, tripId,{nights:1});
  const before=store.getSnapshot();
  for(const fields of [{nights:-1},{nights:1.5},{nights:"3"},{nights:NaN},{nights:3652059},{nights:2},{arrivalDate:"2027-06-01"},{departureDate:null}]) {
    assert.throws(()=>store.applyMutation(destinationEdit(id, {...fields})),ValidationError);
    assert.deepEqual(store.getSnapshot(),before);
  }
  for(const fields of [{startDate:"2027-02-29"},{startDate:"0000-01-01"},{startDate:"9999-12-31"},{startDate:42},{endDate:"2027-06-04"}]) {
    assert.throws(()=>store.applyMutation(tripInput({id:tripId,...fields})),ValidationError);
    assert.deepEqual(store.getSnapshot(),before);
  }
});

test("church placement uses inclusive Sundays and respects hiding through every date change",t=>{
  const {store,tripId}=setup(t);
  const first=addDestination(store, tripId,{nights:1});
  const second=addDestination(store, tripId,{city:"Lyon",nights:0});
  const visible=id=>destination(store,id).churchEnabled && churchDateEligible(stop(store,id));
  assert.equal(visible(first),true); assert.equal(visible(second),true,"unknown dates show Church");
  store.applyMutation(tripInput({id:tripId,startDate:"2027-06-05"}));
  assert.equal(visible(first),true); assert.equal(visible(second),true,"shared Sunday counts at both endpoints");
  const churchId=store.applyMutation({type:"church.save",...newItem(),destinationId:second,name:"Chapel",address:"",denomination:"",url:"",massTimes:[]}).id;
  store.applyMutation({type:"destination.churchVisibility",id:second,enabled:false});
  for(const startDate of ["2027-06-12",null,"2027-06-01","2027-06-05"]) {
    store.applyMutation(tripInput({id:tripId,startDate})); assert.equal(visible(second),false);
  }
  store.applyMutation({type:"destination.churchVisibility",id:second,enabled:true});
  store.applyMutation(tripInput({id:tripId,startDate:"2027-06-01"}));
  assert.equal(visible(second),false,"manual enabling cannot override a known Sunday-free stay");
  store.applyMutation(stopEdit(first, {nights:20})); assert.equal(visible(first),true);
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
  let store=createOwnedStore(path);
  const tripId=store.applyMutation(tripInput()).id;
  const first=addDestination(store, tripId,{hotelNightlyAmount:"123.45",weatherHighF:0,weatherLowF:-12.5});
  const second=addDestination(store, tripId,{city:"Rome"});
  const candidateId=store.applyMutation(candidateInput(first,"hotels")).id;
  const image=new Uint8Array([82,73,70,70,4,0,0,0,87,69,66,80]);
  store.applyMutation({type:"church.save",...newItem(),destinationId:first,name:"Chapel",address:"",denomination:"",url:"",massTimes:[],gallery:{add:[{id:randomUUID(),...prepared(image)}],remove:[]}});
  const old=store.getSnapshot();
  store.close();
  let db=new DatabaseSync(path);
  db.exec(UNDO_SCHEMA_21);
  db.prepare("UPDATE destinations SET arrivalDate=?,departureDate=? WHERE id=?").run("2027-06-01","2027-06-04",first);
  db.prepare("UPDATE destinations SET arrivalDate=?,departureDate=? WHERE id=?").run(consistent?"2027-06-04":"2027-06-05","2027-06-06",second);
  db.exec("ALTER TABLE trips DROP COLUMN startDate; ALTER TABLE destinations DROP COLUMN nights; ALTER TABLE destinations DROP COLUMN legacyArrivalDate; ALTER TABLE destinations DROP COLUMN legacyDepartureDate; PRAGMA user_version=14;"); db.close();
  store=createOwnedStore(path);
  try {
    const saved=store.getSnapshot();
    assert.equal(saved.trips[0].startDate,consistent?"2027-06-01":null);
    assert.equal(stop(store, first).nights,consistent?3:null);
    assert.equal(stop(store, first).legacyArrivalDate,"2027-06-01");
    assert.equal(stop(store, second).legacyArrivalDate,consistent?"2027-06-04":"2027-06-05");
    assert.equal(destination(store,first).hotelNightlyMinor,12345);
    assert.equal(destination(store,first).weatherHighF,0);
    assert.deepEqual(saved.candidates,old.candidates); assert.equal(saved.candidates[0].id,candidateId);
    assert.deepEqual(saved.legs,old.legs); assert.deepEqual(saved.churches,old.churches);
    assert.equal(saved.trips[0].dateLabel,old.trips[0].dateLabel); assert.equal(stop(store, first).stay,"Stay notes");
    store.applyMutation(tripInput({id:tripId,startDate:"2028-02-28"}));
    store.applyMutation(stopEdit(first, {nights:0}));
    store.applyMutation(stopEdit(second, {city:"Rome",nights:2}));
    store.applyMutation({type:"destination.churchVisibility",id:first,enabled:false});
    const edited=store.getSnapshot();
    store.close(); db=new DatabaseSync(path); db.exec("PRAGMA user_version=14"); db.close();
    store=createOwnedStore(path); assert.deepEqual(store.getSnapshot(),edited);
    db=new DatabaseSync(path,{readOnly:true}); await backup(db,path+".backup"); db.close();
    const restored=createOwnedStore(path+".backup");
    try { assert.deepEqual(restored.getSnapshot(),edited); } finally { restored.close(); }
    db=new DatabaseSync(path,{readOnly:true}); assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok"); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]); db.close();
  } finally { store.close(); }
});

test("contrary legacy currency aborts the upgrade without relabeling amounts or advancing schema",t=>{
  const path=fileDatabase(t); let store=createOwnedStore(path);
  const tripId=store.applyMutation(tripInput()).id;
  const id=addDestination(store, tripId,{shoppingAmount:"123.45"});
  store.close(); const db=new DatabaseSync(path);
  db.prepare("UPDATE destinations SET shoppingCurrency='KWD' WHERE id=?").run(id); db.exec("PRAGMA user_version=14");
  assert.throws(()=>createOwnedStore(path),/Unexpected non-USD data/);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version,14);
  assert.equal(db.prepare("SELECT shoppingMinor FROM destinations WHERE id=?").get(id).shoppingMinor,12345);
  assert.equal(db.prepare("SELECT shoppingCurrency FROM destinations WHERE id=?").get(id).shoppingCurrency,"KWD"); db.close();
});
