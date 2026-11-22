import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as coordinates from "../src/lib/coordinates.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as galleryDraft from "../src/lib/gallery-draft.ts";
import * as imageLimits from "../src/lib/image-limits.ts";
import * as photoSizes from "../src/lib/photo-sizes.ts";
import * as money from "../src/lib/money.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import * as types from "../src/lib/types.ts";
import * as uuid from "../src/lib/uuid.ts";
import { addDestination, candidateInput, newItem, prepared, setup, stop, visit } from "./budget-fixtures.mjs";
import { cssRules, onlyRule } from "./css-rules.mjs";

// The actual components, rendered with each hook's initial state, as on a page's first render. No browser is involved.
const element = (type, props) => ({ type, props });
const shared = {
  "react": { useId: () => "id", useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }), useEffect: () => {} },
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "next/link": { default: "a" }, "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
  "@/lib/budget": budget, "@/lib/coordinates": coordinates, "@/lib/destination-label": destinationLabel, "@/lib/gallery-draft": galleryDraft, "@/lib/image-limits": imageLimits, "@/lib/photo-sizes": photoSizes, "@/lib/money": money, "@/lib/trip-dates": tripDates, "@/lib/types": types, "@/lib/uuid": uuid,
};
/** A component module, given the components it imports. A CSS module's class names are their own names. */
function load(file, modules = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URL,
    require(name) {
      if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (!(name in modules) && !(name in shared)) throw new Error("Unexpected component import: " + name);
      return modules[name] ?? shared[name];
    },
  });
  return exports;
}
// Add image by URL (TRA-139), tested in image-by-url.test.mjs, stands in as an element showing what the editor gives it.
const imageByUrl = { AddImageByUrl: (props) => ({ type: "AddImageByUrl", props }) };
const ideaModules = {
  "./candidate-gallery": load("../src/components/candidate-gallery.tsx", { "./focus-after": load("../src/components/focus-after.ts"), "./image-by-url": imageByUrl, "./photo-browsing": load("../src/components/photo-browsing.tsx"), "./photo-drag": load("../src/components/photo-drag.ts") }),
  "./research-links": load("../src/components/research-links.tsx"),
  "./restaurant-types": load("../src/components/restaurant-types.tsx"),
  "./place-location": load("../src/components/place-location.tsx"),
};
const { DestinationIdeas, IdeaDetails } = load("../src/components/destination-ideas.tsx", ideaModules);
const { default: CandidateList } = load("../src/components/candidate-list.tsx", ideaModules);
const { RestaurantTypesField } = ideaModules["./restaurant-types"];
const { DestinationBudget } = load("../src/components/destination-budget.tsx", { "@/components/focus-after": { useFocusFallback: () => null } });
const { ChurchOptions } = load("../src/components/churches.tsx", { "./candidate-gallery": ideaModules["./candidate-gallery"], "./focus-after": load("../src/components/focus-after.ts"), "./place-location": ideaModules["./place-location"] });
const { ChurchSundays } = load("../src/components/church-sundays.tsx");

/** The host elements an element renders to, with every component rendered. */
function hosts(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (typeof node.type === "function") return hosts(node.type(node.props));
  return [node, ...hosts(node.props.children)];
}
/** An element's text, including what only screen readers read. */
function text(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(typeof node.type === "function" ? node.type(node.props) : node.props.children);
}
/** An element's text as the page shows it, without what only screen readers read. */
function shownText(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(shownText).join("");
  if (typeof node.type === "function") return shownText(node.type(node.props));
  return String(node.props.className ?? "").split(" ").includes("sr-only") ? "" : shownText(node.props.children);
}
const byClass = (nodes, className) => nodes.filter((node) => String(node.props.className ?? "").split(" ").includes(className));

