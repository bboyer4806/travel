import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { aiPlatform, authorizationServerMetadata, bearerChallenge, protectedResourceMetadata } from "../src/lib/ai-auth.ts";
import { handleMcp } from "../src/lib/mcp.ts";
import { handleRegistration, handleToken } from "../src/lib/oauth-handlers.ts";
import { allowAiConnection, applyMutation, authorizeGoogleSignIn, createStore, decideAiProposal, SCHEMA_VERSION } from "../src/lib/store.ts";
import { aiSetup, CHALLENGE, CLAUDE, connectClaude, DAY, GUEST, NOW, OWNER, VERIFIER } from "./ai-fixtures.mjs";
import { fileDatabase, newItem, tripInput } from "./budget-fixtures.mjs";

const HOUR = 60 * 60 * 1000;
const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";

test("only Claude's and ChatGPT's own callbacks can register, and waiting registrations can't pile up", (t) => {
  const store = createStore(":memory:", OWNER);
  t.after(() => store.close());
  const callbacks = [CLAUDE, "https://claude.com/api/mcp/auth_callback", CHATGPT, "https://chatgpt.com/connector/oauth/Ab_9-x"];
  assert.deepEqual(callbacks.map(aiPlatform), ["Claude", "Claude", "ChatGPT", "ChatGPT"]);
  for (const uri of ["https://evil.example/callback", "http://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback/", "https://chatgpt.com.evil.example/connector_platform_oauth_redirect", "https://chatgpt.com/connector/oauth/../x", "http://localhost:3000/callback"]) {
    assert.equal(aiPlatform(uri), undefined, uri);
  }
  for (const metadata of [undefined, null, [], {}, { redirect_uris: [] }, { redirect_uris: CLAUDE }, { redirect_uris: ["https://evil.example/callback"] }, { redirect_uris: [CLAUDE, "https://evil.example/callback"] }]) {
    assert.throws(() => store.registerAiClient(metadata, NOW), /only to Claude and ChatGPT/);
  }
  assert.deepEqual(store.registerAiClient({ redirect_uris: callbacks }, NOW).redirectUris, callbacks);
  // At most 100 registrations wait to be allowed. A day later the ones never allowed are removed.
  for (let count = 1; count < 100; count += 1) store.registerAiClient({ redirect_uris: [CLAUDE] }, NOW);
  assert.throws(() => store.registerAiClient({ redirect_uris: [CLAUDE] }, NOW), /Too many connections are waiting/);
  assert.ok(store.registerAiClient({ redirect_uris: [CLAUDE] }, NOW + DAY).clientId);
});

