import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** How near the window's top or bottom edge, in pixels, dragging a trip scrolls the page: the nearer, the faster. */
const SCROLL_EDGE = 80;
/** How far each key moves a picked-up trip: a place earlier or later, or to the first or last place. */
const STEPS: Record<string, number> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, Home: -Infinity, End: Infinity };

/** A trip being moved and the place it would take: dragged by the pointer `pointerId`, or picked up from the keyboard when that is null. */
interface Move { id: string; target: number; pointerId: number | null }

/**
 * Putting the trips on All trips in a new order from each card's handle (TRA-16): dragged with a mouse, finger or pen,
 * or picked up with Space or Enter, moved with the arrow keys, Home and End, and dropped with Space or Enter again.
 * `trips` are in order. Nothing moves until the trip is dropped in a new place, when `place` gets its ID, the index it
 * takes and whether the keyboard moved it. Meanwhile its card's `data-drag` is "dragged", and the card whose place it
 * would take is "before" or "after", the side it would go, as photos show it (TRA-126). Dragging near the window's top
 * or bottom scrolls the page. Escape, or leaving the handle, puts a picked-up trip back. `announcement` says each step
 * for screen readers.
 */
export function useTripDrag(trips: readonly { id: string; name: string }[], place: (id: string, index: number, keyboard: boolean) => void, enabled: boolean) {
  const [move, setMove] = useState<Move | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // The same move, for the events and scrolling that read it between renders.
  const moving = useRef<Move | null>(null);
  // Where the pointer dragging a trip is, so the page goes on scrolling while it holds still near an edge.
  const pointer = useRef({ x: 0, y: 0 });
  const update = (next: Move | null) => { moving.current = next; setMove(next); };
  const indexOf = (id: string | undefined) => trips.findIndex((trip) => trip.id === id);
  const position = (index: number) => `position ${index + 1} of ${trips.length}`;

  /** Aims the dragged trip at the place of the card at a point. Between cards it keeps its aim. */
  function aim(x: number, y: number) {
    const current = moving.current;
    const index = indexOf(document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-trip-id]")?.dataset.tripId);
    if (current && index >= 0 && index !== current.target) update({ ...current, target: index });
  }
  /** Ends a move, putting the trip in the place it was aimed at, or back where it was. */
  function finish(drop: boolean) {
    const current = moving.current;
    if (!current) return;
    update(null);
    const from = indexOf(current.id);
    const name = trips[from].name;
    if (drop && enabled && current.target !== from) {
      setAnnouncement(`${name} moved to ${position(current.target)}.`);
      place(current.id, current.target, current.pointerId === null);
    } else setAnnouncement(`${name} stays at ${position(from)}.`);
  }
  const scroll = useEffectEvent(() => {
    const { x, y } = pointer.current;
    // A mouse beyond the window's edge scrolls it as fast as at the edge, and no faster.
    const inside = Math.min(Math.max(y, 0), window.innerHeight);
    const speed = inside < SCROLL_EDGE ? inside - SCROLL_EDGE : Math.max(0, inside - window.innerHeight + SCROLL_EDGE);
    if (!speed) return;
    window.scrollBy(0, speed / 4);
    aim(x, y);
  });
  const dragging = move !== null && move.pointerId !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame = requestAnimationFrame(function step() { scroll(); frame = requestAnimationFrame(step); });
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  const shown = enabled ? move : null;
  return {
    announcement,
    /** A trip's card, which a dragged trip is aimed at, and its part in the move. */
    card: (id: string) => ({
      "data-trip-id": id,
      "data-drag": shown === null ? undefined : id === shown.id ? "dragged" : indexOf(id) !== shown.target ? undefined : shown.target < indexOf(shown.id) ? "before" : "after",
    }),
    /** A trip's handle, which drags it, and picks it up from the keyboard. */
    handle: (id: string) => ({
      disabled: !enabled,
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (!enabled || moving.current || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = { x: event.clientX, y: event.clientY };
        update({ id, target: indexOf(id), pointerId: event.pointerId });
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        if (moving.current?.pointerId !== event.pointerId) return;
        pointer.current = { x: event.clientX, y: event.clientY };
        aim(event.clientX, event.clientY);
      },
      onPointerUp(event: PointerEvent<HTMLButtonElement>) {
        if (moving.current?.pointerId === event.pointerId) finish(true);
      },
      onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
        if (moving.current?.pointerId === event.pointerId) finish(false);
      },
      onLostPointerCapture(event: PointerEvent<HTMLButtonElement>) {
        if (moving.current?.pointerId === event.pointerId) finish(false);
      },
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        const current = moving.current;
        if (!enabled || (current && (current.id !== id || current.pointerId !== null))) return;
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (current) { finish(true); return; }
          const index = indexOf(id);
          update({ id, target: index, pointerId: null });
          setAnnouncement(`${trips[index].name} picked up, at ${position(index)}. Move it with the arrow keys, then press Space to drop it, or Escape to cancel.`);
        } else if (current && event.key === "Escape") {
          event.preventDefault();
          finish(false);
        } else if (current && Object.hasOwn(STEPS, event.key)) {
          event.preventDefault();
          const target = Math.min(Math.max(current.target + STEPS[event.key], 0), trips.length - 1);
          update({ ...current, target });
          setAnnouncement(`${trips[indexOf(id)].name}: ${position(target)}.`);
          document.querySelector(`[data-trip-id="${trips[target].id}"]`)?.scrollIntoView({ block: "nearest" });
        }
      },
      onBlur() {
        if (moving.current?.id === id && moving.current.pointerId === null) finish(false);
      },
    }),
  };
}
