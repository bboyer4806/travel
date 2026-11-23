import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as healthSafety from "../src/lib/health-safety.ts";
import { TOOLS } from "../src/lib/mcp-tools.ts";
import { PLANNER_UPDATED } from "../src/lib/planner-updated.ts";
import { createStore, SCHEMA_VERSION, ValidationError } from "../src/lib/store.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as uuid from "../src/lib/uuid.ts";
import { aiSetup, NOW } from "./ai-fixtures.mjs";
import { addCity, addDestination, fileDatabase, setup, tripInput } from "./budget-fixtures.mjs";
import { contrast, onlyRule } from "./css-rules.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

// TRA-171: each destination's U.S. travel advisory level, the State Department's level from 1 to 4 chosen in its health
// and safety editor, or none, shown in its color with its number and official description.

const { GIVE_US_ADVISORY_LEVEL, US_ADVISORY_LEVELS, healthSafetyFromForm, normalizeHealthSafety, usAdvisoryLabel } = healthSafety;
const LABELS = ["Level 1: Exercise Normal Precautions", "Level 2: Exercise Increased Caution", "Level 3: Reconsider Travel", "Level 4: Do Not Travel"];
const NOT_AVAILABLE = "This item no longer exists or isn't shared with you. Please refresh and try again.";
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
/** Health and safety research as its editor saves it: no U.S. travel advisory level, unless `overrides` gives one. */
const research = (overrides = {}) => ({
  advisoryLevel: "Level 2: Exercise increased caution", advisoryWarnings: "Demonstrations possible in the capital",
  healthPrecautions: "Routine vaccines", localSafety: "Pickpockets on trams",
  emergencyContacts: [{ id: randomUUID(), name: "Emergency services", phone: "112", notes: "Police, fire and ambulance" }],
  sources: [{ id: randomUUID(), url: "https://travel.state.gov/", description: "U.S. travel advisory" }],
  lastCheckedDate: "2026-11-10", usAdvisoryLevel: null, medicalProviders: [], emergencyNumber: null, ...overrides,
});
/** A record without its U.S. travel advisory level, as the editor of a page opened before it had one saves it. */
const withoutLevel = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== "usAdvisoryLevel"));
/** A record as schema 43 saved it, before its U.S. travel advisory level, its medical providers (TRA-172) and its local emergency number (TRA-173). */
const asSchema43 = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => !["usAdvisoryLevel", "medicalProviders", "emergencyNumber"].includes(key)));
const save = (id, record) => ({ type: "destination.healthSafety", id, healthSafety: record });
const saved = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id).healthSafety;
/** A snapshot with every destination's U.S. travel advisory level left out, to compare everything else. */
const withoutLevels = (snapshot) => ({ ...snapshot, destinations: snapshot.destinations.map((item) => ({ ...item, healthSafety: item.healthSafety && withoutLevel(item.healthSafety) })) });

test("the four levels read as the State Department writes them, and a record keeps exactly one of them or none (TRA-171)", () => {
  assert.deepEqual(US_ADVISORY_LEVELS.map(usAdvisoryLabel), LABELS);
  for (const level of [null, 1, 2, 3, 4]) assert.equal(normalizeHealthSafety(research({ usAdvisoryLevel: level })).usAdvisoryLevel, level);
  // Nothing else: no other number, decimal, text, or a level left out, which is never taken as none or as Level 1.
  for (const value of [undefined, 0, 5, -1, 1.5, 2.5, 4.0001, Number.NaN, Number.POSITIVE_INFINITY, "1", "2", "Level 2", "", " ", true, false, [], [2], {}, { level: 2 }]) {
    assert.throws(() => normalizeHealthSafety(research({ usAdvisoryLevel: value })), { message: GIVE_US_ADVISORY_LEVEL }, String(value));
  }
  assert.throws(() => normalizeHealthSafety(withoutLevel(research())), { message: GIVE_US_ADVISORY_LEVEL });
  // The editor's dropdown: Not set is none, and each level its number.
  const form = (value) => { const fields = new FormData(); fields.set("usAdvisoryLevel", value); return fields; };
  assert.equal(healthSafetyFromForm(form(""), [], [], []).usAdvisoryLevel, null);
  for (const level of US_ADVISORY_LEVELS) assert.equal(healthSafetyFromForm(form(String(level)), [], [], []).usAdvisoryLevel, level);
});

