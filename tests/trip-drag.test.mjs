import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// TRA-16: the trip list's handles, run with a small hook harness that keeps their state and effects between renders, as
// React does, given pointer and keyboard events as a browser dispatches them. No browser is involved: the harness says
// which trip's card is under the pointer, and runs animation frames when told to.
const TRIPS = ["Lisbon", "Rome", "Oslo", "Kyoto"].map((name, index) => ({ id: `trip-${index + 1}`, name }));
const [LISBON, ROME, OSLO, KYOTO] = TRIPS.map((trip) => trip.id);

/** An event as a browser dispatches it, recording whether the handler prevented its default. */
const event = (fields) => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields });

/** The trip list's drag, for `trips` in order, which may move trips while `enabled`. */
function harness({ enabled = true, trips = TRIPS } = {}) {
  const hooks = [];
  const effects = [];
  let cursor = 0;
  let drag;
  // What the page does: the trip moves the list saves, the frames waiting to run, how far the page scrolled, and which
  // cards were scrolled into view.
  const placed = [];
  const frames = new Map();
  let frameId = 0;
  const scrolled = [];
  const shown = [];
  let under = null;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value) => { hooks[index] = value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffectEvent(callback) {
      const index = cursor++;
      hooks[index] = callback;
      return () => hooks[index]();
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const before = hooks[index];
      if (before && deps.every((value, at) => value === before.deps[at])) return;
      before?.cleanup?.();
      hooks[index] = { deps };
      effects.push(() => { hooks[index].cleanup = effect(); });
    },
  };
  const globals = {
    window: { innerHeight: 800, scrollBy: (x, y) => scrolled.push(y) },
    document: {
      elementFromPoint: () => ({ closest: (selector) => (assert.equal(selector, "[data-trip-id]"), under === null ? null : { dataset: { tripId: under } }) }),
      querySelector: (selector) => ({ scrollIntoView: (options) => { assert.equal(options.block, "nearest"); shown.push(selector); } }),
    },
    requestAnimationFrame: (step) => { frames.set(++frameId, step); return frameId; },
    cancelAnimationFrame: (id) => { frames.delete(id); },
  };
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/trip-drag.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name) => { assert.equal(name, "react"); return react; }, ...globals });
  const render = () => {
    cursor = 0;
    drag = exports.useTripDrag(trips, (id, index, keyboard) => placed.push([id, index, keyboard]), enabled);
    for (const run of effects.splice(0)) run();
  };
  render();
  const handle = (id) => drag.handle(id);
  return {
    placed, scrolled, shown, frames,
    handle,
    announcement: () => drag.announcement,
    /** Each card's part in a move: "dragged", "before" or "after" the card whose place the trip would take, or none. */
    marks: () => trips.map((trip) => drag.card(trip.id)["data-drag"]),
    key(id, key) { const pressed = event({ key }); handle(id).onKeyDown(pressed); render(); return pressed; },
    blur(id) { handle(id).onBlur(); render(); },
    /** Presses `id`'s handle with the pointer `pointerId` at height `y`. */
    down(id, { pointerId = 1, y = 400, isPrimary = true, button = 0 } = {}) {
      const captured = [];
      const pressed = event({ pointerId, isPrimary, button, clientX: 100, clientY: y, currentTarget: { setPointerCapture: (pointer) => captured.push(pointer) } });
      handle(id).onPointerDown(pressed);
      render();
      return { pressed, captured };
    },
    /** Moves the pointer pressing `id`'s handle, which its capture keeps sending there, to `y`, over `card`'s card or none. */
    over(id, card, { pointerId = 1, y = 400 } = {}) { under = card; handle(id).onPointerMove(event({ pointerId, clientX: 100, clientY: y })); render(); },
    up(id, pointerId = 1) { handle(id).onPointerUp(event({ pointerId })); render(); },
    cancel(id, pointerId = 1) { handle(id).onPointerCancel(event({ pointerId })); render(); },
    lose(id, pointerId = 1) { handle(id).onLostPointerCapture(event({ pointerId })); render(); },
    /** Runs the next animation frame, with `card`'s card now under the pointer, as the page scrolls under it. */
    frame(card) { under = card; const [[id, step]] = frames; frames.delete(id); step(); render(); },
  };
}

