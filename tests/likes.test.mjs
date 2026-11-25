import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import * as tripTags from "../src/lib/trip-tags.ts";
import * as types from "../src/lib/types.ts";
import { createStore, SCHEMA_VERSION } from "../src/lib/store.ts";
import { aiSetup, OWNER as AI_OWNER } from "./ai-fixtures.mjs";
import { addCity, fileDatabase, newItem, tripInput } from "./budget-fixtures.mjs";
import { contrast, cssRules } from "./css-rules.mjs";

// TRA-31: each person can like a trip, destination, hotel, activity, restaurant or church, once, and like it no longer.
// Everyone who can open the item sees how many people like it, and their own like as theirs. A destination's, idea's or
// church's likes go with it into every trip that visits it, and a trip's stay with that trip. Liking changes nothing
// else, only people like items, and deleting an item deletes its likes.

const OWNER = "owner@example.com";
const FRIEND = "friend@example.com";
const NOT_AVAILABLE = { name: "ValidationError", message: "This item no longer exists or isn't shared with you. Please refresh and try again." };
const TABLES = { trip: "trip_likes", destination: "destination_likes", candidate: "candidate_likes", church: "church_likes" };

/**
 * The designated owner, a friend the owner shares a trip with, and an outsider nobody shares anything with. The store
 * closes after the test, unless a test closes it first to start Travel again.
 */
function accounts(t, path = ":memory:") {
  const opened = createStore(path, OWNER);
  let open = true;
  const close = () => { if (open) { open = false; opened.close(); } };
  t.after(close);
  const store = { ...opened, close };
  return { store, owner: store.authorizeAccount(OWNER).id, friend: store.authorizeAccount(FRIEND).id, outsider: store.authorizeAccount("outsider@example.com").id };
}
/**
 * The owner's trip to Portugal, shared with the friend, staying in Lisbon from Saturday, May 1, 2027, for three nights,
 * which include a Sunday, with Church shown, a hotel, an activity, a restaurant and a church there.
 */
function plan(t, path) {
  const context = accounts(t, path);
  const { store, owner } = context;
  const save = (input) => store.applyMutation(owner, input).id;
  const tripId = save(tripInput({ name: "Portugal", startDate: "2027-05-01" }));
  save({ type: "trip.share", tripId, email: FRIEND });
  const lisbon = addCity(save, tripId, "Lisbon", { nights: 3 });
  save({ type: "destination.churchVisibility", id: lisbon, enabled: true });
  const idea = (category, name, overrides = {}) => save({ type: "candidate.save", ...newItem(), destinationId: lisbon, category, name, price: "40", address: "", url: "", notes: "", included: false, ...overrides });
  const hotel = idea("hotels", "Alfama guesthouse", { included: true });
  const activity = idea("activities", "Tram 28", { mustDo: true });
  const restaurant = idea("restaurants", "Taberna", { included: true });
  const church = save({ type: "church.save", ...newItem(), destinationId: lisbon, name: "Sé", address: "", denomination: "", url: "", massTimes: [] });
  return { ...context, save, tripId, lisbon, hotel, activity, restaurant, church };
}
/** Saves whether an account likes an item, as its Like does. */
const like = (store, accountId, kind, id, liked = true) => store.applyMutation(accountId, { type: kind + ".like", id, liked });
/** The likes a trip's page shows an account. */
const tripLikes = (store, accountId, tripId, stopId) => store.getTripSnapshot(accountId, tripId, stopId).data.likes;
/** How many likes are saved for an item, whoever can open it. */
const saved = (path, kind, id) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(`SELECT count(*) AS count FROM ${TABLES[kind]} WHERE ${{ trip: "tripId", destination: "destinationId", candidate: "candidateId", church: "churchId" }[kind]} = ?`).get(id).count; } finally { db.close(); }
};

test("liking an item saves the account's like once, liking it again keeps it, and selecting it again removes it (TRA-31)", (t) => {
  const { store, owner, tripId, lisbon, hotel, activity, restaurant, church } = plan(t);
  for (const [kind, id] of [["trip", tripId], ["destination", lisbon], ["candidate", hotel], ["candidate", activity], ["candidate", restaurant], ["church", church]]) {
    assert.equal(tripLikes(store, owner, tripId)[kind][id], undefined, `${kind}: nobody likes it yet`);
    assert.deepEqual(like(store, owner, kind, id), { id }, kind);
    assert.deepEqual(tripLikes(store, owner, tripId)[kind][id], { count: 1, liked: true }, kind);
    // The same like sent again, as after a lost response, keeps the one like.
    assert.deepEqual(like(store, owner, kind, id), { id });
    assert.deepEqual(tripLikes(store, owner, tripId)[kind][id], { count: 1, liked: true }, `${kind}: one like per account`);
    assert.deepEqual(like(store, owner, kind, id, false), { id });
    assert.equal(tripLikes(store, owner, tripId)[kind][id], undefined, `${kind}: liked no longer`);
    // Removing a like the account doesn't have changes nothing.
    assert.deepEqual(like(store, owner, kind, id, false), { id });
    assert.equal(tripLikes(store, owner, tripId)[kind][id], undefined);
  }
});

