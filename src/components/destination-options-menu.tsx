"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { dropdownPosition } from "@/lib/dropdown-position";
import styles from "./destination-options-menu.module.css";

type Props = {
  /** The destination's name as its card shows it, which names the button for screen readers. */
  label: string;
  /** True while a change saves: the button and every action are disabled, so none saves twice. */
  disabled: boolean;
  /** Whether the destination is the trip's first or last, where Move up or Move down is disabled. */
  first: boolean;
  last: boolean;
  /** Each move is given the options button, which has focus once the menu closes. */
  onMoveUp: (button: HTMLButtonElement) => void;
  onMoveDown: (button: HTMLButtonElement) => void;
  onEdit: () => void;
  onDelete: () => void;
};

type Action = { name: string; Icon: LucideIcon; disabled: boolean; run: (button: HTMLButtonElement) => void };

/**
 * Which of `count` enabled actions a key moves focus to from the one at `at`, which is -1 when focus is on the button:
 * the arrows wrap around, and Home and End go to the first and last. Other keys move nothing.
 */
function step(key: string, at: number, count: number) {
  switch (key) {
    case "ArrowDown": return (at + 1) % count;
    case "ArrowUp": return (at <= 0 ? count : at) - 1;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/**
 * A trip destination card's options (TRA-55): a three-dot button whose menu has Move up, Move down, Edit and Delete, in
 * that order. Move up is disabled for the trip's first destination and Move down for its last, and the button and every
 * action while a change saves; disabled actions still show. Opening the menu moves focus to its first enabled action; the
 * arrow keys, Home and End move between enabled actions, and Enter or Space selects one. Selecting an action, Escape or
 * the button again closes the menu with focus on the button, where a move keeps it and an editor or confirmation returns
 * it. A click or tap outside the menu closes it, and so does focus moving outside it, as another destination's menu
 * opening takes it; focus stays where it went.
 */
export function DestinationOptionsMenu({ label, disabled, first, last, onMoveUp, onMoveDown, onEdit, onDelete }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const actions: Action[] = [
    { name: "Move up", Icon: ArrowUp, disabled: disabled || first, run: onMoveUp },
    { name: "Move down", Icon: ArrowDown, disabled: disabled || last, run: onMoveDown },
    { name: "Edit", Icon: Pencil, disabled, run: onEdit },
    { name: "Delete", Icon: Trash2, disabled, run: onDelete },
  ];

  /** Closes the menu with focus on its button. */
  function close() {
    setOpen(false);
    button.current!.focus();
  }

  // The menu opens below the button, or above it when it doesn't fit below and there is more room above, never past the
  // part of the window people can see, as city suggestions do (TRA-140). Its right edge lines up with the button's, so it
  // stays within the card. Then focus moves to its first enabled action.
  useLayoutEffect(() => {
    if (!open) return;
    const box = menu.current!, viewport = window.visualViewport!;
    const field = button.current!.getBoundingClientRect();
    const { above, edge, maxHeight } = dropdownPosition(field, { top: viewport.offsetTop, bottom: viewport.offsetTop + viewport.height }, box.offsetHeight);
    Object.assign(box.style, { top: edge - root.current!.getBoundingClientRect().top + "px", maxHeight: maxHeight + "px", transform: above ? "translateY(-100%)" : "" });
    box.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open]);

  // A click or tap anywhere outside the menu and its button closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current!.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    const enabled = [...menu.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const next = step(event.key, enabled.indexOf(event.target as HTMLButtonElement), enabled.length);
    if (next === null || !enabled[next]) return;
    event.preventDefault();
    enabled[next].focus();
  }

  return <div ref={root} className={styles.options} onKeyDown={onKeyDown}
    onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={button} id={id + "button"} type="button" className={"icon-button " + styles.button} aria-label={"Options for " + label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id + "menu" : undefined} disabled={disabled}
      onClick={() => { if (open) close(); else setOpen(true); }}>
      <MoreHorizontal size={18} aria-hidden="true" />
    </button>
    {open && <div ref={menu} id={id + "menu"} role="menu" aria-labelledby={id + "button"} className={styles.menu}>
      {actions.map(({ name, Icon, disabled: off, run }) => <button key={name} type="button" role="menuitem" tabIndex={-1} className={styles.item} disabled={off}
        onClick={() => { close(); run(button.current!); }}><Icon size={15} aria-hidden="true" />{name}</button>)}
    </div>}
  </div>;
}
