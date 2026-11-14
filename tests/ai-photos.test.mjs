import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import sharp from "sharp";
import { prepareAiPhotos } from "../src/lib/ai-photos.ts";
import { AI_PHOTO_DOWNLOAD_SECONDS, MAX_AI_PROPOSAL_PHOTOS } from "../src/lib/image-limits.ts";
import { ImageValidationError } from "../src/lib/image-upload.ts";

const refusal = (message) => (error) => error instanceof ImageValidationError && message.test(error.message);
const photo = (change, url) => ({ change, id: randomUUID(), url });
const image = (format, color, width = 40, height = 30) => sharp({ create: { width, height, channels: 3, background: color } })[format]().toBuffer();
/** A fetch serving each address's file, `[type, bytes]`, and recording the signal each request was given. */
function serve(files) {
  const signals = [];
  const fetch = async (url, signal) => {
    signals.push(signal);
    const file = files[url.href];
    if (typeof file === "function") return file(signal);
    if (!file) return Object.assign(Readable.from([]), { statusCode: 404, headers: {} });
    return Object.assign(Readable.from([file[1]]), { statusCode: 200, headers: { "content-type": file[0] } });
  };
  return { fetch, signals };
}

test("a proposal's photos download together and are prepared as uploads are, by their new ids", async () => {
  const photos = [photo(1, "https://images.example.com/a.jpg"), photo(3, "https://images.example.com/b.png"), photo(3, "https://images.example.com/c.webp")];
  const { fetch, signals } = serve({
    [photos[0].url]: ["image/jpeg", await image("jpeg", "#285f56", 2400, 1600)],
    [photos[1].url]: ["image/png", await image("png", "#c46b2d")],
    [photos[2].url]: ["image/webp", await image("webp", "#3b4f8a")],
  });
  const prepared = await prepareAiPhotos(photos, fetch);
  assert.deepEqual([...prepared.keys()], photos.map(({ id }) => id));
  const sizes = await Promise.all([...prepared.values()].map(async (data) => { const { format, width, height } = await sharp(data).metadata(); return [format, width, height]; }));
  assert.deepEqual(sizes, [["webp", 1600, 1067], ["webp", 40, 30], ["webp", 40, 30]], "each is resized and saved as WebP, as an upload is");
  assert.equal(signals.length, 3);
  assert.ok(signals.every((signal) => signal.aborted), "every request is done with once the photos are ready");
  assert.equal(AI_PHOTO_DOWNLOAD_SECONDS, 15);
});

test("a proposal with a photo Travel can't download or use is refused, naming its change and address", async () => {
  const good = photo(1, "https://images.example.com/good.jpg");
  const files = { [good.url]: ["image/jpeg", await image("jpeg", "#285f56")] };

  // Addresses are checked, and the count, before anything downloads.
  for (const [photos, message] of [
    [[good, photo(2, "http://images.example.com/a.jpg")], /^Change 2: http:\/\/images\.example\.com\/a\.jpg: Travel downloads photos only from https:\/\/ addresses\.$/],
    [[good, photo(4, "https://10.0.0.8/a.jpg")], /^Change 4: https:\/\/10\.0\.0\.8\/a\.jpg: Travel doesn't download photos from private, loopback or link-local addresses\.$/],
    [Array.from({ length: MAX_AI_PROPOSAL_PHOTOS + 1 }, () => good), /^Propose up to 10 new photos at a time, and the rest in another proposal\.$/],
  ]) {
    const { fetch, signals } = serve(files);
    await assert.rejects(prepareAiPhotos(photos, fetch), refusal(message), String(message));
    assert.equal(signals.length, 0, "nothing was downloaded");
  }

  // One photo failing stops the others' downloads.
  const slow = photo(1, "https://images.example.com/slow.jpg");
  let slowStopped = false;
  const stalled = { ...files, [slow.url]: () => Object.assign(new Readable({ read() {}, destroy(error, done) { slowStopped = true; done(error); } }), { statusCode: 200, headers: { "content-type": "image/jpeg" } }) };
  await assert.rejects(prepareAiPhotos([slow, photo(2, "https://images.example.com/missing.jpg")], serve(stalled).fetch), refusal(/^Change 2: https:\/\/images\.example\.com\/missing\.jpg: The photo's server answered 404 Not Found\.$/));
  assert.equal(slowStopped, true);

  // Downloads share one deadline.
  await assert.rejects(prepareAiPhotos([good, slow], serve(stalled).fetch, 100), refusal(/^Change 1: https:\/\/images\.example\.com\/slow\.jpg: The photo didn't download within 0\.1 seconds\.$/));

  // A proposal downloads up to 15 MB of photos, as one gallery save uploads.
  const large = Array.from({ length: 4 }, (_, index) => photo(1, `https://images.example.com/large-${index}.jpg`));
  await assert.rejects(prepareAiPhotos(large, serve(Object.fromEntries(large.map(({ url }) => [url, ["image/jpeg", Buffer.alloc(4 * 1024 * 1024)]]))).fetch), refusal(/^Propose up to 15 MB of new photos at a time, and the rest in another proposal\.$/));

  // A photo is checked as an upload is, by prepareImage.
  const broken = photo(2, "https://images.example.com/broken.png");
  await assert.rejects(prepareAiPhotos([good, broken], serve({ ...files, [broken.url]: ["image/png", Buffer.from("not a png")] }).fetch),
    refusal(/^Change 2: https:\/\/images\.example\.com\/broken\.png: We couldn't read that image\. Choose a JPEG, PNG, or WebP image up to 20 megapixels\.$/));
  const empty = photo(1, "https://images.example.com/empty.jpg");
  await assert.rejects(prepareAiPhotos([empty], serve({ [empty.url]: ["image/jpeg", Buffer.alloc(0)] }).fetch), refusal(/^Change 1: https:\/\/images\.example\.com\/empty\.jpg: That image is empty\. Choose another image\.$/));
});
