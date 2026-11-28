import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fieldColumns, PREVIEW_COLUMNS } from "../src/lib/ai-preview.ts";
import { EDITABLE_FIELDS, fieldColumn } from "../src/lib/editable-fields.ts";
import { CHANGE_FIELDS, fieldProperties, TOOLS } from "../src/lib/mcp-tools.ts";
import { formatCurrency } from "../src/lib/money.ts";
import { readFields } from "../src/lib/store.ts";
import { aiSetup, GUEST, NOW } from "./ai-fixtures.mjs";
import { newItem } from "./budget-fixtures.mjs";

// TRA-174: Travel's editable fields are declared once, in EDITABLE_FIELDS. People's saves and ChatGPT's and Claude's
// proposals are checked by those rules, assistants are told about them from there, and the owner reviews them under
// their labels, so a field added there needs no code of its own for assistants.

const changeSchema = (type) => TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === type);
/** A new trip of the guest's, with a destination of its own when `city` is true. */
function guestTrip(store, guest, city = false) {
  const tripId = store.applyMutation(guest, { type: "trip.save", ...newItem(), name: "Guest trip", dateLabel: "Someday", homeCity: "Denver", travelers: 2, notes: "Trip notes" }).id;
  return { tripId, destinationId: city ? store.applyMutation(guest, { type: "stop.add", tripId, city: `City ${randomUUID().slice(0, 8)}` }).id : undefined };
}
/**
 * Each table's record, new for each field: the change type that saves it, the save with every field it must give as it
 * was saved and `fields`, how assistants read it, and where it is in a snapshot of everything saved.
 */
