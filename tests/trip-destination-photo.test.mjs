import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as budget from "../src/lib/budget.ts";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as money from "../src/lib/money.ts";
import * as photoFocus from "../src/lib/photo-focus.ts";
import * as tripDates from "../src/lib/trip-dates.ts";
import { cssRules } from "./css-rules.mjs";
import { createOwnedStore } from "./owned-store.mjs";
import { addDestination, prepared, tripInput } from "./budget-fixtures.mjs";

// TRA-155: the main photo on a trip's destination cards, rendered by the planner from what the store gives
// `/trips/<trip ID>` and `/destinations/<destination ID>`, as their pages do, with each render a page load, and the
// styles each screen width gives it. No browser or server is involved.
function load(file, require) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
const element = (type, props) => ({ type, props });
const modules = {
  // A page load's render: state starts as given, and effects, which run only in a browser, don't run.
  "react": { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}], useTransition: () => [false, () => {}], useId: () => "id", useRef: (current) => ({ current }), useEffect: () => {} },
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
  "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
  "@/lib/budget": budget, "@/lib/destination-label": destinationLabel, "@/lib/money": money, "@/lib/photo-focus": photoFocus, "@/lib/trip-dates": tripDates,
};
// Every other module is one the cards' photos don't use: each of its exports renders, and returns, nothing.
const unused = new Proxy({}, { get: () => () => null });
// A CSS module's class names are their own names.
const require = (name) => name.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : modules[name] ?? unused;
modules["@/components/destination-gallery"] = load("../src/components/destination-gallery.tsx", require);
const { default: PlannerApp } = load("../src/components/planner-app.tsx", require);

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
/** The host elements in a rendered page with a class. */
const byClass = (page, className) => page.filter((node) => String(node.props.className ?? "").split(" ").includes(className));
/** A host element's first child element. */
const first = (node) => node.props.children.find((child) => typeof child !== "string");

const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const photo = () => ({ id: randomUUID(), ...prepared(new Uint8Array(webp)) });
/** A trip to Lisbon, whose second photo is primary with its crop adjusted, then Porto, without photos. */
function plan(t) {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput({ name: "Spring in Portugal" })).id;
  const lisbon = addDestination(store, tripId, { city: "Lisbon" });
  const porto = addDestination(store, tripId, { city: "Porto" });
  const photos = [photo(), photo()];
  store.applyMutation({ type: "destination.save", id: lisbon, gallery: { add: photos, remove: [], mainImageId: photos[1].id, focus: [{ id: photos[1].id, focusX: 20, focusY: 80 }] } });
  const { version } = store.getDestinationSnapshot(lisbon).data.destinations[0].images[1];
  return { store, tripId, lisbon, porto, primary: `/api/destination-images/${lisbon}/${photos[1].id}?v=${version}` };
}
/** The trip's page as `/trips/<trip ID>` renders it, as its host elements in order. */
function tripPage(store, tripId) {
  const { data, access, library } = store.getTripSnapshot(tripId);
  return render(PlannerApp({ initialData: data, access: { [tripId]: access }, library, tripId })).flatMap(within);
}
/** A destination's page as `/destinations/<destination ID>` renders it, as its host elements in order. */
function destinationPage(store, destinationId) {
  const { data, access } = store.getDestinationSnapshot(destinationId);
  return render(PlannerApp({ initialData: data, destinationAccess: { [destinationId]: access }, destinationId })).flatMap(within);
}
/** A card's main photo: the frame its gallery starts with, and the photo in it with its crop. */
function mainPhoto(card) {
  const gallery = first(card);
  assert.equal(gallery.props.className, "gallery");
  const frame = first(gallery);
  const image = first(frame);
  return { gallery: gallery.props["aria-label"], frame: frame.props.className, src: image.props.src, crop: image.props.style.objectPosition };
}

test("a trip's destination cards start with the main photo, in the trip's list of destinations, which a destination's page doesn't have (TRA-155)", (t) => {
  const { store, tripId, lisbon, porto, primary } = plan(t);
  // The phone style applies only in the trip's list, to a photo that starts its card, so the photo meets the card's top edge.
  const trip = tripPage(store, tripId);
  const [list] = byClass(trip, "destination-list");
  assert.equal(byClass(trip, "destination-list").length, 1);
  const cards = list.props.children.filter((child) => child.props.className === "destination-card");
  assert.deepEqual(cards.map((card) => card.props.id), ["destination-" + lisbon, "destination-" + porto]);
  // The primary photo itself, not its thumbnail, cropped around its saved focal point.
  const lisbonPhoto = { gallery: "Photos of Lisbon", frame: "hero", src: primary, crop: "20% 80%" };
  assert.deepEqual(mainPhoto(cards[0]), lisbonPhoto);
  assert.equal(first(cards[1]).props.className, "destination-top", "a destination without photos has no frame");
  // A destination's page shows the same photo, cropped the same way, at the top of its card, outside any trip's list.
  const page = destinationPage(store, lisbon);
  assert.deepEqual(byClass(page, "destination-list"), []);
  const [card] = byClass(page, "destination-card");
  assert.deepEqual(mainPhoto(card), lisbonPhoto);
});

