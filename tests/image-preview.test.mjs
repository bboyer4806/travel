import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { MAX_IMAGE_UPLOAD_BYTES } from "../src/lib/image-limits.ts";
import { imagePreviewResponse } from "../src/lib/image-preview.ts";
import { prepareImage } from "../src/lib/image-upload.ts";

// TRA-179: a photo editor's preview of an image the browser can't show itself, such as a HEIC photo outside Safari.
const fixture = (name) => readFileSync(new URL(`./fixtures/images/${name}`, import.meta.url));
/** A request from Travel's page, as a photo editor sends a file, with `headers` changing it. */
function request(body, headers = {}) {
  return new Request("http://0.0.0.0:3000/api/image-preview", {
    method: "POST",
    headers: { host: "travel.example", origin: "https://travel.example", "sec-fetch-site": "same-origin", ...headers },
    body,
    duplex: "half",
  });
}
const refused = async (response, status, error) => {
  assert.deepEqual([response.status, response.headers.get("cache-control"), response.headers.get("content-type"), await response.json()], [status, "no-store", "application/json", { error }]);
};

test("an image's preview is the photo Travel would save of it, as WebP, kept by neither Travel nor the browser", async () => {
  const response = await imagePreviewResponse(request(fixture("rotated.heic"), { "content-type": "image/heic" }));
  assert.deepEqual([response.status, response.headers.get("content-type"), response.headers.get("cache-control"), response.headers.get("x-content-type-options")], [200, "image/webp", "no-store", "nosniff"]);
  const preview = Buffer.from(await response.arrayBuffer());
  const form = new FormData();
  form.set("image", new File([fixture("rotated.heic")], "IMG_0002.HEIC"));
  assert.deepEqual(preview, Buffer.from((await prepareImage(form)).data), "it is the photo a save would keep");
  const { format, width, height } = await sharp(preview).metadata();
  assert.deepEqual([format, width, height], ["webp", 48, 64], "upright, as the photo shows");
  // Whatever type the request names, what it holds decides.
  const bitmap = await imagePreviewResponse(request(fixture("bmp-24.bmp"), { "content-type": "application/octet-stream" }));
  assert.deepEqual([bitmap.status, (await sharp(Buffer.from(await bitmap.arrayBuffer())).metadata()).format], [200, "webp"]);
});

test("a preview is refused, saying why, for another site, a file larger than an upload may be, or an image a save would refuse", async () => {
  await refused(await imagePreviewResponse(request(fixture("photo.heic"), { origin: "https://elsewhere.example" })), 403, "Refresh the page and try again.");
  await refused(await imagePreviewResponse(request(fixture("photo.heic"), { "sec-fetch-site": "cross-site" })), 403, "Refresh the page and try again.");
  // The bytes sent are counted, whatever length the request claims.
  let pulled = 0;
  const endless = new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(1024 * 1024)); } });
  await refused(await imagePreviewResponse(request(endless)), 413, "Choose an image smaller than 5 MB.");
  assert.ok(pulled <= MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024) + 2, `it stops reading at the limit, after ${pulled} chunks`);
  await refused(await imagePreviewResponse(request(fixture("two-images.heic"))), 422, "Choose a still image instead of an animated or multi-page image.");
  await refused(await imagePreviewResponse(request("not an image")), 422, "We couldn't read that image. It may be damaged, or not a JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, or HEIC image.");
  await refused(await imagePreviewResponse(request(null)), 422, "That image is empty. Choose another image.");
});
