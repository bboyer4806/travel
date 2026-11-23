"use client";

import type { PointerEvent, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { controlOrNeighbor, useFocusAfter } from "./focus-after";
import { useSwipe } from "./photo-browsing";
import styles from "./activity-steps.module.css";

/**
 * Previous and Next below an activity's dialog title (TRA-160), with its place among its destination's activities, in
 * the order its Activities carousel shows them. Unlike the carousel's arrows they stop at either end: Previous is
 * disabled on the first activity and Next on the last, and a step that reaches an end moves focus to the other. The
 * place also names the activity for screen readers, which hear it as each step changes it.
 */
export function ActivitySteps({ index, count, name, disabled, onStep }: {
  /** Where the activity shown is among them, from 0. */
  index: number;
  count: number;
  name: string;
  disabled: boolean;
  onStep: (step: -1 | 1) => void;
}) {
  const focusAfter = useFocusAfter();
  const step = (control: HTMLButtonElement, offset: -1 | 1) => { focusAfter(() => controlOrNeighbor(control)); onStep(offset); };
  return <div className={styles.steps}>
    <button type="button" className="button secondary small" disabled={disabled || index === 0} onClick={(event) => step(event.currentTarget, -1)}><ChevronLeft size={16} aria-hidden="true" />Previous<span className="sr-only"> activity</span></button>
    <p className={styles.place} aria-live="polite">{index + 1} of {count}<span className="sr-only">: {name}</span></p>
    <button type="button" className="button secondary small" disabled={disabled || index === count - 1} onClick={(event) => step(event.currentTarget, 1)}>Next<span className="sr-only"> activity</span><ChevronRight size={16} aria-hidden="true" /></button>
  </div>;
}

/**
 * An activity's details as its dialog's scrolling body (TRA-160): swiping across it shows the next or previous activity,
 * as Next and Previous do. Its photos keep sideways swipes for themselves, and so does anything that scrolls sideways,
 * such as their thumbnails.
 */
export function SwipeBody({ onStep, children }: { onStep: (step: -1 | 1) => void; children: ReactNode }) {
  const swipe = useSwipe(onStep);
  const start = (event: PointerEvent<HTMLDivElement>) => { if (!(event.target as Element).closest("[data-photos]")) swipe.onPointerDown(event); };
  return <div className="dialog-body" {...swipe} onPointerDown={start}>{children}</div>;
}
