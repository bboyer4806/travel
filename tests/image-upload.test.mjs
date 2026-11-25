import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { makeThumbnail, prepareImage, previewImage, ImageValidationError } from "../src/lib/image-upload.ts";

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
// TRA-179: more image formats, decided by what an upload holds, never its name or type, and still images only.
const fixture = (name) => readFileSync(new URL(`./fixtures/images/${name}`, import.meta.url));
const named = (bytes, name, type) => { const form = new FormData(); form.set("image", new File([bytes], name, { type })); return form; };
const NAMES = "JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, or HEIC";
const UNREADABLE = `We couldn't read that image. It may be damaged, or not a ${NAMES} image.`;
const NOT_STILL = "Choose a still image instead of an animated or multi-page image.";
/** A pixel's channels in a saved photo. */
async function pixel(webp, x, y) {
  const { data, info } = await sharp(webp).raw().toBuffer({ resolveWithObject: true });
  return [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x + 1) * info.channels)];
}
const near = (actual, expected, tolerance, label) => assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance), `${label}: ${actual} is not near ${expected}`);
/** A copy of a HEIC file with its brand, which names its kind, changed. */
function branded(bytes, brand) {
  const copy = Buffer.from(bytes);
  copy.write(brand, 8, "latin1");
  return copy;
}

test("every new format decodes to a WebP photo and thumbnail, whatever name and type the browser gives it (TRA-179)", async () => {
  const still = (format) => sharp({ create: { width: 40, height: 20, channels: 3, background: "#496b62" } })[format]().toBuffer();
  for (const [label, bytes, name, type, size] of [
    // A JPEG saved as .jfif or .jpe, which browsers may give an unexpected type or none.
    ["JFIF", await still("jpeg"), "photo.jfif", "", [40, 20]],
    ["JPE", await still("jpeg"), "photo.jpe", "image/pjpeg", [40, 20]],
    ["AVIF", await still("avif"), "photo.avif", "image/avif", [40, 20]],
    ["GIF", await still("gif"), "photo.gif", "image/gif", [40, 20]],
    ["TIFF", await still("tiff"), "scan.tif", "image/tiff", [40, 20]],
    ["BMP", fixture("bmp-24.bmp"), "map.bmp", "image/bmp", [16, 8]],
    ["HEIC", fixture("photo.heic"), "IMG_0001.HEIC", "", [64, 48]],
    // A HEIF file whose brand is the general one, as cameras' .heif files are.
    ["HEIF", branded(fixture("photo.heic"), "mif1"), "camera.heif", "image/heif", [64, 48]],
    // A PNG named as a JPEG is taken as the PNG it is.
    ["disguised PNG", await still("png"), "photo.jpg", "image/jpeg", [40, 20]],
  ]) {
    const result = await prepareImage(named(bytes, name, type));
    for (const image of [result.data, result.thumbnail]) {
      const { format, width, height, exif, icc } = await sharp(image).metadata();
      assert.deepEqual([format, width, height, exif, icc], ["webp", ...size, undefined, undefined], label);
    }
  }
});

test("animated and multi-page images are refused in every format, as still images of them are taken (TRA-179)", async () => {
  const frames = await Promise.all(["#ff0000", "#0000ff"].map((background) => sharp({ create: { width: 8, height: 6, channels: 3, background } }).png().toBuffer()));
  const joined = (format) => sharp(frames, { join: { animated: true } })[format]().toBuffer();
  for (const [label, bytes] of [
    ["animated GIF", await joined("gif")], ["animated WebP", await joined("webp")], ["multi-page TIFF", await joined("tiff")],
    ["animated PNG", fixture("animated.png")], ["animated AVIF", fixture("animated.avif")],
    ["HEIC with two images", fixture("two-images.heic")], ["HEIC sequence", branded(fixture("photo.heic"), "msf1")],
  ]) await assert.rejects(prepareImage(named(bytes, "image", "")), { message: NOT_STILL }, label);
  const singleFrame = await prepareImage(named(await sharp(frames[0]).gif().toBuffer(), "still.gif", "image/gif"));
  near(await pixel(singleFrame.data, 4, 3), [255, 0, 0], 8, "a GIF of one frame is a still image");
});

