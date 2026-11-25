import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as coordinates from "../src/lib/coordinates.ts";
import * as healthSafety from "../src/lib/health-safety.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { PLANNER_UPDATED } from "../src/lib/planner-updated.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as uuid from "../src/lib/uuid.ts";
import { aiSetup, NOW } from "./ai-fixtures.mjs";
import { addCity, addDestination, fileDatabase, setup, tripInput } from "./budget-fixtures.mjs";
import { contrast, cssRules, styles } from "./css-rules.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

// TRA-173: each destination's local emergency number, such as 112 or 911, verified from an official or reliable source,
// first in its Health and safety section whether the section is open or closed, in large text with a Call link, or
// "Emergency number not verified" with nothing to call.

const { EMERGENCY_NUMBER_MAX_LENGTH, GIVE_EMERGENCY_NUMBER, healthSafetyFromForm, normalizeHealthSafety, providerDraft } = healthSafety;
const NOT_AVAILABLE = "This item no longer exists or isn't shared with you. Please refresh and try again.";
const NO_PHONE = "Enter the local emergency number, or clear its source and verified date.";
const NO_SOURCE = "Enter the website address of the source that verifies the local emergency number.";
const NO_DATE = "Enter the date the local emergency number was verified.";
const BAD_SOURCE = "Enter the local emergency number's source starting with https:// or http://, without a username or password.";
const BAD_PHONE = "Enter each phone number using only digits, spaces, plus signs, parentheses, hyphens, and periods.";
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
/** Portugal's emergency number, as verified on an official page. */
const verified = (overrides = {}) => ({ phone: "112", sourceUrl: "https://www.portugal.gov.pt/emergency", verifiedDate: "2026-11-21", ...overrides });
/** Health and safety research as its editor saves it, with an emergency services contact and no emergency number unless `overrides` gives one. */
const research = (overrides = {}) => ({
  advisoryLevel: "Level 1: Exercise normal precautions", advisoryWarnings: "", healthPrecautions: "Routine vaccines", localSafety: "Pickpockets on trams",
  emergencyContacts: [{ id: randomUUID(), name: "Emergency services", phone: "112", notes: "Police, fire and ambulance" }, { id: randomUUID(), name: "U.S. Embassy", phone: "+351 21 727 3300", notes: "" }],
  sources: [{ id: randomUUID(), url: "https://travel.state.gov/", description: "U.S. travel advisory" }],
  lastCheckedDate: "2026-11-10", usAdvisoryLevel: 1, medicalProviders: [], emergencyNumber: null, ...overrides,
});
/** A record without its emergency number, as the editor of a page opened before it saves it. */
const withoutNumber = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== "emergencyNumber"));
const save = (id, record) => ({ type: "destination.healthSafety", id, healthSafety: record });
const saved = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id).healthSafety;
const refuses = (number, message) => assert.throws(() => normalizeHealthSafety(research({ emergencyNumber: number })), { message }, JSON.stringify(number));

