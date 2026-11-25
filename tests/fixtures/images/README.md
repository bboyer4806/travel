# Image fixtures (TRA-179)

Images of formats sharp can't make, for the upload, decoding and preview tests and the container smoke test. Tests make
JPEG, PNG, WebP, AVIF, GIF and TIFF images, animated GIF and WebP images and multi-page TIFF files with sharp instead.

## HEIC

Made with Pillow 13 and pillow-heif 1.9 (libheif 1.23 with the x265 encoder), at quality 90:

- `photo.heic`: 64 × 48, red, green, blue and white quarters, from the top left.
- `rotated.heic`: the same, saved with EXIF orientation 6, which pillow-heif records as a quarter turn clockwise for display.
- `alpha.heic`: the same, with the right half fully transparent.
- `two-images.heic`: the same and the same turned upside down, as two images in one file.
- `display-p3.heic`: 64 × 48 of sRGB pure red converted to Display P3, (234, 51, 34), with the Display P3 profile sharp
  attaches with `withIccProfile("p3")`.

## Animated

Made with ffmpeg 7 from its `testsrc` pattern, 16 × 8, three frames:

- `animated.avif`: `-c:v libaom-av1`, an AVIF image sequence (brand `avis`).
- `animated.png`: `-f apng -plays 0`, an animated PNG.

## Bitmaps

Each made from a reference PNG, made with Pillow, 16 × 8 in 2 × 2 blocks whose components are multiples of 17:
`bmp-reference.png` (32 colours), `bmp-reference-16.png` (16 colours), `bmp-reference-alpha.png` (the 32 colours with
16 levels of alpha) and `bmp-reference-mono.png` (black and white).

| File | Made with | Kind |
| --- | --- | --- |
| `bmp-1.bmp` | ImageMagick 6.9, `-type Bilevel BMP3:` | 1 bit per pixel, from a palette |
| `bmp-4.bmp` | ImageMagick, `-type Palette -compress None BMP3:` | 4 bits per pixel, from a palette |
| `bmp-8.bmp` | ImageMagick, `-type Palette -compress None BMP3:` | 8 bits per pixel, from a palette |
| `bmp-rle8.bmp` | ImageMagick, `-type Palette -compress RLE BMP3:` | 8 bits per pixel, run-length encoded |
| `bmp-24.bmp` | ImageMagick, `-type TrueColor BMP3:` | 24 bits per pixel |
| `bmp-core.bmp` | ImageMagick, `-type TrueColor BMP2:` | 24 bits per pixel, OS/2's 12-byte header |
| `bmp-555.bmp` | ffmpeg, `-pix_fmt rgb555le` | 16 bits per pixel, without bit fields, dithered |
| `bmp-565-masks.bmp` | ffmpeg, `-pix_fmt rgb565le` | 16 bits per pixel, bit fields after a 40-byte header, dithered |
| `bmp-4444.bmp` | ImageMagick, `-define bmp:subtype=ARGB4444 BMP:` | 16 bits per pixel with alpha, version 5 header |
| `bmp-32-alpha.bmp` | Pillow, from `bmp-reference-alpha.png` | 32 bits per pixel, alpha in the fourth byte |
| `bmp-32-zero.bmp` | Pillow, `bmp-reference-alpha.png` with its alpha zero | 32 bits per pixel, fourth byte zero throughout |
| `bmp-v5-alpha.bmp` | ImageMagick, `BMP:` from `bmp-reference-alpha.png` | 32 bits per pixel, bit fields with alpha, version 5 header |