const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
/** A trip's destination with hotels and activities, some chosen for the budget, and no restaurants. */
function seed(t) {
  const { store, tripId } = setup(t);
  const id = addDestination(store, tripId, { city: "Vienna", nights: 3 });
  const [first, second] = [randomUUID(), randomUUID()];
  const save = (category, name, overrides) => store.applyMutation(candidateInput(id, category, { name, price: "", included: false, ...overrides })).id;
  const ideas = {
    first: save("hotels", "First hotel", { price: "980", gallery: { add: [{ id: first, ...prepared(webp) }, { id: second, ...prepared(webp) }], remove: [], mainImageId: second } }),
    chosen: save("hotels", "Chosen hotel", { price: "1250", included: true }),
    third: save("hotels", "Third hotel", { gallery: { add: [{ id: randomUUID(), ...prepared(webp) }], remove: [] } }),
    opera: save("activities", "Opera", { price: "260" }),
    palace: save("activities", "Palace", { price: "80", included: true, mustDo: true }),
    museum: save("activities", "Museum", { price: "40", included: true }),
  };
  return { store, tripId, id, ideas, snapshot: store.getSnapshot() };
}
function render(t) {
  const { snapshot, id, ideas } = seed(t);
  const calls = [];
  const tree = { type: DestinationIdeas, props: {
    ideas: snapshot.candidates.filter((item) => item.destinationId === id), city: "Vienna", pages: "/trips/trip/destinations/stop", busy: false,
    onView: (item) => calls.push(["view", item.id]), onAdd: (category) => calls.push(["add", category]), onBudgetEdit: (category) => calls.push(["budget", category]),
  } };
  const sections = hosts(tree).filter((node) => node.type === "section");
  return { snapshot, ideas, calls, sections: Object.fromEntries(sections.map((section) => [section.props["aria-label"], hosts(section)])), order: sections.map((section) => section.props["aria-label"]) };
}

test("a destination's Hotels, Activities and Restaurants sections start expanded, in that order (TRA-120)", (t) => {
  const { sections, order } = render(t);
  assert.deepEqual(order, ["Hotels", "Activities", "Restaurants"]);
  for (const [name, count] of [["Hotels", 3], ["Activities", 3], ["Restaurants", 0]]) {
    const toggle = sections[name].find((node) => node.props["aria-controls"]);
    assert.equal(text(toggle), name + "(" + count + ")");
    assert.equal(toggle.props["aria-expanded"], true);
    assert.equal(sections[name].find((node) => node.props.id === toggle.props["aria-controls"]).props.hidden, false);
  }
  assert.equal(text(byClass(sections.Restaurants, "empty")[0]), "No restaurants saved yet.");
  assert.deepEqual(byClass(sections.Restaurants, "card"), []);
});

test("each carousel shows ideas chosen for the budget first, each group in its saved order, with photo, name and price", (t) => {
  const { sections, snapshot, ideas } = render(t);
  const cards = (name) => byClass(sections[name], "card").map((card) => {
    const rendered = hosts(card);
    return { name: text(byClass(rendered, "name")[0]), price: text(byClass(rendered, "price")[0]), chosen: text(byClass(rendered, "chosen")[0]), photo: rendered.find((node) => node.type === "img")?.props.src };
  });
  const main = (id) => { const item = snapshot.candidates.find((candidate) => candidate.id === id); const image = item.images.find((photo) => photo.id === item.mainImageId); return `/api/candidate-images/${id}/${image.id}?v=${image.version}`; };
  assert.deepEqual(cards("Hotels"), [
    { name: "Chosen hotel", price: "$1,250", chosen: "Chosen stay", photo: undefined },
    { name: "First hotel", price: "$980", chosen: "", photo: main(ideas.first) },
    { name: "Third hotel", price: "Not estimated", chosen: "", photo: main(ideas.third) },
  ]);
  assert.deepEqual(cards("Activities").map((card) => [card.name, card.chosen]), [["Palace", "In the plan"], ["Museum", "In the plan"], ["Opera", ""]]);
  // Every carousel has its arrows, which wait to be measured before they scroll.
  assert.deepEqual(sections.Hotels.filter((node) => byClass([node], "arrow").length).map((node) => [node.props["aria-label"], node.props.disabled]), [["Previous hotels", true], ["Next hotels", true]]);
});

