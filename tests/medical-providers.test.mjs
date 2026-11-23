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
import { aiSetup } from "./ai-fixtures.mjs";
import { addCity, addDestination, fileDatabase, setup, tripInput } from "./budget-fixtures.mjs";
import { styles } from "./css-rules.mjs";
import { createOwnedStore, OWNER_EMAIL } from "./owned-store.mjs";

// TRA-172: each destination's Health and safety research keeps doctors and clinics for non-emergency care, apart from its
// emergency contacts: who they are, how to reach them, whether a source confirmed consultations in English, seeing visiting
// American patients and the soonest visit, the sources saying so and when they were last verified.

const { GIVE_MEDICAL_PROVIDERS, MAX_SOURCES, PROVIDER_CHECKS, SHORT_NOTICE_CARE, healthSafetyFromForm, mapHref, newProviderDraft, normalizeHealthSafety, providerDraft, providerFromDraft, providersInOrder, telephoneHref } = healthSafety;
const NOT_AVAILABLE = "This item no longer exists or isn't shared with you. Please refresh and try again.";
/** A refusal with exactly this message. */
const refusal = (message) => (error) => error instanceof ValidationError && error.message === message;
/** A clinic as researched from an embassy's list, with every detail given, or as `overrides` change it. */
const provider = (overrides = {}) => ({
  id: randomUUID(), name: "Lisbon International Clinic", address: "Rua do Exemplo 12, 1250-001 Lisbon", coordinates: { latitude: 38.7167, longitude: -9.15 },
  phone: "+351 21 000 0000", website: "https://clinic.example/", services: "General practice and pediatrics", notes: "Weekdays 8:00 to 20:00",
  englishConsultations: "verified", visitingAmericans: "verified", shortNotice: "same-day",
  sources: [{ id: randomUUID(), url: "https://example.gov/embassy/medical-providers", description: "U.S. embassy list of medical providers" }],
  lastVerifiedDate: "2026-11-20", ...overrides,
});
/** A doctor with only a name and what isn't known left blank or unconfirmed. */
const bare = (overrides = {}) => ({ id: randomUUID(), name: "Dr. Ana Silva", address: "", coordinates: null, phone: "", website: "", services: "", notes: "", englishConsultations: "unconfirmed", visitingAmericans: "unconfirmed", shortNotice: "unconfirmed", sources: [], lastVerifiedDate: null, ...overrides });
/** Health and safety research as its editor saves it, with two providers unless `overrides` gives others. */
const research = (overrides = {}) => ({
  advisoryLevel: "Level 2: Exercise increased caution", advisoryWarnings: "Demonstrations possible in the capital", healthPrecautions: "Routine vaccines", localSafety: "Pickpockets on trams",
  emergencyContacts: [{ id: randomUUID(), name: "Emergency services", phone: "112", notes: "Police, fire and ambulance" }],
  sources: [{ id: randomUUID(), url: "https://example.gov/advisory", description: "U.S. travel advisory" }],
  lastCheckedDate: "2026-11-10", usAdvisoryLevel: 2, medicalProviders: [provider(), bare()], emergencyNumber: null, ...overrides,
});
/** A record without its medical providers, as the editor of a page opened before them saves it. */
const withoutProviders = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== "medicalProviders"));
/** A record as schema 44 saved it, before its medical providers and its local emergency number (TRA-173). */
const asSchema44 = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== "medicalProviders" && key !== "emergencyNumber"));
const save = (id, record) => ({ type: "destination.healthSafety", id, healthSafety: record });
const saved = (store, id) => store.getSnapshot().destinations.find((item) => item.id === id).healthSafety;
/** A record with one of its providers changed by `change`, as the editor saves it. */
const withProvider = (record, index, change) => ({ ...record, medicalProviders: record.medicalProviders.map((item, at) => at === index ? change(item) : item) });

