import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { authorizeGoogleSignIn, createStore, ValidationError } from "../src/lib/store.ts";

const google = (subject, email, emailVerified = true, name = null) => ({ subject, email, emailVerified, name });
const DAY = 24 * 60 * 60 * 1000;
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-accounts-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}
const rows = (path, sql) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(sql).all().map((row) => ({ ...row })); }
  finally { db.close(); }
};
const accountRows = (path) => rows(path, "SELECT email, googleSubject, name FROM accounts ORDER BY email");

test("only explicitly authorized, verified Google accounts sign in, bound to their stable subject", (t) => {
  const path = fileDatabase(t);
  const store = createStore(path);
  t.after(() => store.close());
  // Nobody is authorized by signing in first, and an uninvited account cannot register itself.
  assert.equal(store.authorizeGoogleSignIn(google("first-visitor", "first@example.com")), undefined);
  assert.deepEqual(accountRows(path), []);

  const owner = store.authorizeAccount("  Owner@Example.COM ");
  assert.deepEqual({ email: owner.email, name: owner.name }, { email: "owner@example.com", name: null });
  assert.match(owner.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(store.authorizeAccount("owner@example.com"), owner, "authorizing again is idempotent");
  for (const email of ["", "owner", "owner@example", "two words@example.com", "a@b@example.com", `${"x".repeat(250)}@example.com`]) {
    assert.throws(() => store.authorizeAccount(email), ValidationError);
  }

  // Google's verification is required; an unverified claim neither signs in nor binds the authorization.
  assert.equal(store.authorizeGoogleSignIn(google("owner-subject", "owner@example.com", false)), undefined);
  assert.equal(store.authorizeGoogleSignIn(google("", "owner@example.com")), undefined);
  assert.deepEqual(accountRows(path), [{ email: "owner@example.com", googleSubject: null, name: null }]);

  const signedIn = { ...owner, name: "Owner Person" };
  assert.deepEqual(store.authorizeGoogleSignIn(google("owner-subject", "OWNER@example.com", true, "Owner Person")), signedIn);
  assert.deepEqual(store.getAccountByGoogleSubject("owner-subject"), signedIn);
  assert.equal(store.getAccountByGoogleSubject("someone-else"), undefined);
  // The stable subject keeps access if the Google account's email changes later; its name follows Google.
  assert.deepEqual(store.authorizeGoogleSignIn(google("owner-subject", "renamed@example.com", true, "Renamed Owner")), { ...owner, name: "Renamed Owner" });
  // A different Google account later holding the same address never inherits the authorization.
  assert.equal(store.authorizeGoogleSignIn(google("recycled-address", "owner@example.com")), undefined);
  assert.equal(store.authorizeAccount("owner@example.com").id, owner.id, "re-authorizing keeps the original account");
  assert.deepEqual(accountRows(path), [{ email: "owner@example.com", googleSubject: "owner-subject", name: "Renamed Owner" }]);

  // A shared trip authorizes a first-time user's email; their first verified sign-in binds it.
  const guest = store.authorizeAccount("guest@example.com");
  assert.equal(store.authorizeGoogleSignIn(google("guest-subject", "someone@example.com")), undefined);
  // An already bound subject presenting another invited address keeps its own account and leaves the invitation unclaimed.
  assert.equal(store.authorizeGoogleSignIn(google("owner-subject", "guest@example.com", true, "Renamed Owner")).id, owner.id);
  assert.deepEqual(store.authorizeGoogleSignIn(google("guest-subject", "guest@example.com", true, "Guest")), { ...guest, name: "Guest" });
  assert.deepEqual(accountRows(path), [
    { email: "guest@example.com", googleSubject: "guest-subject", name: "Guest" },
    { email: "owner@example.com", googleSubject: "owner-subject", name: "Renamed Owner" },
  ]);
});

test("sessions last thirty days from last use, keep only a token hash, and end on sign out", (t) => {
  const path = fileDatabase(t);
  const store = createStore(path);
  t.after(() => store.close());
  const owner = store.authorizeAccount("owner@example.com");
  const start = Date.UTC(2026, 10, 9);
  const token = store.createSession(owner.id, start);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const hash = createHash("sha256").update(token).digest("hex");
  // Only the hash is stored, so a copy of the database signs nobody in.
  assert.deepEqual(rows(path, "SELECT tokenHash, accountId, expiresAt FROM sessions"), [{ tokenHash: hash, accountId: owner.id, expiresAt: start + 30 * DAY }]);
  assert.deepEqual(store.readSession(token, start + 1000), owner);
  assert.equal(store.readSession("not-a-session", start), undefined);
  assert.equal(store.readSession(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), start), undefined, "an altered token is refused");

  // Renewed at most once a day.
  store.readSession(token, start + DAY - 1);
  assert.equal(rows(path, "SELECT expiresAt FROM sessions")[0].expiresAt, start + 30 * DAY);
  store.readSession(token, start + DAY);
  assert.equal(rows(path, "SELECT expiresAt FROM sessions")[0].expiresAt, start + 31 * DAY);
  // Thirty days without use ends it, and the row goes.
  assert.equal(store.readSession(token, start + 31 * DAY), undefined);
  assert.deepEqual(rows(path, "SELECT tokenHash FROM sessions"), []);

  // Each browser has its own session; signing out ends only that one.
  const laptop = store.createSession(owner.id, start);
  const phone = store.createSession(owner.id, start);
  store.deleteSession(laptop);
  assert.equal(store.readSession(laptop, start), undefined);
  assert.deepEqual(store.readSession(phone, start), owner);
  // Starting a session sweeps everyone's expired ones.
  store.createSession(owner.id, start + 40 * DAY);
  assert.equal(rows(path, "SELECT count(*) AS count FROM sessions")[0].count, 1);
});