test("from the keyboard, Space picks a trip up, the arrow keys, Home and End aim it, and Space drops it in its new place (TRA-16)", () => {
  const list = harness();
  assert.equal(list.handle(OSLO).disabled, false);
  assert.equal(list.key(ROME, "ArrowDown").defaultPrevented, false, "arrows only move a picked-up trip, and otherwise do what they always do");
  assert.equal(list.key(ROME, " ").defaultPrevented, true);
  assert.deepEqual(list.marks(), [undefined, "dragged", undefined, undefined]);
  assert.equal(list.announcement(), "Rome picked up, at position 2 of 4. Move it with the arrow keys, then press Space to drop it, or Escape to cancel.");
  assert.equal(list.key(ROME, "ArrowDown").defaultPrevented, true);
  assert.deepEqual(list.marks(), [undefined, "dragged", "after", undefined], "Rome would go after Oslo");
  assert.equal(list.announcement(), "Rome: position 3 of 4.");
  list.key(ROME, "ArrowRight");
  list.key(ROME, "ArrowDown");
  assert.deepEqual(list.marks(), [undefined, "dragged", undefined, "after"], "the last place is as far as it goes");
  list.key(ROME, "Home");
  assert.deepEqual(list.marks(), ["before", "dragged", undefined, undefined]);
  list.key(ROME, "ArrowLeft");
  list.key(ROME, "End");
  list.key(ROME, "ArrowUp");
  assert.deepEqual(list.marks(), [undefined, "dragged", "after", undefined]);
  assert.deepEqual(list.shown.at(-1), `[data-trip-id="${OSLO}"]`, "the card it is aimed at scrolls into view");
  assert.deepEqual(list.placed, [], "nothing moves until it is dropped");

  list.key(ROME, "Enter");
  assert.deepEqual(list.placed, [[ROME, 2, true]]);
  assert.deepEqual(list.marks(), [undefined, undefined, undefined, undefined]);
  assert.equal(list.announcement(), "Rome moved to position 3 of 4.");
  assert.equal(list.key(ROME, "Escape").defaultPrevented, false, "Escape does nothing once it is dropped");
});

test("Escape, leaving the handle, or dropping a trip where it was puts it back, saving nothing (TRA-16)", () => {
  const list = harness();
  list.key(KYOTO, "Enter");
  list.key(KYOTO, "Home");
  assert.equal(list.key(KYOTO, "Escape").defaultPrevented, true);
  assert.deepEqual(list.marks(), [undefined, undefined, undefined, undefined]);
  assert.equal(list.announcement(), "Kyoto stays at position 4 of 4.");

  list.key(KYOTO, " ");
  list.key(KYOTO, "ArrowUp");
  list.blur(LISBON);
  assert.deepEqual(list.marks(), [undefined, undefined, "before", "dragged"], "another handle losing focus changes nothing");
  assert.equal(list.key(LISBON, " ").defaultPrevented, false, "and another trip can't be picked up meanwhile");
  list.blur(KYOTO);
  assert.deepEqual(list.marks(), [undefined, undefined, undefined, undefined]);

  list.key(KYOTO, " ");
  list.key(KYOTO, "ArrowUp");
  list.key(KYOTO, "ArrowDown");
  list.key(KYOTO, " ");
  assert.equal(list.announcement(), "Kyoto stays at position 4 of 4.");
  assert.deepEqual(list.placed, []);
});