test("everyone who can open an item sees how many people like it, each sees their own like as theirs, and each likes on their own (TRA-31)", (t) => {
  const { store, owner, friend, tripId, lisbon, hotel, activity, church } = plan(t);
  like(store, owner, "trip", tripId);
  like(store, friend, "trip", tripId);
  like(store, owner, "candidate", hotel);
  like(store, friend, "candidate", hotel);
  like(store, friend, "candidate", activity);
  like(store, owner, "church", church);
  like(store, friend, "destination", lisbon);
  const expected = (mine) => ({
    trip: { [tripId]: { count: 2, liked: true } },
    destination: { [lisbon]: { count: 1, liked: mine === friend } },
    candidate: { [hotel]: { count: 2, liked: true }, [activity]: { count: 1, liked: mine === friend } },
    church: { [church]: { count: 1, liked: mine === owner } },
  });
  for (const account of [owner, friend]) {
    assert.deepEqual(tripLikes(store, account, tripId), expected(account), "the trip's page");
    // A trip's idea and Church pages for the stay, and the destination's own pages in Destinations, show the same.
    assert.deepEqual(tripLikes(store, account, tripId, lisbon), expected(account), "the stay's idea pages");
    const { trip, ...destinationLikes } = expected(account);
    assert.deepEqual(store.getDestinationSnapshot(account, lisbon).data.likes, { trip: {}, ...destinationLikes }, "the destination's page");
    assert.deepEqual(store.getHomeOverview(account).data.likes, { trip, destination: {}, candidate: {}, church: {} }, "All trips");
    assert.deepEqual(store.getDestinationsOverview(account).data.likes, { trip: {}, destination: destinationLikes.destination, candidate: {}, church: {} }, "Destinations");
  }
  // The friend's Like changes only the friend's like: the owner's stays.
  like(store, friend, "candidate", hotel, false);
  assert.deepEqual(tripLikes(store, owner, tripId).candidate[hotel], { count: 1, liked: true });
  assert.deepEqual(tripLikes(store, friend, tripId).candidate[hotel], { count: 1, liked: false });
  like(store, owner, "trip", tripId, false);
  assert.deepEqual(tripLikes(store, friend, tripId).trip[tripId], { count: 1, liked: true });
});

test("a destination's, idea's and church's likes show in every trip that visits it, and a trip's likes stay with that trip (TRA-31)", (t) => {
  const { store, owner, friend, save, tripId, lisbon, hotel, church } = plan(t);
  // The owner's second trip visits the same Lisbon, with everything saved for it.
  const second = save(tripInput({ name: "Lisbon again" }));
  save({ type: "stop.visit", tripId: second, destinationId: lisbon });
  like(store, friend, "destination", lisbon);
  like(store, friend, "candidate", hotel);
  like(store, friend, "church", church);
  like(store, friend, "trip", tripId);
  const shared = { destination: { [lisbon]: { count: 1, liked: false } }, candidate: { [hotel]: { count: 1, liked: false } }, church: { [church]: { count: 1, liked: false } } };
  assert.deepEqual(tripLikes(store, owner, second), { trip: {}, ...shared }, "the second trip shows Lisbon's likes, and none of the first trip's");
  assert.deepEqual(tripLikes(store, owner, tripId).trip, { [tripId]: { count: 1, liked: false } });
  // Removing Lisbon from the first trip keeps the destination and its likes, in the second trip and on its page.
  const stop = store.getTripSnapshot(owner, tripId).data.stops.find((item) => item.destinationId === lisbon).id;
  save({ type: "stop.remove", id: stop });
  assert.deepEqual(tripLikes(store, owner, second), { trip: {}, ...shared });
  assert.deepEqual(store.getDestinationSnapshot(owner, lisbon).data.likes, { trip: {}, ...shared });
});

