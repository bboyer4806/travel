import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as photoFocus from "../src/lib/photo-focus.ts";
import * as tripSort from "../src/lib/trip-sort.ts";
import { createOwnedStore } from "./owned-store.mjs";
import { addDestination, candidateInput, destinationEdit, prepared, tripInput } from "./budget-fixtures.mjs";

// TRA-131: the cards of All destinations, rendered by the planner from what the store gives `/destinations`, as its page
// does, with each render a page load. No browser or server is involved.
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
  // A link is the anchor the browser follows.
  "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
  "@/lib/destination-label": destinationLabel, "@/lib/photo-focus": photoFocus, "@/lib/trip-sort": tripSort,
};
// Every other module is one the cards don't use: each of its exports renders, and returns, nothing.
const unused = new Proxy({}, { get: () => () => null });
const require = (name) => modules[name] ?? unused;
modules["@/components/destination-gallery"] = load("../src/components/destination-gallery.tsx", require);
const { default: PlannerApp } = load("../src/components/planner-app.tsx", require);

/** An element as the browser has it: host elements with their children rendered, and text, each component rendered in its place. */
function render(node) {
  if (Array.isArray(node)) return node.flatMap(render);
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node !== "object") return [String(node)];
  if (typeof node.type === "function") return render(node.type(node.props));
  return [{ type: node.type, props: { ...node.props, children: render(node.props.children) } }];
}
/** A rendered host element and the host elements in it, in order. */
const within = (node) => typeof node === "string" ? [] : [node, ...node.props.children.flatMap(within)];
/** A rendered host element's text. */
const text = (node) => typeof node === "string" ? node : node.props.children.map(text).join("");
/** A host element as a card shows it: its tag, class, address or photo, and text. */
function describe(node) {
  const { className, href, src, alt, loading, style } = node.props;
  return { type: node.type, ...(className && { className }), ...(href && { href }), ...(src && { src, alt, loading, position: style.objectPosition }), text: text(node) };
}

/** Each destination's card on All destinations, in order: where its link goes, what the link shows, and anything else on the card. */
function cards(store) {
  const { data, access } = store.getDestinationsOverview();
  const page = render(PlannerApp({ initialData: data, destinationAccess: access, destinationList: true })).flatMap(within);
  return page.filter((node) => node.type === "article").map((card) => {
    const link = card.props.children.find((child) => child.type === "a");
    return { href: link.props.href, text: text(link), shown: within(link).slice(1).map(describe), outside: card.props.children.filter((child) => child !== link).map(describe) };
  });
}
/** The address of a destination's saved photo, with the version it has now. */
function photoUrl(store, destinationId, imageId) {
  const { version } = store.getDestinationsOverview().data.destinations.find((item) => item.id === destinationId).images.find((image) => image.id === imageId);
  return `/api/destination-images/${destinationId}/${imageId}?v=${version}`;
}

const webp = new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"));
const photo = () => ({ id: randomUUID(), ...prepared(new Uint8Array(webp)) });
/** Lisbon, in a trip with a hotel idea, and Porto, a destination of its own without photos. */
function plan(t) {
  const store = createOwnedStore(":memory:");
  t.after(() => store.close());
  const tripId = store.applyMutation(tripInput({ name: "Spring in Portugal" })).id;
  const lisbon = addDestination(store, tripId, { city: "Lisbon" });
  store.applyMutation(candidateInput(lisbon, "hotels", { name: "Alfama guesthouse" }));
  const porto = store.applyMutation({ type: "destination.create", city: "Porto" }).id;
  return { store, lisbon, porto };
}

