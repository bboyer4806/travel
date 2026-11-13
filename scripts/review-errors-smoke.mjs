// Production HTTP regressions for TRA-73, TRA-75 and TRA-94. Run after pnpm build with Node 24.
// All writes and failure injection use a new, isolated database under test-results.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { createStore } from "../src/lib/store.ts";
import { sessionCookieName } from "../src/lib/session-cookie.ts";

assert.equal(process.versions.node.split(".")[0], "24", "Run this smoke test with Node 24.");
assert.ok(existsSync(".next/BUILD_ID"), "Run pnpm build before the production smoke test.");
const build = JSON.parse(readFileSync(".next/required-server-files.json", "utf8"));
const standalone = join(resolve(".next/standalone"), relative(build.config.outputFileTracingRoot ?? resolve("."), resolve(".")));
assert.ok(existsSync(join(standalone, "server.js")), "The build must include the standalone server.");
if (existsSync("public")) cpSync("public", join(standalone, "public"), { recursive: true });
cpSync(".next/static", join(standalone, ".next/static"), { recursive: true });
mkdirSync("test-results", { recursive: true });
const directory = mkdtempSync(resolve("test-results/review-errors-"));
const database = join(directory, "planner.sqlite");
const missingId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ownerEmail = "owner@example.test";
const store = createStore(database, ownerEmail);
const owner = store.authorizeAccount(ownerEmail);
// Seed the result of an authorized Google sign-in in this disposable store.
// No sign-in shortcut is exposed by the application, and Google is never called.
assert.equal(store.authorizeGoogleSignIn({ subject: "review-smoke-owner", email: ownerEmail, emailVerified: true, name: "Smoke Owner" })?.id, owner.id);
const cookie = `${sessionCookieName(false)}=${store.createSession(owner.id, Date.now())}`;
const tripInput = { type: "trip.save", name: "Review smoke trip", dateLabel: "", homeCity: "Test", travelers: 2, notes: "" };
// A new item carries the ID its editor gives it.
const newItem = () => ({ id: randomUUID(), create: true });
const tripId = store.applyMutation(owner.id, { ...tripInput, ...newItem() }).id;
const destinationId = store.applyMutation(owner.id, {
  type: "destination.save", ...newItem(), tripId, city: "Vienna", notes: "", stay: "",
  image: Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQtSZVrP+BiOh/AAA=", "base64"),
}).id;
const otherTripId = store.applyMutation(owner.id, { ...tripInput, ...newItem(), name: "Other smoke trip" }).id;
store.close();
const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8"));
const actions = Object.entries(manifest.node ?? {}).filter(([, action]) => action.exportedName === "mutatePlanner" && action.filename === "src/app/actions.ts");
assert.equal(actions.length, 1, "Production build must expose exactly one mutatePlanner action.");
const actionId = actions[0][0];