test("only an account that can open an item likes it, and a refused like saves nothing (TRA-31)", (t) => {
  const path = fileDatabase(t);
  const { store, owner, friend, outsider, save, tripId, lisbon, hotel, church } = plan(t, path);
  const items = [["trip", tripId], ["destination", lisbon], ["candidate", hotel], ["church", church]];
  for (const [kind, id] of items) {
    for (const liked of [true, false]) assert.throws(() => like(store, outsider, kind, id, liked), NOT_AVAILABLE, kind);
    assert.equal(saved(path, kind, id), 0, `${kind}: nothing is saved`);
    // An item that doesn't exist looks the same.
    assert.throws(() => like(store, owner, kind, "00000000-0000-4000-8000-000000000000"), NOT_AVAILABLE);
  }
  // Only true or false, for a valid ID.
  assert.throws(() => store.applyMutation(owner, { type: "trip.like", id: tripId, liked: "yes" }), { name: "ValidationError", message: "liked must be true or false." });
  assert.throws(() => store.applyMutation(owner, { type: "trip.like", id: tripId }), { name: "ValidationError", message: "liked must be true or false." });
  assert.throws(() => store.applyMutation(owner, { type: "church.like", id: "Sé", liked: true }), { name: "ValidationError", message: "This item has an invalid identifier. Please refresh and try again." });

  // The friend likes everything in the trip they were shared. Once its owner stops sharing it, the friend's likes stay
  // with each item, but the friend can't like or unlike any of them, as they can't open them.
  for (const [kind, id] of items) like(store, friend, kind, id);
  save({ type: "trip.unshare", tripId, email: FRIEND });
  for (const [kind, id] of items) {
    assert.throws(() => like(store, friend, kind, id, false), NOT_AVAILABLE, kind);
    assert.equal(saved(path, kind, id), 1, `${kind}: the friend's like stays with it`);
  }
  assert.deepEqual(tripLikes(store, owner, tripId).candidate[hotel], { count: 1, liked: false });
});

test("liking changes nothing else: Included, Must do, the chosen hotel, budgets and every other detail stay as saved (TRA-31)", (t) => {
  const { store, owner, friend, tripId, lisbon, hotel, activity, restaurant, church } = plan(t);
  const before = store.getSnapshot();
  const estimate = budget.calculateBudget(before, tripId);
  for (const account of [owner, friend]) {
    for (const [kind, id] of [["trip", tripId], ["destination", lisbon], ["candidate", hotel], ["candidate", activity], ["candidate", restaurant], ["church", church]]) like(store, account, kind, id);
  }
  like(store, owner, "candidate", hotel, false);
  assert.deepEqual(store.getSnapshot(), before, "every trip, destination, idea and church is as saved");
  assert.deepEqual(budget.calculateBudget(store.getSnapshot(), tripId), estimate);
  assert.deepEqual(store.getSnapshot().candidates.map(({ name, included, mustDo }) => [name, included, mustDo]), [["Tram 28", false, true], ["Alfama guesthouse", true, false], ["Taberna", true, false]]);
});

test("deleting a trip, destination, idea or church deletes its likes, and removing it from a trip or ending a share keeps them (TRA-31)", (t) => {
  const path = fileDatabase(t);
  const { store, owner, friend, save, tripId, lisbon, hotel, activity, restaurant, church } = plan(t, path);
  const items = [["trip", tripId], ["destination", lisbon], ["candidate", hotel], ["candidate", activity], ["candidate", restaurant], ["church", church]];
  for (const account of [owner, friend]) for (const [kind, id] of items) like(store, account, kind, id);
  save({ type: "church.delete", id: church, destinationId: lisbon });
  assert.equal(saved(path, "church", church), 0, "a deleted church's likes go");
  save({ type: "candidate.delete", id: hotel });
  assert.deepEqual([saved(path, "candidate", hotel), saved(path, "candidate", activity)], [0, 2], "a deleted idea's likes go, and other ideas keep theirs");
  save({ type: "trip.unshare", tripId, email: FRIEND });
  save({ type: "stop.remove", id: store.getTripSnapshot(owner, tripId).data.stops[0].id });
  assert.deepEqual([saved(path, "trip", tripId), saved(path, "destination", lisbon), saved(path, "candidate", restaurant)], [2, 2, 2], "unsharing and removing the stay keep every like");
  save({ type: "destination.delete", id: lisbon });
  assert.deepEqual([saved(path, "destination", lisbon), saved(path, "candidate", activity), saved(path, "candidate", restaurant)], [0, 0, 0], "a deleted destination's likes go, with its ideas' likes");
  save({ type: "trip.delete", id: tripId });
  assert.equal(saved(path, "trip", tripId), 0, "a deleted trip's likes go");
  const db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  for (const table of Object.values(TABLES)) assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0, table);
});

