import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { HEALTH_SAFETY_FIELDS, MAX_EMERGENCY_CONTACTS, healthSafetyFromForm, normalizeHealthSafety } from "../src/lib/health-safety.ts";

const contact = (extra = {}) => ({ id: randomUUID(), name: "Emergency services", phone: "112", notes: "Police, fire and ambulance", ...extra });
const source = (extra = {}) => ({ id: randomUUID(), url: "https://example.gov/advisory", description: "Government travel advisory", ...extra });

test("health and safety research normalizes manual fields without inventing information or a checked date", () => {
  assert.equal(normalizeHealthSafety(null), null);
  const empty = normalizeHealthSafety({});
  for (const { name } of HEALTH_SAFETY_FIELDS) assert.equal(empty[name], "");
  assert.deepEqual(empty.emergencyContacts, []);
  assert.deepEqual(empty.sources, []);
  assert.equal(empty.lastCheckedDate, null);
  const person = contact({ name: " Embassy ", phone: " +1 (202) 555-0100 ", notes: " Ask for the duty officer " });
  const link = source({ url: " https://example.gov ", description: " Official advisory " });
  const input = { advisoryLevel: " Level 2: Exercise increased caution ", localSafety: " Pickpockets on trams\nTaxi scams at the airport ", emergencyContacts: [person], sources: [link], lastCheckedDate: " 2028-02-29 " };
  assert.deepEqual(normalizeHealthSafety(input), {
    ...empty, advisoryLevel: "Level 2: Exercise increased caution", localSafety: "Pickpockets on trams\nTaxi scams at the airport",
    emergencyContacts: [{ ...person, name: "Embassy", phone: "+1 (202) 555-0100", notes: "Ask for the duty officer" }],
    sources: [{ ...link, url: "https://example.gov/", description: "Official advisory" }], lastCheckedDate: "2028-02-29",
  });
  assert.equal(input.emergencyContacts[0].name, " Embassy ", "normalizing does not mutate the draft");
  assert.equal(normalizeHealthSafety({ lastCheckedDate: "  " }).lastCheckedDate, null);
  assert.equal(normalizeHealthSafety({ unexpected: "dropped" }).unexpected, undefined, "only known fields are saved");
});

test("health and safety research rejects malformed records, non-text fields, and excessive field lengths", () => {
  for (const value of [undefined, false, 123, "advisory", []]) assert.throws(() => normalizeHealthSafety(value));
  for (const { name, maxLength } of HEALTH_SAFETY_FIELDS) {
    for (const value of [null, 123, [], {}]) assert.throws(() => normalizeHealthSafety({ [name]: value }), /must be text/);
    assert.equal(normalizeHealthSafety({ [name]: "x".repeat(maxLength) })[name].length, maxLength);
    assert.throws(() => normalizeHealthSafety({ [name]: "x".repeat(maxLength + 1) }), /characters or fewer/);
  }
});

test("last checked dates must be real calendar dates without timezone conversion", () => {
  for (const lastCheckedDate of ["0001-01-01", "2028-02-29", "9999-12-31"]) assert.equal(normalizeHealthSafety({ lastCheckedDate }).lastCheckedDate, lastCheckedDate);
  for (const lastCheckedDate of ["0000-01-01", "2027-02-29", "2028-02-30", "2027-13-01", "2027-01-32", "11/03/2026", "2027-1-1", 123, {}, "2027-01-01T00:00:00Z"]) assert.throws(() => normalizeHealthSafety({ lastCheckedDate }));
});

test("each emergency contact needs a name and a phone number, with optional notes", () => {
  const saved = normalizeHealthSafety({ emergencyContacts: [contact(), contact({ name: "Travel insurer", phone: "+44 20 7946 0000", notes: undefined })] }).emergencyContacts;
  assert.equal(saved.length, 2);
  assert.equal(saved[1].notes, "", "notes are optional");
  for (const [extra, message] of [
    [{ name: "" }, /Enter a name/], [{ name: "   " }, /Enter a name/], [{ name: undefined }, /Enter a name/],
    [{ phone: "" }, /Enter a phone number/], [{ phone: " " }, /Enter a phone number/], [{ phone: undefined }, /Enter a phone number/],
    [{ name: 12 }, /must be text/], [{ phone: 112 }, /must be text/], [{ notes: [] }, /must be text/],
    [{ name: "x".repeat(161) }, /160 characters or fewer/], [{ phone: "1".repeat(41) }, /40 characters or fewer/], [{ notes: "x".repeat(501) }, /500 characters or fewer/],
  ]) assert.throws(() => normalizeHealthSafety({ emergencyContacts: [contact(extra)] }), message, JSON.stringify(extra));
  assert.equal(normalizeHealthSafety({ emergencyContacts: [contact({ name: "x".repeat(160), phone: "1".repeat(40), notes: "x".repeat(500) })] }).emergencyContacts[0].notes.length, 500);
});

