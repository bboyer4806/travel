import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import sharp from "sharp";
import { prepareImage } from "../src/lib/image-upload.ts";
import { handleMcp } from "../src/lib/mcp.ts";
import { checkAiProposal, createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import { aiSetup, connectClaude, DAY, GUEST, NOW, OWNER } from "./ai-fixtures.mjs";
import { candidateInput, fileDatabase, newItem, tripInput } from "./budget-fixtures.mjs";

/** A photo as Travel prepares an upload or a download: resized WebP without metadata. */
async function prepared(color) {
  const form = new FormData();
  form.set("image", new File([await sharp({ create: { width: 48, height: 32, channels: 3, background: color } }).png().toBuffer()], "photo.png", { type: "image/png" }));
  return prepareImage(form);
}
const COLORS = ["#285f56", "#c46b2d", "#3b4f8a", "#8a3b6e", "#6e8a3b", "#3b8a87", "#8a6e3b", "#4f3b8a"];
/** Prepared photos, each new UUID with its own bytes. */
async function photos(count) {
  return new Map(await Promise.all(COLORS.slice(0, count).map(async (color) => [randomUUID(), await prepared(color)])));
}
const ids = (map) => [...map.keys()];
const add = (map, ...photoIds) => photoIds.map((id) => ({ id, url: `https://images.example.com/${id}.png` }));
const withoutPhotos = (snapshot) => JSON.parse(JSON.stringify(snapshot, (key, value) => (["images", "mainImageId", "imageVersion"].includes(key) ? undefined : value)));
const gallery = (item) => ({ images: item.images.map((image) => image.id), main: item.mainImageId });
const count = (path, sql) => { const db = new DatabaseSync(path, { readOnly: true }); try { return db.prepare(sql).get().count; } finally { db.close(); } };

/**
 * The guest's own trip, nobody shares it, with a destination in Oslo with two photos, a hotel with one, a restaurant
 * with none and a church with one, all saved through the editors' own changes. Another destination has a photo too.
 */
async function guestPlans(store, guest, guestTrip) {
  const saved = await photos(5);
  const [P1, P2, Q1, S1, X1] = ids(saved);
  const photo = (id) => ({ id, data: saved.get(id) });
  const destinationId = store.applyMutation(guest, { type: "stop.add", tripId: guestTrip, city: "Oslo" }).id;
  store.applyMutation(guest, { type: "destination.save", id: destinationId, notes: "Fjords", hotelNightlyAmount: "180", gallery: { add: [photo(P1), photo(P2)], remove: [], mainImageId: P1 } });
  const hotelId = store.applyMutation(guest, candidateInput(destinationId, "hotels", { name: "Fjord Hotel", price: "300", notes: "Harbor view", gallery: { add: [photo(Q1)], remove: [] } })).id;
  const restaurantId = store.applyMutation(guest, candidateInput(destinationId, "restaurants", { name: "Maaemo", price: "500", included: false })).id;
  const churchId = store.applyMutation(guest, { type: "church.save", ...newItem(), destinationId, name: "Oslo Cathedral", address: "Karl Johans gate 11", denomination: "Lutheran", url: "", massTimes: [], gallery: { add: [photo(S1)], remove: [] } }).id;
  const otherId = store.applyMutation(guest, { type: "stop.add", tripId: guestTrip, city: "Bergen" }).id;
  store.applyMutation(guest, { type: "destination.save", id: otherId, gallery: { add: [photo(X1)], remove: [] } });
  return { saved, P1, P2, Q1, S1, X1, destinationId, hotelId, restaurantId, churchId, otherId };
}

test("assistants propose adding, removing, ordering and choosing photos for destinations, ideas and churches, and only approval saves them", async (t) => {
  const path = fileDatabase(t);
  const { store, owner, guest, guestTrip, propose, decide } = aiSetup(t, path);
  const plans = await guestPlans(store, guest, guestTrip);
  const { P1, P2, Q1, S1, X1, destinationId, hotelId, restaurantId, churchId } = plans;
  const added = await photos(4);
  const [N1, N2, N3, N4] = ids(added);
  const before = store.getSnapshot();
  const budget = store.aiTrip(guestTrip).budget;
  const proposal = propose([
    { type: "destination.photos", id: destinationId, gallery: { add: add(added, N1), remove: [P2], mainImageId: N1, order: [N1, P1] } },
    { type: "candidate.photos", id: hotelId, gallery: { add: add(added, N2), remove: [], mainImageId: N2 } },
    { type: "candidate.photos", id: restaurantId, gallery: { add: add(added, N3), remove: [] } },
    { type: "church.photos", id: churchId, gallery: { add: add(added, N4), remove: [S1] } },
  ], "Add photos for Oslo", NOW, added);

  assert.equal(proposal.status, "pending");
  assert.deepEqual(store.getSnapshot(), before, "proposing saves and removes no photo");
  const oslo = `Destination “Oslo” (${GUEST})`;
  const records = (index) => proposal.preview[index].records.toSorted((a, b) => a.photo.localeCompare(b.photo));
  const sorted = (list) => list.toSorted((a, b) => a.photo.localeCompare(b.photo));
  assert.deepEqual(proposal.preview.map((change) => change.operation), ["Change a destination's photos", "Change an idea's photos", "Change an idea's photos", "Change a church's photos"]);
  assert.deepEqual(records(0), sorted([
    { action: "Adds", record: `${oslo}: photo`, photo: N1, fields: [{ name: "Order", before: null, after: "1" }, { name: "Primary photo", before: null, after: "Yes" }] },
    { action: "Changes", record: `${oslo}: photo`, photo: P1, fields: [{ name: "Order", before: "1", after: "2" }, { name: "Primary photo", before: "Yes", after: "No" }] },
    { action: "Deletes", record: `${oslo}: photo`, photo: P2, fields: [{ name: "Order", before: "2", after: null }, { name: "Primary photo", before: "No", after: null }] },
  ]));
  assert.deepEqual(records(1), sorted([
    { action: "Adds", record: `${oslo}: hotel “Fjord Hotel”: photo`, photo: N2, fields: [{ name: "Order", before: null, after: "2" }, { name: "Main photo", before: null, after: "Yes" }] },
    { action: "Changes", record: `${oslo}: hotel “Fjord Hotel”: photo`, photo: Q1, fields: [{ name: "Main photo", before: "Yes", after: "No" }] },
  ]));
  assert.deepEqual(records(2), [{ action: "Adds", record: `${oslo}: restaurant “Maaemo”: photo`, photo: N3, fields: [{ name: "Order", before: null, after: "1" }, { name: "Main photo", before: null, after: "Yes" }] }]);
  assert.deepEqual(records(3), sorted([
    { action: "Adds", record: `${oslo}: church “Oslo Cathedral”: photo`, photo: N4, fields: [{ name: "Order", before: null, after: "2" }, { name: "Main photo", before: null, after: "Yes" }] },
    { action: "Deletes", record: `${oslo}: church “Oslo Cathedral”: photo`, photo: S1, fields: [{ name: "Order", before: "1", after: null }, { name: "Main photo", before: "Yes", after: null }] },
  ]));

  // While it waits, only the owner sees the photos it adds, changes and deletes, and no others.
  assert.deepEqual(store.getAiProposalPhoto(owner, proposal.id, N1, NOW), { version: N1, data: added.get(N1) });
  assert.deepEqual(store.getAiProposalPhoto(owner, proposal.id, P2, NOW).data, plans.saved.get(P2), "a saved photo it deletes");
  assert.deepEqual(store.getAiProposalPhoto(owner, proposal.id, Q1, NOW).data, plans.saved.get(Q1), "a saved photo it changes");
  assert.equal(store.getAiProposalPhoto(guest, proposal.id, N1, NOW), undefined, "nobody else sees them");
  assert.equal(store.getAiProposalPhoto(owner, proposal.id, X1, NOW), undefined, "nor a photo it doesn't change");
  assert.equal(store.getAiProposalPhoto(owner, randomUUID(), N1, NOW), undefined);
  assert.equal(count(path, "SELECT count(*) AS count FROM ai_proposal_photos"), 4, "its new photos wait beside it");

  assert.equal(decide(proposal, true).status, "applied");
  const after = store.aiDestination(destinationId);
  assert.deepEqual(gallery(after.destination), { images: [N1, P1], main: N1 });
  assert.deepEqual(gallery(after.ideas.find((idea) => idea.id === hotelId)), { images: [Q1, N2], main: N2 });
  assert.deepEqual(gallery(after.ideas.find((idea) => idea.id === restaurantId)), { images: [N3], main: N3 });
  assert.deepEqual(gallery(after.churches[0]), { images: [N4], main: N4 });
  for (const [kind, ownerId, photoId] of [["destination", destinationId, N1], ["idea", hotelId, N2], ["idea", restaurantId, N3], ["church", churchId, N4]]) {
    assert.deepEqual(store.aiPhoto(kind, ownerId, photoId).data, added.get(photoId), "each saved photo is the one Travel prepared");
  }
  assert.equal(store.aiPhoto("destination", destinationId, P2), undefined);
  assert.equal(store.aiPhoto("church", churchId, S1), undefined);
  // Nothing but photos changed: research, prices, budgets and selections are as they were.
  assert.deepEqual(withoutPhotos(store.getSnapshot()), withoutPhotos(before));
  assert.deepEqual(store.aiTrip(guestTrip).budget, budget);
  assert.equal(count(path, "SELECT count(*) AS count FROM ai_proposal_photos"), 0, "its new photos are in Travel now, and kept nowhere else");
  assert.equal(store.getAiProposalPhoto(owner, proposal.id, N1, NOW + 2000), undefined, "a decided proposal shows no photos");
  // The owner's own photo editing of the guest's trip is unchanged: it isn't shared with them.
  assert.throws(() => store.applyMutation(owner, { type: "destination.save", id: destinationId, gallery: { add: [], remove: [P1] } }), /isn't shared with you/);
});

test("approving makes exactly the photo changes previewed, all of them with the rest of the proposal, or none", async (t) => {
  const path = fileDatabase(t);
  const { store, owner, guest, guestTrip, ownerTrip, propose, decide } = aiSetup(t, path);
  const plans = await guestPlans(store, guest, guestTrip);
  const { P1, P2, destinationId, hotelId } = plans;
  const added = await photos(3);
  const [N1, N2, N3] = ids(added);

  // A gallery rearranged since: the photos to put in order are no longer all of them, so nothing changes.
  const order = propose([{ type: "destination.photos", id: destinationId, gallery: { add: [], remove: [], order: [P2, P1] } }]);
  store.applyMutation(guest, { type: "destination.save", id: destinationId, gallery: { add: [{ id: N3, data: added.get(N3) }], remove: [] } });
  let unchanged = store.getSnapshot();
  const reordered = decide(order, true);
  assert.deepEqual([reordered.status, reordered.error], ["failed", "Change 1: The destination photos have changed. Refresh before rearranging them."]);
  assert.deepEqual(store.getSnapshot(), unchanged);

  // A main photo chosen since: the new photo would no longer be added as shown, so nothing changes.
  const hotel = propose([{ type: "candidate.photos", id: hotelId, gallery: { add: add(added, N1), remove: [] } }], "Add a hotel photo", NOW, new Map([[N1, added.get(N1)]]));
  assert.deepEqual(hotel.preview[0].records.map(({ action, photo, fields }) => [action, photo, fields]), [["Adds", N1, [{ name: "Order", before: null, after: "2" }, { name: "Main photo", before: null, after: "No" }]]]);
  const Q2 = randomUUID();
  store.applyMutation(guest, candidateInput(plans.destinationId, "hotels", { id: hotelId, name: "Fjord Hotel", price: "300", notes: "Harbor view", gallery: { add: [{ id: Q2, data: added.get(N2) }], remove: [], mainImageId: Q2 } }));
  unchanged = store.getSnapshot();
  const changed = decide(hotel, true);
  assert.equal(changed.status, "failed");
  assert.match(changed.error, /^Travel has changed since this was proposed/);
  assert.deepEqual(store.getSnapshot(), unchanged);
  assert.equal(store.aiPhoto("idea", hotelId, N1), undefined);

  // A photo change with a change the planner then refuses: the photo isn't added either.
  const itemId = store.applyMutation(owner, { type: "homeItem.save", ...newItem(), tripId: ownerTrip, name: "Pause mail", price: "", notes: "", completed: false }).id;
  const batch = propose([
    { type: "destination.photos", id: destinationId, gallery: { add: add(added, N2), remove: [], mainImageId: N2 } },
    { type: "homeItem.delete", id: itemId, tripId: ownerTrip },
  ], "Photo and errand", NOW, new Map([[N2, added.get(N2)]]));
  store.applyMutation(owner, { type: "homeItem.delete", id: itemId, tripId: ownerTrip });
  unchanged = store.getSnapshot();
  const refused = decide(batch, true);
  assert.deepEqual([refused.status, refused.error], ["failed", "Change 2: This item doesn't exist. Read Travel again for current IDs."]);
  assert.deepEqual(store.getSnapshot(), unchanged, "the photo rolled back with the refused change");
  assert.equal(count(path, "SELECT count(*) AS count FROM ai_proposal_photos"), 0, "failed proposals keep no photos");

  // An idea a proposal adds can get photos in the same proposal, and a photo can be the main one of nothing but itself.
  const ideaId = randomUUID();
  const fresh = await photos(1);
  const idea = propose([
    { type: "candidate.save", id: ideaId, create: true, destinationId, category: "activities", name: "Fjord cruise", price: "90", address: "", url: "", notes: "", included: true },
    { type: "candidate.photos", id: ideaId, gallery: { add: add(fresh, ...ids(fresh)), remove: [] } },
  ], "Add a cruise", NOW, fresh);
  assert.equal(decide(idea, true).status, "applied");
  assert.deepEqual(gallery(store.aiDestination(destinationId).ideas.find((item) => item.id === ideaId)), { images: ids(fresh), main: ids(fresh)[0] });
});

test("rejecting, expiring or revoking leaves photos as they are and keeps no downloaded photo", async (t) => {
  const path = fileDatabase(t);
  const { store, owner, guest, guestTrip, connection, propose, decide } = aiSetup(t, path);
  const { destinationId } = await guestPlans(store, guest, guestTrip);
  const added = await photos(3);
  const [N1, N2, N3] = ids(added);
  const photoOf = (id) => new Map([[id, added.get(id)]]);
  const pending = () => count(path, "SELECT count(*) AS count FROM ai_proposal_photos");
  const before = store.getSnapshot();

  const rejected = propose([{ type: "destination.photos", id: destinationId, gallery: { add: add(added, N1), remove: [] } }], "One photo", NOW, photoOf(N1));
  assert.equal(pending(), 1);
  assert.equal(decide(rejected, false).status, "rejected");
  assert.deepEqual(store.getSnapshot(), before, "rejecting changes no photo");
  assert.equal(pending(), 0, "and keeps none of its photos");

  const expired = propose([{ type: "destination.photos", id: destinationId, gallery: { add: add(added, N2), remove: [] } }], "Another photo", NOW, photoOf(N2));
  assert.equal(store.getAiProposal(owner, expired.id, NOW + DAY).status, "expired");
  assert.throws(() => decide(expired, true, NOW + DAY), /expired/);
  assert.equal(store.getAiProposalPhoto(owner, expired.id, N2, NOW + DAY), undefined, "an expired proposal shows no photos");
  // The next proposal removes an expired one's photos before keeping its own.
  propose([{ type: "destination.photos", id: destinationId, gallery: { add: add(added, N3), remove: [] } }], "A third photo", NOW + DAY, photoOf(N3));
  assert.equal(count(path, `SELECT count(*) AS count FROM ai_proposal_photos WHERE proposalId = '${expired.id}'`), 0);
  assert.equal(pending(), 1);
  assert.deepEqual(store.getSnapshot(), before, "neither changed any photo");

  // Revoking the connection withdraws its proposals with their photos.
  store.revokeAiConnection(owner, connection.id);
  assert.equal(pending(), 0);
  assert.deepEqual(store.getSnapshot(), before);
});

test("photo changes follow the gallery editors' rules, and refuse what they refuse", async (t) => {
  const { store, owner, guest, guestTrip, propose } = aiSetup(t);
  const { P1, P2, Q1, S1, X1, destinationId, hotelId, churchId } = await guestPlans(store, guest, guestTrip);
  const added = await photos(8);
  const [N1, N2] = ids(added);
  const before = store.getSnapshot();
  const destinationPhotos = (galleryChange) => ({ type: "destination.photos", id: destinationId, gallery: { add: [], remove: [], ...galleryChange } });
  const many = await photos(8);
  const refusals = [
    // A destination has up to 10 photos: two saved and nine new is too many.
    [[destinationPhotos({ add: add(added, ...ids(added)) }), destinationPhotos({ add: add(many, ...ids(many).slice(0, 1)) })], /^Change 2: A destination can have up to 10 photos\. Remove a photo before adding more\.$/, new Map([...added, ...many])],
    [[{ type: "candidate.photos", id: hotelId, gallery: { add: [], remove: [], order: [Q1] } }], /^Change 1: Only a destination's photos can be put in order\./],
    [[{ type: "church.photos", id: churchId, gallery: { add: [], remove: [Q1] } }], /^Change 1: A photo has changed or no longer exists\. Refresh and try again\.$/],
    [[{ type: "candidate.photos", id: hotelId, gallery: { add: [], remove: [], mainImageId: S1 } }], /^Change 1: Choose a main photo from the remaining photos\./],
    [[destinationPhotos({ order: [P1] })], /^Change 1: The destination photos have changed\. Refresh before rearranging them\.$/],
    [[destinationPhotos({ remove: [P1, P2], mainImageId: P1 })], /^Change 1: Choose a primary photo from the remaining destination photos\./],
    [[destinationPhotos({ add: [{ id: X1, url: "https://images.example.com/x.png" }] })], /^Change 1: A new photo's id is already a saved photo's\. Give each new photo a new UUID\.$/, new Map([[X1, added.get(N1)]])],
    [[destinationPhotos({ add: add(added, N1) }), { type: "church.photos", id: churchId, gallery: { add: add(added, N1), remove: [] } }], /^Change 2: Give each new photo its own id\.$/],
    [[destinationPhotos({ add: [{ id: N1 }] })], /^Change 1: url must be text\.$/],
    [[destinationPhotos({ add: [{ url: "https://images.example.com/a.png" }] })], /^Change 1: id must be text\.$/],
    [[destinationPhotos({ add: ["https://images.example.com/a.png"] })], /^Change 1: Give each photo to add as its new id and its url\.$/],
    [[{ type: "candidate.photos", id: hotelId }], /^Change 1: Give the photo changes as gallery/],
    [[{ type: "candidate.photos", id: hotelId, gallery: { add: [] } }], /^Change 1: Give the photo changes as gallery, with the photos to add and to remove\.$/],
    [[{ type: "church.photos", id: randomUUID(), gallery: { add: [], remove: [] } }], /^Change 1: This item doesn't exist\. Read Travel again for current IDs\.$/],
    // Photos change only with photo changes, never with an item's save, and only from photos Travel prepared.
    [[candidateInput(destinationId, "hotels", { id: hotelId, name: "Fjord Hotel", price: "300", gallery: { add: [], remove: [P1] } })], /^Change 1: Change photos with destination\.photos, candidate\.photos or church\.photos\.$/],
    [[{ type: "destination.save", id: destinationId, image: null }], /^Change 1: Change photos with destination\.photos/],
    [[destinationPhotos({ add: [{ id: N2, url: "https://images.example.com/a.png", data: [82, 73, 70, 70] }] })], /^Change 1: This proposal's new photos are no longer available/, new Map()],
  ];
  for (const [changes, message, prepared = added] of refusals) {
    assert.throws(() => propose(changes, "Photos", NOW, prepared), (error) => error instanceof ValidationError && message.test(error.message), String(message));
  }
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");
  assert.equal(store.aiOverview(owner, NOW).proposals.length, 0, "and isn't recorded");
});

test("people change photos only in Travel's own editors; photo changes are for assistants' proposals", async (t) => {
  const { store, owner, guest, guestTrip } = aiSetup(t);
  const { P1, destinationId, hotelId, churchId } = await guestPlans(store, guest, guestTrip);
  const [N1, data] = [...(await photos(1))][0];
  for (const [account, change] of [
    [guest, { type: "destination.photos", id: destinationId, gallery: { add: [{ id: N1, data }], remove: [P1] } }],
    [guest, { type: "candidate.photos", id: hotelId, gallery: { add: [{ id: N1, data }], remove: [] } }],
    [owner, { type: "church.photos", id: churchId, gallery: { add: [], remove: [] } }],
  ]) {
    assert.throws(() => store.applyMutation(account, change), (error) => error instanceof ValidationError && error.message === "This action is not supported. Please refresh and try again.");
  }
  // The guest's own gallery editing works as before.
  store.applyMutation(guest, { type: "destination.save", id: destinationId, gallery: { add: [{ id: N1, data }], remove: [], mainImageId: N1 } });
  assert.equal(store.aiDestination(destinationId).destination.mainImageId, N1);
});

test("a proposal's photos to download are known, and everything Travel's data doesn't decide is checked, before any download", async (t) => {
  const { store, guest, guestTrip, ownerTrip } = aiSetup(t);
  const { destinationId, hotelId } = await guestPlans(store, guest, guestTrip);
  const [N1, N2, N3] = [randomUUID(), randomUUID(), randomUUID()];
  assert.deepEqual(checkAiProposal({
    summary: "Photos and a tag",
    changes: [
      { type: "destination.photos", id: destinationId, gallery: { add: [{ id: N1, url: "https://images.example.com/a.jpg" }, { id: N2, url: "http://not-checked-here.example/b.jpg" }], remove: [] } },
      { type: "trip.tag", tripId: ownerTrip, name: "Norway" },
      { type: "candidate.photos", id: hotelId, gallery: { add: [{ id: N3, url: " https://images.example.com/c.jpg " }], remove: [] } },
    ],
  }), [{ change: 1, id: N1, url: "https://images.example.com/a.jpg" }, { change: 1, id: N2, url: "http://not-checked-here.example/b.jpg" }, { change: 3, id: N3, url: "https://images.example.com/c.jpg" }]);
  for (const [input, message] of [
    [{ summary: " ", changes: [{ type: "trip.tag", tripId: ownerTrip, name: "Norway" }] }, /^Please enter summary\.$/],
    [{ summary: "Nothing", changes: [] }, /^Propose from 1 to 50 changes\.$/],
    [{ summary: "Bad trip", changes: [{ type: "destination.photos", id: destinationId, gallery: { add: [{ id: N1, url: "https://images.example.com/a.jpg" }], remove: [] } }, { type: "trip.save", id: ownerTrip, name: "", dateLabel: "", homeCity: "", travelers: 2, notes: "" }] }, /^Change 2: Please enter name\.$/],
    [{ summary: "Unknown", changes: [{ type: "photos.upload", id: destinationId }] }, /^Change 1: This action is not supported/],
  ]) {
    assert.throws(() => checkAiProposal(input), (error) => error instanceof ValidationError && message.test(error.message), String(message));
  }
});

test("assistants propose photo changes through MCP, and Travel refuses to download from private addresses", async (t) => {
  const path = fileDatabase(t);
  process.env.TRAVEL_DATABASE_PATH = path;
  process.env.TRAVEL_OWNER_EMAIL = OWNER;
  t.after(() => { globalThis.travelStore?.close(); delete globalThis.travelStore; });
  const store = createStore(path, OWNER);
  t.after(() => store.close());
  const guest = store.authorizeAccount(GUEST).id;
  const guestTrip = store.applyMutation(guest, tripInput({ name: "Guest trip" })).id;
  const { P1, P2, destinationId } = await guestPlans(store, guest, guestTrip);
  const { tokens } = connectClaude(store, Date.now());
  const call = async (name, args) => {
    const response = await handleMcp(new Request("https://travel.example/api/mcp", { method: "POST", headers: { Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), "https://travel.example");
    return (await response.json()).result;
  };
  const before = store.getSnapshot();
  const N1 = randomUUID();
  for (const [url, message] of [
    ["http://images.example.com/a.jpg", "Travel downloads photos only from https:// addresses."],
    ["https://127.0.0.1/a.jpg", "Travel doesn't download photos from private, loopback or link-local addresses."],
    ["https://169.254.169.254/latest/meta-data/", "Travel doesn't download photos from private, loopback or link-local addresses."],
    ["https://localhost/a.jpg", "Travel doesn't download photos from private, loopback or link-local addresses."],
  ]) {
    const refused = await call("propose_changes", { summary: "Add a photo", changes: [{ type: "destination.photos", id: destinationId, gallery: { add: [{ id: N1, url }], remove: [] } }] });
    assert.deepEqual(refused, { content: [{ type: "text", text: `Change 1: ${url}: ${message}` }], isError: true }, url);
  }
  // Removing a photo and choosing the primary one download nothing.
  const proposed = JSON.parse((await call("propose_changes", { summary: "Tidy Oslo's photos", changes: [{ type: "destination.photos", id: destinationId, gallery: { add: [], remove: [P1], mainImageId: P2 } }] })).content[0].text);
  assert.equal(proposed.status, "pending");
  assert.deepEqual(proposed.changes[0].records.map(({ action, photo }) => [action, photo]).toSorted(), [["Changes", P2], ["Deletes", P1]].toSorted());
  assert.deepEqual(store.getSnapshot(), before, "proposing changes no photo");
  assert.equal(count(path, "SELECT count(*) AS count FROM ai_proposals"), 1, "only the proposal Travel could prepare was recorded");
});

test("schema 25 adds the table for proposals' photos, keeping every proposal, and a replay keeps their photos", async (t) => {
  const path = fileDatabase(t);
  let store = createStore(path, OWNER);
  const owner = store.authorizeAccount(OWNER).id;
  const tripId = store.applyMutation(owner, tripInput({ name: "Kept" })).id;
  const destinationId = store.applyMutation(owner, { type: "stop.add", tripId, city: "Lisbon" }).id;
  const { tokens } = connectClaude(store);
  const connection = store.readAiConnection(tokens.accessToken, NOW);
  const tagged = store.proposeAiChanges(connection.id, { summary: "Tag it", changes: [{ type: "trip.tag", tripId, name: "Kept" }] }, new Map(), NOW);
  store.close();
  let db = new DatabaseSync(path);
  db.exec("DROP TRIGGER ai_proposal_photos_unchanged; DROP TABLE ai_proposal_photos; PRAGMA user_version = 24;");
  db.close();
  store = createStore(path, OWNER);
  assert.equal(store.getAiProposal(owner, tagged.id, NOW)?.digest, tagged.digest, "the upgrade keeps proposals, unchanged");
  const added = await photos(1);
  const proposal = store.proposeAiChanges(connection.id, { summary: "A photo", changes: [{ type: "destination.photos", id: destinationId, gallery: { add: add(added, ...ids(added)), remove: [] } }] }, added, NOW);
  store.close();
  db = new DatabaseSync(path);
  db.exec("PRAGMA user_version = 24;");
  db.close();
  store = createStore(path, OWNER);
  t.after(() => store.close());
  const [photoId] = ids(added);
  assert.deepEqual(store.getAiProposalPhoto(owner, proposal.id, photoId, NOW)?.data, added.get(photoId), "a replay keeps proposals' photos");
  db = new DatabaseSync(path);
  t.after(() => db.close());
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.throws(() => db.prepare("UPDATE ai_proposal_photos SET data = x'00'").run(), /A proposal's photos can't be changed once it is made/);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