test("likes stay saved when Travel starts again, and each account sees its own as its own (TRA-31)", (t) => {
  const path = fileDatabase(t);
  const first = plan(t, path);
  like(first.store, first.friend, "candidate", first.activity);
  like(first.store, first.owner, "trip", first.tripId);
  first.store.close();
  const store = createStore(path, OWNER);
  t.after(() => store.close());
  assert.deepEqual(tripLikes(store, first.friend, first.tripId), { trip: { [first.tripId]: { count: 1, liked: false } }, destination: {}, candidate: { [first.activity]: { count: 1, liked: true } }, church: {} });
  assert.deepEqual(tripLikes(store, first.owner, first.tripId).trip[first.tripId], { count: 1, liked: true });
});

test("assistants can't like anything, and a trip an assistant deletes shows the likes deleting it removes (TRA-31)", (t) => {
  const { store, owner, ownerTrip, propose, decide } = aiSetup(t);
  const lisbon = addCity((input) => store.applyMutation(owner, input).id, ownerTrip, "Lisbon");
  for (const [kind, id] of [["trip", ownerTrip], ["destination", lisbon]]) {
    for (const liked of [true, false]) {
      assert.throws(() => propose([{ type: kind + ".like", id, liked }]), { name: "ValidationError", message: "Change 1: Each person likes trips, destinations, ideas and churches themselves, so likes can't be proposed." });
    }
  }
  store.applyMutation(owner, { type: "trip.like", id: ownerTrip, liked: true });
  const proposal = propose([{ type: "trip.delete", id: ownerTrip }]);
  assert.ok(proposal.preview[0].records.some((record) => record.action === "Deletes" && record.record === `Trip “Owner trip” (${AI_OWNER}): liked by ${AI_OWNER}` && record.fields.length === 0), "the owner sees whose like goes");
  assert.equal(decide(proposal, true).status, "applied");
  assert.deepEqual(store.getHomeOverview(owner).data.likes.trip, {});
});

test("an older database upgrades to schema 49 with nothing liked and nothing else changed, and a replay keeps saved likes (TRA-31)", (t) => {
  const path = fileDatabase(t);
  const first = plan(t, path);
  const before = first.store.getSnapshot();
  first.store.close();
  const undo = new DatabaseSync(path);
  undo.exec("DROP TABLE trip_likes; DROP TABLE destination_likes; DROP TABLE candidate_likes; DROP TABLE church_likes; PRAGMA user_version = 48;");
  undo.close();
  let store = createStore(path, OWNER);
  assert.equal(SCHEMA_VERSION, 49);
  assert.deepEqual(store.getSnapshot(), before, "every trip, destination, idea and church is as it was");
  assert.deepEqual(tripLikes(store, first.owner, first.tripId), { trip: {}, destination: {}, candidate: {}, church: {} }, "nothing is liked");
  like(store, first.friend, "church", first.church);
  store.close();
  const replay = new DatabaseSync(path);
  replay.exec("PRAGMA user_version = 48;");
  replay.close();
  store = createStore(path, OWNER);
  t.after(() => store.close());
  assert.deepEqual(tripLikes(store, first.friend, first.tripId).church, { [first.church]: { count: 1, liked: true } });
  const db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 49);
});

// The Like itself, and the pages that show it, rendered by their components from what the store gives each page. No
// browser or server is involved.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
const element = (type, props) => ({ type, props });
const icons = new Proxy({}, { get: (_, name) => "icon:" + String(name) });
/** A CSS module's class names are their own names. */
const cssModule = { default: new Proxy({}, { get: (_, key) => String(key) }) };
/** An element as the browser has it: host elements with their children rendered, and text, each component and fragment rendered in its place. */
function render(node) {
  if (Array.isArray(node)) return [...node].flatMap(render);
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node !== "object") return [String(node)];
  if (typeof node.type === "function") return render(node.type(node.props));
  if (node.type === "fragment") return render(node.props.children);
  return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
}
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text, including what only screen readers read. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");
/** A rendered host element's text as the page shows it, without what only screen readers read. */
const shownText = (node) => typeof node === "string" ? node : node.props.className === "sr-only" ? "" : node.props.children.map(shownText).join("");