test("cards show details, and each section edits its budget, adds an idea and links to its page", (t) => {
  const { sections, ideas, calls } = render(t);
  byClass(sections.Hotels, "card")[0].props.onClick();
  for (const [name, category] of [["Hotels", "hotels"], ["Activities", "activities"], ["Restaurants", "restaurants"]]) {
    const buttons = sections[name].filter((node) => node.type === "button");
    buttons.find((node) => text(node).startsWith("Edit budget")).props.onClick();
    buttons.find((node) => text(node).startsWith("Add ")).props.onClick();
    assert.deepEqual(sections[name].filter((node) => node.type === "a").map((link) => [link.props.href, text(link)]), [["/trips/trip/destinations/stop/" + category, "Manage " + category + " in Vienna"]]);
  }
  assert.deepEqual(calls, [["view", ideas.chosen], ["budget", "hotels"], ["add", "hotels"], ["budget", "activities"], ["add", "activities"], ["budget", "restaurants"], ["add", "restaurants"]]);
  assert.deepEqual(sections.Activities.filter((node) => node.type === "button" && !byClass([node], "card").length && !byClass([node], "arrow").length).map(text),
    ["Activities(3)", "Edit budget for activities in Vienna", "Add activity in Vienna"]);
});

test("an idea's details show what its editor saves, read only", (t) => {
  const { store, id } = seed(t);
  const saved = store.applyMutation(candidateInput(id, "activities", { name: "Walking tour", description: "Guided walk through the old town", price: "45.50", address: "Stephansplatz", notes: "Morning\nBring water", links: [{ id: randomUUID(), url: "https://example.com/tour", description: "Booking" }], included: true, mustDo: true,
    coordinates: { latitude: 48.20849, longitude: 16.37208, accuracy: "approximate" } })).id;
  const details = (itemId) => {
    const rendered = hosts({ type: IdeaDetails, props: { item: store.getSnapshot().candidates.find((item) => item.id === itemId) } });
    return rendered.filter((node) => node.type === "div").map((row) => [text(row.props.children[0]), text(row.props.children[1])]);
  };
  assert.deepEqual(details(saved), [
    ["What it is", "Guided walk through the old town"],
    ["Estimated price (USD)", "$45.50Total for the whole party for this activity."],
    ["Address or neighborhood", "Stephansplatz"],
    // Its coordinates, below its address as in its editor, latitude first, with how accurate they are (TRA-150).
    ["Coordinates", "48.20849, 16.37208Approximate"],
    ["Activity photos", "Not added"],
    ["Website and research links", "Bookingexample.com"],
    ["Notes", "Morning\nBring water"],
    ["Must do", "Yes"],
    ["Include in itemized activity costs", "Yes"],
  ]);
  const hotel = store.applyMutation(candidateInput(id, "hotels", { name: "Plain hotel", price: "", included: false })).id;
  assert.deepEqual(details(hotel), [
    ["What it is", "Not added"],
    ["Estimated price (USD)", "Not estimatedTotal for all rooms and the entire stay."],
    ["Address or neighborhood", "Not added"],
    ["Coordinates", "Not added"],
    ["Hotel photos", "Not added"],
    ["Website and research links", "Not added"],
    ["Notes", "Not added"],
    ["Choose this hotel for the budget", "No"],
  ]);
  // A new address leaves the saved coordinates waiting to be checked, and the details say why the map doesn't use them.
  store.applyMutation(candidateInput(id, "activities", { id: saved, name: "Walking tour", price: "45.50", address: "Graben 1", included: true }));
  assert.deepEqual(details(saved).find(([name]) => name === "Coordinates"), ["Coordinates", "48.20849, 16.37208Approximate. The address changed after they were saved, so the map doesn't use them until they're confirmed in the editor."]);
});