test("a provider keeps what people researched, trimmed, and nothing that isn't known is filled in (TRA-172)", () => {
  const clinic = provider();
  const record = normalizeHealthSafety(research({ medicalProviders: [{ ...clinic, name: " Lisbon International Clinic ", phone: " +351 21 000 0000 ", website: " https://clinic.example ", notes: " Weekdays 8:00 to 20:00 " }] }));
  assert.deepEqual(record.medicalProviders, [clinic], "the website is written as the URL parser writes it");
  // Only a name is needed; every check is given, and Unconfirmed is never taken as verified.
  assert.deepEqual(normalizeHealthSafety(research({ medicalProviders: [bare()] })).medicalProviders[0].englishConsultations, "unconfirmed");
  const minimal = { id: randomUUID(), name: "Clinic", englishConsultations: "unconfirmed", visitingAmericans: "unconfirmed", shortNotice: "unconfirmed" };
  assert.deepEqual(normalizeHealthSafety(research({ medicalProviders: [minimal] })).medicalProviders, [{ ...bare(), ...minimal }], "left out, the rest is blank");
  assert.equal(normalizeHealthSafety(research({ medicalProviders: [{ ...clinic, rating: 5 }] })).medicalProviders[0].rating, undefined, "only known fields are saved");
  // Every check's values, and the soonest visit's.
  for (const value of PROVIDER_CHECKS) {
    assert.equal(normalizeHealthSafety(research({ medicalProviders: [provider({ englishConsultations: value })] })).medicalProviders[0].englishConsultations, value);
    assert.equal(normalizeHealthSafety(research({ medicalProviders: [provider({ visitingAmericans: value })] })).medicalProviders[0].visitingAmericans, value);
  }
  assert.deepEqual([...PROVIDER_CHECKS], ["unconfirmed", "verified"]);
  assert.deepEqual([...SHORT_NOTICE_CARE], ["unconfirmed", "walk-in", "same-day", "short-notice"]);
  for (const shortNotice of SHORT_NOTICE_CARE) assert.equal(normalizeHealthSafety(research({ medicalProviders: [provider({ shortNotice })] })).medicalProviders[0].shortNotice, shortNotice);
  // There is no fixed maximum, and each stays a record of its own, in the order saved.
  const many = Array.from({ length: 60 }, (_, index) => bare({ name: `Clinic ${index + 1}` }));
  assert.deepEqual(normalizeHealthSafety(research({ medicalProviders: many })).medicalProviders.map((item) => item.name), many.map((item) => item.name));
  assert.deepEqual(normalizeHealthSafety(research({ medicalProviders: [] })).medicalProviders, []);
});