test("phone numbers use digits and the separators phone numbers are written with", () => {
  for (const phone of ["112", "911", "+351 21 727 3300", "(+33) 1 43 12 22 22", "1-888-407-4747", "020.7946.0000"]) {
    assert.equal(normalizeHealthSafety({ emergencyContacts: [contact({ phone })] }).emergencyContacts[0].phone, phone);
  }
  for (const phone of ["call the front desk", "+-()", "112 or 911", "555-0100 ext. 2", "1-800-FLOWERS", "112\n911", "١١٢"]) {
    assert.throws(() => normalizeHealthSafety({ emergencyContacts: [contact({ phone })] }), /phone number/, phone);
  }
});

test("emergency contacts are a bounded list with unique identifiers", () => {
  for (const emergencyContacts of [null, "112", {}, [null], [[]], ["112"], [contact({ id: "wrong" })], [contact({ id: 7 })]]) assert.throws(() => normalizeHealthSafety({ emergencyContacts }));
  const person = contact();
  assert.throws(() => normalizeHealthSafety({ emergencyContacts: [person, { ...person, id: person.id.toUpperCase() }] }), /unique identifier/);
  assert.equal(normalizeHealthSafety({ emergencyContacts: Array.from({ length: MAX_EMERGENCY_CONTACTS }, () => contact()) }).emergencyContacts.length, MAX_EMERGENCY_CONTACTS);
  assert.throws(() => normalizeHealthSafety({ emergencyContacts: Array.from({ length: MAX_EMERGENCY_CONTACTS + 1 }, () => contact()) }), /up to 20 emergency contacts/);
});

test("source links require HTTP or HTTPS without credentials, bounded text, and unique identifiers", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/source", "ftp://example.gov", "https://name:secret@example.gov/", "http://name@example.gov/", "not-a-url", ""]) assert.throws(() => normalizeHealthSafety({ sources: [source({ url })] }));
  for (const url of ["https://example.gov/advisory", "http://example.gov/advisory"]) assert.equal(normalizeHealthSafety({ sources: [source({ url })] }).sources[0].url, url);
  for (const sources of [null, "source", {}, [null], [[]], [source({ id: "wrong" })], [source({ description: 12 })], [source({ description: "x".repeat(161) })], [source({ url: "https://example.gov/" + "x".repeat(2048) })]]) assert.throws(() => normalizeHealthSafety({ sources }));
  const link = source();
  assert.throws(() => normalizeHealthSafety({ sources: [link, { ...link, id: link.id.toUpperCase() }] }), /unique identifier/);
  assert.equal(normalizeHealthSafety({ sources: Array.from({ length: 20 }, () => source()) }).sources.length, 20);
  assert.throws(() => normalizeHealthSafety({ sources: Array.from({ length: 21 }, () => source()) }), /up to 20/);
  assert.equal(normalizeHealthSafety({ sources: [source({ description: undefined })] }).sources[0].description, "");
});

test("the form draft preserves fields, contacts, links and an explicitly chosen last checked date", () => {
  const fields = new FormData();
  for (const { name } of HEALTH_SAFETY_FIELDS) fields.set(name, `value for ${name}`);
  fields.set("lastCheckedDate", "2026-11-12");
  const contacts = [contact()];
  const sources = [source()];
  const result = healthSafetyFromForm(fields, contacts, sources);
  for (const { name } of HEALTH_SAFETY_FIELDS) assert.equal(result[name], `value for ${name}`);
  assert.deepEqual(result.emergencyContacts, contacts);
  assert.deepEqual(result.sources, sources);
  assert.equal(result.lastCheckedDate, "2026-11-12");
  assert.equal(healthSafetyFromForm(new FormData(), [], []).lastCheckedDate, null);
});
