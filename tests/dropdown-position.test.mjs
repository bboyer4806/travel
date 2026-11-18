import assert from "node:assert/strict";
import test from "node:test";
import { dropdownPosition } from "../src/lib/dropdown-position.ts";

// TRA-140: where a city field's suggestions open, at most 222 pixels tall, within the part of the window people can see.
const TALLEST = 222;
/** A 42-pixel field whose top is at `top`. */
const field = (top) => ({ top, bottom: top + 42 });
/** Where the suggestions' box is, from top to bottom, when they would be `height` tall with room to spare. */
function box(at, visible, height = TALLEST) {
  const { above, edge, maxHeight } = dropdownPosition(at, visible, TALLEST);
  const shown = Math.min(height, maxHeight);
  return above ? { above, top: edge - shown, bottom: edge } : { above, top: edge, bottom: edge + shown };
}

test("Add destination's suggestions open below its city at 1920 × 911, all of them in view (TRA-140)", () => {
  // The city field in the editor as reported, measured in Chromium at 1920 × 911.
  assert.deepEqual(dropdownPosition({ top: 376, bottom: 419 }, { top: 0, bottom: 911 }, TALLEST), { above: false, edge: 423, maxHeight: TALLEST });
});

test("near the bottom of the window they open above the field, 4 pixels from it", () => {
  assert.deepEqual(dropdownPosition(field(800), { top: 0, bottom: 911 }, TALLEST), { above: true, edge: 796, maxHeight: TALLEST });
  assert.deepEqual(box(field(800), { top: 0, bottom: 911 }), { above: true, top: 574, bottom: 796 });
});

test("they open below when their tallest just fits there, 8 pixels from the window's edge", () => {
  assert.deepEqual(box(field(635), { top: 0, bottom: 911 }), { above: false, top: 681, bottom: 903 });
  assert.equal(box(field(636), { top: 0, bottom: 911 }).above, true);
});

test("they stay below, shortened so their list scrolls, when below has more room though not enough", () => {
  assert.deepEqual(dropdownPosition(field(100), { top: 0, bottom: 300 }, TALLEST), { above: false, edge: 146, maxHeight: 146 });
});

test("they open above, shortened so their list scrolls, when above has more room though not enough", () => {
  assert.deepEqual(dropdownPosition(field(200), { top: 0, bottom: 300 }, TALLEST), { above: true, edge: 196, maxHeight: 188 });
  assert.deepEqual(box(field(200), { top: 0, bottom: 300 }), { above: true, top: 8, bottom: 196 });
});

test("a short list near the bottom opens above too, so it stays on one side as people type", () => {
  // "Finding cities…" would fit below, but the suggestions that replace it would not.
  assert.equal(box(field(800), { top: 0, bottom: 911 }, 40).above, true);
});

test("an on-screen keyboard shortening what people can see moves them above the field", () => {
  // A phone's city field, with the keyboard leaving 420 pixels of a 915-pixel window in view.
  assert.equal(box(field(330), { top: 0, bottom: 915 }).above, false);
  assert.deepEqual(box(field(330), { top: 0, bottom: 420 }), { above: true, top: 104, bottom: 326 });
});

test("with the visual viewport scrolled down the page, they stay within what people can see", () => {
  // The keyboard is open and the browser has scrolled 200 pixels to show the field.
  assert.deepEqual(box(field(500), { top: 200, bottom: 620 }), { above: true, top: 274, bottom: 496 });
  assert.deepEqual(box(field(230), { top: 200, bottom: 620 }), { above: false, top: 276, bottom: 498 });
});

test("wherever the field is in view, they stay in view, 8 pixels from its edges, and never cover the field", () => {
  for (const height of [200, 360, 420, 600, 911]) {
    for (const offset of [0, 150]) {
      const visible = { top: offset, bottom: offset + height };
      for (let top = visible.top; top <= visible.bottom - 42; top += 3) {
        const at = field(top);
        const shown = box(at, visible);
        assert.ok(shown.top >= visible.top + 8 && shown.bottom <= visible.bottom - 8, `in view: ${JSON.stringify({ visible, at, shown })}`);
        assert.ok(shown.bottom <= at.top - 4 || shown.top >= at.bottom + 4, `beside the field: ${JSON.stringify({ visible, at, shown })}`);
        assert.ok(shown.bottom - shown.top >= Math.min(TALLEST, (height - 42 - 24) / 2), `on the side with more room: ${JSON.stringify({ visible, at, shown })}`);
      }
    }
  }
});
