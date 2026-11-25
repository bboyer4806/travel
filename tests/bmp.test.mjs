import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { isBmp, readBmp } from "../src/lib/bmp.ts";

// TRA-179: Windows bitmaps, which sharp can't decode. The fixtures were made from the reference images by ImageMagick,
// Pillow and ffmpeg, as tests/fixtures/images/README.md says.
const fixture = (name) => readFileSync(new URL(`./fixtures/images/${name}`, import.meta.url));
/** A reference image's pixels as RGBA, as sharp decodes the PNG. */
const reference = (name) => sharp(fixture(name)).ensureAlpha().raw().toBuffer();
/** The largest difference between decoded pixels and RGBA ones, channel by channel. */
function difference({ width, height, channels, data }, rgba) {
  let largest = 0;
  for (let pixel = 0; pixel < width * height; pixel++) {
    for (let channel = 0; channel < channels; channel++) largest = Math.max(largest, Math.abs(data[pixel * channels + channel] - rgba[pixel * 4 + channel]));
  }
  return largest;
}
/** A copy of a bitmap with its header's `size` changed, as an older or newer version of the header with the same fields. */
function withHeaderSize(bytes, size) {
  const copy = Buffer.from(bytes);
  copy.writeUInt32LE(size, 14);
  return copy;
}
/** A copy of an uncompressed bottom-up bitmap stored top down instead: its rows reversed and its height negative. */
function topDown(bytes) {
  const copy = Buffer.from(bytes);
  const [width, height, bits, offset] = [copy.readInt32LE(18), copy.readInt32LE(22), copy.readUInt16LE(28), copy.readUInt32LE(10)];
  const stride = Math.ceil(width * bits / 32) * 4;
  for (let row = 0; row < height; row++) bytes.copy(copy, offset + row * stride, offset + (height - 1 - row) * stride, offset + (height - row) * stride);
  copy.writeInt32LE(-height, 22);
  return copy;
}
/** A palette bitmap with a 40-byte header, whose index `i` is (16i, 255 - 16i, 8i). */
function paletteBitmap({ width, height, bits, compression, data }) {
  const header = Buffer.alloc(54 + 4 * 16);
  header.write("BM", 0, "latin1");
  header.writeUInt32LE(header.length + data.length, 2);
  header.writeUInt32LE(header.length, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(bits, 28);
  header.writeUInt32LE(compression, 30);
  header.writeUInt32LE(16, 46);
  for (let index = 0; index < 16; index++) header.set([index * 8, 255 - index * 16, index * 16, 0], 54 + index * 4);
  return Buffer.concat([header, Buffer.from(data)]);
}
/** Palette indexes as `paletteBitmap` colours them, with "-" for a pixel left transparent. */
const painted = (rows) => rows.flatMap((row) => [...row].map((index) => index === "-" ? [0, 0, 0, 0] : [parseInt(index, 16) * 16, 255 - parseInt(index, 16) * 16, parseInt(index, 16) * 8, 255])).flat();

test("bitmaps of every kind decode to the pixels they were made from, without alpha when every pixel is opaque (TRA-179)", async () => {
  for (const [name, made, channels, tolerance] of [
    ["bmp-1.bmp", "bmp-reference-mono.png", 3, 0],
    ["bmp-4.bmp", "bmp-reference-16.png", 3, 0],
    ["bmp-8.bmp", "bmp-reference.png", 3, 0],
    ["bmp-rle8.bmp", "bmp-reference.png", 3, 0],
    ["bmp-24.bmp", "bmp-reference.png", 3, 0],
    // OS/2's header, with three-byte colours.
    ["bmp-core.bmp", "bmp-reference.png", 3, 0],
    // 5 and 6 bits a colour, as ffmpeg dithers them.
    ["bmp-555.bmp", "bmp-reference.png", 3, 12],
    ["bmp-565-masks.bmp", "bmp-reference.png", 3, 12],
    ["bmp-4444.bmp", "bmp-reference-alpha.png", 4, 0],
    ["bmp-32-alpha.bmp", "bmp-reference-alpha.png", 4, 0],
    // A fourth byte left zero throughout is opaque, as browsers take it.
    ["bmp-32-zero.bmp", "bmp-reference.png", 3, 0],
    ["bmp-v5-alpha.bmp", "bmp-reference-alpha.png", 4, 0],
  ]) {
    const bitmap = readBmp(fixture(name));
    const pixels = bitmap.pixels();
    assert.deepEqual([bitmap.width, bitmap.height, pixels.width, pixels.height, pixels.channels], [16, 8, 16, 8, channels], name);
    assert.ok(difference(pixels, await reference(made)) <= tolerance, `${name} differs from ${made} by ${difference(pixels, await reference(made))}`);
  }
});

test("bitmaps stored top down, and with each version of Windows' header, decode as they show (TRA-179)", async () => {
  assert.equal(difference(readBmp(topDown(fixture("bmp-24.bmp"))).pixels(), await reference("bmp-reference.png")), 0);
  assert.equal(difference(readBmp(topDown(fixture("bmp-v5-alpha.bmp"))).pixels(), await reference("bmp-reference-alpha.png")), 0);
  // Version 3's and 4's headers have an alpha mask; version 2's doesn't, so its pixels are opaque.
  for (const size of [56, 108]) assert.equal(difference(readBmp(withHeaderSize(fixture("bmp-v5-alpha.bmp"), size)).pixels(), await reference("bmp-reference-alpha.png")), 0, `${size}`);
  const v2 = readBmp(withHeaderSize(fixture("bmp-v5-alpha.bmp"), 52)).pixels();
  assert.deepEqual([v2.channels, difference(v2, await reference("bmp-reference-alpha.png"))], [3, 0]);
});

test("run-length encoded bitmaps paint runs, literal runs, moves, row ends and their end as Windows does, leaving pixels moved past transparent (TRA-179)", () => {
  const rle4 = readBmp(paletteBitmap({ width: 8, height: 3, bits: 4, compression: 2, data: [
    // The bottom row: a run of 1 and 2 alternating, a literal run of 3 pixels in two bytes, and the row's end.
    5, 0x12, 0, 3, 0x34, 0x50, 0, 0,
    // A move 3 pixels along, a run of 7, a literal run of 5 pixels in three bytes and a byte of padding, past the row's width.
    0, 2, 3, 0, 2, 0x77, 0, 5, 0x89, 0xab, 0xc0, 0, 0, 0,
    // The top row, and the bitmap's end.
    8, 0xf0, 0, 1,
  ] })).pixels();
  assert.deepEqual([rle4.width, rle4.height, rle4.channels, [...rle4.data]], [8, 3, 4, painted(["f0f0f0f0", "---7789a", "12121345"])]);
  const rle8 = readBmp(paletteBitmap({ width: 4, height: 2, bits: 8, compression: 1, data: [
    // A literal run of 3 with a byte of padding, then a move up a row, a run, and the end.
    0, 3, 1, 2, 3, 0, 0, 2, 0, 1, 1, 5, 0, 1,
  ] })).pixels();
  assert.deepEqual([...rle8.data], painted(["---5", "123-"]));
  const solid = readBmp(paletteBitmap({ width: 2, height: 1, bits: 8, compression: 1, data: [2, 9, 0, 1] })).pixels();
  assert.deepEqual([solid.channels, [...solid.data]], [3, [144, 111, 72, 144, 111, 72]], "a bitmap painted throughout is opaque");
});

test("a bitmap's size is read before its pixels, and damaged or other kinds of bitmaps are refused (TRA-179)", () => {
  assert.deepEqual([isBmp(fixture("bmp-24.bmp")), isBmp(fixture("photo.heic")), isBmp(new Uint8Array())], [true, false, false]);
  // A size larger than any upload may be is read without decoding a pixel.
  const huge = Buffer.from(fixture("bmp-rle8.bmp"));
  huge.writeInt32LE(100_000, 18);
  huge.writeInt32LE(100_000, 22);
  assert.deepEqual((({ width, height }) => [width, height])(readBmp(huge)), [100_000, 100_000]);
  const patched = (name, at, write) => { const copy = Buffer.from(fixture(name)); write(copy, at); return copy; };
  for (const [label, bytes] of [
    ["cut short", fixture("bmp-24.bmp").subarray(0, 300)],
    ["run lengths cut short", fixture("bmp-rle8.bmp").subarray(0, 1100)],
    ["header cut short", fixture("bmp-24.bmp").subarray(0, 20)],
    ["OS/2's second header", patched("bmp-24.bmp", 14, (copy, at) => copy.writeUInt32LE(64, at))],
    ["embedded JPEG", patched("bmp-24.bmp", 30, (copy, at) => copy.writeUInt32LE(4, at))],
    ["24 bits in bit fields", patched("bmp-24.bmp", 30, (copy, at) => copy.writeUInt32LE(3, at))],
    ["64 bits per pixel", patched("bmp-24.bmp", 28, (copy, at) => copy.writeUInt16LE(64, at))],
    ["no width", patched("bmp-24.bmp", 18, (copy, at) => copy.writeInt32LE(0, at))],
    ["run lengths top down", patched("bmp-rle8.bmp", 22, (copy, at) => copy.writeInt32LE(-8, at))],
    ["pixels outside the palette", patched("bmp-8.bmp", 46, (copy, at) => copy.writeUInt32LE(4, at))],
    ["a bit field with a gap", patched("bmp-565-masks.bmp", 54, (copy, at) => copy.writeUInt32LE(0xf801, at))],
  ]) assert.throws(() => readBmp(bytes).pixels(), Error, label);
});
