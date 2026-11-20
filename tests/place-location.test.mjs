import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as coordinates from "../src/lib/coordinates.ts";

// TRA-150: a hotel's, activity's, restaurant's or church's address and coordinates in its editor, run with a small hook
// harness that keeps state between renders, as React does. No browser is involved.
const element = (type, props, key) => ({ type, props, key });
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node === null || node === undefined || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props.children);

function load(state) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/place-location.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require(name) {
      if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      const modules = {
        react: { useState(initial) { const index = state.cursor++; if (!(index in state.hooks)) state.hooks[index] = initial; return [state.hooks[index], (value) => { state.hooks[index] = value; }]; } },
        "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
        "@/lib/coordinates": coordinates,
      };
      if (!(name in modules)) throw new Error("Unexpected component import: " + name);
      return modules[name];
    },
  });
  return exports;
}

/** The fields for a place saved with `address` and `saved` coordinates, rendered again after each change. */
function fields(address, saved, disabled = false) {
  const state = { hooks: [], cursor: 0 };
  const { PlaceLocationFields } = load(state);
  let tree;
  const render = () => { state.cursor = 0; tree = PlaceLocationFields({ label: "Address or neighborhood", placeholder: "Optional", address, coordinates: saved, disabled }); };
  render();
  const input = (name, value) => nodes(tree).find((node) => node.type === "input" && node.props.name === name && (value === undefined || node.props.value === value));
  return {
    input,
    /** Types into a field, as its change event sets it. */
    type(name, value) { input(name).props.onChange({ target: { value } }); render(); },
    choose(value) { input("accuracy", value).props.onChange(); render(); },
    confirming: () => input("coordinatesConfirmed") !== undefined,
    note: () => nodes(tree).filter((node) => node.type === "p").map(text).at(-1),
    tree: () => tree,
  };
}

const RENTAL = { latitude: 48.2167, longitude: 16.3958, accuracy: "approximate", review: false };

test("a place's editor shows its address and saved coordinates, and needs both degrees and an accuracy once either is entered", () => {
  const editor = fields("Address withheld", RENTAL);
  assert.deepEqual(["address", "latitude", "longitude"].map((name) => editor.input(name).props.value), ["Address withheld", "48.2167", "16.3958"]);
  assert.deepEqual([editor.input("accuracy", "exact").props.checked, editor.input("accuracy", "approximate").props.checked], [false, true]);
  assert.deepEqual(["latitude", "longitude"].map((name) => { const { type, min, max, step } = editor.input(name).props; return { type, min, max, step }; }),
    [{ type: "number", min: "-90", max: "90", step: "any" }, { type: "number", min: "-180", max: "180", step: "any" }], "the browser keeps each in range, to any precision");
  assert.equal(editor.input("address").props.maxLength, 500);
  const empty = fields("", null);
  assert.deepEqual(["latitude", "longitude"].map((name) => empty.input(name).props.value), ["", ""]);
  const required = () => [empty.input("latitude").props.required, empty.input("longitude").props.required, empty.input("accuracy", "exact").props.required, empty.input("accuracy", "approximate").props.required];
  assert.deepEqual(required(), [false, false, false, false], "a place needs no coordinates");
  empty.type("longitude", "15.33437");
  assert.deepEqual(required(), [true, true, true, true], "one degree needs the other and an accuracy");
  empty.type("longitude", " ");
  assert.deepEqual(required(), [false, false, false, false]);
  assert.equal(empty.confirming(), false, "a place without coordinates has none to confirm");
  // Saving is closed to changes, address included.
  const busy = fields("Address withheld", RENTAL, true);
  assert.equal(busy.input("address").props.disabled, true);
  assert.equal(nodes(busy.tree()).find((node) => node.type === "fieldset").props.disabled, true);
});

test("a new address asks to confirm the saved coordinates for it, unless they are changed or cleared", () => {
  const editor = fields("Address withheld", RENTAL);
  assert.equal(editor.confirming(), false);
  editor.type("address", "  Address withheld ");
  assert.equal(editor.confirming(), false, "the same address with spaces around it is no change");
  editor.type("address", "Praterstraße 10, Wien");
  assert.equal(editor.confirming(), true);
  assert.equal(editor.note(), "The address is different from when these coordinates were saved. Unless you confirm them for it, change them or clear them, the map won't use them.");
  assert.equal(editor.input("coordinatesConfirmed").props.type, "checkbox");
  // New coordinates are for the new address, and so is removing them.
  editor.type("latitude", "48.2176");
  assert.equal(editor.confirming(), false);
  editor.type("latitude", "48.21670");
  assert.equal(editor.confirming(), true, "the same number again is unchanged");
  editor.choose("exact");
  assert.equal(editor.confirming(), false, "a new accuracy is a change");
  editor.choose("approximate");
  editor.type("latitude", "");
  editor.type("longitude", "");
  assert.equal(editor.confirming(), false);
  // Coordinates already waiting for review ask at once.
  assert.equal(fields("Praterstraße 10, Wien", { ...RENTAL, review: true }).confirming(), true);
});

test("a place's details show its coordinates, latitude first, with their accuracy, and say when they wait for review", () => {
  const { CoordinatesDetail } = load({ hooks: [], cursor: 0 });
  assert.equal(text(CoordinatesDetail({ coordinates: null })), "Not added");
  assert.equal(text(CoordinatesDetail({ coordinates: RENTAL })), "48.2167, 16.3958Approximate");
  assert.equal(text(CoordinatesDetail({ coordinates: { latitude: -33.85678, longitude: 151.21529, accuracy: "exact", review: true } })),
    "-33.85678, 151.21529Exact. The address changed after they were saved, so the map doesn't use them until they're confirmed in the editor.");
});