const RECORDS = {
  trips: ({ store, guest }) => {
    const { tripId } = guestTrip(store, guest);
    return { type: "trip.save", save: (fields) => ({ type: "trip.save", id: tripId, name: "Guest trip", dateLabel: "Someday", homeCity: "Denver", travelers: 2, notes: "Trip notes", ...fields }), read: () => store.aiTrip(tripId).trip, item: (all) => all.trips.find((item) => item.id === tripId) };
  },
  home_items: ({ store, guest }) => {
    const { tripId } = guestTrip(store, guest);
    const id = store.applyMutation(guest, { type: "homeItem.save", ...newItem(), tripId, name: "House sitting", price: "", notes: "" }).id;
    return { type: "homeItem.save", save: (fields) => ({ type: "homeItem.save", id, tripId, name: "House sitting", price: "", notes: "", ...fields }), read: () => store.aiTrip(tripId).atHome.find((item) => item.id === id), item: (all) => all.homeItems.find((item) => item.id === id) };
  },
  // An item on a trip's packing list (TRA-18).
  packing_items: ({ store, guest }) => {
    const { tripId } = guestTrip(store, guest);
    const saved = { tripId, name: "Socks", category: "clothing", quantity: 2 };
    const id = store.applyMutation(guest, { type: "packingItem.save", ...newItem(), ...saved }).id;
    return { type: "packingItem.save", save: (fields) => ({ type: "packingItem.save", id, ...saved, ...fields }), read: () => store.aiTrip(tripId).packing.find((item) => item.id === id), item: (all) => all.packingItems.find((item) => item.id === id) };
  },
  destinations: ({ store, guest }) => {
    const { destinationId } = guestTrip(store, guest, true);
    return { type: "destination.save", save: (fields) => ({ type: "destination.save", id: destinationId, ...fields }), read: () => store.aiDestination(destinationId).destination, item: (all) => all.destinations.find((item) => item.id === destinationId) };
  },
  // A new destination's stay in its trip shares its ID.
  trip_stops: ({ store, guest }) => {
    const { tripId, destinationId } = guestTrip(store, guest, true);
    return { type: "destination.save", save: (fields) => ({ type: "destination.save", id: destinationId, stopId: destinationId, ...fields }), read: () => store.aiTrip(tripId).stops.find((item) => item.id === destinationId), item: (all) => all.stops.find((item) => item.id === destinationId) };
  },
  churches: ({ store, guest }) => {
    const { destinationId } = guestTrip(store, guest, true);
    const saved = { destinationId, name: "Cathedral", address: "", denomination: "", url: "", massTimes: [] };
    const id = store.applyMutation(guest, { type: "church.save", ...newItem(), ...saved }).id;
    return { type: "church.save", save: (fields) => ({ type: "church.save", id, ...saved, ...fields }), read: () => store.aiDestination(destinationId).churches.find((item) => item.id === id), item: (all) => all.churches.find((item) => item.id === id) };
  },
  // The travel from the departing city to the trip's one destination.
  legs: ({ store, guest }) => {
    const { tripId } = guestTrip(store, guest, true);
    const id = store.aiTrip(tripId).travel.find((leg) => leg.fromId === null).id;
    return { type: "leg.save", save: (fields) => ({ type: "leg.save", id, method: "", price: "", departure: "", arrival: "", url: "", notes: "", ...fields }), read: () => store.aiTrip(tripId).travel.find((item) => item.id === id), item: (all) => all.legs.find((item) => item.id === id) };
  },
  // An activity, which can be Must do, and whose inclusion chooses nothing else.
  candidates: ({ store, guest }) => {
    const { destinationId } = guestTrip(store, guest, true);
    const saved = { destinationId, category: "activities", name: "Fjord cruise", price: "", address: "", url: "", notes: "", included: true };
    const id = store.applyMutation(guest, { type: "candidate.save", ...newItem(), ...saved }).id;
    return { type: "candidate.save", save: (fields) => ({ type: "candidate.save", id, ...saved, ...fields }), read: () => store.aiDestination(destinationId).ideas.find((item) => item.id === id), item: (all) => all.candidates.find((item) => item.id === id) };
  },
};
/** A value unlike the saved one, as a save sends it and as assistants read it back. */
function sample(name, field, saved) {
  switch (field.kind) {
    case "text": { const text = `New ${name}`.slice(0, field.maxLength); return [text, text]; }
    case "url": return [`https://example.com/${name}`, `https://example.com/${name}`];
    case "amount": return ["12.34", 1234];
    case "boolean": return [!saved, !saved];
    case "whole": return [(saved ?? field.min) + 1, (saved ?? field.min) + 1];
    case "number": return [72.5, 72.5];
    case "choice": { const choice = field.values.find((value) => value !== saved); return [choice, choice]; }
    case "date": return ["2027-05-01", "2027-05-01"];
  }
}
/** A saved value as the owner reads it on a proposal's page, or null for none. */
const shown = (field, value) => value === null || value === "" ? null : field.kind === "amount" ? formatCurrency(value, "USD") : field.kind === "boolean" ? (value ? "Yes" : "No") : String(value);
/** A value of the wrong kind for a field, and the message refusing it. */
function invalid(name, field) {
  switch (field.kind) {
    case "text": return [42, field.invalid ?? `${name} must be text.`];
    case "url": return ["ftp://example.com/file", "Enter a website link starting with https:// or http://."];
    case "amount": return ["-5", `${field.noun} must be a positive USD amount or zero, with up to 2 decimal places. Leave it blank if unknown.`];
    case "boolean": return ["yes", `${name} must be true or false.`];
    case "whole": return [1.5, field.invalid];
    case "number": return ["warm", field.invalid];
    case "choice": return ["monthly", field.invalid];
    case "date": return ["2027-13-01", field.invalid];
  }
}
/**
 * What else a field's save changes in a snapshot: a destination amount's currency, always USD, kept for storage
 * compatibility (miscDailyMinor's is miscCurrency), a link's research links, and a start date's end date.
 */
const alongside = (name, field) => [...(field.column?.endsWith("Minor") ? [`${/^[a-z]+/.exec(field.column)[0]}Currency`] : []), ...(field.kind === "url" && field.label === null ? ["links"] : []), ...(name === "startDate" ? ["endDate"] : [])];
const without = (item, keys) => Object.fromEntries(Object.entries(item).filter(([key]) => !keys.includes(key)));