test("a record keeps one verified emergency number, its source and its verified date, all three, or none (TRA-173)", () => {
  assert.equal(normalizeHealthSafety(research()).emergencyNumber, null, "none is assumed, even beside an emergency services contact");
  assert.deepEqual(normalizeHealthSafety(research({ emergencyNumber: verified() })).emergencyNumber, verified());
  // Trimmed, with the source's address as the URL parser writes it, and nothing else kept.
  assert.deepEqual(normalizeHealthSafety(research({ emergencyNumber: { phone: " 112 ", sourceUrl: " https://Example.gov ", verifiedDate: " 2028-02-29 ", notes: "dropped" } })).emergencyNumber,
    { phone: "112", sourceUrl: "https://example.gov/", verifiedDate: "2028-02-29" });
  for (const phone of ["911", "999", "000", "110", "+1 911", "(112)"]) assert.equal(normalizeHealthSafety(research({ emergencyNumber: verified({ phone }) })).emergencyNumber.phone, phone);
  assert.equal(normalizeHealthSafety(research({ emergencyNumber: verified({ phone: "1".repeat(EMERGENCY_NUMBER_MAX_LENGTH.phone) }) })).emergencyNumber.phone.length, EMERGENCY_NUMBER_MAX_LENGTH.phone);
  // A number is never saved unverified: without its source or date, it is refused.
  for (const phone of [undefined, "", "   "]) refuses(verified({ phone }), NO_PHONE);
  for (const sourceUrl of [undefined, "", "  "]) refuses(verified({ sourceUrl }), NO_SOURCE);
  for (const verifiedDate of [undefined, null, "", " "]) refuses(verified({ verifiedDate }), NO_DATE);
  refuses({ phone: "", sourceUrl: "", verifiedDate: "" }, NO_PHONE);
  for (const phone of ["call 112", "112 or 911", "+-()", "١١٢"]) refuses(verified({ phone }), BAD_PHONE);
  for (const sourceUrl of ["example.gov", "javascript:alert(1)", "ftp://example.gov/", "https://name:secret@example.gov/"]) refuses(verified({ sourceUrl }), BAD_SOURCE);
  for (const verifiedDate of ["2026-02-30", "11/21/2026", "2026-1-1"]) refuses(verified({ verifiedDate }), "Enter a valid emergency number verified date in YYYY-MM-DD format.");
  refuses(verified({ phone: "1".repeat(EMERGENCY_NUMBER_MAX_LENGTH.phone + 1) }), `Local emergency number must be ${EMERGENCY_NUMBER_MAX_LENGTH.phone} characters or fewer.`);
  refuses(verified({ sourceUrl: "https://example.gov/" + "x".repeat(EMERGENCY_NUMBER_MAX_LENGTH.sourceUrl) }), `Local emergency number source must be ${EMERGENCY_NUMBER_MAX_LENGTH.sourceUrl} characters or fewer.`);
  refuses(verified({ phone: 112 }), "Local emergency number must be text.");
  // Every record gives it: left out, or anything but a number's record or null, is refused, never taken as none.
  for (const value of [undefined, "112", 112, true, [], [verified()]]) refuses(value, GIVE_EMERGENCY_NUMBER);
  assert.throws(() => normalizeHealthSafety(withoutNumber(research())), { message: GIVE_EMERGENCY_NUMBER });
});

test("the editor's fields give no number when all three are blank, and otherwise the number as typed for the store to check (TRA-173)", () => {
  const form = (phone, sourceUrl, verifiedDate) => {
    const fields = new FormData();
    fields.set("emergencyPhone", phone);
    fields.set("emergencySourceUrl", sourceUrl);
    fields.set("emergencyVerifiedDate", verifiedDate);
    return fields;
  };
  assert.equal(healthSafetyFromForm(new FormData(), [], [], []).emergencyNumber, null);
  assert.equal(healthSafetyFromForm(form("", " ", ""), [], [], []).emergencyNumber, null, "clearing all three removes it");
  assert.deepEqual(healthSafetyFromForm(form("112", "https://www.portugal.gov.pt/emergency", "2026-11-21"), [], [], []).emergencyNumber, verified());
  // One filled in without the others is sent as typed, and the store says what is missing.
  const partial = healthSafetyFromForm(form("112", "", ""), [], [], []);
  assert.deepEqual(partial.emergencyNumber, { phone: "112", sourceUrl: "", verifiedDate: "" });
  assert.throws(() => normalizeHealthSafety(partial), { message: NO_SOURCE });
  assert.throws(() => normalizeHealthSafety(healthSafetyFromForm(form("112", "https://example.gov/", ""), [], [], [])), { message: NO_DATE });
  assert.throws(() => normalizeHealthSafety(healthSafetyFromForm(form("", "https://example.gov/", "2026-11-21"), [], [], [])), { message: NO_PHONE });
});