test("a destination's card shows only its primary photo, across its top and cropped as saved, and opens the destination like the rest of the card", (t) => {
  const { store, lisbon, porto } = plan(t);
  const before = cards(store);
  assert.deepEqual(before.map((card) => [card.href, card.text]), [
    ["/destinations/" + lisbon, "DESTINATION 01LisbonSpring in Portugal1 hotel0 activities0 restaurants"],
    ["/destinations/" + porto, "DESTINATION 02PortoNot in a trip0 hotels0 activities0 restaurants"],
  ]);
  const photos = [photo(), photo(), photo()];
  store.applyMutation({ type: "destination.save", id: lisbon, gallery: { add: photos, remove: [], mainImageId: photos[1].id, focus: [{ id: photos[0].id, focusX: 10, focusY: 30 }, { id: photos[1].id, focusX: 20, focusY: 80 }] } });
  const [withPhoto, withoutPhoto] = cards(store);
  // The primary photo, not the gallery's first, with its own focal point, comes first in the card's link.
  const [frame, image, ...details] = withPhoto.shown;
  assert.deepEqual(frame, { type: "div", className: "trip-card-image", text: "" });
  assert.deepEqual(image, { type: "img", src: photoUrl(store, lisbon, photos[1].id), alt: "", loading: "lazy", position: "20% 80%", text: "" }, "the city's name follows the photo, so the photo is decorative");
  assert.equal(withPhoto.shown.filter((node) => node.type === "img").length, 1, "no other photo shows");
  assert.equal(withPhoto.href, "/destinations/" + lisbon);
  assert.deepEqual(withPhoto.outside, [], "the link is the whole card, so selecting the photo opens the destination");
  assert.deepEqual(details, before[0].shown, "the card's name, trips and idea counts follow the photo as they were");
  assert.equal(withPhoto.text, before[0].text);
  // A destination without photos keeps its card exactly, with no frame or placeholder.
  assert.deepEqual(withoutPhoto, before[1]);
  assert.equal(withoutPhoto.shown[0].className, "trip-card-top");
});

test("choosing, recentering, replacing or removing a destination's primary photo changes its card when the list loads again", (t) => {
  const { store, lisbon } = plan(t);
  const [original] = cards(store);
  /** The photo Lisbon's card shows: its address and its crop, or nothing. */
  const shown = () => {
    const [card] = cards(store);
    const image = card.shown.find((node) => node.type === "img");
    return image && { src: image.src, position: image.position };
  };
  const photos = [photo(), photo(), photo()];
  // Photos added without a choice make the first one primary.
  store.applyMutation({ type: "destination.save", id: lisbon, gallery: { add: photos, remove: [], focus: [{ id: photos[0].id, focusX: 10, focusY: 30 }] } });
  assert.deepEqual(shown(), { src: photoUrl(store, lisbon, photos[0].id), position: "10% 30%" });
  store.applyMutation({ type: "destination.save", id: lisbon, gallery: { add: [], remove: [], mainImageId: photos[2].id } });
  assert.deepEqual(shown(), { src: photoUrl(store, lisbon, photos[2].id), position: "50% 50%" });
  store.applyMutation({ type: "destination.save", id: lisbon, gallery: { add: [], remove: [], focus: [{ id: photos[2].id, focusX: 75, focusY: 25 }] } });
  assert.deepEqual(shown(), { src: photoUrl(store, lisbon, photos[2].id), position: "75% 25%" });
  // An older client's single image replaces the primary photo's file under the same ID, so only its version tells browsers.
  const replaced = shown().src;
  store.applyMutation(destinationEdit(lisbon, { image: prepared(new Uint8Array(webp)) }));
  assert.notEqual(shown().src, replaced);
  assert.deepEqual(shown(), { src: photoUrl(store, lisbon, photos[2].id), position: "50% 50%" });
  // Removing the primary photo makes the first remaining one primary.
  store.applyMutation({ type: "destination.save", id: lisbon, gallery: { add: [], remove: [photos[2].id] } });
  assert.deepEqual(shown(), { src: photoUrl(store, lisbon, photos[0].id), position: "10% 30%" });
  store.applyMutation({ type: "destination.save", id: lisbon, gallery: { add: [], remove: [photos[0].id, photos[1].id], mainImageId: null, order: [] } });
  assert.equal(shown(), undefined);
  assert.deepEqual(cards(store)[0], original, "without photos, the card is as it was before it had any");
});
