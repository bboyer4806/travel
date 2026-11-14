import { useState, useSyncExternalStore, type DragEvent } from "react";

/** A mouse or trackpad: the main pointer hovers and points precisely. Phones and tablets do neither, so they never drag photos (TRA-126). */
const MOUSE = "(hover: hover) and (pointer: fine)";
function subscribe(onChange: () => void) {
  const query = window.matchMedia(MOUSE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const usesMouse = () => window.matchMedia(MOUSE).matches;
/** What a dragged photo carries: Firefox drags only with data, and text fields don't accept this type, so dropping a photo on one changes nothing. */
const DRAG_TYPE = "application/x-travel-photo";

/**
 * Dragging a photo editor's photos into a new order with a mouse or trackpad (TRA-126). `ids` are the photos in order.
 * A photo is dragged by `source` and dropped anywhere on another photo's `target`, its card, whose place it takes:
 * `place` gets the dragged photo's ID and that photo's index. While a photo is dragged, its card's `data-drag` is
 * "dragged", and the card under the pointer's is "before" or "after", where the dragged photo would go.
 */
export function usePhotoDrag(ids: readonly string[], place: (id: string, index: number) => void, disabled: boolean) {
  const mouse = useSyncExternalStore(subscribe, usesMouse, () => false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const enabled = mouse && !disabled;
  const end = () => { setDragged(null); setOver(null); };
  /** A photo's part in the drag: dragged, or where the dragged photo goes if dropped on it, before an earlier photo and after a later one. */
  const role = (id: string) => dragged === null ? undefined : id === dragged ? "dragged" : id !== over ? undefined : ids.indexOf(id) < ids.indexOf(dragged) ? "before" : "after";
  return {
    /** Whether this device drags photos, which the editor's hint says while it saves too. */
    available: mouse,
    source(id: string) {
      if (!enabled) return {};
      return {
        draggable: true,
        onDragStart(event: DragEvent<HTMLElement>) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(DRAG_TYPE, id);
          setDragged(id);
        },
        onDragEnd: end,
      };
    },
    target(id: string) {
      if (!enabled) return {};
      return {
        "data-drag": role(id),
        onDragOver(event: DragEvent<HTMLElement>) {
          if (dragged === null) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver(id);
        },
        onDragLeave(event: DragEvent<HTMLElement>) {
          if (over === id && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
        },
        onDrop(event: DragEvent<HTMLElement>) {
          if (dragged === null) return;
          event.preventDefault();
          end();
          if (dragged !== id) place(dragged, ids.indexOf(id));
        },
      };
    },
  };
}
