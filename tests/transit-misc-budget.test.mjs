import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBudget, calculateDestinationBudget } from "../src/lib/budget.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { MAX_AMOUNT_CENTS } from "../src/lib/money.ts";
import { SCHEMA_VERSION } from "../src/lib/store.ts";
import { aiSetup, NOW } from "./ai-fixtures.mjs";
import { addDestination, destinationEdit, fileDatabase, setup, tripInput, visit } from "./budget-fixtures.mjs";
import { createOwnedStore } from "./owned-store.mjs";

/** A connection's save as its editor sends it, every field included, `miscAmount` its miscellaneous spending on the way (TRA-26). */
const legSave = (id, overrides = {}) => ({ type: "leg.save", id, method: "Flight", price: "300", miscAmount: "", departure: "", arrival: "", url: "", notes: "", ...overrides });
/** A trip's connections in route order, from the departing city to the return city. */
const legsOf = (store, tripId) => store.getSnapshot().legs.filter((leg) => leg.tripId === tripId);
const miscOf = (store, legId) => store.getSnapshot().legs.find((leg) => leg.id === legId)?.miscCents;
const FORMAT = "Miscellaneous spending must be a positive USD amount or zero, with up to 2 decimal places. Leave it blank if unknown.";

test("a connection saves its miscellaneous spending blank, as zero or as an amount, and refuses any other amount without saving (TRA-26)", (t) => {
  const { store, tripId } = setup(t);
  addDestination(store, tripId, { nights: 3 });
  const [outbound] = legsOf(store, tripId);
  assert.equal(outbound.miscCents, null, "a new connection has no estimate");
  for (const [miscAmount, cents] of [["45.5", 4550], ["0", 0], [" 12.34 ", 1234], ["100000000", MAX_AMOUNT_CENTS], ["", null], ["45.50", 4550], ["  ", null]]) {
    store.applyMutation(legSave(outbound.id, { miscAmount }));
    assert.equal(miscOf(store, outbound.id), cents, JSON.stringify(miscAmount));
  }
  store.applyMutation(legSave(outbound.id, { miscAmount: "45.50" }));
  const before = store.getSnapshot();
  for (const [miscAmount, message] of [
    ["-1", FORMAT], ["-0.01", FORMAT], ["1.001", FORMAT], ["1e2", FORMAT], ["$5", FORMAT], ["1,000", FORMAT], ["NaN", FORMAT],
    ["100000000.01", "Miscellaneous spending must be $100,000,000 or less."], [5, "miscAmount must be text."], [null, "miscAmount must be text."],
  ]) {
    assert.throws(() => store.applyMutation(legSave(outbound.id, { method: "Train", miscAmount })), { name: "ValidationError", message }, JSON.stringify(miscAmount));
  }
  assert.deepEqual(store.getSnapshot(), before, "a refused amount saves nothing, not even the connection's other fields");
});

