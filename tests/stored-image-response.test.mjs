import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { makeThumbnail } from "../src/lib/image-upload.ts";
import { storedImageResponse, storedThumbnailResponse } from "../src/lib/stored-image-response.ts";

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
  // Photos require sign-in, so shared caches must never store them.
  assert.equal(response.headers.get("cache-control"), "private, max-age=31536000, immutable");
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

test("a thumbnail is served as its photo is, as saved, or made from a photo saved before thumbnails (TRA-89)", async () => {
  const thumbnail = new Uint8Array([4, 5]);
  const saved = await storedThumbnailResponse(request(`?v=${version}`), id, (key) => key === id ? { version, data: thumbnail } : undefined);
  assert.equal(saved.status, 200);
  assert.deepEqual(["content-type", "content-length", "x-content-type-options", "cache-control", "etag"].map((name) => saved.headers.get(name)),
    ["image/webp", "2", "nosniff", "private, max-age=31536000, immutable", `"${version}"`]);
  assert.deepEqual(new Uint8Array(await saved.arrayBuffer()), thumbnail);
  // A photo saved before thumbnails has its thumbnail made as an upload's is, for each response.
  const photo = new Uint8Array(await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#285f56" } }).webp().toBuffer());
  const made = await storedThumbnailResponse(request(`?v=${version}`), id, () => ({ version, photo }));
  const bytes = new Uint8Array(await made.arrayBuffer());
  assert.deepEqual(bytes, await makeThumbnail(photo));
  assert.equal(made.headers.get("content-length"), String(bytes.byteLength));
  const { format, width, height } = await sharp(bytes).metadata();
  assert.deepEqual([format, width, height], ["webp", 480, 360]);
});

test("thumbnail requests with invalid IDs, for missing photos or obsolete versions find nothing, and a matching ETag makes no thumbnail", async () => {
  const responses = await Promise.all([
    storedThumbnailResponse(request(), "invalid", () => { throw new Error("Invalid IDs must not reach storage"); }),
    storedThumbnailResponse(request(), id, () => undefined),
    storedThumbnailResponse(request("?v=old"), id, () => ({ version, data: new Uint8Array([1]) })),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 404);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  // These bytes aren't an image, so answering anything but 304 would fail to make a thumbnail of them.
  const unchanged = await storedThumbnailResponse(request(`?v=${version}`, { "if-none-match": `"${version}"` }), id, () => ({ version, photo: new Uint8Array([1, 2, 3]) }));
  assert.equal(unchanged.status, 304);
  assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
});
