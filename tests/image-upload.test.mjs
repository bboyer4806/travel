import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { makeThumbnail, prepareImage, ImageValidationError } from "../src/lib/image-upload.ts";

function upload(bytes, type = "image/png") {
  const form = new FormData();
  form.set("image", new File([bytes], "destination", { type }));
  return form;
}

test("image drafts preserve existing images or explicitly remove them", async () => {
  assert.equal(await prepareImage(), undefined);
  assert.equal(await prepareImage(new FormData()), undefined);
  const remove = new FormData();
  remove.set("removeImage", "true");
  assert.equal(await prepareImage(remove), null);
});

test("uploads become bounded WebP images with orientation applied and metadata removed", async () => {
  const source = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#496b62" } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const result = await prepareImage(upload(source, "image/jpeg"));
  const metadata = await sharp(result.data).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 600);
  assert.equal(metadata.height, 1200);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.ok(result.data.byteLength < 2 * 1024 * 1024);
  // Its thumbnail is the oriented photo too, without metadata (TRA-89).
  const thumbnail = await sharp(result.thumbnail).metadata();
  assert.deepEqual([thumbnail.format, thumbnail.width, thumbnail.height, thumbnail.orientation, thumbnail.exif, thumbnail.icc], ["webp", 480, 960, undefined, undefined, undefined]);
});

test("small PNG and WebP uploads keep their dimensions", async () => {
  for (const format of ["png", "webp"]) {
    const source = await sharp({ create: { width: 40, height: 20, channels: 4, background: "#79a6a080" } })[format]().toBuffer();
    const result = await prepareImage(upload(source, `image/${format}`));
    for (const image of [result.data, result.thumbnail]) {
      const metadata = await sharp(image).metadata();
      assert.equal(metadata.width, 40);
      assert.equal(metadata.height, 20);
      assert.equal(metadata.format, "webp");
    }
  }
});

test("each upload is saved with a thumbnail of the whole photo that covers 480 × 320 without being enlarged (TRA-89)", async () => {
  for (const [width, height, photo, thumbnail] of [
    [4000, 3000, [1600, 1200], [480, 360]], [3000, 4000, [900, 1200], [480, 640]], [3200, 800, [1600, 400], [1280, 320]],
    [1200, 800, [1200, 800], [480, 320]], [300, 200, [300, 200], [300, 200]], [1000, 300, [1000, 300], [1000, 300]],
  ]) {
    const source = await sharp({ create: { width, height, channels: 3, background: "#496b62" } }).jpeg().toBuffer();
    const result = await prepareImage(upload(source, "image/jpeg"));
    const sizes = await Promise.all([result.data, result.thumbnail].map(async (image) => { const { format, width, height } = await sharp(image).metadata(); return [format, width, height]; }));
    assert.deepEqual(sizes, [["webp", ...photo], ["webp", ...thumbnail]], `${width} × ${height}`);
    assert.deepEqual(result.thumbnail, await makeThumbnail(result.data), "the thumbnail is made from the saved photo, as for a photo saved before thumbnails");
  }
});

test("unsupported, empty, oversized, corrupt, and disguised uploads are rejected", async () => {
  const cases = [
    upload("anything", "image/svg+xml"),
    upload(new Uint8Array()),
    upload(new Uint8Array(5 * 1024 * 1024 + 1)),
    upload("not really a PNG"),
    upload('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>', "image/jpeg"),
  ];
  const stringFile = new FormData();
  stringFile.set("image", "not a file");
  cases.push(stringFile);
  for (const form of cases) await assert.rejects(prepareImage(form), ImageValidationError);
});

test("compressed uploads cannot exceed the decoded pixel limit", async () => {
  const source = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: "#ffffff" } }).png().toBuffer();
  assert.ok(source.byteLength < 5 * 1024 * 1024);
  await assert.rejects(prepareImage(upload(source)), /20 megapixels/);
});