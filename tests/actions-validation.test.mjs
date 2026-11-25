import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";
import * as actionStore from "../src/lib/store.ts";
import * as apiStore from "../src/lib/store.ts?api-bundle";
import * as imageUpload from "../src/lib/image-upload.ts";
import * as candidateGallery from "../src/lib/candidate-gallery-upload.ts";
import * as destinationGallery from "../src/lib/destination-gallery-upload.ts";
import * as tripImageUpload from "../src/lib/trip-image-upload.ts";
import { OWNER_EMAIL } from "./owned-store.mjs";
import { newItem } from "./budget-fixtures.mjs";

// Execute the real action with only Next's request/cache boundaries replaced.
const source = ts.transpileModule(readFileSync(new URL("../src/app/actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function actionHarness(store, account) {
  const logged = [], revalidated = [], exports = {};
  const dependencies = {
    "next/cache": { revalidatePath: (...args) => revalidated.push(args) },
    "@/lib/store": { ...actionStore, ...store },
    "@/auth": { currentAccount: async () => account },
    "@/lib/image-upload": imageUpload,
    "@/lib/candidate-gallery-upload": candidateGallery,
    "@/lib/destination-gallery-upload": destinationGallery,
    "@/lib/trip-image-upload": tripImageUpload,
  };
  const require = (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected action dependency: ${name}`);
    return dependencies[name];
  };
  new Function("require", "exports", "console", source)(require, exports, { error: (...args) => logged.push(args) });
  return { save: exports.mutatePlanner, logged, revalidated };
}

const trip = { type: "trip.save", name: "Test trip", dateLabel: "", homeCity: "", travelers: 2, notes: "" };

for (const [label, initializingModule] of [["page-first", actionStore], ["API-first", apiStore]]) {
  test(`save errors retain their messages with ${label} store initialization`, async (t) => {
    assert.notEqual(apiStore.ValidationError, actionStore.ValidationError);
    // Choose the module explicitly: a production API and action may bundle separate copies.
    const store = initializingModule.createStore(":memory:", OWNER_EMAIL);
    t.after(() => store.close());
    const account = store.authorizeAccount(OWNER_EMAIL);
    const action = actionHarness({ applyMutation: store.applyMutation }, account);
    assert.deepEqual(await action.save({ ...trip, ...newItem(), name: "" }), { ok: false, error: "Please enter name." });
    const saved = await action.save({ ...trip, ...newItem() });
    assert.equal(saved.ok, true);
    assert.equal(store.getSnapshot().trips.length, 1);
    assert.equal(action.revalidated.length, 1);
    assert.deepEqual(await action.save({ type: "trip.delete", id: saved.id }), { ok: true });
    // Preserve the current privacy-safe message for both missing and inaccessible records.
    assert.deepEqual(await action.save({ ...trip, id: saved.id }), {
      ok: false, error: "This item no longer exists or isn't shared with you. Please refresh and try again.",
    });
    assert.equal(action.logged.length, 0);
  });
}

test("cross-module stale-record validation retains the original message", async () => {
  const message = "This item no longer exists. Please refresh and try again.";
  const error = new apiStore.ValidationError(message);
  assert.equal(error instanceof actionStore.ValidationError, false);
  const action = actionHarness({ applyMutation() { throw error; } }, { id: "owner" });
  assert.deepEqual(await action.save(trip), { ok: false, error: message });
  assert.equal(action.logged.length, 0);
});

test("unexpected errors and ordinary lookalike objects stay generic and are logged", async () => {
  for (const error of [new Error("private database detail"), new TypeError("internal failure"), { name: "ValidationError", message: "not an Error" }, "failure", null]) {
    const action = actionHarness({ applyMutation() { throw error; } }, { id: "owner" });
    assert.deepEqual(await action.save(trip), { ok: false, error: "We couldn't save your changes. Please try again." });
    assert.deepEqual(action.logged, [["Unable to save travel plan", error]]);
    assert.equal(action.revalidated.length, 0);
  }
});

test("invalid images retain their upload validation and never reach storage", async () => {
  let writes = 0;
  const action = actionHarness({ applyMutation() { writes++; } }, { id: "owner" });
  const form = new FormData();
  form.set("image", new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'], "image.svg", { type: "image/svg+xml" }));
  assert.deepEqual(await action.save({ type: "destination.save" }, form), { ok: false, error: "Choose a JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, or HEIC image." });
  assert.equal(writes, 0);
  assert.equal(action.logged.length, 0);
});

test("unauthenticated saves still require sign-in before validation or storage", async () => {
  const action = actionHarness({ applyMutation() { assert.fail("Unauthenticated write"); } }, null);
  assert.deepEqual(await action.save(trip), {
    ok: false, error: "Your session has ended. Sign in again in another tab, then save again.",
  });
});

test("a trip's headline image comes only from the trip editor's form, as a validated upload (TRA-133)", async (t) => {
  const store = actionStore.createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const account = store.authorizeAccount(OWNER_EMAIL);
  const action = actionHarness({ applyMutation: store.applyMutation }, account);
  const crop = { focusX: 40, focusY: 60, zoom: 1.25 };
  const upload = new FormData();
  upload.set("image", new File([await sharp({ create: { width: 64, height: 32, channels: 3, background: "#496b62" } }).png().toBuffer()], "trip.png", { type: "image/png" }));
  upload.set("crops", JSON.stringify({ card: crop, banner: crop }));
  const created = { ...trip, ...newItem() };
  assert.deepEqual(await action.save(created, upload), { ok: true, id: created.id });
  const saved = store.getTripImage(account.id, created.id);
  assert.equal((await sharp(saved.data).metadata()).format, "webp");
  const savedTrip = () => store.getSnapshot().trips.find((item) => item.id === created.id);
  assert.deepEqual(savedTrip().image, { version: saved.version, card: crop, banner: crop, widths: null });

  // An image named in the change itself, without the editor's form, changes nothing.
  for (const image of [null, { version: saved.version, card: { ...crop, zoom: 3 }, banner: crop }, { data: [...saved.data], card: crop, banner: crop }]) {
    assert.deepEqual(await action.save({ ...trip, id: created.id, image }), { ok: true, id: created.id });
    assert.deepEqual([store.getTripImage(account.id, created.id), savedTrip().image.card], [saved, crop]);
  }
  // An upload that isn't an image is refused before anything is saved.
  const svg = new FormData();
  svg.set("image", new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'], "trip.svg", { type: "image/svg+xml" }));
  svg.set("crops", JSON.stringify({ card: crop, banner: crop }));
  assert.deepEqual(await action.save({ ...trip, id: created.id, name: "Not saved" }, svg), { ok: false, error: "Choose a JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, or HEIC image." });
  assert.equal(savedTrip().name, trip.name);
  // New crops for the saved image, then its removal, through the form.
  const recrop = new FormData();
  recrop.set("crops", JSON.stringify({ version: saved.version, card: crop, banner: { ...crop, zoom: 2 } }));
  assert.equal((await action.save({ ...trip, id: created.id }, recrop)).ok, true);
  assert.deepEqual(savedTrip().image.banner, { ...crop, zoom: 2 });
  const remove = new FormData();
  remove.set("removeImage", "true");
  assert.equal((await action.save({ ...trip, id: created.id }, remove)).ok, true);
  assert.deepEqual([store.getTripImage(account.id, created.id), savedTrip().image], [undefined, null]);
  assert.equal(action.logged.length, 0);
});