test("each level saves with its destination, changes and clears, every trip's page and the destination's page show it, and reopening keeps it (TRA-171)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Lisbon", nights: 3 });
    const porto = addDestination(store, tripId, { city: "Porto", nights: 2 });
    const record = research();
    store.applyMutation(save(id, record));
    store.applyMutation(save(porto, research({ usAdvisoryLevel: 1 })));
    assert.equal(saved(store, id).usAdvisoryLevel, null, "research can leave it unset");
    for (const level of [1, 2, 3, 4, null, 3]) {
      store.applyMutation(save(id, { ...record, usAdvisoryLevel: level }));
      assert.deepEqual(saved(store, id), { ...record, usAdvisoryLevel: level });
      store.close(); store = null;
      store = createOwnedStore(path);
      assert.equal(saved(store, id).usAdvisoryLevel, level, "reopening keeps it");
    }
    const lisbon = (snapshot) => snapshot.data.destinations.find((item) => item.id === id).healthSafety.usAdvisoryLevel;
    assert.deepEqual([lisbon(store.getTripSnapshot(tripId)), lisbon(store.getDestinationSnapshot(id))], [3, 3]);
    assert.equal(saved(store, porto).usAdvisoryLevel, 1, "each destination has its own");
    // Clear removes the record, its level included, after which the destination has none.
    store.applyMutation(save(id, null));
    assert.equal(saved(store, id), null);
  } finally { store?.close(); }
});

test("changing the level changes nothing else, and a refused save, a page opened before it included, changes nothing (TRA-171)", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Lisbon", nights: 3 });
  addDestination(store, tripId, { city: "Porto", nights: 2 });
  const record = research({ usAdvisoryLevel: 2 });
  store.applyMutation(save(id, record));
  const before = store.getSnapshot();
  for (const level of [4, null, 1]) {
    store.applyMutation(save(id, { ...record, usAdvisoryLevel: level }));
    assert.deepEqual(withoutLevel(saved(store, id)), withoutLevel(record), "its research, typed advisory level, contacts, sources and last checked date are as they were");
    assert.deepEqual(withoutLevels(store.getSnapshot()), withoutLevels(before), "and nothing else in Travel changes");
  }
  const current = store.getSnapshot();
  // A page opened before the level saves its research without it, which would clear the level: it asks to reload instead.
  assert.throws(() => store.applyMutation(save(id, withoutLevel({ ...record, localSafety: "Edited on an old page" }))), refusal(PLANNER_UPDATED));
  assert.throws(() => store.applyMutation(save(id, withoutLevel(research()))), refusal(PLANNER_UPDATED), "a new record too");
  for (const value of [0, 5, 2.5, "3", "Level 3", true]) assert.throws(() => store.applyMutation(save(id, { ...record, usAdvisoryLevel: value })), refusal(GIVE_US_ADVISORY_LEVEL), String(value));
  assert.deepEqual(store.getSnapshot(), current);
});

