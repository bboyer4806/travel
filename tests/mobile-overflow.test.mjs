import assert from "node:assert/strict";
import test from "node:test";
import { cssRules } from "./css-rules.mjs";

// TRA-157: nothing on a page reaches past a phone's screen, so no page scrolls sideways. Each fix is in the styles of
// what was wider than the screen, checked here rule by rule; no rule hides a page's overflow instead.
const GLOBALS = "../src/app/globals.css";
/** Every rule for `selector` in a CSS file, alone or in a list, at every screen width: its declarations and at-rule. */
const rulesFor = (file, selector) => cssRules(file).filter(([selectors]) => selectors.split(",").some((part) => part.trim() === selector))
  .map(([, declarations, atRule]) => ({ declarations, atRule }));
/** The values a CSS file gives `property` for `selector`, by at-rule, or "" outside one. */
const values = (file, selector, property) => Object.fromEntries(rulesFor(file, selector).filter(({ declarations }) => property in declarations)
  .map(({ declarations, atRule }) => [atRule ?? "", declarations[property]]));

test("a trip's page and an idea list keep the screen's width, however wide their content (TRA-157)", () => {
  // A track of 1fr is at least as wide as its widest content, which then widens the page; minmax(0,1fr) never is.
  assert.deepEqual(values(GLOBALS, ".trip-layout", "grid-template-columns"), { "": "minmax(0,1fr) 294px", "@media(max-width:1080px)": "minmax(0,1fr) 260px", "@media(max-width:780px)": "minmax(0,1fr)" });
  assert.deepEqual(values(GLOBALS, ".ideas-grid", "grid-template-columns"), { "": "repeat(2,minmax(0,1fr))", "@media(max-width:540px)": "minmax(0,1fr)" });
  // A trip's or destination's name and details narrow with the screen beside its buttons, which wrap within its width.
  assert.deepEqual(values(GLOBALS, ".trip-heading>div:first-child", "min-width"), { "": "0" });
  assert.deepEqual(rulesFor(GLOBALS, ".heading-actions").map(({ declarations, atRule }) => [atRule, declarations["flex-wrap"], declarations["max-width"]]), [[null, "wrap", "100%"], ["@media(max-width:780px)", undefined, undefined]]);
  // An idea's price and its button share a line only while both fit, on phones too.
  assert.deepEqual(values(GLOBALS, ".idea-bottom", "flex-wrap"), { "@media(max-width:1080px)": "wrap" });
  // A trip's tag field narrows with a phone's screen rather than keeping the width its own size gives it.
  assert.deepEqual(values("../src/components/trip-tags.module.css", ".add", "min-width"), { "@media(max-width:540px)": "0" });
});

test("what people and assistants write wraps within the screen, a long link or word included (TRA-157)", () => {
  for (const [file, selectors] of [
    // A trip's focus on its card (TRA-168).
    [GLOBALS, [".trip-meta", ".destination-name p", ".list-intro", ".helper", ".form-error", ".destination-budget-total small", ".budget-breakdown dt small", ".budget-category dt small", ".trip-focus"]],
    ["../src/components/destination-map.module.css", [".unmapped > p", ".credit"]],
    // The Destinations page's map: its Not on the map list and the names in a shared marker's popup (TRA-180).
    ["../src/components/destinations-map.module.css", [".unmapped > p", ".unmapped li", ".frame .popupList a", ".credit"]],
    // A layover plan's notes name the layover's place (TRA-45).
    ["../src/components/layover-plan.module.css", [".note"]],
    ["../src/app/ai/ai.module.css", [".change h2"]],
    // A packing item's name, and a recommendation's name and reasons (TRA-18).
    ["../src/components/packing-list.module.css", [".text", ".reviewItem > span"]],
    // A trip's Best time to go notes (TRA-178).
    ["../src/components/trip-best-time.module.css", [".note"]],
  ]) {
    for (const selector of selectors) assert.deepEqual(values(file, selector, "overflow-wrap"), { "": "anywhere" }, selector);
  }
});

test("no page hides what reaches past the screen in place of fixing it (TRA-157)", () => {
  for (const selector of ["html", "body", "*", ".app-shell", ".main-content", ".site-header", ".site-footer"]) {
    for (const { declarations } of rulesFor(GLOBALS, selector)) {
      for (const property of ["overflow", "overflow-x", "overflow-inline"]) assert.equal(declarations[property], undefined, `${selector} ${property}`);
    }
  }
});