test("the trip budget totals every connection's miscellaneous spending once, apart from Travel and destination Miscellaneous, and blank amounts keep it complete", (t) => {
  const { store, tripId } = setup(t);
  const amounts = { nights: 2, hotelNightlyAmount: "100", miscDailyAmount: "10" };
  const paris = addDestination(store, tripId, amounts);
  const lyon = addDestination(store, tripId, { city: "Lyon", ...amounts });
  const legs = legsOf(store, tripId);
  assert.equal(legs.length, 3);
  for (const leg of legs) store.applyMutation(legSave(leg.id));
  const budget = () => calculateBudget(store.getSnapshot(), tripId);
  const destinations = () => [paris, lyon].map((id) => calculateDestinationBudget(store.getSnapshot(), visit(store, id)));
  const baseline = budget();
  const destinationBaseline = destinations();
  assert.equal(baseline.complete, true, "every connection without miscellaneous spending still leaves the estimate complete");
  assert.equal(baseline.transitMiscCents, null);

  store.applyMutation(legSave(legs[0].id, { miscAmount: "45.50" }));
  store.applyMutation(legSave(legs[2].id, { miscAmount: "20" }));
  assert.deepEqual(budget(), { ...baseline, transitMiscCents: 6550, totalsByCurrency: { USD: baseline.totalsByCurrency.USD + 6550 }, knownCount: baseline.knownCount + 2 },
    "two amounts add up once in the total, and travel, destination amounts and completeness are unchanged");
  assert.deepEqual(destinations(), destinationBaseline, "destination budgets, their Miscellaneous included, are unchanged");
  assert.deepEqual(store.getHomeOverview().budgets[tripId], budget(), "the trip list's estimate includes it too");

  store.applyMutation(legSave(legs[1].id, { miscAmount: "0" }));
  assert.deepEqual(budget(), { ...baseline, transitMiscCents: 6550, totalsByCurrency: { USD: baseline.totalsByCurrency.USD + 6550 }, knownCount: baseline.knownCount + 3 }, "zero is a known amount");
  store.applyMutation(tripInput({ id: tripId, travelers: 6 }));
  assert.equal(budget().transitMiscCents, 6550, "it is the whole party's, never multiplied by travelers");

  // An unknown price is a missing estimate whatever the connection's miscellaneous spending.
  store.applyMutation(legSave(legs[2].id, { price: "", miscAmount: "20" }));
  assert.equal(budget().travelMissingCount, 1);
  assert.equal(budget().complete, false);
  assert.equal(budget().transitMiscCents, 6550);

  for (const leg of [legs[0], legs[2]]) store.applyMutation(legSave(leg.id, { miscAmount: "" }));
  assert.equal(budget().transitMiscCents, 0, "only the zero remains");
  store.applyMutation(legSave(legs[1].id, { miscAmount: "" }));
  assert.equal(budget().transitMiscCents, null, "blank everywhere is no estimate");
  assert.deepEqual(destinations(), destinationBaseline);
});

test("miscellaneous spending stays with its connection when the trip is reopened or the connection is edited, and clearing the connection clears it", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    addDestination(store, tripId, { nights: 3 });
    const [outbound, returning] = legsOf(store, tripId);
    store.applyMutation(legSave(outbound.id, { price: "500", miscAmount: "45.50", notes: "Lunch at the airport" }));
    store.applyMutation(legSave(returning.id, { miscAmount: "30" }));
    const saved = store.getSnapshot();
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved, "reopening keeps every amount");
    assert.equal(miscOf(store, outbound.id), 4550);

    // The editor sends the saved amount with every other field.
    store.applyMutation(legSave(outbound.id, { method: "Train", price: "420", miscAmount: "45.50", notes: "Dinner on board" }));
    assert.equal(miscOf(store, outbound.id), 4550);
    // A page opened before this, or a ChatGPT or Claude change, sends none, which keeps it.
    store.applyMutation({ type: "leg.save", id: outbound.id, method: "Train", price: "420", departure: "", arrival: "", url: "", notes: "Older page" });
    assert.equal(miscOf(store, outbound.id), 4550);
    store.applyMutation(legSave(outbound.id, { miscAmount: "60" }));
    assert.equal(miscOf(store, outbound.id), 6000);

    store.applyMutation({ type: "leg.clear", id: outbound.id });
    const cleared = store.getSnapshot().legs.find((leg) => leg.id === outbound.id);
    assert.deepEqual([cleared.method, cleared.priceCents, cleared.miscCents, cleared.notes], ["", null, null, ""], "the connection stays in the route with its plan cleared");
    assert.equal(miscOf(store, returning.id), 3000, "other connections keep theirs");
    assert.equal(calculateBudget(store.getSnapshot(), tripId).transitMiscCents, 3000);
    const after = store.getSnapshot();
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), after);
  } finally { store?.close(); }
});

