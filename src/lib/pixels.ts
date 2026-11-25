/** An image decoded apart from sharp (TRA-179): 8-bit RGB or RGBA pixels, row by row from the top. */
export interface Pixels { width: number; height: number; channels: 3 | 4; data: Uint8Array; }

/** A TIFF tag: its number, type (3 for 16-bit, 4 for 32-bit, 7 for bytes), count, and value, or null when it follows the tags. */
type Tag = [tag: number, type: 3 | 4 | 7, count: number, value: number | null];

/**
 * Decoded pixels as an uncompressed TIFF, with `icc` as their colour profile when they have one, for sharp to decode as
 * it decodes any upload (TRA-179). Sharp also takes bare pixels, but only as sRGB, which would dull the Display P3
 * colours of a phone's HEIC photo.
 */
export function pixelsTiff({ width, height, channels, data }: Pixels, icc?: Uint8Array): Buffer {
  const tags: Tag[] = [
    [256, 4, 1, width], // ImageWidth
    [257, 4, 1, height], // ImageLength
    [258, 3, channels, null], // BitsPerSample, 8 for each channel
    [259, 3, 1, 1], // Compression: none
    [262, 3, 1, 2], // PhotometricInterpretation: RGB
    [273, 4, 1, null], // StripOffsets: the pixels
    [277, 3, 1, channels], // SamplesPerPixel
    [278, 4, 1, height], // RowsPerStrip: all of them
    [279, 4, 1, data.length], // StripByteCounts
    [284, 3, 1, 1], // PlanarConfiguration: each pixel's channels together
    ...(channels === 4 ? [[338, 3, 1, 2] satisfies Tag] : []), // ExtraSamples: unassociated alpha
    ...(icc ? [[34675, 7, icc.length, null] satisfies Tag] : []), // ICCProfile
  ];
  // The header, then the tags, then what they point to, each starting on an even offset.
  const bitsAt = 8 + 2 + tags.length * 12 + 4;
  const iccAt = bitsAt + channels * 2;
  const pixelsAt = iccAt + (icc ? icc.length + (icc.length % 2) : 0);
  const pointers: Record<number, number> = { 258: bitsAt, 273: pixelsAt, 34675: iccAt };
  const tiff = Buffer.alloc(pixelsAt + data.length);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(tags.length, 8);
  for (const [index, [tag, type, count, value]] of tags.entries()) {
    const at = 10 + index * 12;
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    if (value === null) tiff.writeUInt32LE(pointers[tag], at + 8);
    else if (type === 3) tiff.writeUInt16LE(value, at + 8);
    else tiff.writeUInt32LE(value, at + 8);
  }
  for (let channel = 0; channel < channels; channel++) tiff.writeUInt16LE(8, bitsAt + channel * 2);
  if (icc) tiff.set(icc, iccAt);
  tiff.set(data, pixelsAt);
  return tiff;
}
