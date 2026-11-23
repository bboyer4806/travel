import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import sharp from "sharp";
import { prepareImage } from "../src/lib/image-upload.ts";
import { handleMcp } from "../src/lib/mcp.ts";
import { UNCROPPED } from "../src/lib/photo-focus.ts";
import { checkAiProposal, createStore, ValidationError } from "../src/lib/store.ts";
import { aiSetup, connectClaude, GUEST, NOW, OWNER } from "./ai-fixtures.mjs";
import { fileDatabase, newItem, tripInput } from "./budget-fixtures.mjs";

// TRA-174: ChatGPT and Claude propose adding, replacing and removing trips' and destinations' headline images, for the
// owner to approve, by the rules people's editors follow.

/** An image as Travel prepares a download, larger than a photo, so it keeps a large version too (TRA-154). */
async function downloaded(color, width = 2400, height = 1200) {
  const form = new FormData();
  form.set("image", new File([await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()], "image.png", { type: "image/png" }));
  return prepareImage(form);
}
const url = (id) => `https://images.example.com/${id}.png`;
const headline = (tripId, id) => ({ type: "trip.image", id: tripId, image: id === null ? null : { id, url: url(id) } });
const count = (path, sql) => { const db = new DatabaseSync(path, { readOnly: true }); try { return db.prepare(sql).get().count; } finally { db.close(); } };
/** Everything saved, but trips' headline images, which a headline image change alone may change. */
const withoutHeadlines = (snapshot) => ({ ...snapshot, trips: snapshot.trips.map((trip) => ({ ...trip, image: null })) });
/** A saved trip's details as its editor sends them, with a headline image change. */
const tripEdit = (id, image) => ({ type: "trip.save", id, name: "Guest trip", dateLabel: "Someday", homeCity: "Denver", travelers: 2, notes: "Trip notes", image });