test("a provider is refused without a name, with a check left out or unknown, or with a phone, website, map location, date or source that isn't one (TRA-172)", () => {
  const refuses = (overrides, message) => assert.throws(() => normalizeHealthSafety(research({ medicalProviders: [provider(overrides)] })), { message }, JSON.stringify(overrides));
  for (const name of ["", "  ", undefined]) refuses({ name }, "Enter a name for each medical provider.");
  for (const value of [undefined, null, "", "yes", "Verified", true, 1]) {
    refuses({ englishConsultations: value }, "Choose whether it is verified or unconfirmed that each medical provider offers consultations in English.");
    refuses({ visitingAmericans: value }, "Choose whether it is verified or unconfirmed that each medical provider sees visiting American patients.");
    refuses({ shortNotice: value }, "Choose the soonest visit verified for each medical provider: walk-in, same-day, short-notice, or unconfirmed.");
  }
  refuses({ shortNotice: "verified" }, "Choose the soonest visit verified for each medical provider: walk-in, same-day, short-notice, or unconfirmed.");
  for (const [field, label, maxLength] of [["name", "Medical provider name", 160], ["address", "Medical provider address", 500], ["services", "Medical specialty or services", 500], ["notes", "Medical provider notes", 2000]]) {
    assert.equal(normalizeHealthSafety(research({ medicalProviders: [provider({ [field]: "x".repeat(maxLength) })] })).medicalProviders[0][field].length, maxLength);
    refuses({ [field]: "x".repeat(maxLength + 1) }, `${label} must be ${maxLength} characters or fewer.`);
    refuses({ [field]: 12 }, `${label} must be text.`);
  }
  for (const phone of ["call the front desk", "+-()", "555-0100 ext. 2", "1-800-DOCTORS"]) refuses({ phone }, "Enter each phone number using only digits, spaces, plus signs, parentheses, hyphens, and periods.");
  refuses({ phone: "1".repeat(41) }, "Medical provider phone number must be 40 characters or fewer.");
  for (const website of ["clinic.example", "javascript:alert(1)", "ftp://clinic.example", "https://name:secret@clinic.example/"]) refuses({ website }, "Enter each medical provider's website starting with https:// or http://, without a username or password.");
  for (const value of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: "38.7", longitude: -9.15 }, { latitude: Number.NaN, longitude: 1 }]) assert.throws(() => normalizeHealthSafety(research({ medicalProviders: [provider({ coordinates: value })] })), /must be a number/, JSON.stringify(value));
  refuses({ coordinates: { latitude: 38.7 } }, "Enter both a latitude and a longitude, or remove the coordinates.");
  refuses({ coordinates: "38.7, -9.15" }, "Enter each medical provider's map location as a latitude and a longitude, or remove it.");
  for (const lastVerifiedDate of ["2026-02-30", "11/20/2026", 20261120]) assert.throws(() => normalizeHealthSafety(research({ medicalProviders: [provider({ lastVerifiedDate })] })), lastVerifiedDate === 20261120 ? /must be text/ : { message: "Enter a valid last verified date in YYYY-MM-DD format." });
  refuses({ sources: [{ id: randomUUID(), url: "javascript:alert(1)" }] }, "Enter a source link starting with https:// or http://, without a username or password.");
  refuses({ sources: Array.from({ length: MAX_SOURCES + 1 }, () => ({ id: randomUUID(), url: "https://example.gov/" })) }, `You can save up to ${MAX_SOURCES} sources for each medical provider.`);
  assert.equal(normalizeHealthSafety(research({ medicalProviders: [provider({ sources: Array.from({ length: MAX_SOURCES }, () => ({ id: randomUUID(), url: "https://example.gov/" })) })] })).medicalProviders[0].sources.length, MAX_SOURCES);
  // Each is a record with its own identifier, and the record gives the list, empty for none.
  const clinic = provider();
  assert.throws(() => normalizeHealthSafety(research({ medicalProviders: [clinic, { ...clinic, id: clinic.id.toUpperCase() }] })), { message: "Each medical provider must have a unique identifier." });
  assert.throws(() => normalizeHealthSafety(research({ medicalProviders: [provider({ id: "clinic-1" })] })), { message: "This medical provider has an invalid identifier. Please remove it and add it again." });
  for (const value of [null, "x"]) assert.throws(() => normalizeHealthSafety(research({ medicalProviders: [value] })), { message: "Each medical provider needs a name." });
  for (const medicalProviders of [undefined, null, {}, "Lisbon International Clinic"]) assert.throws(() => normalizeHealthSafety(research({ medicalProviders })), { message: GIVE_MEDICAL_PROVIDERS });
  assert.throws(() => normalizeHealthSafety(withoutProviders(research())), { message: GIVE_MEDICAL_PROVIDERS });
});

test("the editor's drafts hold the map location as typed and save every provider as it was, and a new one starts with nothing verified (TRA-172)", () => {
  for (const item of [provider(), bare(), provider({ coordinates: { latitude: -33.8688, longitude: 151.2093 } })]) {
    const draft = providerDraft(normalizeHealthSafety(research({ medicalProviders: [item] })).medicalProviders[0]);
    assert.equal(draft.coordinates, undefined);
    assert.deepEqual([draft.latitude, draft.longitude], item.coordinates ? [String(item.coordinates.latitude), String(item.coordinates.longitude)] : ["", ""]);
    assert.deepEqual(normalizeHealthSafety(research({ medicalProviders: [providerFromDraft(draft)] })).medicalProviders, [item]);
  }
  const fresh = newProviderDraft("id-1");
  assert.deepEqual(fresh, { id: "id-1", name: "", address: "", latitude: "", longitude: "", phone: "", website: "", services: "", notes: "", englishConsultations: "unconfirmed", visitingAmericans: "unconfirmed", shortNotice: "unconfirmed", sources: [], lastVerifiedDate: null });
  assert.equal(providerFromDraft({ ...fresh, latitude: " ", longitude: "" }).coordinates, null, "clearing both removes the map location");
  assert.throws(() => normalizeHealthSafety(research({ medicalProviders: [providerFromDraft({ ...newProviderDraft(randomUUID()), name: "Clinic", latitude: "38.7", longitude: "" })] })), /Longitude must be a number/, "one alone is no location, never 0");
  // The form's draft carries the providers with the rest of the research.
  const record = normalizeHealthSafety(research());
  assert.deepEqual(healthSafetyFromForm(new FormData(), [], [], record.medicalProviders.map(providerDraft)).medicalProviders, record.medicalProviders);
});