test("route changes that remove or clear a connection remove its miscellaneous spending from the trip total, and keep it on connections they keep", (t) => {
  const { store, tripId } = setup(t);
  const paris = addDestination(store, tripId, { nights: 2 });
  const lyon = addDestination(store, tripId, { city: "Lyon", nights: 2 });
  const [outbound, between, returning] = legsOf(store, tripId);
  [outbound, between, returning].forEach((leg, index) => store.applyMutation(legSave(leg.id, { miscAmount: String((index + 1) * 10) })));
  const total = () => calculateBudget(store.getSnapshot(), tripId).transitMiscCents;
  assert.equal(total(), 6000);

  store.applyMutation({ type: "stop.remove", id: lyon });
  const route = legsOf(store, tripId);
  assert.deepEqual(route.map((leg) => [leg.id === outbound.id, leg.miscCents]), [[true, 1000], [false, null]], "the kept connection keeps its amount, and the new one has none");
  assert.equal(total(), 1000, "the removed connections' amounts leave the total");

  store.applyMutation(legSave(route[1].id, { miscAmount: "15" }));
  // The trip still returns to Boston, so only the connection from the departing city changes.
  store.applyMutation(tripInput({ id: tripId, homeCity: "Chicago", returnCity: "Boston" }));
  assert.deepEqual(legsOf(store, tripId).map((leg) => leg.miscCents), [null, 1500], "a new departing city clears the connection from it");
  store.applyMutation(destinationEdit(paris, { city: "Marseille" }));
  assert.deepEqual(legsOf(store, tripId).map((leg) => leg.miscCents), [null, null], "a new city clears the connections to and from it");
  assert.equal(total(), null);
});