test("a Like is a heart, filled only while the account likes the item, beside how many people like it, and selecting it asks for the opposite (TRA-31)", () => {
  const modules = { "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" }, "lucide-react": icons };
  const { LikeButton } = load("../src/components/like-button.tsx", (name) => name.endsWith(".module.css") ? cssModule : modules[name] ?? assert.fail(name));
  const calls = [];
  const button = (like, disabled = false) => render(LikeButton({ like, name: "Lisbon", disabled, onLike: (liked, control) => calls.push([liked, control]) }))[0];
  const outlined = button({ count: 0, liked: false });
  assert.deepEqual([outlined.type, outlined.props.type, outlined.props.className, outlined.props["aria-pressed"], outlined.props.disabled], ["button", "button", "like", false, false]);
  const [heart] = outlined.props.children;
  assert.deepEqual([heart.type, heart.props.fill, heart.props["aria-hidden"]], ["icon:Heart", "none", "true"]);
  // Screen readers hear what it likes and its count, and whether it is pressed; the page shows the count beside the heart.
  assert.deepEqual([text(outlined), shownText(outlined)], ["Like Lisbon, 0 likes", "0"]);
  const filled = button({ count: 1, liked: true });
  assert.deepEqual([filled.props["aria-pressed"], filled.props.children[0].props.fill, text(filled), shownText(filled)], [true, "currentColor", "Like Lisbon, 1 like", "1"]);
  assert.deepEqual([text(button({ count: 12, liked: true })), shownText(button({ count: 12, liked: false }))], ["Like Lisbon, 12 likes", "12"]);
  outlined.props.onClick({ currentTarget: outlined });
  filled.props.onClick({ currentTarget: filled });
  assert.deepEqual(calls, [[true, outlined], [false, filled]]);
  assert.equal(button({ count: 3, liked: true }, true).props.disabled, true, "it waits while a change saves");
});

test("a Like is a touch-friendly button whose colors are legible, liked or not, and an idea card's sits over the bottom of its photo (TRA-31)", () => {
  const rules = cssRules("../src/components/like-button.module.css");
  const rule = (selector, atRule = null) => rules.find(([shown, , media]) => shown === selector && media === atRule)?.[1] ?? assert.fail(selector);
  const root = cssRules("../src/app/globals.css").find(([selector]) => selector === ":root")[1];
  const color = (value) => value.startsWith("var(") ? root[value.slice(4, -1)] : value;
  assert.deepEqual([rule(".like")["min-width"], rule(".like")["min-height"]], ["32px", "32px"]);
  assert.deepEqual([rule(".like", "@media(pointer:coarse)")["min-width"], rule(".like", "@media(pointer:coarse)")["min-height"]], ["44px", "44px"], "touchscreens get a 44-pixel target");
  for (const selector of [".like", ".like:hover:not(:disabled)", '.like[aria-pressed="true"]', '.like[aria-pressed="true"]:hover:not(:disabled)']) {
    const shown = { ...rule(".like"), ...(selector.includes("aria-pressed") && rule('.like[aria-pressed="true"]')), ...rule(selector) };
    assert.ok(contrast(color(shown.color), color(shown.background)) >= 4.5, `${selector}: ${shown.color} on ${shown.background}`);
  }
  const ideas = cssRules("../src/components/destination-ideas.module.css");
  const ideaRule = (selector) => ideas.find(([shown, , media]) => shown === selector && media === null)[1];
  assert.equal(ideaRule(".likeSlot")["aspect-ratio"], ideaRule(".photo")["aspect-ratio"], "the Like's box is the photo's shape");
  assert.deepEqual([ideaRule(".likeSlot")["pointer-events"], ideaRule(".likeSlot > *")["pointer-events"]], ["none", "auto"], "only the Like takes taps, and the rest of the photo selects the card");
});

/**
 * A planner page as an account sees it, rendered by the planner from what the store gives it, with the real Like, idea
 * sections, idea lists and churches, and React's state kept between renders so their controls can be used. Its saves
 * are made by the store as the account, unless a test gives the next one's answer.
 */
