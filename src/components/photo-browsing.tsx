import { useRef, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./photo-browsing.module.css";

/**
 * How far a finger or pen moves across a gallery's main photo, more sideways than up or down, to swipe to another photo
 * (TRA-136), or across an activity's details to another activity (TRA-160).
 */
const SWIPE_DISTANCE = 40;

/** The photo a step from photo `index`: the next (1) or previous (-1) in saved order, from the last photo to the first and the first to the last (TRA-123). */
export function neighborPhoto<T>(images: readonly T[], index: number, step: -1 | 1): T {
  return images[(index + step + images.length) % images.length];
}

/**
 * Previous and Next, midway down the left and right edges of a gallery's main photo with two or more photos (TRA-123).
 * `name` says whose photos they are, in their labels, and `onStep` shows the previous (-1) or next (1) photo. With a
 * mouse they show while the pointer is over the main photo or either has keyboard focus; on touchscreens they always show.
 */
export function PhotoArrows({ name, onStep }: { name: string; onStep: (step: -1 | 1) => void }) {
  return <>
    <button type="button" className={`${styles.arrow} ${styles.previous}`} aria-label={`Previous photo of ${name}`} onClick={() => onStep(-1)}><ChevronLeft size={22} aria-hidden="true" /></button>
    <button type="button" className={`${styles.arrow} ${styles.next}`} aria-label={`Next photo of ${name}`} onClick={() => onStep(1)}><ChevronRight size={22} aria-hidden="true" /></button>
  </>;
}

/**
 * Swiping with one finger or a pen: to the left shows the next item and to the right the previous, as Next and Previous
 * do, for a gallery's main photo (TRA-136) and an activity's details (TRA-160). Spread it on what swipes, which then
 * leaves sideways moves to the swipe while the page still scrolls up and down and zooms. Anything inside it that scrolls
 * sideways still does, and that ends the swipe. A mouse doesn't swipe.
 */
export function useSwipe(onStep: (step: -1 | 1) => void) {
  // Where the swipe started, until it ends, a second finger touches, or the browser takes the touch to scroll or zoom.
  const start = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  return {
    style: { touchAction: "pan-y pinch-zoom" },
    onPointerDown(event: PointerEvent<HTMLElement>) {
      start.current = event.isPrimary && event.pointerType !== "mouse" ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const from = start.current;
      if (from?.pointerId !== event.pointerId) return;
      start.current = null;
      const across = event.clientX - from.x;
      if (Math.abs(across) >= SWIPE_DISTANCE && Math.abs(across) > Math.abs(event.clientY - from.y)) onStep(across < 0 ? 1 : -1);
    },
    onPointerCancel() {
      start.current = null;
    },
  };
}
