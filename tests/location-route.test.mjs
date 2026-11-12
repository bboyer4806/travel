import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { createLocationSearch, LocationSearchError } from "../src/lib/location-search.ts";

// Exercise the actual handler with isolated auth/upstream dependencies, without a Next server.
const compiled = ts.transpileModule(readFileSync(new URL("../src/app/api/locations/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function route(searchLocations, authenticated = true) {
  const exports = {};
  const imports = {
    "node:crypto": { randomBytes },
    "@/lib/location-search": { searchLocations, LocationSearchError },
    "@/auth": {
      currentAccount: async () => authenticated ? { id: "test-account" } : null,
      signedOutResponse: () => Response.json({ error: "Please sign in." }, { status: 401 }),
    },
  };
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports);
  return exports.GET;
}
function request(query, cookie, origin = "http://localhost:3000") {
  const url = new URL("/api/locations", origin);
  url.searchParams.set("q", query);
  return new Request(url, { headers: cookie ? { Cookie: cookie } : {} });
}

test("location API issues a scoped client cookie and enforces its upstream budget", async () => {
  let calls = 0;
  const GET = route(createLocationSearch({ fetcher: async () => { calls++; return Response.json({}); } }));
  const first = await GET(request("First city"));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "private, max-age=300");
  const setCookie = first.headers.get("set-cookie");
  assert.match(setCookie, /^travel-locations=[a-f0-9]{64}; Path=\/api\/locations; HttpOnly; SameSite=Strict; Max-Age=86400$/);
  const cookie = setCookie.split(";", 1)[0];
  for (let i = 1; i < 20; i++) {
    const response = await GET(request(`City ${i}`, `unrelated=value; ${cookie}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null, "Keep the existing client identity.");
  }
  const denied = await GET(request("One too many", cookie));
  assert.equal(denied.status, 503);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.deepEqual(await denied.json(), { error: "City suggestions are unavailable. You can still enter your city." });
  assert.equal(calls, 20);
  assert.equal((await GET(request("First city", cookie))).status, 200, "Cached results remain available.");
  assert.equal(calls, 20);
  assert.equal((await GET(request("Another client's city"))).status, 200);
  assert.equal(calls, 21);
});

test("location cookies are secure on HTTPS and replaced when malformed", async () => {
  const clients = [];
  const GET = route(async (_query, client) => { clients.push(client); return []; });
  const response = await GET(request("Vienna", "travel-locations=invalid", "https://travel.example.test"));
  assert.equal(response.status, 200);
  assert.match(clients[0], /^[a-f0-9]{64}$/);
  assert.match(response.headers.get("set-cookie"), /; Secure$/);
  assert.ok(!response.headers.get("set-cookie").includes("invalid"));
  await GET(request("Paris"));
  assert.notEqual(clients[0], clients[1]);
});

test("location API preserves authentication and invalid-query responses", async () => {
  let calls = 0;
  const search = createLocationSearch({ fetcher: async () => { calls++; return Response.json({}); } });
  const unauthorized = await route(search, false)(request("Vienna"));
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("set-cookie"), null);
  const invalid = await route(search)(request("a".repeat(121)));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  assert.deepEqual(await invalid.json(), { error: "Enter a city using 120 characters or fewer." });
  assert.equal(calls, 0);
});