/** Whether an at-rule holds on a screen `width` pixels wide. These rules depend only on the screen's width. */
function holds(atRule, width) {
  if (atRule === null) return true;
  const [, bound, pixels] = atRule.match(/^@media\((max|min)-width:(\d+)px\)$/) ?? assert.fail("Unexpected at-rule " + atRule);
  return bound === "max" ? width <= Number(pixels) : width >= Number(pixels);
}
/**
 * The declarations a CSS file, by its path from tests, gives an element matched by any of `selectors` on a screen
 * `width` pixels wide, each rule over the ones before it, as these rules' specificities agree.
 */
function styles(file, selectors, width) {
  return Object.assign({}, ...cssRules(file).filter(([selector, , atRule]) => selector.split(",").some((part) => selectors.includes(part.trim())) && holds(atRule, width))
    .map(([, declarations]) => declarations));
}
const GALLERY = "../src/components/destination-gallery.module.css";
const GLOBALS = "../src/app/globals.css";
/** The main photo's frame in a trip's destination card, and on a destination's page. */
const TRIP_PHOTO = [".hero", ":global(.destination-list) .hero"];
const PAGE_PHOTO = [".hero"];
/** Phones, up to 540 pixels wide, and tablets and desktops. */
const PHONES = [320, 360, 375, 390, 414, 430, 540];
const WIDER = [541, 600, 744, 780, 834, 1024, 1080, 1440];

test("on phones, a trip's destination card shows its main photo edge to edge across its top, inside its border, in the crop editor's 16:7 shape (TRA-155)", () => {
  for (const width of PHONES) {
    const card = styles(GLOBALS, [".destination-card"], width);
    assert.match(card.padding, /^\d+px$/, "the card's padding is the same on every side");
    const border = Number(card.border.match(/^(\d+)px solid /)[1]);
    const corner = parseInt(card["border-radius"]) - border;
    const framed = styles(GALLERY, PAGE_PHOTO, width);
    // It takes back the card's padding above and beside it, without a border of its own, and its top corners follow the
    // card's inside its border. Everything else is as framed, so it keeps its shape, and fills it without stretching.
    assert.deepEqual(styles(GALLERY, TRIP_PHOTO, width), { ...framed, margin: `-${card.padding} -${card.padding} 0`, border: "0", "border-radius": `${corner}px ${corner}px 0 0` }, `${width}px`);
    assert.equal(framed["aspect-ratio"], styles(GALLERY, [".cropFrame"], width)["aspect-ratio"], "the crop editor's shape, so it shows the crop editor's crop");
  }
  assert.deepEqual(styles(GALLERY, TRIP_PHOTO, 390), {
    position: "relative", overflow: "hidden", border: "0", "border-radius": "9px 9px 0 0", background: "var(--wash)", "aspect-ratio": "16 / 7", margin: "-16px -16px 0",
  });
  assert.deepEqual(styles(GALLERY, [".image"], 390), { display: "block", width: "100%", height: "100%", "object-fit": "cover" }, "the photo covers its frame, cropped rather than stretched");
});

test("tablets, desktops and destination pages keep the main photo inside the card's padding, framed, in the same 16:7 shape (TRA-155)", () => {
  const framed = { position: "relative", overflow: "hidden", border: "1px solid var(--line)", "border-radius": "8px", background: "var(--wash)", "aspect-ratio": "16 / 7" };
  for (const width of WIDER) assert.deepEqual(styles(GALLERY, TRIP_PHOTO, width), framed, `a trip at ${width}px`);
  for (const width of [...PHONES, ...WIDER]) {
    assert.deepEqual(styles(GALLERY, PAGE_PHOTO, width), framed, `a destination's page at ${width}px`);
    assert.equal(styles(GALLERY, [".cropFrame"], width)["aspect-ratio"], "16 / 7", `the crop editor at ${width}px`);
  }
});
