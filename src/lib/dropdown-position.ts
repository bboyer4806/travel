/** Part of the window from top to bottom, in CSS pixels from the top of the layout viewport, as getBoundingClientRect gives them. */
export interface VerticalSpan {
  top: number;
  bottom: number;
}

/** Where a dropdown goes beside its field (TRA-140). */
export interface DropdownPosition {
  /** Whether it opens above the field rather than below it. */
  above: boolean;
  /** Where it meets the field: its top, below the field, or its bottom, above the field. */
  edge: number;
  /** How tall it may be: its tallest, or less when its side has less room. */
  maxHeight: number;
}

/** The space between a field and its dropdown, as before TRA-140. */
const GAP = 4;
/** The space a dropdown keeps from the edge of what people can see. */
const MARGIN = 8;

/**
 * Places a dropdown at most `tallest` pixels tall beside `field`, within `visible`: the part of the window people can see,
 * which an on-screen keyboard shortens. It opens below the field when its tallest fits there, and otherwise on the side
 * with more room, shortened to fit, so its list scrolls. Deciding by its tallest rather than by what it shows keeps it on
 * one side while its contents change as people type.
 */
export function dropdownPosition(field: VerticalSpan, visible: VerticalSpan, tallest: number): DropdownPosition {
  const below = Math.max(0, visible.bottom - MARGIN - GAP - field.bottom);
  const above = Math.max(0, field.top - GAP - MARGIN - visible.top);
  const up = tallest > below && above > below;
  return { above: up, edge: up ? field.top - GAP : field.bottom + GAP, maxHeight: Math.min(tallest, up ? above : below) };
}