async function startServer(label, databasePath = database) {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, NODE_ENV: "production", GOOGLE_CLIENT_ID: "review-smoke-client",
    GOOGLE_CLIENT_SECRET: "review-smoke-secret", TRAVEL_OWNER_EMAIL: ownerEmail,
    TRAVEL_DATABASE_PATH: databasePath, HOSTNAME: "127.0.0.1", PORT: String(port),
  };
  const child = spawn(process.execPath, [join(standalone, "server.js")], {
    env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const exited = once(child, "exit");
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    writeFileSync(join(directory, `${label}.log`), output);
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Production server exited: ${output}`);
      // This unauthenticated page never opens the store. The first authenticated/API
      // request below therefore controls which Next bundle initializes the singleton.
      try { ready = (await fetch(origin + "/login", { signal: AbortSignal.timeout(1000) })).status === 200; } catch {}
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, `Production server did not become ready: ${output}`);
    async function request(path, options = {}) {
      return fetch(origin + path, {
        redirect: "manual", signal: AbortSignal.timeout(10000), ...options,
        headers: { Cookie: cookie, ...options.headers },
      });
    }
    async function mutation(input) {
      const response = await request("/", {
        method: "POST",
        headers: { "Next-Action": actionId, Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8", Origin: origin },
        body: JSON.stringify([input]),
      });
      assert.equal(response.status, 200, "Server Action transport must succeed.");
      const results = (await response.text()).split("\n").flatMap((line) => {
        const separator = line.indexOf(":");
        if (separator < 0) return [];
        try {
          const value = JSON.parse(line.slice(separator + 1));
          return value && typeof value.ok === "boolean" ? [value] : [];
        } catch { return []; }
      });
      assert.equal(results.length, 1, "Server Action must return one result.");
      return results[0];
    }
    return { request, mutation, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

for (const [label, firstPath] of [
  ["health-first", "/api/health"],
  ["image-first", `/api/destination-images/${destinationId}`],
  ["page-first", "/"],
]) {
  const server = await startServer(label);
  try {
    assert.equal((await server.request(firstPath)).status, 200, `${label} initialization must succeed.`);
    assert.deepEqual(await server.mutation({ ...tripInput, ...newItem(), name: " " }), { ok: false, error: "Please enter name." }, `${label} must preserve cross-bundle validation messages.`);
    assert.deepEqual(await server.mutation({ type: "trip.delete", id: missingId }), {
      ok: false, error: "This item no longer exists or isn't shared with you. Please refresh and try again.",
    }, `${label} must preserve current stale-record access messages.`);
    const created = { ...tripInput, ...newItem(), name: `${label} valid save` };
    const saved = await server.mutation(created);
    assert.deepEqual(saved, { ok: true, id: created.id });
    assert.deepEqual(await server.mutation(created), saved, `${label} must save a new trip sent again as the same trip.`);
    assert.equal((await server.mutation({ type: "trip.delete", id: saved.id })).ok, true);

    if (label === "page-first") {
      const validPaths = ["/", `/trips/${tripId}`, `/trips/${tripId}/destinations/${destinationId}/hotels`, "/destinations", `/destinations/${destinationId}`, `/destinations/${destinationId}/hotels`];
      for (const path of validPaths) assert.equal((await server.request(path)).status, 200, path);
      for (const path of [
        `/trips/${missingId}`,
        `/trips/${tripId}/destinations/${missingId}/hotels`,
        `/trips/${otherTripId}/destinations/${destinationId}/hotels`,
        `/trips/${tripId}/destinations/${destinationId}/unsupported`,
        `/destinations/${missingId}`,
        `/destinations/${missingId}/hotels`,
        `/destinations/${destinationId}/unsupported`,
      ]) {
        const response = await server.request(path);
        assert.equal(response.status, 404, path);
        assert.match(await response.text(), /This page has moved on\./);
      }
      // Keep accounts/authentication available while causing page data reads to fail.
      // This changes only this test's disposable fixture, never application code/data.
      const db = new DatabaseSync(database);
      db.exec("ALTER TABLE trips RENAME TO smoke_unavailable_trips");
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          for (const path of validPaths) assert.equal((await server.request(path)).status, 500, `Persistent data failure: ${path}`);
        }
      } finally {
        db.exec("ALTER TABLE smoke_unavailable_trips RENAME TO trips");
        db.close();
      }
      for (const path of validPaths) assert.equal((await server.request(path)).status, 200, `Recovered data: ${path}`);
      assert.equal((await server.request("/api/health")).status, 200);
    }
    console.log(`Passed ${label}: validation, stale-record handling, and valid saves.`);
  } finally { await server.stop(); }
}

// SELECT 1 intentionally does not inspect trip tables. Test failed store startup
// separately by supplying a directory where an isolated database file should be.
const unavailable = await startServer("unavailable-store", directory);
try {
  const response = await unavailable.request("/api/health");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable" });
} finally { await unavailable.stop(); }
console.log("Passed production HTTP regressions: 200/404/500, persistent failure/recovery, health 200/503, and all three store initialization orders.");
console.log("Isolated fixture and server logs:", directory);
