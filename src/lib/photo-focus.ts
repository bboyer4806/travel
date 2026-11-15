import type { PhotoFocus } from "./types";

/** Where a destination photo is centered until someone chooses its focal point, as every photo was before TRA-53. */
export const CENTERED: PhotoFocus = { focusX: 50, focusY: 50 };

/** A draft photo's focal point: its own, or the center for a new photo whose focal point hasn't been chosen. */
export function photoFocus(photo: Partial<PhotoFocus>): PhotoFocus {
  return { focusX: photo.focusX ?? CENTERED.focusX, focusY: photo.focusY ?? CENTERED.focusY };
}

/** The CSS `object-position` that keeps a photo's focal point in view, at the same place in its frame, wherever it is cropped to fit. */
export function objectPosition({ focusX, focusY }: PhotoFocus): string {
  return `${focusX}% ${focusY}%`;
}

export interface Size { width: number; height: number; }

/**
 * The focal point after dragging a photo `dx` and `dy` pixels from `start`, for a photo of `natural` size cropped to cover a
 * `frame` without stretching. The photo follows the pointer until its edge meets the frame's. It moves only the way it
 * overflows the frame: up and down for most photos in the 16:7 hero, across for a panorama wider than that.
 */
export function draggedFocus(start: PhotoFocus, dx: number, dy: number, frame: Size, natural: Size): PhotoFocus {
  const scale = Math.max(frame.width / natural.width, frame.height / natural.height);
  return { focusX: dragged(start.focusX, dx, natural.width * scale - frame.width), focusY: dragged(start.focusY, dy, natural.height * scale - frame.height) };
}

/** A focal point coordinate dragged `delta` pixels, where the photo overflows its frame by `overflow` pixels that way, to a tenth of a percent. */
function dragged(start: number, delta: number, overflow: number): number {
  if (overflow < 1) return start;
  return Math.round(Math.min(100, Math.max(0, start - (delta / overflow) * 100)) * 10) / 10;
}