test("a restaurant's types show as labeled tags on its cards and in its details, and a restaurant without them shows none (TRA-36)", (t) => {
  const { store, id } = seed(t);
  const both = store.applyMutation(candidateInput(id, "restaurants", { name: "Lunch and drinks", price: "30", included: false, restaurantTypes: ["drinks", "lunch"] })).id;
  const plain = store.applyMutation(candidateInput(id, "restaurants", { name: "No types", price: "", included: false })).id;
  const snapshot = store.getSnapshot();
  const ideas = snapshot.candidates.filter((item) => item.destinationId === id);
  const tags = (nodes) => byClass(nodes, "tag").map(text);
  // The destination's Restaurants carousel, and the hotels' and activities' beside it.
  const overview = hosts({ type: DestinationIdeas, props: { ideas, city: "Vienna", pages: "/destinations/vienna", busy: false, onView() {}, onAdd() {}, onBudgetEdit() {} } });
  const carousel = byClass(overview, "card").map((card) => [text(byClass(hosts(card), "name")[0]), tags(hosts(card))]);
  assert.deepEqual(carousel.filter(([, list]) => list.length), [["Lunch and drinks", ["Lunch", "Drinks"]]]);
  assert.ok(carousel.some(([name]) => name === "No types"));
  // The Restaurants page's cards.
  const list = (category) => hosts({ type: CandidateList, props: { items: ideas.filter((item) => item.category === category), category, destination: snapshot.destinations.find((item) => item.id === id), busy: false, onEdit() {}, onDelete() {}, onMutate() {} } });
  assert.deepEqual(list("restaurants").filter((node) => node.type === "article").map((card) => [card.props["aria-label"], tags(hosts(card))]), [["Lunch and drinks", ["Lunch", "Drinks"]], ["No types", []]]);
  // Only a restaurant with types has a tag list, so no empty one shows anywhere.
  assert.deepEqual([overview, list("restaurants"), list("hotels"), list("activities")].map((nodes) => byClass(nodes, "tags").length), [1, 1, 0, 0]);
  const details = (itemId) => hosts({ type: IdeaDetails, props: { item: ideas.find((item) => item.id === itemId) } }).filter((node) => node.type === "div").map((row) => [text(row.props.children[0]), text(row.props.children[1])]);
  // Below what it is (TRA-138), in its editor's order.
  assert.deepEqual(details(both).slice(0, 3), [["What it is", "Not added"], ["Restaurant types", "LunchDrinks"], ["Estimated price (USD)", "$30Total for one meal for the whole party."]]);
  assert.deepEqual(details(plain).map(([name]) => name), ["What it is", "Estimated price (USD)", "Address or neighborhood", "Coordinates", "Restaurant photos", "Website and research links", "Notes", "Must do", "Include in itemized restaurant costs"], "no empty row or placeholder");
});

test("a restaurant's editor has an independent checkbox for each type, checked as saved (TRA-36)", () => {
  const field = (types, disabled = false) => hosts({ type: RestaurantTypesField, props: { types, disabled } });
  assert.equal(text(field([]).find((node) => node.type === "legend")), "Restaurant types");
  assert.deepEqual(field(["lunch", "drinks"]).filter((node) => node.type === "label").map((label) => {
    const input = hosts(label).find((node) => node.type === "input");
    return [text(label), input.props.type, input.props.name, input.props.value, input.props.defaultChecked];
  }), [
    ["Breakfast", "checkbox", "restaurantTypes", "breakfast", false], ["Lunch", "checkbox", "restaurantTypes", "lunch", true],
    ["Dinner", "checkbox", "restaurantTypes", "dinner", false], ["Snack", "checkbox", "restaurantTypes", "snack", false],
    ["Drinks", "checkbox", "restaurantTypes", "drinks", true],
  ]);
  assert.ok(field([], true).filter((node) => node.type === "input").every((input) => input.props.disabled && !input.props.defaultChecked), "none checked, and disabled while saving");
});

test("the destination budget no longer links to the idea pages, and keeps its other editors (TRA-120)", (t) => {
  const { store, id } = seed(t);
  const rendered = hosts({ type: DestinationBudget, props: { snapshot: store.getSnapshot(), visit: visit(store, id), stop: stop(store, id), onShoppingEdit() {}, onMiscellaneousEdit() {} } });
  assert.deepEqual(rendered.filter((node) => node.type === "a"), []);
  assert.deepEqual(byClass(rendered, "budget-category").map((row) => [text(row.props.children[0]), text(byClass(hosts(row), "budget-category-action")[0])]), [
    ["Accommodation", ""], ["Activities", ""], ["Food", ""],
    ["Shopping", "Edit shopping budget for Vienna"], ["Miscellaneous", "Edit miscellaneous budget for Vienna"],
  ]);
});