test("schema 43 research upgrades with no level and keeps everything recorded, and a replay keeps the levels chosen since (TRA-171)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Lisbon", nights: 3 });
    const bare = addDestination(store, tripId, { city: "Porto", nights: 2 });
    store.applyMutation(save(id, research()));
    store.close(); store = null;
    // A schema 43 database: research as TRA-14 saved it, without a U.S. travel advisory level or medical providers.
    let db = new DatabaseSync(path);
    const old = asSchema43(JSON.parse(db.prepare("SELECT healthSafetyJson FROM destination_health_safety WHERE destinationId = ?").get(id).healthSafetyJson));
    db.prepare("UPDATE destination_health_safety SET healthSafetyJson = ? WHERE destinationId = ?").run(JSON.stringify(old), id);
    db.exec("PRAGMA user_version = 43;");
    db.close();
    store = createOwnedStore(path);
    assert.deepEqual(saved(store, id), { ...old, usAdvisoryLevel: null, medicalProviders: [], emergencyNumber: null }, "no level is assumed, and the research, its typed advisory level included, is as recorded");
    assert.equal(saved(store, bare), null, "a destination without research still has none");
    store.applyMutation(save(id, { ...old, usAdvisoryLevel: 3, medicalProviders: [], emergencyNumber: null }));
    const later = store.getSnapshot();
    // A replay of schema 44, also after the schema 1 build resets the schema version, keeps it.
    for (const version of [43, 1]) {
      store.close(); store = null;
      db = new DatabaseSync(path);
      db.exec(`PRAGMA user_version = ${version};`);
      db.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps the saved level`);
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

test("upgraded research is stored as a save stores it, the level last (TRA-171)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  const tripId = store.applyMutation(tripInput()).id;
  const [upgraded, edited] = ["Lisbon", "Porto"].map((city) => addDestination(store, tripId, { city }));
  const record = research();
  for (const id of [upgraded, edited]) store.applyMutation(save(id, record));
  store.close();
  let db = new DatabaseSync(path);
  db.prepare("UPDATE destination_health_safety SET healthSafetyJson = ? WHERE destinationId = ?").run(JSON.stringify(asSchema43(record)), upgraded);
  db.exec("PRAGMA user_version = 43;");
  db.close();
  store = createOwnedStore(path);
  store.applyMutation(save(edited, record));
  store.close();
  db = new DatabaseSync(path, { readOnly: true });
  try {
    const json = (id) => db.prepare("SELECT healthSafetyJson FROM destination_health_safety WHERE destinationId = ?").get(id).healthSafetyJson;
    assert.equal(json(upgraded), json(edited));
    assert.equal(json(edited), JSON.stringify(record));
  } finally { db.close(); }
});

test("everyone who can open the destination sees its level and can change it, and no one else can (TRA-171)", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  const id = addCity((input) => store.applyMutation(owner, input).id, tripId, "Lisbon", { nights: 3 });
  store.applyMutation(owner, save(id, research({ usAdvisoryLevel: 2 })));
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const friend = store.authorizeAccount("friend@example.test").id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  const levelFor = (account) => store.getDestinationSnapshot(account, id)?.data.destinations[0].healthSafety.usAdvisoryLevel;
  assert.deepEqual([levelFor(owner), levelFor(friend), levelFor(outsider)], [2, 2, undefined]);
  store.applyMutation(friend, save(id, research({ usAdvisoryLevel: 3 })));
  assert.equal(levelFor(owner), 3, "someone the trip is shared with changes it");
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(outsider, save(id, research({ usAdvisoryLevel: 4 }))), refusal(NOT_AVAILABLE));
  store.applyMutation(owner, { type: "trip.unshare", tripId, email: "friend@example.test" });
  assert.throws(() => store.applyMutation(friend, save(id, research({ usAdvisoryLevel: 4 }))), refusal(NOT_AVAILABLE), "and no longer once it isn't shared");
  assert.deepEqual(store.getSnapshot().destinations, before.destinations);
});

test("ChatGPT and Claude read the level and propose it, always giving it, and approving saves it (TRA-171)", (t) => {
  const path = fileDatabase(t);
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t, path);
  const id = store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Lisbon" }).id;
  const levelNow = () => store.aiDestination(id).destination.healthSafety?.usAdvisoryLevel;
  const shown = (proposal) => proposal.preview[0].records[0].fields.find((field) => field.name === "Health and safety").after;

  const added = propose([save(id, research({ usAdvisoryLevel: 2 }))]);
  assert.match(shown(added), /usAdvisoryLevel: 2/, "the owner sees it before deciding");
  assert.equal(levelNow(), undefined, "proposing changes nothing");
  assert.equal(decide(added, true).status, "applied");
  assert.equal(levelNow(), 2, "assistants read it with the rest of the research");

  const before = store.getSnapshot();
  assert.throws(() => propose([save(id, withoutLevel(research()))]), refusal(`Change 1: ${GIVE_US_ADVISORY_LEVEL}`), "leaving it out is refused, never taken as none");
  for (const value of [0, 5, 1.5, "2"]) assert.throws(() => propose([save(id, research({ usAdvisoryLevel: value }))]), refusal(`Change 1: ${GIVE_US_ADVISORY_LEVEL}`), String(value));
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");

  // A proposal waiting from before the level fails when approved, changing nothing; the assistant proposes it again. Its
  // change is recorded as a build before TRA-171 recorded it, lifting the trigger that keeps proposals unchanged to write it.
  const waiting = propose([save(id, research({ usAdvisoryLevel: null, localSafety: "Proposed before" }))]);
  const db = new DatabaseSync(path);
  try {
    const [change] = JSON.parse(db.prepare("SELECT changesJson FROM ai_proposals WHERE id = ?").get(waiting.id).changesJson);
    const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'ai_proposals_unchanged'").get().sql;
    db.exec("DROP TRIGGER ai_proposals_unchanged;");
    db.prepare("UPDATE ai_proposals SET changesJson = ? WHERE id = ?").run(JSON.stringify([{ ...change, healthSafety: withoutLevel(change.healthSafety) }]), waiting.id);
    db.exec(trigger);
  } finally { db.close(); }
  const failed = decide(store.getAiProposal(owner, waiting.id, NOW), true);
  assert.deepEqual([failed.status, failed.error], ["failed", `Change 1: ${GIVE_US_ADVISORY_LEVEL}`]);
  assert.deepEqual(store.getSnapshot(), before);

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "destination.healthSafety").properties.healthSafety;
  assert.ok(schema.required.includes("usAdvisoryLevel"), "it is required");
  assert.deepEqual([schema.properties.usAdvisoryLevel.type, schema.properties.usAdvisoryLevel.enum], [["integer", "null"], [1, 2, 3, 4, null]]);
  for (const label of LABELS) assert.ok(schema.properties.usAdvisoryLevel.description.includes(label), label);
});

// The real section and editor, rendered once with each hook's initial state. Modules they import that aren't given render,
// and return, nothing, and a CSS module's class names are their own names.
const element = (type, props) => ({ type, props });
const unused = new Proxy({}, { get: () => () => null });
function stateless(name) {
  if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
  const modules = {
    "react": { useId: () => "id", useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }), useEffect: () => {} },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" }, "lucide-react": new Proxy({}, { get: (_, icon) => "icon:" + String(icon) }),
    "@/lib/health-safety": healthSafety, "@/lib/trip-dates": tripDates, "@/lib/uuid": uuid,
  };
  return modules[name] ?? unused;
}
const component = {};
runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/health-safety.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: component, require: stateless });
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
const panel = (record) => hosts({ type: component.HealthSafetyPanel, props: { healthSafety: record, disabled: false, onEdit() {}, onClear() {} } });
const editor = (record) => hosts({ type: component.HealthSafetyEditor, props: {
  healthSafety: record, contacts: record?.emergencyContacts ?? [], onContactsChange() {}, providers: record?.medicalProviders.map(healthSafety.providerDraft) ?? [], onProvidersChange() {},
  sources: record?.sources ?? [], onSourcesChange() {}, disabled: false,
} });

test("the section shows the level first, in its color with its number and description, and Not recorded without one (TRA-171)", () => {
  for (const [index, level] of US_ADVISORY_LEVELS.entries()) {
    const shown = panel(normalizeHealthSafety(research({ usAdvisoryLevel: level })));
    const [details] = shown.filter((node) => node.type === "dl");
    const [first, typed] = details.props.children.filter((node) => node && node.type === "div");
    assert.equal(first.props.className, "usAdvisory");
    assert.deepEqual([text(first.props.children[0]), text(first.props.children[1])], ["U.S. travel advisory level", LABELS[index]]);
    const badges = shown.filter((node) => String(node.props.className ?? "").startsWith("advisoryLevel"));
    assert.deepEqual(badges.map((node) => [node.type, node.props.className, text(node)]), [["span", `advisoryLevel level${level}`, LABELS[index]]], "one, in this level's color");
    assert.deepEqual([text(typed.props.children[0]), text(typed.props.children[1])], ["Travel advisory level", "Level 2: Exercise increased caution"], "the advisory level as typed shows as recorded");
  }
  const unset = panel(normalizeHealthSafety(research()));
  const [first] = unset.filter((node) => node.type === "dl")[0].props.children.filter((node) => node && node.type === "div");
  assert.equal(text(first.props.children[1]), "Not recorded", "no level is shown, Level 1 included");
  assert.ok(!unset.some((node) => String(node.props.className ?? "").startsWith("advisoryLevel")), "and no color");
  assert.ok(!panel(null).some((node) => node.type === "dl"), "a destination without research shows no level");
});

test("the editor's first field is a dropdown of Not set and the four levels, showing the saved one, and saving it unchanged saves the same record (TRA-171)", () => {
  for (const record of [null, ...[null, 1, 2, 3, 4].map((level) => normalizeHealthSafety(research({ usAdvisoryLevel: level })))]) {
    const fields = editor(record).filter((node) => ["input", "select", "textarea"].includes(node.type) && node.props.name);
    const [select] = fields;
    assert.equal(select.type, "select", "it comes first, so opening the editor focuses it");
    assert.equal(select.props.name, "usAdvisoryLevel");
    const options = hosts(select.props.children).filter((node) => node.type === "option");
    assert.deepEqual(options.map((node) => [String(node.props.value), text(node)]), [["", "Not set"], ...LABELS.map((label, index) => [String(index + 1), label])]);
    assert.equal(select.props.defaultValue, record?.usAdvisoryLevel ?? "", "the saved level, or Not set, never Level 1");
    if (!record) continue;
    // Each field holds what is saved, so saving the editor unchanged saves the record as it was. The local emergency
    // number's fields (TRA-173) hold their values as they change.
    const form = new FormData();
    for (const field of fields) form.set(field.props.name, String(field.props.defaultValue ?? field.props.value));
    assert.deepEqual(normalizeHealthSafety(healthSafetyFromForm(form, record.emergencyContacts, record.sources, record.medicalProviders.map(healthSafety.providerDraft))), record);
  }
  const [label] = editor(null).filter((node) => node.type === "label" && hosts(node.props.children).some((child) => child.type === "select"));
  assert.equal(text(label.props.children[0]), "U.S. travel advisory level");
  assert.equal(label.props.className, "field wide");
});

test("each level's color is its own, green to red, with its text at least 4.5:1 against it (TRA-171)", () => {
  const file = "../src/components/health-safety.module.css";
  /** A #rrggbb color's hue in degrees. */
  const hue = (hex) => {
    const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    const max = Math.max(r, g, b), spread = max - Math.min(r, g, b);
    const degrees = max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
    return (degrees * 60 + 360) % 360;
  };
  // Green, yellow, orange and red.
  const hues = [[90, 150], [45, 60], [20, 40], [0, 10]];
  for (const [index, level] of US_ADVISORY_LEVELS.entries()) {
    const { background, color } = onlyRule(file, `.level${level}`);
    assert.match(background, /^#[0-9a-f]{6}$/);
    const [low, high] = hues[index];
    assert.ok(hue(background) >= low && hue(background) <= high, `Level ${level}'s ${background} is ${hue(background).toFixed(0)}°`);
    assert.ok(contrast(color, background) >= 4.5, `Level ${level}: ${color} on ${background} is ${contrast(color, background).toFixed(2)}:1`);
  }
  assert.equal(onlyRule(file, ".details > .usAdvisory")["grid-column"], "1 / -1", "it has its row to itself");
});
