import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { authorizeGoogleSignIn, createStore, ValidationError } from "../src/lib/store.ts";
import { returnPath } from "../src/lib/return-path.ts";

const google = (subject, email, emailVerified = true) => ({ subject, email, emailVerified });
function fileDatabase(t) {
  const folder = mkdtempSync(join(tmpdir(), "travel-accounts-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "travel.sqlite");
}
const accountRows = (path) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare("SELECT email, googleSubject FROM accounts ORDER BY email").all().map((row) => ({ ...row })); }
  finally { db.close(); }
};

test("only explicitly authorized, verified Google accounts sign in, bound to their stable subject", (t) => {
  const path = fileDatabase(t);
  const store = createStore(path);
  t.after(() => store.close());
  // Nobody is authorized by signing in first, and an uninvited account cannot register itself.
  assert.equal(store.authorizeGoogleSignIn(google("first-visitor", "first@example.com")), undefined);
  assert.deepEqual(accountRows(path), []);

  const owner = store.authorizeAccount("  Owner@Example.COM ");
  assert.equal(owner.email, "owner@example.com");
  assert.match(owner.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(store.authorizeAccount("owner@example.com"), owner, "authorizing again is idempotent");
  for (const email of ["", "owner", "owner@example", "two words@example.com", "a@b@example.com", `${"x".repeat(250)}@example.com`]) {
    assert.throws(() => store.authorizeAccount(email), ValidationError);
  }

  // Google's verification is required; an unverified claim neither signs in nor binds the authorization.
  assert.equal(store.authorizeGoogleSignIn(google("owner-subject", "owner@example.com", false)), undefined);
  assert.equal(store.authorizeGoogleSignIn(google("", "owner@example.com")), undefined);
  assert.deepEqual(accountRows(path), [{ email: "owner@example.com", googleSubject: null }]);

  assert.deepEqual(store.authorizeGoogleSignIn(google("owner-subject", "OWNER@example.com")), owner);
  assert.deepEqual(store.getAccountByGoogleSubject("owner-subject"), owner);
  assert.equal(store.getAccountByGoogleSubject("someone-else"), undefined);
  // The stable subject keeps access if the Google account's email changes later.
  assert.deepEqual(store.authorizeGoogleSignIn(google("owner-subject", "renamed@example.com")), owner);
  // A different Google account later holding the same address never inherits the authorization.
  assert.equal(store.authorizeGoogleSignIn(google("recycled-address", "owner@example.com")), undefined);
  assert.deepEqual(store.authorizeAccount("owner@example.com"), owner, "re-authorizing keeps the original binding");
  assert.deepEqual(accountRows(path), [{ email: "owner@example.com", googleSubject: "owner-subject" }]);

  // A shared trip authorizes a first-time user's email; their first verified sign-in binds it.
  const guest = store.authorizeAccount("guest@example.com");
  assert.equal(store.authorizeGoogleSignIn(google("guest-subject", "someone@example.com")), undefined);
  // An already bound subject presenting another invited address keeps its own account and leaves the invitation unclaimed.
  assert.deepEqual(store.authorizeGoogleSignIn(google("owner-subject", "guest@example.com")), owner);
  assert.deepEqual(store.authorizeGoogleSignIn(google("guest-subject", "guest@example.com")), guest);
  assert.deepEqual(accountRows(path), [
    { email: "guest@example.com", googleSubject: "guest-subject" },
    { email: "owner@example.com", googleSubject: "owner-subject" },
  ]);
});

test("schema 19 adds accounts without changing trips, and replay preserves bindings", (t) => {
  const path = fileDatabase(t);
  let store = createStore(path);
  const { id: tripId } = store.applyMutation({ type: "trip.save", name: "Lisbon", dateLabel: "Spring", homeCity: "Boston", travelers: 2, notes: "Keep me" });
  store.close();
  let db = new DatabaseSync(path);
  db.exec("DROP TABLE accounts; PRAGMA user_version = 18;");
  db.close();

  store = createStore(path);
  assert.deepEqual(store.getSnapshot().trips.map(({ id, name, notes }) => ({ id, name, notes })), [{ id: tripId, name: "Lisbon", notes: "Keep me" }]);
  const owner = store.authorizeAccount("owner@example.com");
  assert.deepEqual(store.authorizeGoogleSignIn(google("owner-subject", "owner@example.com")), owner);
  store.close();

  db = new DatabaseSync(path);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
  db.exec("PRAGMA user_version = 18;");
  db.close();
  store = createStore(path);
  t.after(() => store.close());
  assert.deepEqual(store.getAccountByGoogleSubject("owner-subject"), owner);
  assert.equal(store.getSnapshot().trips.length, 1);
  db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    // Duplicate emails and subjects are impossible even outside the store's own checks.
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
  assert.deepEqual(accountRows(path), [{ email: "owner@example.com", googleSubject: "owner-subject" }]);
});

test("sign-in returns only to same-origin paths", () => {
  for (const path of ["/", "/trips/abc", "/trips/abc/destinations/def/hotels?x=1#top", "/whats-new"]) assert.equal(returnPath(path), path);
  for (const value of [undefined, null, "", "trips", "https://evil.example/", "//evil.example/", "/\\evil.example", "javascript:alert(1)", ["/trips"]]) {
    assert.equal(returnPath(value), "/");
  }
});
