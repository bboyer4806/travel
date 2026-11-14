// Production HTTP regressions for TRA-73, TRA-75, TRA-94, TRA-115 and TRA-122. Run after pnpm build with Node 24.
// All writes and failure injection use a new, isolated database under test-results.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { prepareImage } from "../src/lib/image-upload.ts";
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
/** A photo as Travel prepares an upload, or a photo it downloads for a proposal (TRA-122). */
async function preparedPhoto(color) {
  const form = new FormData();
  form.set("image", new File([await sharp({ create: { width: 48, height: 32, channels: 3, background: color } }).png().toBuffer()], "photo.png", { type: "image/png" }));
  return prepareImage(form);
}
const tripId = store.applyMutation(owner.id, { ...tripInput, ...newItem() }).id;
// A city added to a trip is a new destination whose first stop shares its ID.
const destinationId = store.applyMutation(owner.id, { type: "stop.add", tripId, city: "Vienna" }).id;
store.applyMutation(owner.id, {
  type: "destination.save", id: destinationId,
  image: Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQtSZVrP+BiOh/AAA=", "base64"),
});
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

// TRA-115: Claude connects as an assistant does, through the OAuth endpoints and the owner's consent on Travel's page,
// reads a trip nobody shared with the owner, proposes a change, and the owner approves it on the proposal's page.
{
  const seed = createStore(database, ownerEmail);
  const guest = seed.authorizeAccount("guest@example.test");
  assert.equal(seed.authorizeGoogleSignIn({ subject: "review-smoke-guest", email: "guest@example.test", emailVerified: true, name: "Smoke Guest" })?.id, guest.id);
  const guestCookie = `${sessionCookieName(false)}=${seed.createSession(guest.id, Date.now())}`;
  const guestTripId = seed.applyMutation(guest.id, { ...tripInput, ...newItem(), name: "Guest smoke trip" }).id;
  // TRA-122: the guest's destination with two photos, the first of them primary.
  const bergenId = seed.applyMutation(guest.id, { type: "stop.add", tripId: guestTripId, city: "Bergen" }).id;
  const [firstPhoto, secondPhoto] = [randomUUID(), randomUUID()];
  seed.applyMutation(guest.id, { type: "destination.save", id: bergenId, gallery: { add: [{ id: firstPhoto, data: await preparedPhoto("#285f56") }, { id: secondPhoto, data: await preparedPhoto("#c46b2d") }], remove: [], mainImageId: firstPhoto } });
  seed.close();
  const aiActions = Object.fromEntries(Object.entries(manifest.node ?? {}).filter(([, action]) => action.filename === "src/app/ai/actions.ts").map(([id, action]) => [action.exportedName, id]));
  assert.deepEqual(Object.keys(aiActions).sort(), ["answerAiConnection", "decideProposal", "revokeConnection"]);
  const server = await startServer("ai-connection");
  try {
    const origin = new URL((await server.request("/api/health")).url).origin;
    const claude = "https://claude.ai/api/mcp/auth_callback";
    const json = (path, body, headers = {}) => server.request(path, { method: "POST", headers: { "Content-Type": "application/json", Cookie: "", ...headers }, body: JSON.stringify(body) });
    // Server Actions as React sends a form: its fields under _1_, then the arguments in field 0, which name them $K1.
    async function formAction(path, name, args, fields, cookie) {
      const body = new FormData();
      for (const [key, value] of Object.entries(fields)) body.append(`_1_${key}`, value);
      body.append("0", JSON.stringify(args));
      return server.request(path, { method: "POST", headers: { "Next-Action": aiActions[name], Accept: "text/x-component", Origin: origin, ...(cookie === undefined ? {} : { Cookie: cookie }) }, body });
    }

    // Before connecting: the metadata is public, and the MCP endpoint says where to authorize.
    const metadata = await (await server.request("/.well-known/oauth-authorization-server", { headers: { Cookie: "" } })).json();
    assert.equal(metadata.issuer, origin);
    assert.equal(metadata.authorization_endpoint, `${origin}/ai/authorize`);
    const resource = await (await server.request("/.well-known/oauth-protected-resource/api/mcp", { headers: { Cookie: "" } })).json();
    assert.deepEqual(resource.authorization_servers, [origin]);
    const unauthorized = await json("/api/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`);

    const registered = await json("/api/oauth/register", { client_name: "Claude", redirect_uris: [claude], token_endpoint_auth_method: "none" });
    assert.equal(registered.status, 201);
    const { client_id: clientId } = await registered.json();
    const verifier = "review-smoke-verifier-".padEnd(64, "v");
    const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = `/ai/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: claude, code_challenge: codeChallenge, code_challenge_method: "S256", state: "smoke-state", scope: "" })}`;
    assert.match(await (await server.request(authorize)).text(), /Connect Claude to Travel\?/);
    assert.match(await (await server.request(authorize, { headers: { Cookie: guestCookie } })).text(), /Only Travel(&#x27;|')s owner can connect AI assistants/);
    const plain = await server.request(authorize.replace("S256", "plain"));
    assert.equal(plain.status, 307, "a malformed request goes back to the assistant");
    assert.equal(new URL(plain.headers.get("location")).searchParams.get("error"), "invalid_request");
    // The guest can't allow it even by calling the action directly.
    const consent = { clientId, redirectUri: claude, codeChallenge, state: "smoke-state", decision: "allow" };
    assert.equal((await formAction("/ai/authorize", "answerAiConnection", ["$K1"], consent, guestCookie)).headers.get("x-action-redirect"), null);
    const allowed = await formAction("/ai/authorize", "answerAiConnection", ["$K1"], consent);
    const callback = new URL(allowed.headers.get("x-action-redirect").split(";")[0]);
    assert.equal(callback.origin + callback.pathname, claude, "the code goes only to Claude's callback");
    assert.deepEqual([callback.searchParams.get("state"), callback.searchParams.get("iss")], ["smoke-state", origin]);

    const tokenResponse = await server.request("/api/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: "" }, body: new URLSearchParams({ grant_type: "authorization_code", code: callback.searchParams.get("code"), redirect_uri: claude, client_id: clientId, code_verifier: verifier }) });
    assert.equal(tokenResponse.status, 200);
    const { access_token: accessToken } = await tokenResponse.json();
    const mcp = async (method, params) => (await (await json("/api/mcp", { jsonrpc: "2.0", id: 2, method, params }, { Authorization: `Bearer ${accessToken}` })).json()).result;
    assert.equal((await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } })).serverInfo.name, "travel");
    const trips = JSON.parse((await mcp("tools/call", { name: "list_trips", arguments: {} })).content[0].text).trips;
    assert.ok(trips.some((trip) => trip.id === guestTripId && trip.owner.email === "guest@example.test"), "Claude reads a trip nobody shared with the owner");
    const proposed = JSON.parse((await mcp("tools/call", { name: "propose_changes", arguments: { summary: "Rename the guest's trip", changes: [{ type: "trip.save", id: guestTripId, name: "Renamed by Claude", dateLabel: "", homeCity: "Test", travelers: 2, notes: "" }] } })).content[0].text);
    assert.equal(proposed.approve_at, `${origin}/ai/proposals/${proposed.proposal_id}`);
    const proposalPath = `/ai/proposals/${proposed.proposal_id}`;

    // Only the owner, signed in, sees the proposal; the decision names its digest, as the page's form does.
    assert.equal((await server.request(proposalPath, { headers: { Cookie: guestCookie } })).status, 404);
    assert.equal((await server.request(proposalPath, { headers: { Cookie: "" } })).status, 307);
    const page = await (await server.request(proposalPath)).text();
    assert.match(page, /Rename the guest(&#x27;|')s trip/);
    const digest = page.match(/name="digest" value="([^"]+)"/)[1];
    const decision = { proposalId: proposed.proposal_id, digest, decision: "approve" };
    await formAction(proposalPath, "decideProposal", [null, "$K1"], decision, guestCookie);
    await formAction(proposalPath, "decideProposal", [null, "$K1"], { ...decision, digest: "tampered" });
    const check = new DatabaseSync(database, { readOnly: true });
    try {
      assert.equal(check.prepare("SELECT name FROM trips WHERE id = ?").get(guestTripId).name, "Guest smoke trip", "neither the guest nor a tampered decision approves it");
      assert.equal((await formAction(proposalPath, "decideProposal", [null, "$K1"], decision)).status, 200);
      assert.equal(check.prepare("SELECT name FROM trips WHERE id = ?").get(guestTripId).name, "Renamed by Claude");
      assert.equal(JSON.parse((await mcp("tools/call", { name: "get_change_proposal", arguments: { proposal_id: proposed.proposal_id } })).content[0].text).status, "applied");
      const overview = await (await server.request("/ai")).text();
      assert.match(overview, /AI assistants/);
      assert.match(overview, /Rename the guest(&#x27;|')s trip/);
      assert.equal((await server.request("/ai", { headers: { Cookie: guestCookie } })).status, 404, "only the owner manages AI assistants");
      const connectionId = check.prepare("SELECT id FROM ai_connections").get().id;

      // TRA-122: through the production MCP endpoint, Travel refuses to download a proposed photo from a private address,
      // given by IP address or by name, and records nothing.
      for (const url of ["https://127.0.0.1/smoke.jpg", "https://localhost/smoke.jpg"]) {
        const refused = await mcp("tools/call", { name: "propose_changes", arguments: { summary: "Add a photo", changes: [{ type: "destination.photos", id: bergenId, gallery: { add: [{ id: randomUUID(), url }], remove: [] } }] } });
        assert.deepEqual(refused, { content: [{ type: "text", text: `Change 1: ${url}: Travel doesn't download photos from private, loopback or link-local addresses.` }], isError: true });
      }
      // A proposal adding a photo Travel downloaded and prepared, removing a saved one and choosing the new one as
      // primary. No public image server is reachable here, so it is proposed through the store with the prepared photo.
      const addedPhoto = randomUUID();
      const addedData = await preparedPhoto("#3b4f8a");
      const writer = createStore(database, ownerEmail);
      let photoProposal;
      try {
        photoProposal = writer.proposeAiChanges(connectionId, { summary: "Add a photo of Bergen", changes: [{ type: "destination.photos", id: bergenId, gallery: { add: [{ id: addedPhoto, url: "https://images.example.com/bergen.jpg" }], remove: [secondPhoto], mainImageId: addedPhoto } }] }, new Map([[addedPhoto, addedData]]), Date.now());
      } finally {
        writer.close();
      }
      // The owner sees each photo it adds, changes and deletes beside its record; nobody else sees any of them.
      const photoPath = `/ai/proposals/${photoProposal.id}`;
      const photoPage = await (await server.request(photoPath)).text();
      const photoRoute = (photoId) => `/api/ai-proposal-images/${photoProposal.id}/${photoId}`;
      for (const photoId of [addedPhoto, firstPhoto, secondPhoto]) assert.ok(photoPage.includes(`src="${photoRoute(photoId)}"`), `the proposal's page shows ${photoId}`);
      const shown = await server.request(photoRoute(addedPhoto));
      assert.deepEqual([shown.status, shown.headers.get("content-type")], [200, "image/webp"]);
      assert.deepEqual(new Uint8Array(await shown.arrayBuffer()), addedData, "the photo shown is the one approving saves");
      assert.equal((await server.request(photoRoute(secondPhoto))).status, 200, "the owner sees the saved photo it deletes");
      assert.equal((await server.request(photoRoute(addedPhoto), { headers: { Cookie: guestCookie } })).status, 404, "nobody else sees a proposal's photos");
      assert.equal((await server.request(photoRoute(addedPhoto), { headers: { Cookie: "" } })).status, 401);
      assert.equal((await server.request(photoRoute(randomUUID()))).status, 404, "nor a photo it doesn't change");
      assert.deepEqual(check.prepare("SELECT id FROM destination_images WHERE destinationId = ? ORDER BY position").all(bergenId).map((row) => row.id), [firstPhoto, secondPhoto], "nothing changes before approval");
      // Approving saves exactly what was shown, and keeps no copy of the photo with the proposal.
      const photoDecision = { proposalId: photoProposal.id, digest: photoPage.match(/name="digest" value="([^"]+)"/)[1], decision: "approve" };
      assert.equal((await formAction(photoPath, "decideProposal", [null, "$K1"], photoDecision)).status, 200);
      assert.deepEqual(check.prepare("SELECT id, isMain FROM destination_images WHERE destinationId = ? ORDER BY position").all(bergenId).map((row) => [row.id, row.isMain]), [[firstPhoto, 0], [addedPhoto, 1]]);
      assert.deepEqual(new Uint8Array(check.prepare("SELECT data FROM destination_images WHERE id = ?").get(addedPhoto).data), addedData);
      assert.equal(check.prepare("SELECT count(*) AS count FROM ai_proposal_photos").get().count, 0, "an approved proposal keeps no photos of its own");
      assert.equal((await server.request(photoRoute(addedPhoto))).status, 404, "a decided proposal shows no photos");
      assert.equal(JSON.parse((await mcp("tools/call", { name: "get_change_proposal", arguments: { proposal_id: photoProposal.id } })).content[0].text).status, "applied");
      // Claude proposes choosing the primary photo through MCP, which downloads nothing, and the owner rejects it.
      const primary = JSON.parse((await mcp("tools/call", { name: "propose_changes", arguments: { summary: "Show the first photo first", changes: [{ type: "destination.photos", id: bergenId, gallery: { add: [], remove: [], mainImageId: firstPhoto } }] } })).content[0].text);
      assert.equal(primary.status, "pending");
      const primaryPath = `/ai/proposals/${primary.proposal_id}`;
      const primaryDigest = (await (await server.request(primaryPath)).text()).match(/name="digest" value="([^"]+)"/)[1];
      assert.equal((await formAction(primaryPath, "decideProposal", [null, "$K1"], { proposalId: primary.proposal_id, digest: primaryDigest, decision: "reject" })).status, 200);
      assert.equal(JSON.parse((await mcp("tools/call", { name: "get_change_proposal", arguments: { proposal_id: primary.proposal_id } })).content[0].text).status, "rejected");
      assert.equal(check.prepare("SELECT id FROM destination_images WHERE destinationId = ? AND isMain = 1").get(bergenId).id, addedPhoto, "rejecting changes no photo");
      console.log("Passed TRA-122: private photo addresses refused through MCP, owner-only proposal photos, photo approval and rejection.");

      // Revoking ends the connection at once.
      await formAction("/ai", "revokeConnection", ["$K1"], { connectionId });
      assert.equal(check.prepare("SELECT count(*) AS count FROM ai_connections").get().count, 0);
    } finally {
      check.close();
    }
    assert.equal((await json("/api/mcp", { jsonrpc: "2.0", id: 3, method: "tools/list" }, { Authorization: `Bearer ${accessToken}` })).status, 401);
    console.log("Passed TRA-115: OAuth metadata, registration, owner-only consent, token exchange, MCP reads and proposals, owner-only approval, and revocation.");
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