test("only the designated owner allows a connection, and each code works once, with its verifier, for ten minutes", (t) => {
  const path = fileDatabase(t);
  const store = createStore(path, OWNER);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER).id;
  const guest = store.authorizeAccount(GUEST).id;
  const { clientId } = store.registerAiClient({ redirect_uris: [CLAUDE] }, NOW);
  const request = { clientId, redirectUri: CLAUDE, codeChallenge: CHALLENGE };
  assert.throws(() => store.allowAiConnection(guest, request, NOW), /Only Travel's owner can connect AI assistants/);
  assert.throws(() => store.allowAiConnection(owner, { ...request, redirectUri: CHATGPT }, NOW), /isn't from Claude or ChatGPT/, "only a callback the client registered");
  assert.throws(() => store.allowAiConnection(owner, { ...request, clientId: randomUUID() }, NOW), /isn't from Claude or ChatGPT/);
  assert.throws(() => store.allowAiConnection(owner, { ...request, codeChallenge: "plain-text" }, NOW), /no valid code challenge/);
  const exchange = (code, overrides = {}, now = NOW) => store.exchangeAiCode({ code, clientId, redirectUri: CLAUDE, codeVerifier: VERIFIER, ...overrides }, now);
  // Whatever goes wrong, a code is used up.
  for (const [overrides, now] of [[{ codeVerifier: "w".repeat(43) }, NOW], [{ clientId: randomUUID() }, NOW], [{ redirectUri: "https://claude.com/api/mcp/auth_callback" }, NOW], [{}, NOW + 10 * 60 * 1000]]) {
    const code = store.allowAiConnection(owner, request, NOW);
    assert.equal(exchange(code, overrides, now), undefined);
    assert.equal(exchange(code), undefined, "a refused code can't be tried again");
  }
  const code = store.allowAiConnection(owner, request, NOW);
  const tokens = exchange(code);
  assert.match(tokens.accessToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(tokens.refreshToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(tokens.expiresIn, 3600);
  assert.equal(exchange(code), undefined, "a replayed code is refused");
  assert.deepEqual(store.readAiConnection(tokens.accessToken, NOW), { id: store.aiOverview(owner, NOW).connections[0].id, accountId: owner, platform: "Claude" });
  // Codes and tokens are kept only as hashes.
  const db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  const stored = JSON.stringify([...db.prepare("SELECT * FROM ai_connections").all(), ...db.prepare("SELECT * FROM ai_authorization_codes").all()]);
  for (const secret of [code, tokens.accessToken, tokens.refreshToken]) assert.ok(!stored.includes(secret));
});

test("access lasts an hour, refresh tokens work once, and revoking ends a connection with its proposals", (t) => {
  const { store, owner, guest, connection, tokens, clientId, ownerTrip, propose } = aiSetup(t);
  assert.equal(store.readAiConnection(tokens.accessToken, NOW + HOUR - 1)?.id, connection.id);
  assert.equal(store.readAiConnection(tokens.accessToken, NOW + HOUR), undefined, "an access token lasts an hour");
  assert.equal(store.readAiConnection("not-a-token", NOW), undefined);
  assert.equal(store.refreshAiTokens({ refreshToken: tokens.refreshToken, clientId: randomUUID() }, NOW + HOUR), undefined, "only its own client refreshes a connection");
  const renewed = store.refreshAiTokens({ refreshToken: tokens.refreshToken, clientId }, NOW + HOUR);
  assert.equal(store.readAiConnection(renewed.accessToken, NOW + HOUR)?.id, connection.id);
  assert.equal(store.refreshAiTokens({ refreshToken: tokens.refreshToken, clientId }, NOW + HOUR), undefined, "a refresh token works once");
  assert.equal(store.refreshAiTokens({ refreshToken: renewed.refreshToken, clientId }, NOW + HOUR + 30 * DAY), undefined, "a connection unused for thirty days ends");
  assert.deepEqual(store.aiOverview(owner, NOW + HOUR).connections.map(({ platform, connectedAt, lastUsedAt }) => ({ platform, connectedAt, lastUsedAt })), [{ platform: "Claude", connectedAt: NOW, lastUsedAt: NOW + HOUR }]);

  const proposal = propose([{ type: "trip.tag", tripId: ownerTrip, name: "Soon" }]);
  assert.throws(() => store.revokeAiConnection(guest, connection.id), /Only Travel's owner/);
  store.revokeAiConnection(owner, connection.id);
  assert.equal(store.readAiConnection(renewed.accessToken, NOW + HOUR), undefined, "revoking ends access at once");
  assert.equal(store.refreshAiTokens({ refreshToken: renewed.refreshToken, clientId }, NOW + HOUR), undefined);
  assert.equal(store.getAiProposal(owner, proposal.id, NOW), undefined, "its proposals go with it, so none can be approved");
  assert.deepEqual(store.aiOverview(owner, NOW + HOUR), { connections: [], proposals: [] });
});

test("a new designated owner's start ends the previous owner's connections", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path, OWNER);
  const { clientId, tokens } = connectClaude(store);
  const previous = store.authorizeAccount(OWNER).id;
  store.close();
  store = createStore(path, "new-owner@example.test");
  t.after(() => store.close());
  assert.equal(store.readAiConnection(tokens.accessToken, NOW), undefined);
  assert.equal(store.refreshAiTokens({ refreshToken: tokens.refreshToken, clientId }, NOW), undefined);
  assert.equal(store.aiOverview(previous, NOW), undefined);
  assert.equal(store.isAiOwner(store.authorizeAccount("new-owner@example.test").id), true);
});

test("schema 24 adds the AI integration's tables without changing Travel's data, and a replay keeps them", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path, OWNER);
  const owner = store.authorizeAccount(OWNER).id;
  const tripId = store.applyMutation(owner, tripInput({ name: "Kept" })).id;
  store.applyMutation(owner, { type: "stop.add", tripId, city: "Lisbon" });
  const before = store.getSnapshot();
  store.close();
  let db = new DatabaseSync(path);
  db.exec("DROP TABLE ai_proposal_photos; DROP TABLE ai_proposals; DROP TABLE ai_connections; DROP TABLE ai_authorization_codes; DROP TABLE ai_clients; PRAGMA user_version = 23;");
  db.close();
  store = createStore(path, OWNER);
  assert.deepEqual(store.getSnapshot(), before, "the upgrade changes no trip");
  const { tokens } = connectClaude(store);
  const connection = store.readAiConnection(tokens.accessToken, NOW);
  const proposal = store.proposeAiChanges(connection.id, { summary: "Tag it", changes: [{ type: "trip.tag", tripId, name: "Kept" }] }, new Map(), NOW);
  store.close();
  db = new DatabaseSync(path);
  db.exec("PRAGMA user_version = 23;");
  db.close();
  store = createStore(path, OWNER);
  t.after(() => store.close());
  assert.equal(store.readAiConnection(tokens.accessToken, NOW)?.id, connection.id, "a replay keeps connections");
  assert.equal(store.getAiProposal(owner, proposal.id, NOW)?.digest, proposal.digest, "and proposals, unchanged");
  db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("OAuth metadata names Travel's own endpoints, and the MCP endpoint's challenge names its metadata", () => {
  const origin = "https://travel.example";
  assert.deepEqual(protectedResourceMetadata(origin), { resource: "https://travel.example/api/mcp", authorization_servers: [origin], bearer_methods_supported: ["header"], resource_name: "Travel" });
  assert.deepEqual(authorizationServerMetadata(origin), {
    issuer: origin, authorization_endpoint: "https://travel.example/ai/authorize", token_endpoint: "https://travel.example/api/oauth/token", registration_endpoint: "https://travel.example/api/oauth/register",
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"], authorization_response_iss_parameter_supported: true,
  });
  assert.equal(bearerChallenge(origin, false), 'Bearer resource_metadata="https://travel.example/.well-known/oauth-protected-resource/api/mcp"');
  assert.equal(bearerChallenge(origin, true), 'Bearer resource_metadata="https://travel.example/.well-known/oauth-protected-resource/api/mcp", error="invalid_token"');
});

test("Claude connects through Travel's OAuth endpoints, reads every trip and proposes changes through MCP", async (t) => {
  const path = fileDatabase(t);
  process.env.TRAVEL_DATABASE_PATH = path;
  process.env.TRAVEL_OWNER_EMAIL = OWNER;
  t.after(() => { globalThis.travelStore?.close(); delete globalThis.travelStore; });
  const origin = "https://travel.example";
  const responses = [];
  const read = async (response) => { const text = await response.text(); responses.push(text); return text ? JSON.parse(text) : null; };
  const post = (path, body, headers = {}) => new Request(origin + path, { method: "POST", body, headers });

  // Registration: only Claude's or ChatGPT's callbacks.
  const registered = await handleRegistration(post("/api/oauth/register", JSON.stringify({ client_name: "Claude", redirect_uris: [CLAUDE], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" })));
  assert.equal(registered.status, 201);
  assert.equal(registered.headers.get("cache-control"), "no-store");
  const client = await read(registered);
  assert.deepEqual({ ...client, client_id: typeof client.client_id, client_id_issued_at: typeof client.client_id_issued_at }, {
    client_id: "string", client_id_issued_at: "number", client_name: "Claude", redirect_uris: [CLAUDE],
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
  });
  for (const body of ["not json", JSON.stringify({ client_name: "Elsewhere", redirect_uris: ["https://evil.example/callback"] })]) {
    const refused = await handleRegistration(post("/api/oauth/register", body));
    assert.equal(refused.status, 400);
    assert.equal((await read(refused)).error, "invalid_client_metadata");
  }

  // The owner, signed in with Google, allows it on Travel's page, which gives the code to Claude's callback.
  const owner = authorizeGoogleSignIn({ subject: "owner-subject", email: OWNER, emailVerified: true, name: "Owner" });
  const guest = createStore(path, OWNER);
  t.after(() => guest.close());
  const guestId = guest.authorizeAccount(GUEST).id;
  const guestTrip = guest.applyMutation(guestId, tripInput({ name: "Guest's private trip" })).id;
  const destinationId = guest.applyMutation(guestId, { type: "stop.add", tripId: guestTrip, city: "Oslo" }).id;
  guest.applyMutation(guestId, { type: "destination.save", id: destinationId, image: Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQtSZVrP+BiOh/AAA=", "base64") });
  const code = allowAiConnection(owner.id, { clientId: client.client_id, redirectUri: CLAUDE, codeChallenge: CHALLENGE });

  const form = (fields) => post("/api/oauth/token", new URLSearchParams(fields).toString(), { "Content-Type": "application/x-www-form-urlencoded" });
  const exchange = { grant_type: "authorization_code", code, redirect_uri: CLAUDE, client_id: client.client_id, code_verifier: VERIFIER, resource: `${origin}/api/mcp` };
  const issued = await handleToken(form(exchange));
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get("cache-control"), "no-store");
  const first = await read(issued);
  assert.deepEqual(Object.keys(first).sort(), ["access_token", "expires_in", "refresh_token", "token_type"]);
  assert.deepEqual([first.token_type, first.expires_in], ["Bearer", 3600]);
  const tokenError = async (fields) => { const response = await handleToken(form(fields)); assert.equal(response.status, 400); return (await read(response)).error; };
  assert.equal(await tokenError(exchange), "invalid_grant", "a replayed code is refused");
  assert.equal(await tokenError({ grant_type: "authorization_code", client_id: client.client_id }), "invalid_request");
  assert.equal(await tokenError({ grant_type: "client_credentials", client_id: client.client_id }), "unsupported_grant_type");
  const refreshed = await read(await handleToken(form({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: client.client_id })));
  assert.equal(await tokenError({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: client.client_id }), "invalid_grant", "a refresh token works once");

  const mcp = async (message, { token = refreshed.access_token, headers = {} } = {}) => {
    const response = await handleMcp(post("/api/mcp", typeof message === "string" ? message : JSON.stringify(message), { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }), origin);
    return { status: response.status, headers: response.headers, body: await read(response) };
  };
  // Without a current access token, the challenge says where to get one.
  for (const [headers, challenge] of [[{}, bearerChallenge(origin, false)], [{ Authorization: `Bearer ${first.access_token}` }, bearerChallenge(origin, true)], [{ Authorization: "Bearer forged" }, bearerChallenge(origin, true)]]) {
    const refused = await handleMcp(post("/api/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), headers), origin);
    assert.equal(refused.status, 401);
    assert.equal(refused.headers.get("www-authenticate"), challenge);
    assert.equal((await read(refused)).error, "invalid_token");
  }

  const initialized = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1" } } });
  assert.deepEqual([initialized.status, initialized.body.result.protocolVersion, initialized.body.result.serverInfo.name, initialized.body.result.capabilities], [200, "2025-06-18", "travel", { tools: {} }]);
  assert.equal((await mcp({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } })).body.result.protocolVersion, "2025-11-25", "an unknown version is offered the newest");
  assert.deepEqual(await mcp({ jsonrpc: "2.0", method: "notifications/initialized" }, { headers: { "MCP-Protocol-Version": "2025-06-18" } }).then(({ status, body }) => [status, body]), [202, null]);
  assert.deepEqual((await mcp({ jsonrpc: "2.0", id: 3, method: "ping" })).body, { jsonrpc: "2.0", id: 3, result: {} });
  const tools = (await mcp({ jsonrpc: "2.0", id: 4, method: "tools/list" })).body.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), ["list_trips", "get_trip", "list_destinations", "get_destination", "list_accounts", "get_photo", "propose_changes", "get_change_proposal"]);
  assert.equal(tools.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.length, 30, "every planner change can be proposed");

  const call = async (name, args = {}) => (await mcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name, arguments: args } })).body.result;
  const data = async (name, args) => { const result = await call(name, args); assert.equal(result.isError, undefined, result.content[0].text); return JSON.parse(result.content[0].text); };
  assert.deepEqual((await data("list_trips")).trips.map((trip) => [trip.name, trip.owner.email]), [["Guest's private trip", GUEST]], "every account's trips, shared with the owner or not");
  assert.equal((await data("get_trip", { trip_id: guestTrip })).destinations[0].city, "Oslo");
  assert.deepEqual(await call("get_trip", { trip_id: randomUUID() }), { content: [{ type: "text", text: "Travel has no trip with this id." }], isError: true });
  const oslo = await data("get_destination", { destination_id: destinationId });
  const photo = await call("get_photo", { of: "destination", id: destinationId, photo_id: oslo.destination.images[0].id });
  assert.deepEqual(photo.content, [{ type: "image", mimeType: "image/webp", data: "UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQtSZVrP+BiOh/AAA=" }]);
  assert.equal((await data("list_destinations")).destinations[0].owner.email, GUEST);
  assert.deepEqual((await data("list_accounts")).accounts.map((account) => account.email), [GUEST, OWNER]);

  // A proposal changes nothing until the owner approves it on its page.
  const refusal = await call("propose_changes", { summary: "Rename", changes: [{ type: "trip.save", id: guestTrip, name: "", dateLabel: "", homeCity: "", travelers: 2, notes: "" }] });
  assert.deepEqual(refusal, { content: [{ type: "text", text: "Change 1: Please enter name." }], isError: true });
  const proposed = await data("propose_changes", { summary: "Rename the guest's trip", changes: [{ type: "trip.save", id: guestTrip, name: "Renamed by Claude", dateLabel: "Someday", homeCity: "Boston", travelers: 2, notes: "Trip notes" }] });
  assert.deepEqual({ ...proposed, proposal_id: undefined, created_at: undefined, expires_at: undefined }, {
    proposal_id: undefined, summary: "Rename the guest's trip", status: "pending", approve_at: `${origin}/ai/proposals/${proposed.proposal_id}`,
    created_at: undefined, expires_at: undefined, decided_at: null, error: null,
    changes: [{ operation: "Change the trip “Renamed by Claude”", records: [{ action: "Changes", record: `Trip “Renamed by Claude” (${GUEST})`, fields: [{ name: "Name", before: "Guest's private trip", after: "Renamed by Claude" }] }] }],
  });
  assert.equal(guest.getSnapshot().trips[0].name, "Guest's private trip");
  const { digest } = guest.getAiProposal(owner.id, proposed.proposal_id, Date.now());
  assert.equal(decideAiProposal(owner.id, proposed.proposal_id, digest, true).status, "applied");
  assert.equal((await data("get_change_proposal", { proposal_id: proposed.proposal_id })).status, "applied");
  assert.equal(guest.getSnapshot().trips[0].name, "Renamed by Claude");
  // Ordinary access is unchanged: the owner still can't change the guest's trip from Travel itself.
  assert.throws(() => applyMutation(owner.id, { type: "homeItem.save", ...newItem(), tripId: guestTrip, name: "Not mine", price: "", notes: "", completed: false }), /isn't shared with you/);

  // Protocol errors.
  assert.equal((await mcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "run_sql", arguments: { sql: "DROP TABLE trips" } } })).body.error.code, -32602);
  assert.equal((await mcp({ jsonrpc: "2.0", id: 7, method: "resources/list" })).body.error.code, -32601);
  const malformed = await mcp("{not json");
  assert.deepEqual([malformed.status, malformed.body.error.code], [400, -32700]);
  const batch = await mcp([{ jsonrpc: "2.0", id: 8, method: "ping" }]);
  assert.deepEqual([batch.status, batch.body.error.code], [400, -32600]);
  const version = await mcp({ jsonrpc: "2.0", id: 9, method: "ping" }, { headers: { "MCP-Protocol-Version": "1999-01-01" } });
  assert.deepEqual([version.status, version.body.error.code], [400, -32600]);

  // No response carried a credential: tokens and codes are only ever in the token endpoint's own replies.
  const db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  const hashes = [...db.prepare("SELECT tokenHash FROM sessions").all().map((row) => row.tokenHash), ...db.prepare("SELECT accessTokenHash, refreshTokenHash FROM ai_connections").all().flatMap((row) => [row.accessTokenHash, row.refreshTokenHash])];
  const mcpReplies = responses.filter((text) => !text.includes("access_token"));
  for (const secret of [...hashes, "owner-subject", code, first.access_token, refreshed.access_token, refreshed.refresh_token]) assert.ok(!mcpReplies.some((text) => text.includes(secret)));
});