function plannerPage(save, read) {
  const slots = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(current) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current };
      return slots[index];
    },
    useId: () => "id-" + cursor++,
    useCallback: (callback) => callback,
    // A transition finishes at once, and effects, which run only in a browser, don't run.
    useTransition: () => [false, (work) => work()],
    useEffect: () => {},
  };
  const sent = [];
  const answers = [];
  // Whether a save has asked for the page to load again, as a saved change does.
  let refreshed = false;
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" }, "lucide-react": icons,
    "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() { refreshed = true; } }), unstable_isUnrecognizedActionError: () => false },
    // The page's save: the answer a test gives, or the store's as the account, which refuses a change with its message.
    "@/app/actions": {
      async mutatePlanner(mutation) {
        sent.push({ ...mutation });
        if (answers.length) return answers.shift()();
        try { return { ok: true, ...save(mutation) }; } catch (error) {
          if (error.name === "ValidationError") return { ok: false, error: error.message };
          throw error;
        }
      },
    },
    "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/trip-sort": tripSort, "@/lib/trip-tags": tripTags, "@/lib/types": types,
    // Dragging trips into order (TRA-16) is tested in trip-drag.test.mjs. Here no card or handle takes a drag's props.
    "@/components/trip-drag": { useTripDrag: () => ({ card: () => ({}), handle: () => ({}), announcement: "" }) },
    // Each destination's map shows nothing, but keeps how it opens a place's details, as its markers do (TRA-130).
    "@/components/destination-map": { default: ({ onView }) => { views.push(onView); return null; } },
  };
  const views = [];
  // Every other module is one the Likes don't need: each of its exports renders, and returns, nothing.
  const unused = new Proxy({}, { get: () => () => null });
  const require = (name) => name.endsWith(".module.css") ? cssModule : modules[name] ?? unused;
  modules["@/components/focus-after"] = modules["./focus-after"] = load("../src/components/focus-after.ts", require);
  modules["@/components/like-button"] = load("../src/components/like-button.tsx", require);
  modules["@/components/destination-ideas"] = load("../src/components/destination-ideas.tsx", require);
  modules["@/components/candidate-list"] = load("../src/components/candidate-list.tsx", require);
  modules["@/components/churches"] = load("../src/components/churches.tsx", require);
  const { default: PlannerApp } = load("../src/components/planner-app.tsx", require);
  let props;
  let shown;
  /** The page as it renders now. It renders twice, as React renders again at once when the page changes its state while rendering. */
  const show = () => { for (let pass = 0; pass < 2; pass++) { cursor = 0; shown = render(PlannerApp(props)); } };
  /** Loads the page again, as after a saved change or a refresh. */
  const reload = () => { props = read(); show(); };
  reload();
  const all = () => shown.flatMap(within);
  const dialog = () => all().find((node) => node.type === "dialog");
  const isLike = (node) => node.type === "button" && node.props.className === "like";
  return {
    sent, all,
    /** Each Like on the page, in order, as screen readers hear it, and whether it is pressed. */
    likes: () => all().filter(isLike).map((button) => [text(button), button.props["aria-pressed"]]),
    /** Each Like's button on the page, in order. */
    likeButtons: () => all().filter(isLike),
    /** The Like screen readers hear as `name`. */
    like: (name) => all().find((node) => isLike(node) && text(node).startsWith("Like " + name + ",")),
    /** The element that directly holds a Like. */
    holder: (button) => all().find((node) => node.props.children.includes(button)),
    /** The card that shows an idea's details in a destination's carousel, by the idea's name. */
    card: (name) => all().find((node) => node.props.className === "card" && text(within(node).find((part) => part.props.className === "name")) === name),
    /** The open dialog's title and its Likes, or undefined without one. */
    dialog: () => dialog() && { title: text(within(dialog()).find((node) => node.type === "h2")), likes: within(dialog()).filter(isLike).map((button) => [text(button), button.props["aria-pressed"]]) },
    /** The message a saved change shows, or undefined without one. */
    message: () => { const toast = all().find((node) => node.props.role === "status" && node.props.className === "toast"); return toast && text(toast); },
    /** The error a failed change shows on the page, or undefined without one. */
    error: () => { const toast = all().find((node) => node.props.role === "alert" && node.props.className === "toast error-toast"); return toast && text(toast); },
    /** Selects a control, as a click, a tap, or Enter or Space on it does. */
    select(control) { control.props.onClick({ currentTarget: control }); show(); },
    /** Opens a church's details from its marker on its destination's map, and returns what the dialog shows. */
    openChurch(id) { views.at(-1)({ category: "churches", id }); show(); return dialog() && { title: text(within(dialog()).find((node) => node.type === "h2")), likes: within(dialog()).filter(isLike).map((button) => [text(button), button.props["aria-pressed"]]) }; },
    /** Answers the next save with what `answer` returns, without saving it. */
    answerNext(answer) { answers.push(answer); },
    /** Waits for the save in progress to finish, then shows the page, loaded again if the save asked for that. */
    async settle() {
      await new Promise((resolve) => setImmediate(resolve));
      if (refreshed) { refreshed = false; reload(); } else show();
    },
    reload,
  };
}
/** A trip's page as an account sees it, as `/trips/<trip ID>` loads it. */
const tripPage = (store, accountId, tripId) => plannerPage((input) => store.applyMutation(accountId, input), () => {
  const { data, access, library } = store.getTripSnapshot(accountId, tripId);
  return { initialData: data, access: { [tripId]: access }, library, tripId };
});

