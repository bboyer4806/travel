import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareDestinationImage, ImageValidationError } from "../src/lib/destination-image-upload.ts";

function upload(bytes, type = "image/png") {
  const form = new FormData();
  form.set("image", new File([bytes], "destination", { type }));
  return form;
}

test("image drafts preserve existing images or explicitly remove them", async () => {
  assert.equal(await prepareDestinationImage(), undefined);
  assert.equal(await prepareDestinationImage(new FormData()), undefined);
  const remove = new FormData();
  remove.set("removeImage", "true");
  assert.equal(await prepareDestinationImage(remove), null);
});

test("uploads become bounded WebP images with orientation applied and metadata removed", async () => {
  const source = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#496b62" } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const result = await prepareDestinationImage(upload(source, "image/jpeg"));
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 600);
  assert.equal(metadata.height, 1200);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.ok(result.byteLength < 2 * 1024 * 1024);
});

test("small PNG and WebP uploads keep their dimensions", async () => {
  for (const format of ["png", "webp"]) {
    const source = await sharp({ create: { width: 40, height: 20, channels: 4, background: "#79a6a080" } })[format]().toBuffer();
    const result = await prepareDestinationImage(upload(source, `image/${format}`));
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.width, 40);
    assert.equal(metadata.height, 20);
    assert.equal(metadata.format, "webp");
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
  for (const form of cases) await assert.rejects(prepareDestinationImage(form), ImageValidationError);
});

test("compressed uploads cannot exceed the decoded pixel limit", async () => {
  const source = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: "#ffffff" } }).png().toBuffer();
  assert.ok(source.byteLength < 5 * 1024 * 1024);
  await assert.rejects(prepareDestinationImage(upload(source)), /20 megapixels/);
});