test("every editable field is read, proposed, checked and previewed from the shared contract, and changes nothing else (TRA-174)", (t) => {
  for (const [table, fields] of Object.entries(EDITABLE_FIELDS)) {
    const setup = aiSetup(t);
    for (const [name, field] of Object.entries(fields)) {
      const label = `${table}.${name}`;
      const record = RECORDS[table](setup);
      const column = fieldColumn(name, field);
      // Assistants are told about it with the change that saves it, and must give it unless a save may leave it out.
      const schema = changeSchema(record.type);
      assert.ok(schema.properties[name].description.startsWith(field.description), label);
      assert.equal(schema.required.includes(name), !field.keep, label);
      // The owner reviews it under its label.
      assert.deepEqual(PREVIEW_COLUMNS[table][column], fieldColumns(fields)[column], label);

      // People's saves and proposals refuse a value of the wrong kind with the same message.
      const [wrong, message] = invalid(name, field);
      assert.throws(() => setup.store.applyMutation(setup.guest, record.save({ [name]: wrong })), { name: "ValidationError", message }, label);
      assert.throws(() => setup.propose([record.save({ [name]: wrong })]), { name: "ValidationError", message: `Change 1: ${message}` }, label);

      // Assistants read it, and a proposal changing it alone previews and changes only it.
      const saved = record.read()[column];
      const [value, read] = sample(name, field, saved);
      const before = setup.store.getSnapshot();
      const proposal = setup.propose([record.save({ [name]: value })]);
      assert.equal(proposal.preview[0].records.length, 1, label);
      // A link shows as the record's research links, whose first link it is.
      assert.deepEqual(proposal.preview[0].records[0].fields.map((change) => change.name), [field.label ?? "Research links"], label);
      if (field.label !== null) assert.deepEqual(proposal.preview[0].records[0].fields[0], { name: field.label, before: shown(field, saved), after: shown(field, read) }, label);
      assert.deepEqual(setup.store.getSnapshot(), before, `${label}: proposing changes nothing`);
      assert.equal(setup.decide(proposal, true).status, "applied", label);
      assert.deepEqual(record.read()[column], read, `${label}: assistants read the new value`);
      // Everything saved, but the record's field and what its save changes along with it. A check's snapshot reads no likes (TRA-31).
      const rest = (all) => {
        const item = record.item(all);
        return Object.fromEntries(Object.entries(all).map(([key, list]) => [key, key === "likes" ? list : list.map((entry) => entry === item ? without(entry, [column, ...alongside(name, field)]) : entry)]));
      };
      assert.deepEqual(rest(setup.store.getSnapshot()), rest(before), `${label}: nothing else changed`);
    }
  }
});

test("a field added to the contract is described to assistants, checked and shown to the owner, with no code of its own for assistants (TRA-174)", () => {
  // Two fields a later change might add to every trip, of different kinds: one a save may leave out, one it must give.
  const fields = {
    ...EDITABLE_FIELDS.trips,
    packingNotes: { kind: "text", maxLength: 2000, keep: true, label: "Packing notes", description: "What to pack. Empty for none. Left out keeps the saved one." },
    rooms: { kind: "whole", min: 1, max: 20, invalid: "Rooms must be a whole number from 1 to 20.", label: "Rooms", description: "How many hotel rooms the party needs." },
  };
  const { properties, required } = fieldProperties(fields);
  assert.deepEqual(properties.packingNotes, { type: "string", maxLength: 2000, description: "What to pack. Empty for none. Left out keeps the saved one." });
  assert.deepEqual(properties.rooms, { type: "integer", minimum: 1, maximum: 20, description: "How many hotel rooms the party needs." });
  assert.deepEqual([required.includes("packingNotes"), required.includes("rooms")], [false, true], "assistants know which a save may leave out");

  const trip = { name: "Lisbon", dateLabel: "", homeCity: "Boston", travelers: 2, notes: "", rooms: 1 };
  const read = readFields(fields, { ...trip, packingNotes: "  Raincoat  ", rooms: 2 });
  assert.deepEqual([read.packingNotes, read.rooms], ["Raincoat", 2], "the store checks them by their kinds' rules");
  const others = Object.fromEntries(Object.entries(read).filter(([name]) => name !== "packingNotes" && name !== "rooms"));
  assert.deepEqual(others, readFields(EDITABLE_FIELDS.trips, trip), "and reads the trip's own fields as before");
  assert.equal(readFields(fields, trip).packingNotes, undefined, "left out, the saved value stays");
  for (const [values, message] of [
    [{ ...trip, packingNotes: 5 }, "packingNotes must be text."],
    [{ ...trip, packingNotes: "x".repeat(2001) }, "packingNotes must be 2000 characters or fewer."],
    [{ ...trip, rooms: 21 }, "Rooms must be a whole number from 1 to 20."],
    [{ ...trip, rooms: undefined }, "Rooms must be a whole number from 1 to 20."],
  ]) {
    assert.throws(() => readFields(fields, values), { name: "ValidationError", message });
  }
  assert.deepEqual([fieldColumns(fields).packingNotes, fieldColumns(fields).rooms], [["Packing notes", "text"], ["Rooms", "number"]], "the owner reviews them under their labels");
});