test("the number saves with its destination, changes and clears, every page shows it, reopening keeps it, and the emergency contacts stay as they were (TRA-173)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Lisbon", nights: 3 });
    const porto = addDestination(store, tripId, { city: "Porto", nights: 2 });
    const record = research();
    store.applyMutation(save(id, record));
    store.applyMutation(save(porto, research({ emergencyNumber: verified({ verifiedDate: "2026-11-01" }) })));
    for (const number of [verified(), verified({ phone: "+351 112", verifiedDate: "2026-11-22" }), null, verified()]) {
      store.applyMutation(save(id, { ...record, emergencyNumber: number }));
      store.close(); store = null;
      store = createOwnedStore(path);
      assert.deepEqual(saved(store, id), { ...record, emergencyNumber: number }, "reopening keeps it with everything else as recorded");
    }
    // It is its own field: no emergency contact is added or changed for it.
    assert.deepEqual(saved(store, id).emergencyContacts, record.emergencyContacts);
    const lisbon = (snapshot) => snapshot.data.destinations.find((item) => item.id === id).healthSafety.emergencyNumber;
    assert.deepEqual([lisbon(store.getTripSnapshot(tripId)), lisbon(store.getDestinationSnapshot(id))], [verified(), verified()]);
    assert.equal(saved(store, porto).emergencyNumber.verifiedDate, "2026-11-01", "each destination has its own");
    store.applyMutation(save(id, null));
    assert.equal(saved(store, id), null, "Clear removes it with the record");
  } finally { store?.close(); }
});

test("changing the number changes nothing else, and a refused save, a page opened before it included, changes nothing (TRA-173)", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Lisbon", nights: 3 });
  addDestination(store, tripId, { city: "Porto", nights: 2 });
  const record = research({ emergencyNumber: verified() });
  store.applyMutation(save(id, record));
  const before = store.getSnapshot();
  const others = (snapshot) => ({ ...snapshot, destinations: snapshot.destinations.map((item) => ({ ...item, healthSafety: item.healthSafety && withoutNumber(item.healthSafety) })) });
  for (const number of [verified({ phone: "911" }), null]) {
    store.applyMutation(save(id, { ...record, emergencyNumber: number }));
    assert.deepEqual(others(store.getSnapshot()), others(before), "contacts, advisories, providers, research and everything else in Travel are as they were");
  }
  const current = store.getSnapshot();
  // A page opened before the number saves its research without it, which would clear it: it asks to reload instead.
  assert.throws(() => store.applyMutation(save(id, withoutNumber({ ...record, localSafety: "Edited on an old page" }))), refusal(PLANNER_UPDATED));
  assert.throws(() => store.applyMutation(save(addDestination(store, tripId, { city: "Faro" }), withoutNumber(research()))), refusal(PLANNER_UPDATED), "a new record too");
  const unchanged = store.getSnapshot();
  for (const [number, message] of [[verified({ sourceUrl: "" }), NO_SOURCE], [verified({ verifiedDate: null }), NO_DATE], [verified({ phone: "" }), NO_PHONE], [verified({ sourceUrl: "javascript:alert(1)" }), BAD_SOURCE], ["112", GIVE_EMERGENCY_NUMBER]]) {
    assert.throws(() => store.applyMutation(save(id, { ...record, emergencyNumber: number })), refusal(message), JSON.stringify(number));
  }
  assert.deepEqual(store.getSnapshot(), unchanged);
  assert.deepEqual(current.destinations.find((item) => item.id === id), unchanged.destinations.find((item) => item.id === id));
});

