import { createHash } from "node:crypto";
import { createStore } from "../src/lib/store.ts";
import { tripInput } from "./budget-fixtures.mjs";

/** The designated owner, who alone connects AI assistants and decides their proposals (TRA-115). */
export const OWNER = "owner@example.test";
/** Another account, whose trip nobody shares. */
export const GUEST = "guest@example.test";
export const NOW = Date.UTC(2026, 10, 13, 12);
export const DAY = 24 * 60 * 60 * 1000;
export const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
/** A PKCE verifier and its S256 challenge, as an assistant makes them. */
export const VERIFIER = "a-verifier-".padEnd(64, "x");
export const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

/** Connects Claude as the owner allows it: registration, consent and code exchange. Returns the client and its tokens. */
export function connectClaude(store, now = NOW) {
  const owner = store.authorizeAccount(OWNER).id;
  const { clientId } = store.registerAiClient({ redirect_uris: [CLAUDE] }, now);
  const code = store.allowAiConnection(owner, { clientId, redirectUri: CLAUDE, codeChallenge: CHALLENGE }, now);
  return { clientId, tokens: store.exchangeAiCode({ code, clientId, redirectUri: CLAUDE, codeVerifier: VERIFIER }, now) };
}

/**
 * A store with the designated owner, a guest with a trip of its own that nobody shares, the owner's own trip, and a
 * Claude connection the owner allowed. `propose` proposes as that connection, with the photos its changes add as Travel
 * prepared them, by their IDs (TRA-122), and `decide` decides as the owner.
 */
export function aiSetup(t, path = ":memory:") {
  const store = createStore(path, OWNER);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER).id;
  const guest = store.authorizeAccount(GUEST).id;
  const { clientId, tokens } = connectClaude(store);
  const connection = store.readAiConnection(tokens.accessToken, NOW);
  const guestTrip = store.applyMutation(guest, tripInput({ name: "Guest trip", homeCity: "Denver" })).id;
  const ownerTrip = store.applyMutation(owner, tripInput({ name: "Owner trip" })).id;
  const propose = (changes, summary = "Plan the trips", now = NOW, photos = new Map()) => store.proposeAiChanges(connection.id, { summary, changes }, photos, now);
  const decide = (proposal, approve, now = NOW + 1000) => store.decideAiProposal(owner, proposal.id, proposal.digest, approve, now);
  return { store, owner, guest, connection, clientId, tokens, guestTrip, ownerTrip, propose, decide };
}
