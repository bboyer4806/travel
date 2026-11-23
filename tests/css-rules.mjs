import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Each rule in a CSS file, by its path from tests, in order: its selector, its declarations by property, and the at-rule
 * it is in, such as `@media(max-width:540px)` without spaces around its parentheses and colons, or null outside one. A
 * rule in a media query is listed in its place, as any other.
 */
export function cssRules(file) {
  const css = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = (text, atRule) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), Object.fromEntries(body.split(";").filter((declaration) => declaration.trim())
    .map((declaration) => [declaration.slice(0, declaration.indexOf(":")).trim(), declaration.slice(declaration.indexOf(":") + 1).trim()])), atRule]);
  return [...css.matchAll(/(@[^{};]+)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}|[^{}@;]+\{[^{}]*\}/g)].flatMap(([block, atRule, inner]) => atRule === undefined
    ? rules(block, null) : rules(inner, atRule.replace(/\s+/g, " ").trim().replace(/ ?([():,]) ?/g, "$1")));
}

/** The declarations of the one rule for a selector, alone or after another, in a CSS file, so no rule for another screen width changes it. */
export function onlyRule(file, selector) {
  const rules = cssRules(file).filter(([selectors]) => selectors.split(",").map((part) => part.trim()).some((part) => part === selector || part.endsWith(" " + selector)));
  assert.equal(rules.length, 1, selector);
  return rules[0][1];
}

/** A mouse or trackpad, and a touchscreen, as media queries describe them. */
export const MOUSE = { pointer: "fine", hover: "hover" };
export const TOUCH = { pointer: "coarse", hover: "none" };
/** Whether an at-rule holds on a screen `width` pixels wide used with `input`. These rules depend only on those. */
export function holds(atRule, width, input) {
  if (atRule === null) return true;
  const [, feature, value] = atRule.match(/^@media\(([a-z-]+):([a-z0-9]+)\)$/) ?? assert.fail("Unexpected at-rule " + atRule);
  if (feature === "max-width" || feature === "min-width") {
    const pixels = Number(value.match(/^(\d+)px$/)?.[1] ?? assert.fail("Unexpected width " + value));
    return feature === "max-width" ? width <= pixels : width >= pixels;
  }
  assert.ok(feature in input, "Unexpected media feature " + feature);
  return input[feature] === value;
}
/**
 * The declarations a CSS file, by its path from tests, gives an element matched by any of `selectors` on a screen
 * `width` pixels wide used with `input`, each rule over the ones before it, as these rules' specificities agree.
 */
export function styles(file, selectors, width, input = MOUSE) {
  return Object.assign({}, ...cssRules(file).filter(([selector, , atRule]) => selector.split(",").some((part) => selectors.includes(part.trim())) && holds(atRule, width, input))
    .map(([, declarations]) => declarations));
}