test("HEIC photos keep their orientation, transparency and Display P3 colours, without their metadata (TRA-179)", async () => {
  // Red, green, blue and white quarters, turned a quarter clockwise for display as a phone held upright records it.
  const turned = await prepareImage(named(fixture("rotated.heic"), "IMG_0002.HEIC", "image/heic"));
  const { width, height, exif } = await sharp(turned.data).metadata();
  assert.deepEqual([width, height, exif], [48, 64, undefined], "the photo is upright, with its EXIF removed");
  near(await pixel(turned.data, 5, 5), [40, 70, 210], 12, "blue is at the top left");
  near(await pixel(turned.data, 42, 5), [220, 40, 40], 12, "red is at the top right");
  near(await pixel(turned.data, 42, 58), [40, 180, 60], 12, "green is at the bottom right");
  // The left half opaque, the right half clear.
  const clear = await prepareImage(named(fixture("alpha.heic"), "clear.heic", "image/heic"));
  assert.equal((await sharp(clear.data).metadata()).hasAlpha, true);
  assert.deepEqual([(await pixel(clear.data, 5, 5))[3], (await pixel(clear.data, 58, 5))[3]], [255, 0]);
  // Pure red in Display P3, as (234, 51, 34) with its profile, is saved as sRGB pure red, not as those numbers.
  const p3 = await prepareImage(named(fixture("display-p3.heic"), "IMG_0003.HEIC", ""));
  near(await pixel(p3.data, 32, 24), [255, 0, 0], 6, "Display P3 is converted to sRGB");
  assert.equal((await sharp(p3.data).metadata()).icc, undefined, "the profile isn't kept");
});

test("an image is refused with why before it is decoded when it has more pixels than any upload may, in every format (TRA-179)", async () => {
  const LARGE = "That image is larger than 20 megapixels. Choose a smaller image.";
  // A bitmap whose header says 5,000 × 4,001.
  const bitmap = Buffer.from(fixture("bmp-rle8.bmp"));
  bitmap.writeInt32LE(5000, 18);
  bitmap.writeInt32LE(4001, 22);
  // A HEIC photo whose size property and clean aperture, the crop shown of it, say 5,000 × 4,001.
  const heic = Buffer.from(fixture("photo.heic"));
  const ispe = heic.indexOf("ispe", 0, "latin1"), clap = heic.indexOf("clap", 0, "latin1");
  heic.writeUInt32BE(5000, ispe + 8);
  heic.writeUInt32BE(4002, ispe + 12);
  heic.writeUInt32BE(5000, clap + 4);
  heic.writeUInt32BE(4001, clap + 12);
  for (const bytes of [bitmap, heic]) await assert.rejects(prepareImage(named(bytes, "large", "")), { message: LARGE });
});

test("damaged images, and files of other kinds whatever their names and types, are refused with why (TRA-179)", async () => {
  // Noise, so the image data is most of each file.
  const noisy = (format) => sharp({ create: { width: 64, height: 48, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } })[format]().toBuffer();
  for (const [label, bytes] of [
    ["cut-short HEIC", fixture("photo.heic").subarray(0, 400)],
    ["cut-short bitmap", fixture("bmp-24.bmp").subarray(0, 300)],
    ["cut-short TIFF", (await noisy("tiff")).subarray(0, 2000)],
    ["cut-short GIF", (await noisy("gif")).subarray(0, 300)],
    ["cut-short AVIF", (await noisy("avif")).subarray(0, 300)],
    ["text named as a bitmap", Buffer.from("BM but not a bitmap")],
    ["text named as a HEIC photo", Buffer.from("not a photo")],
  ]) await assert.rejects(prepareImage(named(bytes, label, "image/heic")), { message: UNREADABLE }, label);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
  await assert.rejects(prepareImage(named(svg, "photo.heic", "image/heic")), { message: `Choose a ${NAMES} image.` }, "an SVG image named as a HEIC photo");
});

test("a photo editor's preview of an image is the photo Travel would save, refused as saving it would be (TRA-179)", async () => {
  const preview = await previewImage(new File([fixture("photo.heic")], "IMG_0001.HEIC"));
  assert.deepEqual(Buffer.from(preview), Buffer.from((await prepareImage(named(fixture("photo.heic"), "IMG_0001.HEIC", ""))).data));
  await assert.rejects(previewImage(new File([fixture("two-images.heic")], "burst.heic")), { message: NOT_STILL });
  await assert.rejects(previewImage(new File([], "empty.heic")), { message: "That image is empty. Choose another image." });
  await assert.rejects(previewImage("not a file"), { message: `Choose a ${NAMES} image.` });
});
