import type { MainModule } from "libheif-js/libheif-wasm/libheif";
import type { Pixels } from "./pixels.ts";

/** libheif compiled to WebAssembly with the HEVC decoder sharp's libheif lacks, started when the first HEIC image needs it. */
let started: Promise<MainModule> | null = null;

/**
 * Decodes a HEIC or HEIF image's primary image (TRA-179), turned, flipped and cropped as the file says, as libheif does
 * by default. Sharp reads such a file's header, but can't decode its HEVC-coded pixels. The caller checks the header
 * first: that the file holds one image, of no more pixels than an upload may have.
 */
export async function decodeHeic(bytes: Uint8Array): Promise<Pixels> {
  started ??= import("libheif-js/libheif-wasm/libheif-bundle.js").then(({ default: start }) => start());
  const libheif = await started;
  try {
    return primaryImage(libheif, bytes);
  } catch (error) {
    // A failed decode may leave libheif's memory in any state, so the next image starts a fresh libheif.
    started = null;
    throw error;
  }
}

function primaryImage(libheif: MainModule, bytes: Uint8Array): Pixels {
  const context = libheif.heif_context_alloc();
  try {
    const read = libheif.heif_context_read_from_memory(context, bytes);
    if (read.code !== libheif.heif_error_code.heif_error_Ok) throw new Error(`libheif couldn't read the image: ${read.message}`);
    const handle = libheif.heif_js_context_get_primary_image_handle(context);
    if (!handle || handle.code) throw new Error(`libheif found no primary image: ${handle?.message}`);
    try {
      const channels = libheif.heif_image_handle_has_alpha_channel(handle) ? 4 : 3;
      const chroma = channels === 4 ? libheif.heif_chroma.heif_chroma_interleaved_RGBA : libheif.heif_chroma.heif_chroma_interleaved_RGB;
      const image = libheif.heif_js_decode_image2(handle, libheif.heif_colorspace.heif_colorspace_RGB, chroma);
      if (!image || image.code) throw new Error(`libheif couldn't decode the image: ${image?.message}`);
      try {
        const plane: { width: number; height: number; stride: number; data: Uint8Array } = image.channels.find((channel: { id: unknown }) => channel.id === libheif.heif_channel.heif_channel_interleaved);
        const { width, height, stride } = plane;
        // The plane is libheif's memory, which its next image reuses, and its rows may be padded.
        const data = new Uint8Array(width * height * channels);
        for (let row = 0; row < height; row++) data.set(plane.data.subarray(row * stride, row * stride + width * channels), row * width * channels);
        return { width, height, channels, data };
      } finally {
        libheif.heif_image_release(image.image);
      }
    } finally {
      libheif.heif_image_handle_release(handle);
    }
  } finally {
    libheif.heif_context_free(context);
  }
}
