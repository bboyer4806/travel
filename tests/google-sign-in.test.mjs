import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { googleSettings, readGoogleCallback, startGoogleSignIn } from "../src/lib/google.ts";

const origin = "https://travel.example.test";
const settings = { GOOGLE_CLIENT_ID: "travel-client", GOOGLE_CLIENT_SECRET: "client-secret-value" };
const idToken = (claims) => ["header", Buffer.from(JSON.stringify(claims)).toString("base64url"), "signature"].join(".");
const validClaims = () => ({ iss: "https://accounts.google.com", aud: "travel-client", exp: Math.floor(Date.now() / 1000) + 300, sub: "google-subject", email: "Owner@Example.com", email_verified: true, name: " Owner Person " });

function withGoogle(t, respond) {
  const saved = { fetch: globalThis.fetch, id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  Object.assign(process.env, settings);
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init.method, body: Object.fromEntries(new URLSearchParams(init.body)) });
    return respond();
  };
  t.after(() => {
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [["GOOGLE_CLIENT_ID", saved.id], ["GOOGLE_CLIENT_SECRET", saved.secret]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  return requests;
}
function started() {
  const { url, cookie } = startGoogleSignIn(origin);
  return { url: new URL(url), cookie, state: cookie.split(".")[0] };
}

test("the server can't sign anyone in without both Google settings, and names each missing one", (t) => {
  withGoogle(t, () => { throw new Error("No request expected."); });
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.throws(() => googleSettings(), /without GOOGLE_CLIENT_SECRET\./);
  delete process.env.GOOGLE_CLIENT_ID;
  assert.throws(() => googleSettings(), /without GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET\./);
});

test("sign-in starts at Google with PKCE, a fresh state and the account chooser", (t) => {
  withGoogle(t, () => { throw new Error("No request expected."); });
  const { url, cookie, state } = started();
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const verifier = cookie.split(".")[1];
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "travel-client",
    redirect_uri: "https://travel.example.test/auth/google/callback",
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  assert.notEqual(started().state, state, "every trip has its own state");
  assert.ok(!url.search.includes(verifier), "the verifier stays in this browser's cookie");
});

test("a callback that didn't start here, ran out, or was canceled at Google creates no account", async (t) => {
  const requests = withGoogle(t, () => { throw new Error("No request expected."); });
  const { cookie, state } = started();
  const query = (values) => new URLSearchParams(values);
  for (const [values, sent] of [
    [{ state, code: "code" }, undefined],
    [{ state: "another", code: "code" }, cookie],
    [{ code: "code" }, cookie],
    [{ state, code: "code" }, `${cookie}.extra`],
  ]) {
    assert.deepEqual(await readGoogleCallback(query(values), sent, origin), { kind: "expired" });
  }
  assert.deepEqual(await readGoogleCallback(query({ state, error: "access_denied" }), cookie, origin), { kind: "cancelled" });
  assert.deepEqual(requests, [], "Google is never asked");
});

test("the code and this browser's verifier are exchanged for Google's verified identity", async (t) => {
  const requests = withGoogle(t, () => Response.json({ id_token: idToken(validClaims()), access_token: "unused" }));
  const { cookie, state } = started();
  const result = await readGoogleCallback(new URLSearchParams({ state, code: "the-code" }), cookie, origin);
  assert.deepEqual(result, { kind: "account", account: { subject: "google-subject", email: "Owner@Example.com", emailVerified: true, name: "Owner Person" } });
  assert.deepEqual(requests, [{
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    body: { code: "the-code", client_id: "travel-client", client_secret: "client-secret-value", redirect_uri: "https://travel.example.test/auth/google/callback", grant_type: "authorization_code", code_verifier: cookie.split(".")[1] },
  }]);
});

test("an unverified email comes back marked so, and the issuer form without https is accepted", async (t) => {
  withGoogle(t, () => Response.json({ id_token: idToken({ ...validClaims(), iss: "accounts.google.com", email_verified: false, name: undefined }) }));
  const { cookie, state } = started();
  const { account } = await readGoogleCallback(new URLSearchParams({ state, code: "code" }), cookie, origin);
  assert.deepEqual(account, { subject: "google-subject", email: "Owner@Example.com", emailVerified: false, name: null });
});

test("a refused code or a wrong ID token is a fault, reported without the code or secret", async (t) => {
  let response;
  withGoogle(t, () => response());
  const { cookie, state } = started();
  const finish = () => readGoogleCallback(new URLSearchParams({ state, code: "the-code" }), cookie, origin);
  const cases = [
    [() => Response.json({ error: "invalid_grant", error_description: "Bad Request" }, { status: 400 }), /HTTP 400 invalid_grant\./],
    [() => Response.json({ access_token: "only" }), /no ID token/],
    [() => Response.json({ id_token: idToken({ ...validClaims(), iss: "https://evil.example" }) }), /not from Google/],
    [() => Response.json({ id_token: idToken({ ...validClaims(), aud: "another-client" }) }), /another client/],
    [() => Response.json({ id_token: idToken({ ...validClaims(), exp: Math.floor(Date.now() / 1000) - 1 }) }), /expired/],
    [() => Response.json({ id_token: idToken({ ...validClaims(), sub: "" }) }), /names no account/],
    [() => Response.json({ id_token: idToken({ ...validClaims(), email: undefined }) }), /names no account/],
  ];
  for (const [respond, message] of cases) {
    response = respond;
    const error = await finish().then(() => assert.fail("expected a fault"), (caught) => caught);
    assert.match(error.message, message);
    assert.ok(!error.message.includes("the-code") && !error.message.includes("client-secret-value"));
  }
  await assert.rejects(readGoogleCallback(new URLSearchParams({ state }), cookie, origin), /neither a code nor an error/);
});
