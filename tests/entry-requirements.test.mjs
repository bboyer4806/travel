import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ENTRY_REQUIREMENT_FIELDS, entryRequirementsFromForm, normalizeEntryRequirements } from "../src/lib/entry-requirements.ts";

const source = (extra = {}) => ({ id: randomUUID(), url: "https://example.gov/entry", description: "Official entry guidance", ...extra });

test("entry research normalizes manual fields without inventing requirements or a checked date", () => {
  assert.equal(normalizeEntryRequirements(null), null);
  const empty = normalizeEntryRequirements({});
  for (const { name } of ENTRY_REQUIREMENT_FIELDS) assert.equal(empty[name], "");
  assert.deepEqual(empty.sources, []);
  assert.equal(empty.lastCheckedDate, null);
  const link = source({ url: " https://example.gov ", description: " Official guidance " });
  const input = { passportNationality: " US ", travelPurpose: " Tourism ", notes: " Remember to verify\nagain ", sources: [link], lastCheckedDate: " 2028-02-29 " };
  assert.deepEqual(normalizeEntryRequirements(input), { ...empty, passportNationality: "US", travelPurpose: "Tourism", notes: "Remember to verify\nagain", sources: [{ ...link, url: "https://example.gov/", description: "Official guidance" }], lastCheckedDate: "2028-02-29" });
  assert.equal(input.sources[0].url, " https://example.gov ", "normalizing does not mutate the draft");
  assert.equal(normalizeEntryRequirements({ lastCheckedDate: "  " }).lastCheckedDate, null);
});

test("entry research rejects malformed records, non-text fields, and excessive field lengths", () => {
  for (const value of [undefined, false, 123, "requirements", []]) assert.throws(() => normalizeEntryRequirements(value));
  for (const { name, maxLength } of ENTRY_REQUIREMENT_FIELDS) {
    for (const value of [null, 123, [], {}]) assert.throws(() => normalizeEntryRequirements({ [name]: value }));
    assert.equal(normalizeEntryRequirements({ [name]: "x".repeat(maxLength) })[name].length, maxLength);
    assert.throws(() => normalizeEntryRequirements({ [name]: "x".repeat(maxLength + 1) }), /characters or fewer/);
  }
});

test("last checked dates must be real calendar dates without timezone conversion", () => {
  for (const lastCheckedDate of ["0001-01-01", "2028-02-29", "9999-12-31"]) assert.equal(normalizeEntryRequirements({ lastCheckedDate }).lastCheckedDate, lastCheckedDate);
  for (const lastCheckedDate of ["0000-01-01", "2027-02-29", "2028-02-30", "2027-13-01", "2027-01-32", "11/03/2026", "2027-1-1", 123, {}, "2027-01-01T00:00:00Z"]) assert.throws(() => normalizeEntryRequirements({ lastCheckedDate }));
});

test("source links require HTTP or HTTPS without credentials, bounded text, and unique identifiers", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/source", "ftp://example.gov", "https://name:secret@example.gov/", "http://name@example.gov/", "not-a-url", ""]) assert.throws(() => normalizeEntryRequirements({ sources: [source({ url })] }));
  for (const url of ["https://example.gov/entry", "http://example.gov/entry"]) assert.equal(normalizeEntryRequirements({ sources: [source({ url })] }).sources[0].url, url);
  for (const sources of [null, "source", {}, [null], [[]], [source({ id: "wrong" })], [source({ description: 12 })], [source({ description: "x".repeat(161) })], [source({ url: "https://example.gov/" + "x".repeat(2048) })]]) assert.throws(() => normalizeEntryRequirements({ sources }));
  const link = source();
  assert.throws(() => normalizeEntryRequirements({ sources: [link, { ...link, id: link.id.toUpperCase() }] }), /unique identifier/);
  assert.equal(normalizeEntryRequirements({ sources: Array.from({ length: 20 }, () => source()) }).sources.length, 20);
  assert.throws(() => normalizeEntryRequirements({ sources: Array.from({ length: 21 }, () => source()) }), /up to 20/);
  assert.equal(normalizeEntryRequirements({ sources: [source({ description: undefined })] }).sources[0].description, "");
});

test("the form draft preserves fields, links and an explicitly chosen last checked date", () => {
  const fields = new FormData();
  for (const { name } of ENTRY_REQUIREMENT_FIELDS) fields.set(name, `value for ${name}`);
  fields.set("lastCheckedDate", "2026-11-03");
  const sources = [source()];
  const result = entryRequirementsFromForm(fields, sources);
  for (const { name } of ENTRY_REQUIREMENT_FIELDS) assert.equal(result[name], `value for ${name}`);
  assert.deepEqual(result.sources, sources);
  assert.equal(result.lastCheckedDate, "2026-11-03");
  assert.equal(entryRequirementsFromForm(new FormData(), []).lastCheckedDate, null);
});
