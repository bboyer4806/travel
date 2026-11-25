import type { Pixels } from "./pixels.ts";

/** How a bitmap's pixels are stored: as they are, run-length encoded, or in bit fields. */
const BI_RGB = 0, BI_RLE8 = 1, BI_RLE4 = 2, BI_BITFIELDS = 3, BI_ALPHABITFIELDS = 6;
/** The sizes of the headers bitmaps have: OS/2's, then each version of Windows'. */
const HEADER_SIZES = [12, 40, 52, 56, 108, 124];

/** Whether a file holds a Windows bitmap, which starts "BM". */
export function isBmp(bytes: Uint8Array): boolean {
  return bytes[0] === 0x42 && bytes[1] === 0x4d;
}

/**
 * A Windows bitmap's size and, once the caller has checked it, its pixels (TRA-179), since sharp can't decode bitmaps:
 * 1, 2, 4 or 8 bits per pixel from a palette, as they are or run-length encoded; 16 or 32 bits per pixel, as they are
 * or in bit fields; or 24. Throws for a damaged bitmap or any other kind.
 */
export function readBmp(bytes: Uint8Array): { width: number; height: number; pixels: () => Pixels } {
  // Reading past the end throws, as a damaged bitmap should.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true), u32 = (at: number) => view.getUint32(at, true);
  const headerSize = u32(14);
  if (!HEADER_SIZES.includes(headerSize)) throw new Error(`A bitmap header of ${headerSize} bytes isn't supported.`);
  const os2 = headerSize === 12;
  const width = os2 ? u16(18) : view.getInt32(18, true);
  // Rows are stored from the bottom up, unless the height is negative.
  const rows = os2 ? u16(20) : view.getInt32(22, true);
  const height = Math.abs(rows);
  const bits = u16(os2 ? 24 : 28);
  const compression = os2 ? BI_RGB : u32(30);
  const runLength = compression === BI_RLE8 || compression === BI_RLE4;
  const supported = compression === BI_RGB ? [1, 2, 4, 8, 16, 24, 32].includes(bits)
    : compression === BI_RLE8 ? bits === 8
    : compression === BI_RLE4 ? bits === 4
    : (compression === BI_BITFIELDS || compression === BI_ALPHABITFIELDS) && (bits === 16 || bits === 32);
  if (!supported || width < 1 || height < 1 || (runLength && rows < 0)) {
    throw new Error(`A bitmap of ${width} × ${rows} pixels of ${bits} bits with compression ${compression} isn't supported.`);
  }
  return { width, height, pixels() {
    const rgba = new Uint8Array(width * height * 4);
    const offset = u32(10);
    /** Where the pixel at `x` in the bitmap's `row`th stored row goes, counting rows from the top. */
    const at = (x: number, row: number) => ((rows < 0 ? row : height - 1 - row) * width + x) * 4;
    if (bits <= 8) {
      // The palette follows the header. OS/2's colours have three bytes, Windows' four, each blue, green, red.
      const colors = Math.min((os2 ? 0 : u32(46)) || 2 ** bits, 2 ** bits);
      const entry = os2 ? 3 : 4;
      const palette = Array.from({ length: colors }, (_, index) => {
        const from = 14 + headerSize + index * entry;
        return [view.getUint8(from + 2), view.getUint8(from + 1), view.getUint8(from), 255];
      });
      const paint = (x: number, row: number, index: number) => {
        if (index >= colors) throw new Error("A bitmap's pixel isn't in its palette.");
        rgba.set(palette[index], at(x, row));
      };
      if (runLength) runLengths(bytes, offset, width, height, bits, paint);
      else {
        const stride = rowBytes(width, bits, height, offset, bytes.length);
        for (let row = 0; row < height; row++) {
          for (let x = 0; x < width; x++) paint(x, row, (bytes[offset + row * stride + ((x * bits) >> 3)] >> (8 - bits - ((x * bits) & 7))) & (2 ** bits - 1));
        }
      }
      return opaque(width, height, rgba, false);
    }
    // 24 bits are blue, green and red bytes. 16 and 32 bits are bit fields, by default 5 bits of each colour with the top
    // bit unused, or a byte of each colour with the fourth byte as alpha, as browsers take it.
    const masks = compression === BI_RGB ? (bits === 16 ? [0x7c00, 0x3e0, 0x1f, 0] : [0xff0000, 0xff00, 0xff, 0xff000000])
      : [u32(54), u32(58), u32(62), compression === BI_ALPHABITFIELDS || headerSize >= 56 ? u32(66) : 0];
    const [red, green, blue, alpha] = masks.map(field);
    const stride = rowBytes(width, bits, height, offset, bytes.length);
    for (let row = 0; row < height; row++) {
      for (let x = 0; x < width; x++) {
        const out = at(x, row), from = offset + row * stride + x * (bits / 8);
        if (bits === 24) {
          rgba[out] = bytes[from + 2];
          rgba[out + 1] = bytes[from + 1];
          rgba[out + 2] = bytes[from];
          rgba[out + 3] = 255;
        } else {
          const pixel = bits === 16 ? u16(from) : u32(from);
          rgba[out] = red ? red(pixel) : 0;
          rgba[out + 1] = green ? green(pixel) : 0;
          rgba[out + 2] = blue ? blue(pixel) : 0;
          rgba[out + 3] = alpha ? alpha(pixel) : 255;
        }
      }
    }
    return opaque(width, height, rgba, alpha !== null);
  } };
}

