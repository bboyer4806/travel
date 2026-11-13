import assert from "node:assert/strict";
import test from "node:test";
import { cleanTagName, hasEveryTag, tagKey } from "../src/lib/trip-tags.ts";

test("a tag is saved trimmed, with single spaces, in one Unicode form", () => {
  assert.equal(cleanTagName("  Family \t  Vacation \n"), "Family Vacation");
  assert.equal(cleanTagName("Café crawl"), "Café crawl");
  assert.equal(cleanTagName("   "), "");
});

test("names that differ only in letter case, spacing or Unicode form are the same tag", () => {
  assert.equal(tagKey(" EUROPE "), tagKey("europe"));
  assert.equal(tagKey("Family  Vacation"), "family vacation");
  assert.equal(tagKey("CAFÉ"), tagKey("café"));
  assert.notEqual(tagKey("Beach"), tagKey("Beaches"));
});

test("a trip matches the tag filter only when it has every selected tag", () => {
  const tags = ["Beach", "Europe", "Family Vacation"];
  assert.equal(hasEveryTag(tags, []), true, "no selection shows every trip");
  assert.equal(hasEveryTag([], []), true, "including trips without tags");
  assert.equal(hasEveryTag(tags, ["Europe"]), true);
  assert.equal(hasEveryTag(tags, ["Europe", "Beach"]), true);
  assert.equal(hasEveryTag(tags, ["europe", " family vacation "]), true, "compared as the same tag");
  assert.equal(hasEveryTag(tags, ["Europe", "Ski"]), false, "one missing tag hides the trip");
  assert.equal(hasEveryTag([], ["Europe"]), false);
});