test("a pointer drags a trip from its handle to the place of the card it is let go over, keeping its aim between cards (TRA-16)", () => {
  const list = harness();
  const { pressed, captured } = list.down(KYOTO);
  assert.equal(pressed.defaultPrevented, true, "pressing the handle selects no text");
  assert.deepEqual(captured, [1], "the handle keeps the pointer, wherever it goes");
  assert.deepEqual(list.marks(), [undefined, undefined, undefined, "dragged"]);
  list.over(KYOTO, ROME);
  assert.deepEqual(list.marks(), [undefined, "before", undefined, "dragged"]);
  list.over(KYOTO, null);
  assert.deepEqual(list.marks(), [undefined, "before", undefined, "dragged"], "between cards it keeps its aim");
  list.over(KYOTO, LISBON, { pointerId: 2 });
  assert.deepEqual(list.marks(), [undefined, "before", undefined, "dragged"], "another pointer doesn't steer it");
  list.down(LISBON, { pointerId: 2 });
  list.up(KYOTO, 2);
  assert.deepEqual(list.marks(), [undefined, "before", undefined, "dragged"], "nor start another move or drop it");
  list.up(KYOTO);
  assert.deepEqual(list.placed, [[KYOTO, 1, false]]);
  assert.equal(list.announcement(), "Kyoto moved to position 2 of 4.");
  list.lose(KYOTO);
  assert.equal(list.placed.length, 1, "the handle letting go of the pointer afterwards changes nothing");

  // A trip dragged later goes after the card it is let go over.
  list.down(LISBON);
  list.over(LISBON, OSLO);
  assert.deepEqual(list.marks(), ["dragged", undefined, "after", undefined]);
  list.up(LISBON);
  assert.deepEqual(list.placed.at(-1), [LISBON, 2, false]);
});

test("a drag the browser cancels, a press that doesn't move, or a press with another button saves nothing (TRA-16)", () => {
  const list = harness();
  list.down(ROME);
  list.over(ROME, KYOTO);
  list.cancel(ROME);
  assert.deepEqual(list.marks(), [undefined, undefined, undefined, undefined]);
  list.down(ROME);
  list.over(ROME, KYOTO);
  list.lose(ROME);
  assert.deepEqual(list.marks(), [undefined, undefined, undefined, undefined], "nor one whose handle lets go of the pointer");
  list.down(ROME);
  list.up(ROME);
  assert.equal(list.announcement(), "Rome stays at position 2 of 4.");
  assert.equal(list.down(ROME, { button: 2 }).pressed.defaultPrevented, false);
  assert.equal(list.down(ROME, { isPrimary: false }).pressed.defaultPrevented, false, "a second finger doesn't drag");
  assert.deepEqual(list.marks(), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(list.placed, []);
});

test("near the window's top or bottom, a dragged trip scrolls the page every frame and aims at the card that comes under the pointer (TRA-16)", () => {
  const list = harness();
  list.down(KYOTO, { y: 400 });
  assert.equal(list.frames.size, 1, "frames run while the pointer drags");
  list.frame(null);
  assert.deepEqual(list.scrolled, [], "away from the edges nothing scrolls");
  list.over(KYOTO, OSLO, { y: 20 });
  list.frame(ROME);
  list.frame(ROME);
  assert.deepEqual(list.scrolled, [-15, -15], "near the top the page scrolls up, faster nearer the edge");
  assert.deepEqual(list.marks(), [undefined, "before", undefined, "dragged"], "and the card coming under the pointer is aimed at");
  list.over(KYOTO, null, { y: -300 });
  list.frame(null);
  assert.deepEqual(list.scrolled.at(-1), -20, "above the window a mouse scrolls it as fast as at the edge");
  list.over(KYOTO, null, { y: 790 });
  list.frame(null);
  assert.deepEqual(list.scrolled.at(-1), 17.5, "near the bottom it scrolls down");
  list.up(KYOTO);
  assert.equal(list.frames.size, 0, "frames stop with the drag");
  assert.deepEqual(list.placed, [[KYOTO, 1, false]]);

  list.key(OSLO, " ");
  assert.equal(list.frames.size, 0, "a trip picked up from the keyboard scrolls only to show its aim");
});

test("while trips can't move, as during a search, a sort (TRA-177), a save or with one trip, every handle is disabled and does nothing (TRA-16)", () => {
  const list = harness({ enabled: false });
  assert.equal(list.handle(ROME).disabled, true);
  assert.equal(list.key(ROME, " ").defaultPrevented, false);
  assert.equal(list.down(ROME).pressed.defaultPrevented, false);
  assert.deepEqual(list.marks(), [undefined, undefined, undefined, undefined]);
  assert.deepEqual([list.placed, list.frames.size, list.announcement()], [[], 0, ""]);
});
