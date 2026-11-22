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

/** WCAG's contrast between two colors written as #rrggbb. */
export function contrast(first, second) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