test("schema 46 research upgrades without a number, never one read from its emergency contacts, stored as a save stores it, and a replay keeps numbers verified since (TRA-173)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const [upgraded, edited] = ["Lisbon", "Porto"].map((city) => addDestination(store, tripId, { city }));
    const empty = addDestination(store, tripId, { city: "Faro" });
    const record = research();
    for (const id of [upgraded, edited]) store.applyMutation(save(id, record));
    store.close(); store = null;
    // A schema 46 database: research as TRA-172 saved it, with an emergency services contact but no emergency number.
    let db = new DatabaseSync(path);
    const json = (id) => db.prepare("SELECT healthSafetyJson FROM destination_health_safety WHERE destinationId = ?").get(id).healthSafetyJson;
    const old = withoutNumber(JSON.parse(json(upgraded)));
    db.prepare("UPDATE destination_health_safety SET healthSafetyJson = ? WHERE destinationId = ?").run(JSON.stringify(old), upgraded);
    db.exec("PRAGMA user_version = 46;");
    db.close();
    store = createOwnedStore(path);
    assert.deepEqual(saved(store, upgraded), { ...old, emergencyNumber: null }, "not verified, and its emergency contacts and research are as recorded");
    assert.equal(saved(store, empty), null, "a destination without research still has none");
    store.close(); store = null;
    db = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(json(upgraded), json(edited), "stored as a save stores it, the number last"); } finally { db.close(); }
    store = createOwnedStore(path);
    store.applyMutation(save(upgraded, { ...old, emergencyNumber: verified() }));
    const later = store.getSnapshot();
    // A replay of schema 47, also after the schema 1 build resets the schema version, keeps it.
    for (const version of [46, 1]) {
      store.close(); store = null;
      db = new DatabaseSync(path);
      db.exec(`PRAGMA user_version = ${version};`);
      db.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps the saved number`);
    }
    store.close(); store = null;
    db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { db.close(); }
  } finally { store?.close(); }
});

test("everyone who can open the destination sees its number and can change it, and no one else can (TRA-173)", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  const id = addCity((input) => store.applyMutation(owner, input).id, tripId, "Lisbon", { nights: 3 });
  store.applyMutation(owner, save(id, research({ emergencyNumber: verified() })));
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const friend = store.authorizeAccount("friend@example.test").id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  const numberFor = (account) => store.getDestinationSnapshot(account, id)?.data.destinations[0].healthSafety.emergencyNumber.phone;
  assert.deepEqual([numberFor(owner), numberFor(friend), numberFor(outsider)], ["112", "112", undefined]);
  store.applyMutation(friend, save(id, research({ emergencyNumber: verified({ phone: "+351 112" }) })));
  assert.equal(numberFor(owner), "+351 112", "someone the trip is shared with changes it");
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(outsider, save(id, research({ emergencyNumber: verified({ phone: "911" }) }))), refusal(NOT_AVAILABLE));
  store.applyMutation(owner, { type: "trip.unshare", tripId, email: "friend@example.test" });
  assert.throws(() => store.applyMutation(friend, save(id, research({ emergencyNumber: null }))), refusal(NOT_AVAILABLE), "and no longer once it isn't shared");
  assert.deepEqual(store.getSnapshot().destinations, before.destinations);
});

test("ChatGPT and Claude read the number and propose it, always giving it, and approving saves it (TRA-173)", (t) => {
  const path = fileDatabase(t);
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t, path);
  const id = store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Lisbon" }).id;
  const numberNow = () => store.aiDestination(id).destination.healthSafety?.emergencyNumber;
  const added = propose([save(id, research({ emergencyNumber: verified() }))]);
  const shown = added.preview[0].records[0].fields.find((field) => field.name === "Health and safety").after;
  assert.ok(shown.includes("emergencyNumber: phone: 112, sourceUrl: https://www.portugal.gov.pt/emergency, verifiedDate: 2026-11-21"), "the owner sees it, its source and date before deciding");
  assert.equal(numberNow(), undefined, "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.deepEqual(numberNow(), verified(), "assistants read it with the rest of the research");

  const before = store.getSnapshot();
  assert.throws(() => propose([save(id, withoutNumber(research()))]), refusal(`Change 1: ${GIVE_EMERGENCY_NUMBER}`), "leaving it out is refused, never taken as none");
  assert.throws(() => propose([save(id, research({ emergencyNumber: { phone: "112" } }))]), refusal(`Change 1: ${NO_SOURCE}`), "a number without its source is refused");
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");

  // A proposal waiting from before the number fails when approved, changing nothing; the assistant proposes it again. Its
  // change is recorded as a build before TRA-173 recorded it, lifting the trigger that keeps proposals unchanged to write it.
  const waiting = propose([save(id, research({ localSafety: "Proposed before" }))]);
  const db = new DatabaseSync(path);
  try {
    const [change] = JSON.parse(db.prepare("SELECT changesJson FROM ai_proposals WHERE id = ?").get(waiting.id).changesJson);
    const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'ai_proposals_unchanged'").get().sql;
    db.exec("DROP TRIGGER ai_proposals_unchanged;");
    db.prepare("UPDATE ai_proposals SET changesJson = ? WHERE id = ?").run(JSON.stringify([{ ...change, healthSafety: withoutNumber(change.healthSafety) }]), waiting.id);
    db.exec(trigger);
  } finally { db.close(); }
  const failed = decide(store.getAiProposal(owner, waiting.id, NOW), true);
  assert.deepEqual([failed.status, failed.error], ["failed", `Change 1: ${GIVE_EMERGENCY_NUMBER}`]);
  assert.deepEqual(store.getSnapshot(), before);

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "destination.healthSafety").properties.healthSafety;
  assert.ok(schema.required.includes("emergencyNumber"), "it is always given");
  const number = schema.properties.emergencyNumber;
  assert.deepEqual([number.type, number.additionalProperties, number.required], [["object", "null"], false, ["phone", "sourceUrl", "verifiedDate"]], "all three, or null");
  assert.deepEqual(Object.keys(number.properties), Object.keys(verified()), "it lists every field a number keeps");
  for (const words of ["official or reliable source", "never a guess", "emergencyContacts", "null when none is verified"]) assert.ok(number.description.includes(words), words);
});

// The real section and editor, rendered once with each hook's initial state. Modules they import that aren't given render,
// and return, nothing, and a CSS module's class names are their own names.
const element = (type, props) => ({ type, props });
const unused = new Proxy({}, { get: () => () => null });
const modules = {
  "react": { useId: () => "id", useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }), useEffect: () => {} },
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" }, "lucide-react": new Proxy({}, { get: (_, icon) => "icon:" + String(icon) }),
  "@/lib/health-safety": healthSafety, "@/lib/coordinates": coordinates, "@/lib/trip-dates": tripDates, "@/lib/uuid": uuid,
};
function load(file) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, require: (name) => name.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : modules[name] ?? unused });
  return exports;
}
modules["@/components/research-links"] = load("../src/components/research-links.tsx");
const component = load("../src/components/health-safety.tsx");
/** The host elements an element renders to, in order, with every component rendered, in this test's own arrays. */
function hosts(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return [...node].flatMap(hosts);
  if (typeof node.type === "function") return hosts(node.type(node.props));
  return [node, ...hosts(node.props.children)];
}
function text(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(typeof node.type === "function" ? node.type(node.props) : node.props.children);
}
/** The section as it first shows, closed: its heading, what follows it, and its content, which opening shows. */
function section(record) {
  const root = component.HealthSafetyPanel({ healthSafety: record, disabled: false, onEdit() {}, onClear() {} });
  const [heading, emergency, content] = root.props.children;
  return { heading, emergency: hosts(emergency), content };
}
const editor = (record) => hosts({ type: component.HealthSafetyEditor, props: {
  healthSafety: record, contacts: record?.emergencyContacts ?? [], onContactsChange() {}, providers: record?.medicalProviders.map(providerDraft) ?? [], onProvidersChange() {},
  sources: record?.sources ?? [], onSourcesChange() {}, disabled: false,
} });

test("the section shows the verified number first, open or closed, large, with a Call link that dials it and where and when it was verified (TRA-173)", () => {
  for (const [number, href] of [[verified(), "tel:112"], [verified({ phone: "+1 911" }), "tel:+1911"]]) {
    const { heading, emergency, content } = section(normalizeHealthSafety(research({ emergencyNumber: number })));
    assert.equal(heading.props.className, "section-heading");
    assert.equal(content.props.hidden, true, "the section starts closed");
    const box = emergency[0];
    assert.equal(box.props.className, "emergency", "right after the heading, outside the content opening shows, in its box");
    assert.equal(text(emergency.find((node) => node.type === "h5")), "Local Emergency Number");
    assert.equal(text(emergency.find((node) => node.props.className === "emergencyNumber")), number.phone, "the number in large text");
    const links = emergency.filter((node) => node.type === "a");
    assert.deepEqual(links.map((node) => [node.props.href, node.props.target ?? null, text(node)]), [
      [href, null, `Call ${number.phone}`],
      [number.sourceUrl, "_blank", "portugal.gov.pt (opens in a new tab)"],
    ], "Call opens the device's dialer with the number; the source opens in a new tab");
    assert.equal(links[0].props.className, "button secondary call", "Travel's secondary button, never its red danger button (TRA-183)");
    assert.equal(text(emergency.find((node) => node.props.className === "emergencySource")), `Verified ${tripDates.formatCalendarDate("2026-11-21")} from portugal.gov.pt (opens in a new tab)`);
    // The rest of the section is as before, the emergency contacts included.
    const inside = hosts(content);
    assert.ok(!inside.some((node) => node.type === "a" && String(node.props.href).startsWith("tel:")), "nothing else in the section calls the number");
    assert.equal(text(inside.find((node) => node.type === "ul" && node.props.className === "contacts")), "Emergency services112Police, fire and ambulanceU.S. Embassy+351 21 727 3300");
    assert.deepEqual(inside.filter((node) => node.type === "h5").map(text), ["Emergency contacts", "Non-emergency medical care", "Sources"]);
  }
});

test("without a verified number the section says so first, with nothing to call, research recorded or not (TRA-173)", () => {
  for (const record of [normalizeHealthSafety(research()), null]) {
    const { emergency, content } = section(record);
    assert.equal(emergency[0].props.className, "emergency notVerified");
    assert.deepEqual(emergency.map((node) => [node.type, text(node)]).slice(1), [["h5", "Local Emergency Number"], ["p", "Emergency number not verified"]]);
    assert.ok(!emergency.some((node) => node.type === "a"), "no Call action, nor a number to call");
    assert.ok(!hosts(content).some((node) => node.type === "a" && String(node.props.href).startsWith("tel:")), "and no emergency contact is shown as the number");
  }
});

test("the editor holds the number, its source and its verified date before the emergency contacts, all three required once any is given, and saving it unchanged saves the same record (TRA-173)", () => {
  for (const number of [null, verified()]) {
    const record = normalizeHealthSafety(research({ emergencyNumber: number }));
    const shown = editor(record);
    const legends = shown.filter((node) => node.type === "legend").map(text);
    assert.deepEqual(legends.slice(0, 3), ["Health and safety research", "Local emergency number", "Emergency contacts"], "before the emergency contacts");
    const inputs = Object.fromEntries(shown.filter((node) => node.type === "input" && String(node.props.name).startsWith("emergency")).map((node) => [node.props.name, node.props]));
    assert.deepEqual(Object.keys(inputs), ["emergencyPhone", "emergencyVerifiedDate", "emergencySourceUrl"]);
    assert.deepEqual([inputs.emergencyPhone.type, inputs.emergencyVerifiedDate.type, inputs.emergencySourceUrl.type], ["tel", "date", "url"]);
    assert.deepEqual([inputs.emergencyPhone.value, inputs.emergencySourceUrl.value, inputs.emergencyVerifiedDate.value], number ? [number.phone, number.sourceUrl, number.verifiedDate] : ["", "", ""]);
    assert.deepEqual(Object.values(inputs).map((props) => props.required), [!!number, !!number, !!number], "required once any is given, and optional while all are blank");
    // The browser submits every named field with what it holds, so saving the editor unchanged saves the record as it was.
    const form = new FormData();
    for (const field of shown.filter((node) => ["input", "select", "textarea"].includes(node.type) && node.props.name)) form.set(field.props.name, String(field.props.defaultValue ?? field.props.value));
    assert.deepEqual(normalizeHealthSafety(healthSafetyFromForm(form, record.emergencyContacts, record.sources, record.medicalProviders.map(providerDraft))), record);
  }
  const [hint] = editor(null).filter((node) => node.type === "p" && node.props.id === "id-hint");
  for (const words of ["official or reliable source", "leave all three blank", "Add other emergency numbers as emergency contacts"]) assert.ok(text(hint).includes(words), words);
});

test("the number stands out in large bold type beside Travel's secondary Call button, in a plain box without red, readable on its colors, side by side on wider screens and stacked on phones (TRA-173, TRA-183)", () => {
  const [file, globals] = ["../src/components/health-safety.module.css", "../src/app/globals.css"];
  const root = cssRules(globals).find(([selector]) => selector === ":root")[1];
  /** A color as written, or the one its custom property is in :root. */
  const color = (value) => /^#[0-9a-f]{6}$/i.test(value) ? value : root[/^var\((--[a-z-]+)\)$/.exec(value)[1]];
  // TRA-183: where TRA-173 had a red border, background and heading, the box has the line and white of the section's other
  // information and its heading Travel's ink, and nothing here changes the secondary button's colors, its hover included.
  const box = styles(file, [".emergency"], 1440);
  assert.deepEqual([box.border, box.background, styles(file, [".emergency h5"], 1440).color], ["1px solid var(--line)", "var(--white)", "var(--ink)"]);
  for (const [selector, declarations] of cssRules(file).filter(([selector]) => selector.includes(".call"))) {
    for (const property of ["color", "background", "background-color", "border", "border-color"]) assert.equal(declarations[property], undefined, `${selector} ${property}`);
  }
  // The heading, the number and an unverified number's message in ink, and the source line muted, on the box's white; the
  // Call button's green on its own white and on its hover's.
  const background = color(box.background);
  for (const selector of [".emergency h5", ".emergencyNumber", ".emergencySource", ".emergencyNumberMissing"]) {
    const text = color(styles(file, [selector], 1440).color);
    assert.ok(contrast(text, background) >= 4.5, `${selector}: ${text} on ${background}`);
  }
  const button = styles(globals, [".button.secondary"], 1440);
  for (const behind of [button.background, styles(globals, [".button.secondary:hover"], 1440).background]) {
    assert.ok(contrast(color(button.color), color(behind)) >= 4.5, `Call: ${button.color} on ${behind}`);
  }
  // Not verified, it is as before: the same box, its heading muted.
  assert.deepEqual(styles(file, [".emergency", ".notVerified"], 1440), box);
  const muted = styles(file, [".emergency h5", ".notVerified h5"], 1440).color;
  assert.ok(muted === "var(--muted)" && contrast(color(muted), background) >= 4.5, muted);
  const number = styles(file, [".emergencyNumber"], 390);
  assert.ok(Number.parseInt(number["font-size"], 10) >= 32 && number["font-weight"] === "700", "the number is large and bold on every screen");
  for (const width of [390, 1440]) assert.ok(Number.parseInt(styles(file, [".emergency .call"], width)["min-height"], 10) >= 48, `the Call button is at least 48px high at ${width}px`);
  for (const width of [541, 780, 1440]) assert.equal(styles(file, [".emergency"], width)["grid-template-columns"], "minmax(0, 1fr) auto", `${width}px`);
  for (const width of [320, 390, 540]) {
    assert.equal(styles(file, [".emergency"], width)["grid-template-columns"], "minmax(0, 1fr)", `${width}px`);
    assert.equal(styles(file, [".emergency .call"], width).width, "100%", `${width}px`);
  }
  assert.equal(styles(file, [".emergencyNumber"], 320)["overflow-wrap"], "anywhere", "a long number wraps on a phone");
});