test("schema 19 adds accounts and sessions without changing trips, and replay keeps both", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  const { id: tripId } = store.applyMutation({ type: "trip.save", name: "Lisbon", dateLabel: "Spring", homeCity: "Boston", travelers: 2, notes: "Keep me" });
  store.close();
  let db = new DatabaseSync(path);
  db.exec("DROP TABLE sessions; DROP TABLE accounts; PRAGMA user_version = 18;");
  db.close();

  store = createStore(path);
  assert.deepEqual(store.getSnapshot().trips.map(({ id, name, notes }) => ({ id, name, notes })), [{ id: tripId, name: "Lisbon", notes: "Keep me" }]);
  const owner = store.authorizeAccount("owner@example.com");
  store.authorizeGoogleSignIn(google("owner-subject", "owner@example.com", true, "Owner"));
  const token = store.createSession(owner.id, Date.now());
  store.close();

  db = new DatabaseSync(path);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
  db.exec("PRAGMA user_version = 18;");
  db.close();
  store = createStore(path);
  t.after(() => store.close());
  assert.deepEqual(store.readSession(token, Date.now()), { ...owner, name: "Owner" });
  assert.equal(store.getSnapshot().trips.length, 1);
  db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    // Duplicate emails are impossible even outside the store's own checks.
    assert.throws(() => db.prepare("INSERT INTO accounts(id,email,googleSubject,authorizedAt) VALUES('x','owner@example.com',NULL,'now')").run());
  } finally {
    db.close();
  }
});

test("the owner comes from TRAVEL_OWNER_EMAIL at startup, never from who signs in first", (t) => {
  const path = fileDatabase(t);
  t.after(() => { globalThis.travelStore?.close(); delete globalThis.travelStore; });
  process.env.TRAVEL_DATABASE_PATH = path;
  delete process.env.TRAVEL_OWNER_EMAIL;
  assert.throws(() => authorizeGoogleSignIn(google("owner-subject", "owner@example.com")), /TRAVEL_OWNER_EMAIL/);
  process.env.TRAVEL_OWNER_EMAIL = "not an email";
  assert.throws(() => authorizeGoogleSignIn(google("owner-subject", "owner@example.com")), /TRAVEL_OWNER_EMAIL/);

  process.env.TRAVEL_OWNER_EMAIL = " Owner@Example.com ";
  assert.equal(authorizeGoogleSignIn(google("first-visitor", "first@example.com")), undefined);
  assert.equal(authorizeGoogleSignIn(google("owner-subject", "owner@example.com")).email, "owner@example.com");
  assert.deepEqual(accountRows(path), [{ email: "owner@example.com", googleSubject: "owner-subject", name: null }]);
});