test("a trip's page shows the Like of the trip, its destinations, their ideas and their churches, and each saves at once and shows what is saved (TRA-31)", async (t) => {
  const { store, owner, friend, tripId, hotel } = plan(t);
  like(store, friend, "candidate", hotel);
  const page = tripPage(store, owner, tripId);
  assert.deepEqual(page.likes(), [
    ["Like Portugal, 0 likes", false],
    ["Like Lisbon, 0 likes", false],
    ["Like Alfama guesthouse, 1 like", false],
    ["Like Tram 28, 0 likes", false],
    ["Like Taberna, 0 likes", false],
    ["Like Sé, 0 likes", false],
  ], "the trip's heading, the destination's card, each idea's card and the church's card");
  // The trip's Like leads its heading's buttons, the destination's follows its stay's notes, and each idea's sits beside
  // its card, over its photo, so selecting it never shows the idea's details.
  assert.equal(page.holder(page.like("Portugal")).props.className, "heading-actions");
  assert.equal(page.holder(page.like("Lisbon")).props.className, "destination-like");
  assert.equal(page.holder(page.like("Alfama guesthouse")).props.className, "likeSlot");
  assert.ok(!within(page.card("Alfama guesthouse")).includes(page.like("Alfama guesthouse")));
  assert.equal(page.holder(page.like("Sé")).props.className, "idea-tools");

  page.select(page.like("Alfama guesthouse"));
  assert.deepEqual(page.sent, [{ type: "candidate.like", id: hotel, liked: true }], "saved at once, with no Save or confirmation");
  assert.equal(page.dialog(), undefined, "no details open");
  // While it saves it shows what is saved, and no Like can be selected.
  assert.deepEqual(page.likes()[2], ["Like Alfama guesthouse, 1 like", false]);
  assert.ok(page.likeButtons().every((button) => button.props.disabled));
  await page.settle();
  assert.deepEqual(page.likes()[2], ["Like Alfama guesthouse, 2 likes", true]);
  assert.equal(page.message(), "Liked.");
  assert.equal(page.like("Alfama guesthouse").props.disabled, false);
  // The friend sees the same count, and their own like as theirs.
  assert.deepEqual(tripPage(store, friend, tripId).likes()[2], ["Like Alfama guesthouse, 2 likes", true]);

  page.select(page.like("Portugal"));
  await page.settle();
  page.select(page.like("Alfama guesthouse"));
  await page.settle();
  assert.deepEqual(page.sent.slice(1), [{ type: "trip.like", id: tripId, liked: true }, { type: "candidate.like", id: hotel, liked: false }]);
  assert.deepEqual([page.likes()[0], page.likes()[2]], [["Like Portugal, 1 like", true], ["Like Alfama guesthouse, 1 like", false]]);
  assert.equal(page.message(), "Like removed.");
});

test("a Like whose save fails shows the error and keeps showing what is saved (TRA-31)", async (t) => {
  const { store, owner, tripId, lisbon } = plan(t);
  like(store, owner, "destination", lisbon);
  const page = tripPage(store, owner, tripId);
  page.answerNext(() => ({ ok: false, error: "We couldn't save your changes. Please try again." }));
  page.select(page.like("Lisbon"));
  await page.settle();
  assert.equal(page.error(), "We couldn't save your changes. Please try again.");
  assert.deepEqual(page.likes()[1], ["Like Lisbon, 1 like", true], "still liked, as saved");
  assert.deepEqual(tripLikes(store, owner, tripId).destination[lisbon], { count: 1, liked: true });
  // A refused one too, as when the trip was unshared meanwhile.
  page.answerNext(() => ({ ok: false, error: NOT_AVAILABLE.message }));
  page.select(page.like("Lisbon"));
  await page.settle();
  assert.equal(page.error(), NOT_AVAILABLE.message);
  assert.deepEqual(page.likes()[1], ["Like Lisbon, 1 like", true]);
});

