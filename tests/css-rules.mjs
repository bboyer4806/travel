import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Each rule in a CSS file, by its path from tests: its selector and its declarations by property. A rule in a media query is listed as any other. */
export function cssRules(file) {
  const css = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), Object.fromEntries(body.split(";").filter((declaration) => declaration.trim())
    .map((declaration) => [declaration.slice(0, declaration.indexOf(":")).trim(), declaration.slice(declaration.indexOf(":") + 1).trim()]))]);
}

/** The declarations of the one rule for a selector, alone or after another, in a CSS file, so no rule for another screen width changes it. */
export function onlyRule(file, selector) {
  const rules = cssRules(file).filter(([selectors]) => selectors.split(",").map((part) => part.trim()).some((part) => part === selector || part.endsWith(" " + selector)));
  assert.equal(rules.length, 1, selector);
  return rules[0][1];
}