test("schema 28 databases upgrade with no miscellaneous spending on any connection, and a replay keeps amounts saved since", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    addDestination(store, tripId, { nights: 3 });
    const [outbound] = legsOf(store, tripId);
    store.applyMutation(legSave(outbound.id, { price: "500", notes: "Window seats" }));
    const saved = store.getSnapshot();
    store.close(); store = null;
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE legs DROP COLUMN miscCents; PRAGMA user_version = 28;");
    db.close();
    store = createOwnedStore(path);
    assert.deepEqual(store.getSnapshot(), saved, "every connection keeps everything saved for it, with no miscellaneous spending");
    store.applyMutation(legSave(outbound.id, { price: "500", notes: "Window seats", miscAmount: "45.50" }));
    const later = store.getSnapshot();
    // A replay of schema 29, also after the schema 1 build resets the schema version, keeps it.
    for (const version of [28, 1]) {
      store.close(); store = null;
      const replay = new DatabaseSync(path);
      replay.exec(`PRAGMA user_version = ${version};`);
      replay.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps saved amounts`);
    }
    const observer = new DatabaseSync(path);
    try {
      assert.equal(observer.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      assert.equal(observer.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(observer.prepare("PRAGMA foreign_key_check").all(), []);
      // The database itself keeps the amount within Travel's limits, as it does a connection's price.
      for (const cents of [-1, MAX_AMOUNT_CENTS + 1]) {
        assert.throws(() => observer.prepare("UPDATE legs SET miscCents = ? WHERE id = ?").run(cents, outbound.id), /CHECK constraint failed/);
      }
    } finally { observer.close(); }
  } finally { store?.close(); }
});

test("ChatGPT and Claude propose a connection's miscellaneous spending, previewed beside its price, and approving saves it", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Vienna" });
  const legId = store.getSnapshot().legs.find((leg) => leg.tripId === ownerTrip && leg.fromId === null).id;
  const save = (overrides) => ({ type: "leg.save", id: legId, method: "Flight", price: "500", departure: "", arrival: "", url: "", notes: "", ...overrides });
  /** The connection's Miscellaneous spending field in a proposal's preview, or undefined when the proposal doesn't change it. */
  const previewed = (proposal) => proposal.preview[0].records.find((record) => record.record.includes(": travel from the departing city"))?.fields.find((field) => field.name === "Miscellaneous spending");
  const miscNow = () => miscOf(store, legId);

  const added = propose([save({ miscAmount: "45.50" })]);
  assert.deepEqual(previewed(added), { name: "Miscellaneous spending", before: null, after: "$45.50" });
  assert.equal(miscNow(), null, "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.equal(miscNow(), 4550);
  assert.equal(store.aiTrip(ownerTrip).travel.find((leg) => leg.id === legId).miscCents, 4550, "assistants read it with the connection");
  assert.equal(store.aiTrip(ownerTrip).budget.transitMiscCents, 4550, "and in the trip's budget");

  const renotes = propose([save({ notes: "Lunch at the airport" })]);
  assert.equal(previewed(renotes), undefined, "a change without it keeps it, so the preview leaves it out");
  assert.equal(decide(renotes, true).status, "applied");
  assert.equal(miscNow(), 4550);

  const changed = propose([save({ notes: "Lunch at the airport", miscAmount: "60" })]);
  assert.deepEqual(previewed(changed), { name: "Miscellaneous spending", before: "$45.50", after: "$60" });
  assert.equal(decide(changed, true).status, "applied");

  const cleared = propose([{ type: "leg.clear", id: legId }]);
  assert.deepEqual(previewed(cleared), { name: "Miscellaneous spending", before: "$60", after: null });
  assert.equal(decide(cleared, true).status, "applied");
  assert.equal(miscNow(), null);

  const proposals = store.aiOverview(owner, NOW).proposals.length;
  const before = store.getSnapshot();
  assert.throws(() => propose([save({ miscAmount: "-5" })]), { name: "ValidationError", message: "Change 1: " + FORMAT });
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");
  assert.equal(store.aiOverview(owner, NOW).proposals.length, proposals, "and isn't recorded");

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "leg.save");
  assert.equal(schema.properties.miscAmount.type, "string", "assistants are told about it");
  assert.ok(!schema.required.includes("miscAmount"), "left out, it is kept");
});

test("a connection's nights spent traveling change neither its price nor its spending in transit, nor what the trip counts of them (TRA-185)", (t) => {
  const { store, tripId } = setup(t, tripInput({ startDate: "2027-06-05" }));
  addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const [outbound, home] = legsOf(store, tripId).map((leg) => leg.id);
  store.applyMutation(legSave(outbound, { price: "1200.50", miscAmount: "45.25" }));
  store.applyMutation(legSave(home, { price: "800", miscAmount: "" }));
  const spending = () => { const all = store.getSnapshot(); const { travelCents, transitMiscCents } = calculateBudget(all, tripId); return [legsOf(store, tripId).map((leg) => [leg.priceCents, leg.miscCents]), travelCents, transitMiscCents]; };
  const before = spending();
  for (const travelNights of [1, 2, 0]) {
    store.applyMutation(legSave(outbound, { price: "1200.50", miscAmount: "45.25", travelNights }));
    assert.deepEqual(spending(), before, `${travelNights} nights spent traveling`);
  }
  assert.deepEqual(before, [[[120050, 4525], [80000, null]], 200050, 4525]);
});

test("a flight's miles change neither its price nor the trip's estimate, and never stand in for an unknown price (TRA-186)", (t) => {
  const { store, tripId } = setup(t);
  addDestination(store, tripId, { city: "London", nights: 2, hotelNightlyAmount: "100", miscDailyAmount: "10" });
  const [outbound, home] = legsOf(store, tripId).map((leg) => leg.id);
  const budget = () => calculateBudget(store.getSnapshot(), tripId);
  store.applyMutation(legSave(outbound, { price: "1250", miscAmount: "45.25" }));
  store.applyMutation(legSave(home, { price: "800" }));
  const priced = budget();
  assert.deepEqual([priced.travelCents, priced.transitMiscCents, priced.complete], [205000, 4525, true]);
  for (const milesRequired of [85000, 0, 120000, null]) {
    store.applyMutation(legSave(outbound, { price: "1250", miscAmount: "45.25", milesRequired }));
    assert.deepEqual(budget(), priced, `${milesRequired} miles: the estimate counts the price alone`);
    assert.deepEqual(store.getHomeOverview().budgets[tripId], priced, `${milesRequired} miles: as does the trip list's`);
  }
  // Miles without a price leave the price unknown, and the connection missing from a partial estimate.
  store.applyMutation(legSave(outbound, { price: "", miscAmount: "45.25" }));
  const unpriced = budget();
  store.applyMutation(legSave(outbound, { price: "", miscAmount: "45.25", milesRequired: 85000 }));
  assert.equal(store.getSnapshot().legs.find((leg) => leg.id === outbound).priceCents, null, "miles never fill in the price");
  assert.deepEqual(budget(), unpriced);
  assert.deepEqual([unpriced.travelCents, unpriced.travelMissingCount, unpriced.complete], [80000, 1, false]);
});