test("assistants read a trip's headline image and propose adding, replacing and removing it, which only approval saves", async (t) => {
  const path = fileDatabase(t);
  const { store, owner, guest, guestTrip, propose, decide } = aiSetup(t, path);
  const [N1, N2] = [randomUUID(), randomUUID()];
  const images = new Map([[N1, await downloaded("#285f56")], [N2, await downloaded("#c46b2d")]]);
  const trip = `Trip “Guest trip” (${GUEST}): headline image`;
  assert.equal(store.aiTrip(guestTrip).trip.image, null, "assistants read that a trip has none");

  // Adding: the owner sees the image it adds, and nothing changes until they approve it.
  const before = store.getSnapshot();
  const added = propose([headline(guestTrip, N1)], "Give the trip an image", NOW, new Map([[N1, images.get(N1)]]));
  assert.deepEqual(added.preview, [{ operation: "Set a trip's headline image", records: [{ action: "Adds", record: trip, fields: [], headline: { before: null, after: N1 } }] }]);
  assert.deepEqual(store.getSnapshot(), before, "proposing saves no image");
  assert.deepEqual(store.getAiProposalPhoto(owner, added.id, N1, NOW).data, images.get(N1).data, "the owner sees the image it adds");
  assert.equal(store.getAiProposalPhoto(guest, added.id, N1, NOW), undefined, "nobody else does");
  assert.equal(count(path, "SELECT count(*) AS count FROM ai_proposal_photos"), 1, "its image waits beside it");
  assert.equal(decide(added, true).status, "applied");
  const saved = store.aiTrip(guestTrip).trip.image;
  assert.deepEqual(saved, { version: saved.version, card: UNCROPPED, banner: UNCROPPED, widths: images.get(N1).large.widths }, "a new image starts uncropped, as in the trip editor");
  assert.deepEqual(store.getTripImage(guest, guestTrip), { version: saved.version, data: images.get(N1).data }, "saved as Travel prepared it");
  assert.deepEqual(store.getTripLargeImage(guest, guestTrip).data, images.get(N1).large.data, "with its large version (TRA-154)");
  assert.deepEqual(store.aiPhoto("trip", guestTrip, saved.version).data, images.get(N1).data, "assistants see the image by its version");
  assert.equal(store.aiPhoto("trip", guestTrip, randomUUID()), undefined, "and only by its version");
  assert.deepEqual(withoutHeadlines(store.getSnapshot()), withoutHeadlines(before), "nothing else changed");
  assert.equal(count(path, "SELECT count(*) AS count FROM ai_proposal_photos"), 0, "the image is in Travel now, and kept nowhere else");

  // Replacing: the owner compares the saved image with the new one, which starts uncropped in place of the saved crops.
  const card = { focusX: 30, focusY: 70, zoom: 1.5 };
  store.applyMutation(guest, tripEdit(guestTrip, { version: saved.version, card, banner: card }));
  const replaced = propose([headline(guestTrip, N2)], "A better image", NOW, new Map([[N2, images.get(N2)]]));
  assert.deepEqual(replaced.preview[0].records, [{ action: "Changes", record: trip, fields: [], headline: { before: saved.version, after: N2 } }]);
  assert.deepEqual(store.getAiProposalPhoto(owner, replaced.id, saved.version, NOW).data, images.get(N1).data, "the owner sees the image it replaces");
  assert.deepEqual(store.getAiProposalPhoto(owner, replaced.id, N2, NOW).data, images.get(N2).data, "beside the image that replaces it");
  assert.equal(decide(replaced, true).status, "applied");
  const replacement = store.aiTrip(guestTrip).trip.image;
  assert.notEqual(replacement.version, saved.version, "a new version, so browsers load the new image");
  assert.deepEqual([replacement.card, replacement.banner], [UNCROPPED, UNCROPPED]);
  assert.deepEqual(store.getTripImage(guest, guestTrip).data, images.get(N2).data);

  // Removing: rejecting changes nothing, and approving removes it.
  const removal = propose([headline(guestTrip, null)], "No image");
  assert.deepEqual(removal.preview, [{ operation: "Remove a trip's headline image", records: [{ action: "Deletes", record: trip, fields: [], headline: { before: replacement.version, after: null } }] }]);
  assert.deepEqual(store.getAiProposalPhoto(owner, removal.id, replacement.version, NOW).data, images.get(N2).data, "the owner sees the image it removes");
  const kept = store.getSnapshot();
  assert.equal(decide(removal, false).status, "rejected");
  assert.deepEqual(store.getSnapshot(), kept, "rejecting changes nothing");
  assert.equal(store.getAiProposalPhoto(owner, removal.id, replacement.version, NOW + 2000), undefined, "a decided proposal shows no image");
  const removed = propose([headline(guestTrip, null)], "No image");
  assert.equal(decide(removed, true).status, "applied");
  assert.equal(store.aiTrip(guestTrip).trip.image, null);
  assert.equal(store.getTripImage(guest, guestTrip), undefined);
  // The owner's own access is unchanged: the guest's trip still isn't shared with them.
  assert.throws(() => store.applyMutation(owner, tripEdit(guestTrip, null)), /isn't shared with you/);
});

test("a headline image change is made with the rest of its proposal exactly as previewed, or not at all", async (t) => {
  const path = fileDatabase(t);
  const { store, owner, guest, guestTrip, ownerTrip, propose, decide } = aiSetup(t, path);
  const [N1, N2, N3] = [randomUUID(), randomUUID(), randomUUID()];
  const images = new Map([[N1, await downloaded("#3b4f8a")], [N2, await downloaded("#8a3b6e")], [N3, await downloaded("#6e8a3b", 48, 32)]]);

  // A later change the planner refuses when approved: the image isn't saved either.
  const itemId = store.applyMutation(owner, { type: "homeItem.save", ...newItem(), tripId: ownerTrip, name: "Pause mail", price: "", notes: "" }).id;
  const batch = propose([headline(guestTrip, N1), { type: "homeItem.delete", id: itemId, tripId: ownerTrip }], "Image and errand", NOW, new Map([[N1, images.get(N1)]]));
  store.applyMutation(owner, { type: "homeItem.delete", id: itemId, tripId: ownerTrip });
  let unchanged = store.getSnapshot();
  const refused = decide(batch, true);
  assert.deepEqual([refused.status, refused.error], ["failed", "Change 2: This item doesn't exist. Read Travel again for current IDs."]);
  assert.deepEqual(store.getSnapshot(), unchanged, "the image rolled back with the refused change");
  assert.equal(count(path, "SELECT count(*) AS count FROM ai_proposal_photos"), 0, "a failed proposal keeps no image");

  // An image someone saved since: approving would replace a different image than the owner saw, so nothing changes.
  const replace = propose([headline(guestTrip, N2)], "An image", NOW, new Map([[N2, images.get(N2)]]));
  store.applyMutation(guest, tripEdit(guestTrip, { data: images.get(N3).data, large: null, card: UNCROPPED, banner: UNCROPPED }));
  unchanged = store.getSnapshot();
  const changed = decide(replace, true);
  assert.equal(changed.status, "failed");
  assert.match(changed.error, /^Travel has changed since this was proposed/);
  assert.deepEqual(store.getSnapshot(), unchanged);
  assert.deepEqual(store.getTripImage(guest, guestTrip).data, images.get(N3).data, "the guest's image stays");

  // A trip a proposal adds can get its image in the same proposal.
  const tripId = randomUUID();
  const both = propose([{ type: "trip.save", id: tripId, create: true, name: "Lisbon", dateLabel: "", homeCity: "Boston", travelers: 2, notes: "" }, headline(tripId, N1)], "A new trip", NOW, new Map([[N1, images.get(N1)]]));
  assert.deepEqual(both.preview[1].records.map(({ action, headline: images }) => [action, images]), [["Adds", { before: null, after: N1 }]]);
  assert.equal(decide(both, true).status, "applied");
  assert.deepEqual(store.getTripImage(owner, tripId).data, images.get(N1).data);
});

test("headline image changes are only proposals', and refuse what Travel can't use", async (t) => {
  const { store, owner, guest, guestTrip, propose } = aiSetup(t);
  const N1 = randomUUID();
  const image = await downloaded("#3b8a87", 48, 32);
  const photos = new Map([[N1, image]]);
  const before = store.getSnapshot();
  for (const [changes, message, prepared = photos] of [
    [[{ type: "trip.image", id: guestTrip }], /^Change 1: Give the headline image as image, with its new id and url, or null to remove it\.$/],
    [[{ type: "trip.image", id: guestTrip, image: "https://images.example.com/a.png" }], /^Change 1: Give the headline image as image/],
    [[{ type: "trip.image", id: guestTrip, image: { id: N1 } }], /^Change 1: url must be text\.$/],
    [[{ type: "trip.image", id: guestTrip, image: { url: url(N1) } }], /^Change 1: id must be text\.$/],
    [[headline(guestTrip, N1), { type: "destination.photos", id: randomUUID(), gallery: { add: [{ id: N1, url: url(N1) }], remove: [] } }], /^Change 2: Give each new photo its own id\.$/],
    [[headline(randomUUID(), N1)], /^Change 1: This item doesn't exist\. Read Travel again for current IDs\.$/],
    // Crops are chosen only in the trip editor, and an image is never sent with the trip's details.
    [[{ ...headline(guestTrip, N1), card: UNCROPPED }], /^Change 1: trip\.image has no field card\.$/],
    [[tripEdit(guestTrip, { data: image.data, large: null, card: UNCROPPED, banner: UNCROPPED })], /^Change 1: Change a trip's headline image with trip\.image\.$/],
    // Only an image Travel downloaded is saved, never bytes an assistant sends.
    [[{ type: "trip.image", id: guestTrip, image: { id: N1, url: url(N1), data: [82, 73, 70, 70] } }], /^Change 1: This proposal's new photos are no longer available/, new Map()],
  ]) {
    assert.throws(() => propose(changes, "An image", NOW, prepared), (error) => error instanceof ValidationError && message.test(error.message), String(message));
  }
  assert.deepEqual(checkAiProposal({ summary: "Images", changes: [headline(guestTrip, N1), headline(guestTrip, null)] }), [{ change: 1, id: N1, url: url(N1) }], "Travel downloads only the image a change adds");
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");
  assert.equal(store.aiOverview(owner, NOW).proposals.length, 0, "and isn't recorded");
  // People change a headline image only in the trip editor, with the trip's save.
  assert.throws(() => store.applyMutation(guest, { ...headline(guestTrip, N1), image: { id: N1, ...image } }), { name: "ValidationError", message: "This action is not supported. Please refresh and try again." });
});

test("assistants see trips' headline images and propose them through MCP, and Travel downloads them only from public https:// addresses", async (t) => {
  const path = fileDatabase(t);
  process.env.TRAVEL_DATABASE_PATH = path;
  process.env.TRAVEL_OWNER_EMAIL = OWNER;
  t.after(() => { globalThis.travelStore?.close(); delete globalThis.travelStore; });
  const store = createStore(path, OWNER);
  t.after(() => store.close());
  const guest = store.authorizeAccount(GUEST).id;
  const image = await downloaded("#8a6e3b", 48, 32);
  const tripId = store.applyMutation(guest, tripInput({ name: "Guest trip", image: { data: image.data, large: null, card: UNCROPPED, banner: UNCROPPED } })).id;
  const { tokens } = connectClaude(store, Date.now());
  const call = async (name, args) => {
    const response = await handleMcp(new Request("https://travel.example/api/mcp", { method: "POST", headers: { Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), "https://travel.example");
    return (await response.json()).result;
  };
  const { version } = JSON.parse((await call("get_trip", { trip_id: tripId })).content[0].text).trip.image;
  assert.deepEqual((await call("get_photo", { of: "trip", id: tripId, photo_id: version })).content, [{ type: "image", mimeType: "image/webp", data: Buffer.from(image.data).toString("base64") }]);
  assert.deepEqual(await call("get_photo", { of: "trip", id: tripId, photo_id: randomUUID() }), { content: [{ type: "text", text: "Travel has no such headline image of this trip." }], isError: true });

  const before = store.getSnapshot();
  const N1 = randomUUID();
  for (const [address, message] of [
    ["http://images.example.com/a.jpg", "Travel downloads photos only from https:// addresses."],
    ["https://127.0.0.1/a.jpg", "Travel doesn't download photos from private, loopback or link-local addresses."],
    ["https://localhost/a.jpg", "Travel doesn't download photos from private, loopback or link-local addresses."],
  ]) {
    const refused = await call("propose_changes", { summary: "An image", changes: [{ type: "trip.image", id: tripId, image: { id: N1, url: address } }] });
    assert.deepEqual(refused, { content: [{ type: "text", text: `Change 1: ${address}: ${message}` }], isError: true }, address);
  }
  // Removing the image downloads nothing.
  const proposed = JSON.parse((await call("propose_changes", { summary: "No image", changes: [{ type: "trip.image", id: tripId, image: null }] })).content[0].text);
  assert.equal(proposed.status, "pending");
  assert.deepEqual(proposed.changes, [{ operation: "Remove a trip's headline image", records: [{ action: "Deletes", record: `Trip “Guest trip” (${GUEST}): headline image`, fields: [], headline: { before: version, after: null } }] }]);
  assert.deepEqual(store.getSnapshot(), before, "proposing changes nothing");
  assert.equal(count(path, "SELECT count(*) AS count FROM ai_proposals"), 1, "only the proposal Travel could prepare was recorded");
});

test("assistants read a destination's headline image, its primary photo, and propose adding, replacing and removing it by the photo editor's rules", async (t) => {
  const { store, guest, guestTrip, propose, decide } = aiSetup(t);
  const [P1, P2, N1, N2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const images = new Map(await Promise.all([[P1, "#285f56"], [P2, "#c46b2d"], [N1, "#3b4f8a"], [N2, "#8a3b6e"]].map(async ([id, color]) => [id, await downloaded(color, 48, 32)])));
  const photo = (id) => ({ id, url: url(id) });
  const destinationId = store.applyMutation(guest, { type: "stop.add", tripId: guestTrip, city: "Oslo" }).id;
  const oslo = `Destination “Oslo” (${GUEST}): photo`;
  const primary = () => store.aiDestination(destinationId).destination.mainImageId;
  const photos = () => store.aiDestination(destinationId).destination.images.map((image) => image.id);
  const records = (proposal) => proposal.preview[0].records.map(({ action, record, photo: id, fields }) => ({ action, record, photo: id, fields })).toSorted((a, b) => a.photo.localeCompare(b.photo));
  const sorted = (list) => list.toSorted((a, b) => a.photo.localeCompare(b.photo));

  // Adding to a destination without photos: the first photo is its primary photo.
  const added = propose([{ type: "destination.photos", id: destinationId, gallery: { add: [photo(P1), photo(P2)], remove: [] } }], "Photos of Oslo", NOW, new Map([[P1, images.get(P1)], [P2, images.get(P2)]]));
  assert.deepEqual(records(added), sorted([
    { action: "Adds", record: oslo, photo: P1, fields: [{ name: "Order", before: null, after: "1" }, { name: "Primary photo", before: null, after: "Yes" }] },
    { action: "Adds", record: oslo, photo: P2, fields: [{ name: "Order", before: null, after: "2" }, { name: "Primary photo", before: null, after: "No" }] },
  ]));
  assert.equal(primary(), null, "nothing changes until the owner approves");
  assert.equal(decide(added, true).status, "applied");
  assert.equal(primary(), P1);
  assert.deepEqual(store.aiPhoto("destination", destinationId, P1).data, images.get(P1).data, "assistants see the primary photo");

  // Replacing: a new photo becomes the primary one in place of the photo it removes.
  const replaced = propose([{ type: "destination.photos", id: destinationId, gallery: { add: [photo(N1)], remove: [P1], mainImageId: N1, order: [N1, P2] } }], "A better photo", NOW, new Map([[N1, images.get(N1)]]));
  // The other photo keeps its place and stays not primary, so it isn't listed.
  assert.deepEqual(records(replaced), sorted([
    { action: "Adds", record: oslo, photo: N1, fields: [{ name: "Order", before: null, after: "1" }, { name: "Primary photo", before: null, after: "Yes" }] },
    { action: "Deletes", record: oslo, photo: P1, fields: [{ name: "Order", before: "1", after: null }, { name: "Primary photo", before: "Yes", after: null }] },
  ]));
  assert.equal(decide(replaced, true).status, "applied");
  assert.deepEqual([primary(), photos()], [N1, [N1, P2]]);

  // Rejecting changes nothing.
  const rejected = propose([{ type: "destination.photos", id: destinationId, gallery: { add: [photo(N2)], remove: [], mainImageId: N2 } }], "Another photo", NOW, new Map([[N2, images.get(N2)]]));
  const kept = store.getSnapshot();
  assert.equal(decide(rejected, false).status, "rejected");
  assert.deepEqual(store.getSnapshot(), kept);

  // Removing the primary photo makes the first remaining photo primary, as the photo editor does; removing the last leaves none.
  const removed = propose([{ type: "destination.photos", id: destinationId, gallery: { add: [], remove: [N1] } }], "Remove a photo");
  assert.deepEqual(records(removed), sorted([
    { action: "Changes", record: oslo, photo: P2, fields: [{ name: "Order", before: "2", after: "1" }, { name: "Primary photo", before: "No", after: "Yes" }] },
    { action: "Deletes", record: oslo, photo: N1, fields: [{ name: "Order", before: "1", after: null }, { name: "Primary photo", before: "Yes", after: null }] },
  ]));
  assert.equal(decide(removed, true).status, "applied");
  assert.equal(primary(), P2);
  const cleared = propose([{ type: "destination.photos", id: destinationId, gallery: { add: [], remove: [P2] } }], "No photos");
  assert.equal(decide(cleared, true).status, "applied");
  assert.deepEqual([primary(), photos()], [null, []]);
  // A primary photo must be one of the photos that remain, as in the photo editor.
  assert.throws(() => propose([{ type: "destination.photos", id: destinationId, gallery: { add: [], remove: [], mainImageId: P1 } }]), { name: "ValidationError", message: /^Change 1: Choose a primary photo from the remaining destination photos/ });
});