test("phone links call the number's digits, map links open Google Maps, and providers confirmed in English are listed first (TRA-172)", () => {
  assert.equal(telephoneHref("+351 21 000 0000"), "tel:+351210000000");
  assert.equal(telephoneHref("(+33) 1 43 12 22 22"), "tel:+33143122222");
  assert.equal(telephoneHref("020.7946.0000"), "tel:02079460000");
  assert.equal(mapHref("Rua do Exemplo 12, Lisbon"), "https://www.google.com/maps/search/?api=1&query=Rua%20do%20Exemplo%2012%2C%20Lisbon");
  assert.equal(mapHref("38.7167,-9.15"), "https://www.google.com/maps/search/?api=1&query=38.7167%2C-9.15");
  const [a, b, c, d] = [bare({ name: "A" }), provider({ name: "B" }), bare({ name: "C", visitingAmericans: "verified", shortNotice: "walk-in" }), provider({ name: "D", englishConsultations: "verified" })];
  const listed = [a, b, c, d];
  assert.deepEqual(providersInOrder(listed).map((item) => item.name), ["B", "D", "A", "C"], "each group keeps the order saved");
  assert.deepEqual(listed.map((item) => item.name), ["A", "B", "C", "D"], "the saved list is unchanged");
});

test("several providers save with their destination, each its own record, and reopening keeps them in every trip and on the destination's page (TRA-172)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Lisbon", nights: 3 });
    const porto = addDestination(store, tripId, { city: "Porto", nights: 2 });
    const record = research();
    store.applyMutation(save(id, record));
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(saved(store, id), record);
    assert.equal(saved(store, id).medicalProviders.length, 2);
    const lisbon = (snapshot) => snapshot.data.destinations.find((item) => item.id === id).healthSafety.medicalProviders;
    assert.deepEqual([lisbon(store.getTripSnapshot(tripId)), lisbon(store.getDestinationSnapshot(id))], [record.medicalProviders, record.medicalProviders]);
    assert.equal(saved(store, porto), null, "another destination has none of them");
    store.applyMutation(save(porto, research({ medicalProviders: [bare({ name: "Porto clinic" })] })));
    assert.deepEqual(saved(store, id).medicalProviders, record.medicalProviders, "each destination keeps its own");
    assert.deepEqual(saved(store, porto).medicalProviders.map((item) => item.name), ["Porto clinic"]);
  } finally { store?.close(); }
});

test("editing or removing one provider changes only it, the rest of the research stays as recorded, and Clear removes them with it (TRA-172)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const id = addDestination(store, tripId, { city: "Lisbon", nights: 3 });
    addDestination(store, tripId, { city: "Porto", nights: 2 });
    const record = research({ medicalProviders: [provider(), bare(), provider({ name: "Hospital da Luz outpatient clinic", shortNotice: "walk-in" })] });
    store.applyMutation(save(id, record));
    const before = store.getSnapshot();
    const unchanged = (snapshot) => ({ ...snapshot, destinations: snapshot.destinations.map((item) => ({ ...item, healthSafety: item.healthSafety && withoutProviders(item.healthSafety) })) });
    const edited = withProvider(record, 1, (item) => ({ ...item, phone: "+351 21 111 1111", englishConsultations: "verified", lastVerifiedDate: "2026-11-22" }));
    store.applyMutation(save(id, edited));
    store.close(); store = null;
    store = createOwnedStore(path);
    assert.deepEqual(saved(store, id).medicalProviders, edited.medicalProviders, "the edit is kept after reopening");
    assert.deepEqual(unchanged(store.getSnapshot()), unchanged(before), "emergency contacts, advisory levels, research, sources, last checked dates and everything else are as they were");
    const removed = { ...edited, medicalProviders: [edited.medicalProviders[0], edited.medicalProviders[2]] };
    store.applyMutation(save(id, removed));
    assert.deepEqual(saved(store, id).medicalProviders, removed.medicalProviders, "the others stay as they were");
    assert.deepEqual(unchanged(store.getSnapshot()), unchanged(before));
    store.applyMutation(save(id, { ...removed, medicalProviders: [] }));
    assert.deepEqual(saved(store, id), { ...removed, medicalProviders: [] }, "removing every provider keeps the record");
    store.applyMutation(save(id, null));
    assert.equal(saved(store, id), null, "Clear removes the providers with the record");
  } finally { store?.close(); }
});

