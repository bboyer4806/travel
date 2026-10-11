import test from "node:test";
import assert from "node:assert/strict";
import { storedImageResponse } from "../src/lib/stored-image-response.ts";

const id = "22222222-2222-4222-8222-222222222222";
const version = "33333333-3333-4333-8333-333333333333";
const data = new Uint8Array([1, 2, 3]);
const readImage = (key) => key === id ? { version, data } : undefined;
const request = (query = "", headers) => new Request(`https://example.com/api/candidate-images/${id}${query}`, { headers });

test("image responses deliver bytes with correct type and versioned caching", async () => {
  const response = storedImageResponse(request(`?v=${version}`), id, readImage);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("content-length"), "3");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control"), /immutable/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), data);
  const uncached = storedImageResponse(request(), id, readImage);
  assert.equal(uncached.headers.get("cache-control"), "no-cache");
});

test("missing images, invalid IDs, and obsolete versions never return current image bytes", async () => {
  const responses = [
    storedImageResponse(request(), "invalid", () => { throw new Error("Invalid IDs must not reach storage"); }),
    storedImageResponse(request(), id, () => undefined),
    storedImageResponse(request("?v=old"), id, readImage),
  ];
  for (const response of responses) {
    assert.equal(response.status, 404);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});

test("matching ETags return an empty 304, but cannot bypass a stale version", async () => {
  const response = storedImageResponse(request(`?v=${version}`, { "if-none-match": `"${version}"` }), id, readImage);
  assert.equal(response.status, 304);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal(storedImageResponse(request("?v=old", { "if-none-match": `"${version}"` }), id, readImage).status, 404);
});