test("a destination card's names say what it shows, and its Church headings sit below the card's h4 (TRA-95)", (t) => {
  const { store, id } = seed(t);
  // A city chosen from the suggestions shows shorter, and the budget's editors name it that way.
  store.applyMutation({ type: "destination.save", id, city: "Vienna, Vienna, Austria", cityFromSuggestion: true });
  const budget = hosts({ type: DestinationBudget, props: { snapshot: store.getSnapshot(), visit: visit(store, id), stop: stop(store, id), onShoppingEdit() {}, onMiscellaneousEdit() {} } });
  assert.deepEqual(byClass(budget, "budget-category-action").map(text), ["Edit shopping budget for Vienna, Austria", "Edit miscellaneous budget for Vienna, Austria"]);
  // The Must do toggle's name is the label it shows, then the activity's name.
  const activities = store.getSnapshot().candidates.filter((item) => item.category === "activities");
  const toggles = byClass(hosts({ type: CandidateList, props: { items: activities, category: "activities", destination: visit(store, id), busy: false, onEdit() {}, onDelete() {}, onMutate() {} } }), "must-do");
  assert.deepEqual(toggles.map((toggle) => [shownText(toggle), text(toggle), toggle.props["aria-pressed"], toggle.props["aria-label"]]), [
    ["Mark as must do", "Mark as must do for Opera", false, undefined],
    ["Must do", "Must do for Palace", true, undefined],
    ["Mark as must do", "Mark as must do for Museum", false, undefined],
  ]);
  // At level 5, as the card's Church section passes them below its h4, the Sundays and each church are h5 headings and
  // its Mass times h6, styled by class.
  const headings = (element) => hosts(element).filter((node) => /^h[1-6]$/.test(node.type)).map((node) => [node.type, text(node), node.props.className]);
  const churches = (items) => ({ type: ChurchOptions, props: { items, headingLevel: 5, busy: false, onAdd() {}, onEdit() {}, onDelete() {} } });
  assert.deepEqual(headings({ type: ChurchSundays, props: { destination: stop(store, id), headingLevel: 5 } }), [["h5", "Sundays during your stay", "heading"]]);
  assert.deepEqual(headings(churches([])), [["h5", "Find a church for your visit.", "emptyHeading"]]);
  store.applyMutation({ type: "church.save", ...newItem(), destinationId: id, name: "St. Stephen's Cathedral", address: "", denomination: "", url: "", massTimes: [{ id: randomUUID(), day: "Sunday", time: "10:15 AM" }] });
  assert.deepEqual(headings(churches(store.getSnapshot().churches)), [["h5", "St. Stephen's Cathedral", "name"], ["h6", "Mass times", "timesHeading"]]);
});

test("activity photos fill frames of one shape, and an activity without photos keeps its photo's place on the Activities page (TRA-124)", (t) => {
  const { store, id } = seed(t);
  const [other, main] = [randomUUID(), randomUUID()];
  store.applyMutation(candidateInput(id, "activities", { name: "Tower", included: false, gallery: { add: [{ id: other, ...prepared(webp) }, { id: main, ...prepared(webp) }], remove: [], mainImageId: main } }));
  store.applyMutation(candidateInput(id, "restaurants", { name: "Cafe", included: false }));
  const snapshot = store.getSnapshot();
  const ideas = snapshot.candidates.filter((item) => item.destinationId === id);
  const tower = ideas.find((item) => item.name === "Tower");
  const photo = (image) => `/api/candidate-images/${tower.id}/${image}?v=${tower.images.find((saved) => saved.id === image).version}`;
  const thumbnail = (image) => `/api/candidate-images/${tower.id}/${image}/thumbnail?v=${tower.images.find((saved) => saved.id === image).version}`;
  // The destination's carousels frame every category's photos alike since TRA-137, tested below.
  // The full pages: each activity's card starts with a main photo frame, its gallery's or an empty one of the same size.
  // Hotels and restaurants without photos still show none.
  const frames = (category) => hosts({ type: CandidateList, props: { items: ideas.filter((item) => item.category === category), category, destination: snapshot.destinations.find((item) => item.id === id), busy: false, onEdit() {}, onDelete() {}, onMutate() {} } })
    .filter((node) => node.type === "article").map((card) => {
      const [gallery, frame, content] = hosts(card.props.children[0]);
      return [card.props["aria-label"], gallery && [gallery.props.className, frame.props.className, content.type === "img" ? content.props.src : content.type]];
    });
  assert.deepEqual(frames("activities"), [
    ["Opera", ["gallery", "hero placeholder", "icon:Binoculars"]], ["Palace", ["gallery", "hero placeholder", "icon:Binoculars"]],
    ["Museum", ["gallery", "hero placeholder", "icon:Binoculars"]], ["Tower", ["gallery", "hero", photo(main)]],
  ]);
  assert.deepEqual(frames("hotels").map(([name, frame]) => [name, frame?.[1]]), [["First hotel", "hero"], ["Chosen hotel", undefined], ["Third hotel", "hero"]]);
  assert.deepEqual(frames("restaurants"), [["Cafe", undefined]]);
  // The gallery still opens on the main photo, with every photo's thumbnail in its saved order, as a small image (TRA-89).
  const card = byClass(hosts({ type: CandidateList, props: { items: [tower], category: "activities", destination: snapshot.destinations.find((item) => item.id === id), busy: false, onEdit() {}, onDelete() {}, onMutate() {} } }), "thumbnails");
  assert.deepEqual(hosts(card).filter((node) => node.type === "img").map((node) => node.props.src), [thumbnail(other), thumbnail(main)]);
});