test("a page opened before providers asks to reload rather than clearing them, and a refused save changes nothing (TRA-172)", (t) => {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Lisbon", nights: 3 });
  const record = research();
  store.applyMutation(save(id, record));
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(save(id, withoutProviders({ ...record, localSafety: "Edited on an old page" }))), refusal(PLANNER_UPDATED));
  const other = addDestination(store, tripId, { city: "Porto", nights: 2 });
  assert.throws(() => store.applyMutation(save(other, withoutProviders(research()))), refusal(PLANNER_UPDATED), "a new record too");
  const current = store.getSnapshot();
  assert.deepEqual(current.destinations.find((item) => item.id === id), before.destinations.find((item) => item.id === id));
  for (const invalid of [withProvider(record, 0, (item) => ({ ...item, name: "" })), withProvider(record, 0, (item) => ({ ...item, englishConsultations: "probably" })), withProvider(record, 1, (item) => ({ ...item, website: "javascript:alert(1)" }))]) {
    assert.throws(() => store.applyMutation(save(id, invalid)), ValidationError);
  }
  assert.deepEqual(store.getSnapshot(), current);
});

test("schema 44 research upgrades with no providers and keeps everything recorded, stored as a save stores it, and a replay keeps providers added since (TRA-172)", (t) => {
  const path = fileDatabase(t);
  let store = createOwnedStore(path);
  try {
    const tripId = store.applyMutation(tripInput()).id;
    const [upgraded, edited] = ["Lisbon", "Porto"].map((city) => addDestination(store, tripId, { city }));
    const empty = addDestination(store, tripId, { city: "Faro" });
    const record = research({ medicalProviders: [] });
    for (const id of [upgraded, edited]) store.applyMutation(save(id, record));
    store.close(); store = null;
    // A schema 44 database: research as TRA-171 saved it, without medical providers.
    let db = new DatabaseSync(path);
    const json = (id) => db.prepare("SELECT healthSafetyJson FROM destination_health_safety WHERE destinationId = ?").get(id).healthSafetyJson;
    const old = asSchema44(JSON.parse(json(upgraded)));
    db.prepare("UPDATE destination_health_safety SET healthSafetyJson = ? WHERE destinationId = ?").run(JSON.stringify(old), upgraded);
    db.exec("PRAGMA user_version = 44;");
    db.close();
    store = createOwnedStore(path);
    assert.deepEqual(saved(store, upgraded), { ...old, medicalProviders: [], emergencyNumber: null }, "no provider is assumed, and its emergency contacts, level, research, sources and last checked date are as recorded");
    assert.equal(saved(store, empty), null, "a destination without research still has none");
    store.close(); store = null;
    db = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(json(upgraded), json(edited), "stored as a save stores it, the providers last"); } finally { db.close(); }
    store = createOwnedStore(path);
    store.applyMutation(save(upgraded, { ...old, medicalProviders: [provider()], emergencyNumber: null }));
    const later = store.getSnapshot();
    // A replay of schema 45, also after the schema 1 build resets the schema version, keeps them.
    for (const version of [44, 1]) {
      store.close(); store = null;
      db = new DatabaseSync(path);
      db.exec(`PRAGMA user_version = ${version};`);
      db.close();
      store = createOwnedStore(path);
      assert.deepEqual(store.getSnapshot(), later, `a replay from schema ${version} keeps the saved providers`);
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

test("everyone who can open the destination sees its providers and can change them, and no one else can (TRA-172)", (t) => {
  const store = createStore(":memory:", OWNER_EMAIL);
  t.after(() => store.close());
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  const tripId = store.applyMutation(owner, tripInput()).id;
  const id = addCity((input) => store.applyMutation(owner, input).id, tripId, "Lisbon", { nights: 3 });
  const record = research();
  store.applyMutation(owner, save(id, record));
  store.applyMutation(owner, { type: "trip.share", tripId, email: "friend@example.test" });
  const friend = store.authorizeAccount("friend@example.test").id;
  const outsider = store.authorizeAccount("outsider@example.test").id;
  const namesFor = (account) => store.getDestinationSnapshot(account, id)?.data.destinations[0].healthSafety.medicalProviders.map((item) => item.name);
  assert.deepEqual([namesFor(owner), namesFor(friend), namesFor(outsider)], [["Lisbon International Clinic", "Dr. Ana Silva"], ["Lisbon International Clinic", "Dr. Ana Silva"], undefined]);
  assert.equal(store.getTripSnapshot(outsider, tripId), undefined, "nor through the trip");
  const added = { ...record, medicalProviders: [...record.medicalProviders, bare({ name: "Added by a friend" })] };
  store.applyMutation(friend, save(id, added));
  assert.equal(namesFor(owner).at(-1), "Added by a friend", "someone the trip is shared with adds one");
  const before = store.getSnapshot();
  assert.throws(() => store.applyMutation(outsider, save(id, { ...added, medicalProviders: [] })), refusal(NOT_AVAILABLE));
  store.applyMutation(owner, { type: "trip.unshare", tripId, email: "friend@example.test" });
  assert.throws(() => store.applyMutation(friend, save(id, { ...added, medicalProviders: [] })), refusal(NOT_AVAILABLE), "and no longer once it isn't shared");
  assert.deepEqual(store.getSnapshot().destinations, before.destinations);
});

test("ChatGPT and Claude read providers and propose them, always giving the list, and approving saves them (TRA-172)", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  const id = store.applyMutation(owner, { type: "stop.add", tripId: ownerTrip, city: "Lisbon" }).id;
  const providersNow = () => store.aiDestination(id).destination.healthSafety?.medicalProviders;
  const record = research();
  const proposal = propose([save(id, record)]);
  const shown = proposal.preview[0].records[0].fields.find((field) => field.name === "Health and safety").after;
  for (const detail of ["name: Lisbon International Clinic", "englishConsultations: verified", "visitingAmericans: verified", "shortNotice: same-day", "lastVerifiedDate: 2026-11-20", "name: Dr. Ana Silva", "englishConsultations: unconfirmed"]) {
    assert.ok(shown.includes(detail), `the owner sees ${detail} before deciding`);
  }
  assert.equal(providersNow(), undefined, "proposing changes nothing");
  assert.equal(decide(proposal, true).status, "applied");
  assert.deepEqual(providersNow(), record.medicalProviders, "assistants read them with the rest of the research");

  const before = store.getSnapshot();
  assert.throws(() => propose([save(id, withoutProviders(research()))]), refusal(`Change 1: ${GIVE_MEDICAL_PROVIDERS}`), "leaving them out is refused, never taken as none");
  assert.throws(() => propose([save(id, research({ medicalProviders: [{ ...bare(), englishConsultations: undefined }] }))]), refusal("Change 1: Choose whether it is verified or unconfirmed that each medical provider offers consultations in English."));
  assert.deepEqual(store.getSnapshot(), before, "a refused proposal changes nothing");

  const schema = TOOLS.find((tool) => tool.name === "propose_changes").inputSchema.properties.changes.items.anyOf.find((change) => change.title === "destination.healthSafety").properties.healthSafety;
  assert.ok(schema.required.includes("medicalProviders"), "the list is always given");
  const list = schema.properties.medicalProviders;
  assert.equal(list.type, "array");
  assert.equal(list.maxItems, undefined, "there is no fixed maximum");
  assert.deepEqual(list.items.required, ["id", "name", "englishConsultations", "visitingAmericans", "shortNotice"]);
  assert.deepEqual(Object.keys(list.items.properties), Object.keys(provider()), "it lists every field a provider keeps");
  assert.deepEqual([list.items.properties.englishConsultations.enum, list.items.properties.visitingAmericans.enum, list.items.properties.shortNotice.enum], [PROVIDER_CHECKS, PROVIDER_CHECKS, SHORT_NOTICE_CARE]);
  for (const words of ["non-emergency", "emergencyContacts", "U.S. embassy", "endorsement"]) assert.ok(list.description.includes(words), words);
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
/** A value the components made, in this test's own objects and arrays, to compare. */
const plain = (value) => JSON.parse(JSON.stringify(value));
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
/** The section's Non-emergency medical care, after its heading. */
const care = (shown) => {
  const lists = shown.filter((node) => node.type === "div" && node.props.className === "list");
  return lists.find((node) => hosts(node.props.children).some((child) => child.type === "h5" && text(child) === "Non-emergency medical care"));
};
/** Each provider's details in the section, as their term and what it shows. */
const details = (item) => Object.fromEntries(hosts(item.props.children).filter((node) => node.type === "div" && hosts(node.props.children)[0]?.type === "dt").map((node) => {
  const [dt, dd] = node.props.children;
  return [text(dt), text(dd)];
}));

test("the section shows Non-emergency medical care after the emergency contacts, apart from them, with each provider's details, English first (TRA-172)", () => {
  const record = normalizeHealthSafety(research({ medicalProviders: [bare(), provider({ shortNotice: "walk-in" })] }));
  const shown = panel(record);
  const headings = shown.filter((node) => node.type === "h5").map(text);
  assert.deepEqual(headings, ["Local Emergency Number", "Emergency contacts", "Non-emergency medical care", "Sources"], "its own subsection, between the emergency contacts and the sources");
  const section = care(shown);
  const inside = hosts(section.props.children);
  assert.match(text(section), /For routine illness or minor injuries, not emergencies\. In an emergency, call local emergency services or the emergency contacts above\./);
  assert.match(text(section), /Appearing on a U\.S\. embassy or consulate list of medical providers does not mean the U\.S\. government endorses or guarantees a provider\./);
  assert.match(text(section), /no appointment or availability is guaranteed/);
  const items = inside.filter((node) => node.type === "li" && node.props.className === "provider");
  assert.deepEqual(items.map((item) => text(hosts(item.props.children).find((node) => node.type === "h6"))), ["Lisbon International Clinic", "Dr. Ana Silva"], "the provider confirmed in English comes first");
  assert.deepEqual(details(items[0]), {
    "Consultations in English": "Verified", "Sees visiting American patients": "Verified", "Walk-in, same-day or short-notice visits": "Walk-in visits (verified, not guaranteed)",
    "Last verified": tripDates.formatCalendarDate("2026-11-20"), "Phone": "+351 21 000 0000, call Lisbon International Clinic", "Website": "clinic.example (opens in a new tab)",
    "Address and map location": "Rua do Exemplo 12, 1250-001 Lisbon in Google Maps (opens in a new tab)38.7167, -9.15 in Google Maps (opens in a new tab)",
    "Notes": "Weekdays 8:00 to 20:00", "Sources": "U.S. embassy list of medical providersexample.gov",
  });
  assert.ok(text(items[0]).includes("General practice and pediatrics"), "its specialty or services show below its name");
  // What isn't known shows as such, never as verified or guaranteed.
  assert.deepEqual(details(items[1]), {
    "Consultations in English": "Unconfirmed", "Sees visiting American patients": "Unconfirmed", "Walk-in, same-day or short-notice visits": "Unconfirmed",
    "Last verified": "Not verified", "Phone": "Not recorded", "Website": "Not recorded", "Address and map location": "Not recorded", "Sources": "Not recorded",
  });
  // Calling, its website and the map are links.
  const links = hosts(items[0].props.children).filter((node) => node.type === "a").map((node) => [node.props.href, node.props.target ?? null]);
  assert.deepEqual(links, [
    ["tel:+351210000000", null], ["https://clinic.example/", "_blank"],
    [mapHref("Rua do Exemplo 12, 1250-001 Lisbon"), "_blank"], [mapHref("38.7167,-9.15"), "_blank"],
    ["https://example.gov/embassy/medical-providers", "_blank"],
  ]);
  assert.deepEqual(hosts(items[1].props.children).filter((node) => node.type === "a"), [], "nothing to call or open without details");
  // The emergency contacts show as before.
  const emergency = shown.filter((node) => node.type === "ul" && node.props.className === "contacts")[0];
  assert.equal(text(emergency), "Emergency services112Police, fire and ambulance");
  // Without providers, the subsection says none are recorded.
  assert.match(text(care(panel(normalizeHealthSafety(research({ medicalProviders: [] }))))), /Not recorded/);
});

test("the editor adds, edits and removes providers among the rest of the research, and saving it unchanged saves the same record (TRA-172)", () => {
  const record = normalizeHealthSafety(research());
  const drafts = record.medicalProviders.map(providerDraft);
  const changes = [];
  const render = (providers) => hosts({ type: component.HealthSafetyEditor, props: {
    healthSafety: record, contacts: record.emergencyContacts, onContactsChange() {}, providers, onProvidersChange: (value) => changes.push(value),
    sources: record.sources, onSourcesChange() {}, disabled: false,
  } });
  const shown = render(drafts);
  const legends = shown.filter((node) => node.type === "legend").map(text);
  assert.deepEqual(legends.slice(0, 4), ["Health and safety research", "Local emergency number", "Emergency contacts", "Non-emergency medical care"], "it follows the emergency contacts");
  const rows = shown.filter((node) => node.props.role === "group");
  assert.equal(rows.length, 2);
  const field = (row, label) => hosts(row.props.children).find((node) => ["input", "select", "textarea"].includes(node.type) && node.props["aria-label"] === label);
  assert.deepEqual(["name", "medical specialty or services", "phone number", "website", "address", "latitude", "longitude", "consultations in English", "sees visiting American patients", "walk-in, same-day or short-notice visits", "last verified date", "notes"]
    .map((label) => field(rows[0], `Provider 1 ${label}`).props.value),
  ["Lisbon International Clinic", "General practice and pediatrics", "+351 21 000 0000", "https://clinic.example/", "Rua do Exemplo 12, 1250-001 Lisbon", "38.7167", "-9.15", "verified", "verified", "same-day", "2026-11-20", "Weekdays 8:00 to 20:00"]);
  assert.equal(field(rows[0], "Provider 1 name").props.required, true, "a name is needed");
  assert.equal(field(rows[1], "Provider 2 latitude").props.required, false, "a map location is optional");
  const options = (row, label) => hosts(field(row, label).props.children).filter((node) => node.type === "option").map((node) => [node.props.value, text(node)]);
  assert.deepEqual(options(rows[1], "Provider 2 consultations in English"), [["unconfirmed", "Unconfirmed"], ["verified", "Verified"]], "Unconfirmed comes first");
  assert.deepEqual(options(rows[1], "Provider 2 walk-in, same-day or short-notice visits"), [["unconfirmed", "Unconfirmed"], ["walk-in", "Walk-in visits"], ["same-day", "Same-day appointments"], ["short-notice", "Short-notice appointments"]]);
  const visitLabel = hosts(rows[1].props.children).find((node) => node.type === "label" && hosts(node.props.children).some((child) => child.props?.["aria-label"] === "Provider 2 walk-in, same-day or short-notice visits"));
  assert.equal(text(hosts(visitLabel.props.children).find((node) => node.type === "small")), "Choose a visit only when a source confirms it. It is never a guarantee.");
  // Saving the editor unchanged saves the record as it was.
  assert.deepEqual(normalizeHealthSafety(healthSafetyFromForm(new FormData(), record.emergencyContacts, record.sources, drafts)).medicalProviders, record.medicalProviders);
  // Editing one changes only it.
  field(rows[1], "Provider 2 phone number").props.onChange({ target: { value: "+351 21 222 2222" } });
  field(rows[1], "Provider 2 consultations in English").props.onChange({ target: { value: "verified" } });
  assert.deepEqual(plain(changes).map((value) => value.map((item) => [item.phone, item.englishConsultations])), [[["+351 21 000 0000", "verified"], ["+351 21 222 2222", "unconfirmed"]], [["+351 21 000 0000", "verified"], ["", "verified"]]]);
  // Removing one keeps the other, and Add provider adds one with nothing verified.
  changes.length = 0;
  hosts(rows[0].props.children).find((node) => node.type === "button" && node.props["aria-label"] === "Remove provider 1").props.onClick();
  shown.find((node) => node.type === "button" && text(node) === "Add provider").props.onClick();
  assert.deepEqual(plain(changes[0]), plain([drafts[1]]));
  assert.deepEqual(plain(changes[1].slice(0, 2)), plain(drafts));
  assert.deepEqual(plain({ ...changes[1][2], id: "new" }), plain(newProviderDraft("new")));
  // Each provider's sources are its own, apart from the research's.
  const sources = hosts(rows[0].props.children).filter((node) => node.type === "legend").map(text);
  assert.deepEqual(sources, ["Sources"]);
});

test("each provider's details share two columns on wider screens and one on phones, and its links are big enough to tap (TRA-172)", () => {
  const file = "../src/components/health-safety.module.css";
  for (const width of [541, 780, 1440]) assert.equal(styles(file, [".providerDetails"], width)["grid-template-columns"], "repeat(2, minmax(0, 1fr))", `${width}px`);
  for (const width of [320, 390, 540]) assert.equal(styles(file, [".providerDetails"], width)["grid-template-columns"], "1fr", `${width}px`);
  assert.equal(styles(file, [".providerDetails > .wide"], 1440)["grid-column"], "1 / -1");
  assert.equal(styles(file, [".contactLink"], 390)["min-height"], "24px");
  assert.equal(styles(file, [".providerDetails dd"], 390)["overflow-wrap"], "anywhere", "a long address or link wraps on a phone");
});