test("an idea's and a church's details show its Like above what is saved for it (TRA-31)", async (t) => {
  const { store, owner, lisbon, hotel, church } = plan(t);
  like(store, owner, "church", church);
  const page = plannerPage((input) => store.applyMutation(owner, input), () => {
    const { data, access } = store.getDestinationSnapshot(owner, lisbon);
    return { initialData: data, destinationAccess: { [lisbon]: access }, destinationId: lisbon };
  });
  // The destination's page: its heading, its ideas' cards and its church's card.
  assert.deepEqual(page.likes().map(([name]) => name), ["Like Lisbon, 0 likes", "Like Alfama guesthouse, 0 likes", "Like Tram 28, 0 likes", "Like Taberna, 0 likes", "Like Sé, 1 like"]);
  assert.equal(page.holder(page.like("Lisbon")).props.className, "heading-actions");
  page.select(page.card("Alfama guesthouse"));
  assert.deepEqual(page.dialog(), { title: "Alfama guesthouse", likes: [["Like Alfama guesthouse, 0 likes", false]] });
  assert.equal(page.holder(within(page.all().find((node) => node.type === "dialog")).find((node) => node.props.className === "like")).props.className, "details-like");
  const dialogLike = () => within(page.all().find((node) => node.type === "dialog")).find((node) => node.props.className === "like");
  page.select(dialogLike());
  await page.settle();
  assert.deepEqual(page.sent, [{ type: "candidate.like", id: hotel, liked: true }]);
  assert.deepEqual(page.dialog(), { title: "Alfama guesthouse", likes: [["Like Alfama guesthouse, 1 like", true]] }, "the details stay open, showing the saved like");
  // One that fails shows its error above the details' buttons, where the page's own toast can't be seen, and the details
  // keep showing what is saved.
  page.answerNext(() => ({ ok: false, error: "We couldn't save your changes. Please try again." }));
  page.select(dialogLike());
  await page.settle();
  const footer = within(page.all().find((node) => node.type === "dialog")).find((node) => node.props.className === "dialog-footer");
  assert.deepEqual(footer.props.children.slice(0, 1).map((child) => [child.type, child.props.role, text(child)]), [["p", "alert", "We couldn't save your changes. Please try again."]]);
  assert.deepEqual(page.dialog().likes, [["Like Alfama guesthouse, 1 like", true]]);

  // A church's details, from its marker on the map, show its Like the same way, and keep showing after it saves.
  page.reload();
  page.select(within(page.all().find((node) => node.type === "dialog")).find((node) => node.type === "button" && text(node) === "Close"));
  const churchDetails = page.openChurch(church);
  assert.deepEqual(churchDetails, { title: "Sé", likes: [["Like Sé, 1 like", true]] });
  page.select(dialogLike());
  await page.settle();
  assert.deepEqual(page.sent.at(-1), { type: "church.like", id: church, liked: false });
  assert.deepEqual(page.dialog(), { title: "Sé", likes: [["Like Sé, 0 likes", false]] });
});

test("All trips, Destinations and an idea page show each trip's, destination's and idea's Like on its card (TRA-31)", (t) => {
  const { store, owner, friend, tripId, lisbon, activity } = plan(t);
  like(store, friend, "trip", tripId);
  like(store, owner, "destination", lisbon);
  like(store, friend, "candidate", activity);
  const home = plannerPage((input) => store.applyMutation(owner, input), () => { const { data, budgets, access } = store.getHomeOverview(owner); return { initialData: data, initialBudgets: budgets, access }; });
  assert.deepEqual(home.likes(), [["Like Portugal, 1 like", false]]);
  // Below the card's link, beside Edit.
  assert.equal(home.holder(home.like("Portugal")).props.className, "card-tools-start");
  const destinations = plannerPage((input) => store.applyMutation(owner, input), () => { const { data, access } = store.getDestinationsOverview(owner); return { initialData: data, destinationAccess: access, destinationList: true }; });
  assert.deepEqual(destinations.likes(), [["Like Lisbon, 1 like", true]]);
  assert.equal(destinations.holder(destinations.like("Lisbon")).props.className, "card-tools");
  const activities = plannerPage((input) => store.applyMutation(friend, input), () => {
    const { data, access } = store.getTripSnapshot(friend, tripId, lisbon);
    return { initialData: data, access: { [tripId]: access }, tripId, stopId: lisbon, category: "activities" };
  });
  assert.deepEqual(activities.likes(), [["Like Tram 28, 1 like", true]]);
  assert.equal(activities.holder(activities.like("Tram 28")).props.className, "idea-tools");
});