test("hotel, activity and restaurant cards in a destination's carousels show photos at one size, with none, one or several (TRA-137)", (t) => {
  const { store, id } = seed(t);
  // With seed's hotels and activities, every category has ideas without photos, with one, and with several, whose main photo is the last.
  const photos = (count) => { const add = Array.from({ length: count }, () => ({ id: randomUUID(), ...prepared(webp) })); return { gallery: { add, remove: [], mainImageId: add.at(-1).id } }; };
  for (const [category, name, overrides] of [["activities", "Tower", photos(1)], ["activities", "Prater", photos(3)], ["restaurants", "Cafe", {}],
    ["restaurants", "Bistro", { restaurantTypes: ["dinner"], ...photos(1) }], ["restaurants", "Heuriger", photos(3)]]) store.applyMutation(candidateInput(id, category, { name, included: false, ...overrides }));
  const ideas = store.getSnapshot().candidates.filter((item) => item.destinationId === id);
  // A card's main photo, at the size every card's photo has.
  const shown = (name) => { const item = ideas.find((idea) => idea.name === name); const image = item.images.find((photo) => photo.id === item.mainImageId); return [`/api/candidate-images/${item.id}/${image.id}?v=${image.version}`, 400, 300]; };
  const sections = hosts({ type: DestinationIdeas, props: { ideas, city: "Vienna", pages: "/destinations/vienna", busy: false, onView() {}, onAdd() {}, onBudgetEdit() {} } }).filter((node) => node.type === "section");
  // No category's carousel is set apart, and every card's frame shows its main photo or, without one, its category's icon.
  assert.deepEqual(Object.fromEntries(sections.map((section) => {
    const [carousel] = byClass(hosts(section), "carousel");
    return [section.props["aria-label"], [carousel.props.className, ...byClass(hosts(carousel), "card").map((card) => {
      const [frame, content] = hosts(byClass(hosts(card), "photo")[0]);
      return [text(byClass(hosts(card), "name")[0]), frame.props.className, content.type === "img" ? [content.props.src, content.props.width, content.props.height] : content.type];
    })]];
  })), {
    Hotels: ["carousel", ["Chosen hotel", "photo", "icon:BedDouble"], ["First hotel", "photo", shown("First hotel")], ["Third hotel", "photo", shown("Third hotel")]],
    Activities: ["carousel", ["Palace", "photo", "icon:Binoculars"], ["Museum", "photo", "icon:Binoculars"], ["Opera", "photo", "icon:Binoculars"], ["Tower", "photo", shown("Tower")], ["Prater", "photo", shown("Prater")]],
    Restaurants: ["carousel", ["Cafe", "photo", "icon:Utensils"], ["Bistro", "photo", shown("Bistro")], ["Heuriger", "photo", shown("Heuriger")]],
  });
  // Every card's frame and photo are styled alike: a 4:3 frame that its photo covers, cropped rather than stretched. The photo
  // is out of the frame's layout, so a portrait, square or tall photo can't make its frame, or every card in its row, taller.
  const rules = Object.fromEntries(cssRules("../src/components/destination-ideas.module.css").filter(([selector]) => /\.photo\b/.test(selector)));
  assert.deepEqual(Object.keys(rules), [".photo", ".photo img"]);
  assert.deepEqual([rules[".photo"]["aspect-ratio"], rules[".photo"].position], ["4 / 3", "relative"]);
  assert.deepEqual([rules[".photo img"].position, rules[".photo img"].inset, rules[".photo img"]["object-fit"]], ["absolute", "0", "cover"]);
});

