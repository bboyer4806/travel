import { useEffect, useRef } from "react";

type FindControl = () => HTMLElement | null | undefined;

/**
 * Keeps keyboard focus on, or next to, a control whose change disables, moves or removes it, which would otherwise drop
 * focus to the page (TRA-86). Call the returned function with `find` before making the change: after the first render
 * that shows it with `settled` true, the control `find` returns takes focus. A save without an editor settles once the
 * page shows the saved change; an editor's draft changes settle as they render. If the person has moved focus to
 * another control by then, it stays there.
 */
export function useFocusAfter(settled = true) {
  const pending = useRef<FindControl | null>(null);
  useEffect(() => {
    if (!settled || !pending.current) return;
    const find = pending.current;
    pending.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && !active.matches(":disabled")) return;
    find()?.focus();
  });
  return (find: FindControl) => { pending.current = find; };
}

/** A control after its change: itself, or when the change disabled it, the first enabled button beside it, as Move up for an item moved to the end. */
export function controlOrNeighbor(control: HTMLButtonElement) {
  return control.disabled ? control.parentElement?.querySelector<HTMLButtonElement>("button:not(:disabled)") : control;
}
