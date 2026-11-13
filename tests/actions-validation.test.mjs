import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as actionStore from "../src/lib/store.ts";
import * as apiStore from "../src/lib/store.ts?api-bundle";
import * as imageUpload from "../src/lib/image-upload.ts";
import * as candidateGallery from "../src/lib/candidate-gallery-upload.ts";
import * as destinationGallery from "../src/lib/destination-gallery-upload.ts";
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
  form.set("image", new File(["svg"], "image.svg", { type: "image/svg+xml" }));
  assert.deepEqual(await action.save({ type: "destination.save" }, form), { ok: false, error: "Choose a JPEG, PNG, or WebP image." });
  assert.equal(writes, 0);
  assert.equal(action.logged.length, 0);
});

test("unauthenticated saves still require sign-in before validation or storage", async () => {
  const action = actionHarness({ applyMutation() { assert.fail("Unauthenticated write"); } }, null);
  assert.deepEqual(await action.save(trip), {
    ok: false, error: "Your session has ended. Sign in again in another tab, then save again.",
  });
});