test("every hotel, activity and restaurant card shows what it is directly below its name, and nothing there without it (TRA-138)", (t) => {
  const { store, id } = seed(t);
  // seed's ideas have none. Give one in each category a short one, a restaurant with types a long one, and leave another restaurant without.
  const long = "Family-run restaurant serving schnitzel larger than the plate since 1905, with a second dining room around the corner";
  for (const [category, name, overrides] of [["hotels", "Hotel Sacher", { description: "Grand hotel" }], ["activities", "St. Stephen's", { description: "Historic cathedral" }],
    ["restaurants", "Figlmüller", { description: long, restaurantTypes: ["lunch", "dinner"] }], ["restaurants", "Cafe", {}]]) store.applyMutation(candidateInput(id, category, { name, price: "", included: false, ...overrides }));
  const snapshot = store.getSnapshot();
  const ideas = snapshot.candidates.filter((item) => item.destinationId === id);
  /** The element and text of the line with `lineClass` on a card, or null without one, checking it is the element directly below its name. */
  const lineBelow = (card, isName, lineClass) => {
    const nodes = hosts(card);
    const lines = byClass(nodes, lineClass);
    assert.ok(lines.length <= 1 && (lines.length === 0 || lines[0] === nodes[nodes.findIndex(isName) + 1]), "one line, directly below the name");
    return lines.length ? [lines[0].type, text(lines[0])] : null;
  };
  // Every category's cards, in the same way: as written, whole, for the style to show at most two lines of it.
  const expected = (element) => ({
    "Chosen hotel": null, "First hotel": null, "Third hotel": null, "Hotel Sacher": [element, "Grand hotel"],
    Palace: null, Museum: null, Opera: null, "St. Stephen's": [element, "Historic cathedral"],
    Figlmüller: [element, long], Cafe: null,
  });
  // A destination's carousels, whose cards are buttons, so the line is a span.
  const carousel = hosts({ type: DestinationIdeas, props: { ideas, city: "Vienna", pages: "/destinations/vienna", busy: false, onView() {}, onAdd() {}, onBudgetEdit() {} } });
  const isName = (node) => byClass([node], "name").length > 0;
  assert.deepEqual(Object.fromEntries(byClass(carousel, "card").map((card) => [text(byClass(hosts(card), "name")[0]), lineBelow(card, isName, "description")])), expected("span"));
  // Then a restaurant's types and its price, below it.
  const figlmuller = byClass(carousel, "card").find((card) => text(byClass(hosts(card), "name")[0]) === "Figlmüller");
  assert.deepEqual(hosts(figlmuller).map((node) => node.props.className).filter(Boolean), ["card", "photo", "name", "description", "tags types", "tag", "tag", "price unknown"]);
  // The Hotels, Activities and Restaurants pages, where each card's name is its heading.
  const page = (category) => hosts({ type: CandidateList, props: { items: ideas.filter((item) => item.category === category), category, destination: snapshot.destinations.find((item) => item.id === id), busy: false, onEdit() {}, onDelete() {}, onMutate() {} } });
  assert.deepEqual(Object.fromEntries(["hotels", "activities", "restaurants"].flatMap((category) => page(category).filter((node) => node.type === "article")
    .map((card) => [card.props["aria-label"], lineBelow(card, (node) => node.type === "h2", "idea-description")]))), expected("p"));
  // Then a restaurant's types, as in the carousel.
  const card = hosts(page("restaurants").find((node) => node.type === "article" && node.props["aria-label"] === "Figlmüller"));
  const heading = card.findIndex((node) => node.type === "h2");
  assert.deepEqual(card.slice(heading, heading + 3).map((node) => [node.type, node.props.className]), [["h2", undefined], ["p", "idea-description"], ["span", "tags idea-types"]]);
});

test("what an idea is shows at most two lines on its cards at every screen width, ending in an ellipsis when it is longer (TRA-138)", () => {
  // A clamp of two lines, which ends the second in an ellipsis, and no rule for another screen width changes it.
  const clamp = { display: "-webkit-box", "-webkit-box-orient": "vertical", "-webkit-line-clamp": "2", overflow: "hidden", "overflow-wrap": "anywhere" };
  for (const [file, selector] of [["../src/components/destination-ideas.module.css", ".description"], ["../src/app/globals.css", ".idea-description"]]) {
    const rule = onlyRule(file, selector);
    assert.deepEqual(Object.fromEntries(Object.keys(clamp).map((property) => [property, rule[property]])), clamp, selector);
  }
});