test("assistants can't propose protected, system-managed or calculated fields, or any field a change doesn't offer (TRA-174)", (t) => {
  const { store, owner, guest, guestTrip, ownerTrip, propose } = aiSetup(t);
  const destinationId = store.applyMutation(guest, { type: "stop.add", tripId: guestTrip, city: "Oslo" }).id;
  const itemId = store.applyMutation(guest, { type: "homeItem.save", ...newItem(), tripId: guestTrip, name: "House sitting", price: "", notes: "" }).id;
  const ideaId = store.applyMutation(guest, { type: "candidate.save", ...newItem(), destinationId, category: "hotels", name: "Fjord Hotel", price: "", address: "", url: "", notes: "", included: false }).id;
  const legId = store.aiTrip(guestTrip).travel[0].id;
  const trip = { type: "trip.save", id: guestTrip, name: "Guest trip", dateLabel: "Someday", homeCity: "Denver", travelers: 2, notes: "Trip notes" };
  const idea = { type: "candidate.save", id: ideaId, destinationId, category: "hotels", name: "Fjord Hotel", price: "", address: "", url: "", notes: "", included: false };
  const before = store.getSnapshot();
  for (const [change, message] of [
    [{ ...trip, ownerId: owner }, "trip.save has no field ownerId."],
    [{ ...trip, createdAt: new Date(NOW).toISOString() }, "trip.save has no field createdAt."],
    [{ ...trip, endDate: "2027-05-09" }, "The trip end date is calculated from the start date, destination nights and nights spent traveling."],
    [{ type: "destination.save", id: destinationId, ownerId: owner }, "destination.save has no field ownerId."],
    [{ type: "destination.save", id: destinationId, cityKey: "elsewhere" }, "destination.save has no field cityKey."],
    [{ type: "destination.save", id: destinationId, city: "Bergen", cityFromSuggestion: true }, "destination.save has no field cityFromSuggestion."],
    [{ type: "destination.save", id: destinationId, churchEnabled: false }, "destination.save has no field churchEnabled."],
    [{ type: "destination.save", id: destinationId, stopId: destinationId, arrivalDate: "2027-05-01" }, "Destination dates are calculated. Edit the trip start date, destination nights or nights spent traveling instead."],
    [{ type: "homeItem.save", id: itemId, tripId: guestTrip, name: "House sitting", price: "", notes: "", completed: true }, "homeItem.save has no field completed."],
    [{ ...idea, position: 0 }, "candidate.save has no field position."],
    [{ type: "leg.save", id: legId, method: "Flight", price: "", departure: "", arrival: "", url: "", notes: "", fromId: null }, "leg.save has no field fromId."],
    [{ type: "trip.share", tripId: ownerTrip, email: "friend@example.test", role: "owner" }, "trip.share has no field role."],
    [{ type: "trip.delete", id: guestTrip, cascade: false }, "trip.delete has no field cascade."],
    [{ type: "stop.add", tripId: guestTrip, city: "Bergen", before: destinationId }, "stop.add has no field before."],
    // Values of the wrong kind are refused by the field's own rules.
    [{ ...trip, travelers: "2" }, "Number of travelers must be a whole number between 1 and 999."],
    [{ ...trip, tagline: 42 }, "tagline must be text."],
    [{ type: "destination.save", id: destinationId, activitiesBudgetMode: "monthly" }, "Choose General budget or Itemized activity costs."],
    [{ ...idea, included: "yes" }, "included must be true or false."],
  ]) {
    assert.throws(() => propose([change]), { name: "ValidationError", message: `Change 1: ${message}` }, message);
  }
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");
  assert.equal(store.aiOverview(owner, NOW).proposals.length, 0, "and isn't recorded");
  // Every change an assistant can propose offers its type, and none offers a protected or calculated column.
  for (const [type, offered] of Object.entries(CHANGE_FIELDS)) {
    assert.ok(offered.includes("type"), type);
    for (const column of ["ownerId", "createdAt", "cityKey", "endDate", "arrivalDate", "departureDate", "position", "googleSubject", "accountId"]) assert.ok(!offered.includes(column), `${type} ${column}`);
  }
  // A person's own trip keeps its owner, and the guest still can't reach the owner's trip.
  assert.equal(store.aiTrips().find((item) => item.id === guestTrip).owner.email, GUEST);
  assert.throws(() => store.applyMutation(guest, { ...trip, id: ownerTrip }), /isn't shared with you/);
});