/** The bytes in each row of an uncompressed bitmap, padded to four, once its rows are known to fit in the file. */
function rowBytes(width: number, bits: number, height: number, offset: number, length: number): number {
  const stride = Math.ceil(width * bits / 32) * 4;
  if (offset + stride * height > length) throw new Error("A bitmap's pixels are cut short.");
  return stride;
}

/** A bit field's value in a pixel, from 0 to 255, or null for a field the bitmap doesn't have. */
function field(mask: number): ((pixel: number) => number) | null {
  if (mask === 0) return null;
  const shift = 31 - Math.clz32(mask & -mask);
  const max = mask >>> shift;
  if ((max & (max + 1)) !== 0) throw new Error("A bitmap's bit field isn't contiguous.");
  return (pixel) => Math.round(((pixel & mask) >>> shift) * 255 / max);
}

/**
 * Paints a run-length encoded bitmap's palette indexes, row by row from the first stored: runs of one index, or of two
 * alternating at 4 bits per pixel, and literal runs padded to two bytes, among codes that end a row, move ahead, or end
 * the bitmap. Pixels it moves past stay transparent, as browsers leave them.
 */
function runLengths(bytes: Uint8Array, offset: number, width: number, height: number, bits: number, paint: (x: number, row: number, index: number) => void) {
  const byte = (at: number) => {
    if (at >= bytes.length) throw new Error("A bitmap's pixels are cut short.");
    return bytes[at];
  };
  /** The palette index of the `index`th pixel of a run whose byte is `value`. */
  const color = (value: number, index: number) => bits === 8 ? value : index % 2 === 0 ? value >> 4 : value & 15;
  let x = 0, row = 0, at = offset;
  while (row < height) {
    const count = byte(at), value = byte(at + 1);
    at += 2;
    if (count > 0) {
      for (let index = 0; index < count && x < width; index++, x++) paint(x, row, color(value, index));
    } else if (value === 0) {
      x = 0;
      row++;
    } else if (value === 1) {
      return;
    } else if (value === 2) {
      x += byte(at);
      row += byte(at + 1);
      at += 2;
    } else {
      for (let index = 0; index < value && x < width; index++, x++) paint(x, row, color(byte(at + (bits === 8 ? index : index >> 1)), index));
      const length = bits === 8 ? value : Math.ceil(value / 2);
      at += length + (length % 2);
    }
  }
}

/**
 * The decoded pixels, without alpha when every pixel is opaque. Alpha read as zero throughout means opaque: most
 * programs leave a 32-bit bitmap's fourth byte zero, as browsers assume.
 */
function opaque(width: number, height: number, rgba: Uint8Array, readAlpha: boolean): Pixels {
  let solid = true, clear = true;
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] !== 255) solid = false;
    if (rgba[index] !== 0) clear = false;
  }
  if (!solid && !(readAlpha && clear)) return { width, height, channels: 4, data: rgba };
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++) rgb.set(rgba.subarray(pixel * 4, pixel * 4 + 3), pixel * 3);
  return { width, height, channels: 3, data: rgb };
}
