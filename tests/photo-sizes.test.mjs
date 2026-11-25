import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as destinationLabel from "../src/lib/destination-label.ts";
import * as imageLimits from "../src/lib/image-limits.ts";
import * as money from "../src/lib/money.ts";
import * as photoFocus from "../src/lib/photo-focus.ts";
import * as photoSizes from "../src/lib/photo-sizes.ts";
import * as types from "../src/lib/types.ts";

// TRA-154: every photo frame offers a photo's large version beside the photo, at the width the frame shows, so browsers
// load the large version only when the frame shows more pixels than the photo has.
const { CARD, CARD_PREVIEW, CAROUSEL_CARD, DIALOG, HALF_PAGE, MAIN_COLUMN, PAGE } = photoSizes;
const widths = { photo: 1600, large: 2560 };

test("a photo with a large version offers both at their widths, sized as its frame is, zoomed or not, and one without offers neither", () => {
  assert.deepEqual(photoSizes.photoSizes("/photo?v=1", "/photo/large?v=1", widths, PAGE), {
    srcSet: "/photo?v=1 1600w, /photo/large?v=1 2560w",
    sizes: "(max-width: 540px) calc((100vw - 36px) * 1), (max-width: 780px) calc((100vw - 48px) * 1), (max-width: 1360px) calc((100vw - 112px) * 1), calc((1248px) * 1)",
  });
  assert.equal(photoSizes.photoSizes("/photo", "/large", { photo: 900, large: 1440 }, CAROUSEL_CARD, 2.5).sizes, "calc((200px) * 2.5)", "a zoomed crop shows more of the photo's pixels");
  assert.equal(photoSizes.photoSizes("/photo", "/large", { photo: 900, large: 1440 }, CAROUSEL_CARD).srcSet, "/photo 900w, /large 1440w");
  assert.deepEqual(photoSizes.photoSizes("/photo", "/large", null, PAGE), {}, "a photo without one loads as it did");
});

/** How wide a frame's `sizes` says it is at a viewport width: its first width that applies, worked out. */
function claimed(frame, viewport) {
  const [, width] = frame.find(([maxViewport]) => maxViewport === null || viewport <= maxViewport);
  const expression = width.replaceAll("100vw", String(viewport)).replaceAll("px", "");
  assert.match(expression, /^[\d\s+\-*/().]+$/);
  return Function(`return ${expression}`)();
}

test("each frame's width is the width Chromium lays its photo out at, at every screen width", () => {
  // Measured in Chromium on Travel's pages, at 390, 560, 700, 1000, 1200 and 1440 pixels wide. Frames leave out their
  // 1-pixel borders, and a carousel's cards are a little wider on phones: neither changes which version loads. A
  // destination's photo is measured on a trip's card; on the destination's own page it is 34 pixels narrower on phones
  // (318 at 390), far from the 1600 device pixels where the version changes.
  const laidOut = [
    [PAGE, [352, 510, 650, 886, 1086, 1246]], [CARD, [352, 243, 313, 431, 346, 399]], [MAIN_COLUMN, [352, 472, 612, 564, 704, 864]],
    [HALF_PAGE, [308, 208, 278, 383, 483, 563]], [DIALOG, [324, 470, 502, 502, 502, 502]], [CARD_PREVIEW, [318, 318, 318, 318, 318, 318]],
    [CAROUSEL_CARD, [204, 198, 198, 198, 198, 198]],
  ];
  for (const [frame, measured] of laidOut) {
    [390, 560, 700, 1000, 1200, 1440].forEach((viewport, index) => {
      const difference = claimed(frame, viewport) - measured[index];
      assert.ok(difference >= -4 && difference <= 2, `${JSON.stringify(frame)} at ${viewport}: ${claimed(frame, viewport)} for ${measured[index]}`);
    });
  }
});

// The components, rendered as a page load renders them: state starts as given, and effects, which run only in a
// browser, don't run. No browser or server is involved.
const element = (type, props) => ({ type, props });
const modules = {
  "react": { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}], useRef: (current) => ({ current }), useEffect() {}, useEffectEvent: (callback) => callback, useId: () => "id" },
  "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
  "lucide-react": new Proxy({}, { get: (_, name) => "icon:" + String(name) }),
  "next/link": { default: ({ children, ...props }) => element("a", { ...props, children }) },
  "@/lib/destination-label": destinationLabel, "@/lib/image-limits": imageLimits, "@/lib/money": money, "@/lib/photo-focus": photoFocus, "@/lib/photo-sizes": photoSizes, "@/lib/types": types,
};
// Every other module is one these photos don't use: each of its exports renders, and returns, nothing.
const unused = new Proxy({}, { get: () => () => null });
function require(name) {
  // A CSS module's class names are their own names.
  if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
  return modules[name] ?? unused;
}
function load(file) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
modules["./candidate-gallery"] = load("../src/components/candidate-gallery.tsx");
const { TripImageView } = load("../src/components/trip-image.tsx");
const { DestinationCardPhoto, DestinationGallery } = load("../src/components/destination-gallery.tsx");
const { CandidateGallery } = modules["./candidate-gallery"];
const { DestinationIdeas } = load("../src/components/destination-ideas.tsx");

/** Each photo an element renders: its address, and the versions and sizes it offers. */
function photos(node) {
  if (Array.isArray(node)) return node.flatMap(photos);
  if (!node || typeof node !== "object") return [];
  if (typeof node.type === "function") return photos(node.type(node.props));
  return [...(node.type === "img" ? [{ src: node.props.src, srcSet: node.props.srcSet, sizes: node.props.sizes }] : []), ...photos(node.props.children)];
}
/** What a photo filling `frame` offers, with the large version at its address. */
const offered = (src, large, frame, zoom = 1) => ({ src, ...photoSizes.photoSizes(src, large, widths, frame, zoom) });
const none = (src) => ({ src, srcSet: undefined, sizes: undefined });

test("a trip's banner and card offer its headline image's large version at their widths times their zoom", () => {
  const trip = { id: randomUUID(), image: { version: randomUUID(), card: { focusX: 50, focusY: 50, zoom: 2 }, banner: { focusX: 30, focusY: 60, zoom: 1.25 }, widths } };
  const src = `/api/trip-images/${trip.id}?v=${trip.image.version}`;
  const large = `/api/trip-images/${trip.id}/large?v=${trip.image.version}`;
  assert.deepEqual(photos(TripImageView({ trip, frame: "banner" })), [offered(src, large, PAGE, 1.25)]);
  assert.deepEqual(photos(TripImageView({ trip, frame: "card" })), [offered(src, large, CARD, 2)]);
  assert.deepEqual(photos(TripImageView({ trip: { ...trip, image: { ...trip.image, widths: null } }, frame: "banner" })), [none(src)], "an image saved without one shows as before");
});

test("a destination's main photo and its card in Destinations offer its large version, and its thumbnails stay thumbnails", () => {
  const [first, second] = [{ id: randomUUID(), version: randomUUID(), focusX: 50, focusY: 50, widths }, { id: randomUUID(), version: randomUUID(), focusX: 20, focusY: 80, widths: null }];
  const destination = { id: randomUUID(), city: "Kyoto", cityFromSuggestion: false, images: [first, second], mainImageId: first.id };
  const address = (photo, path = "") => `/api/destination-images/${destination.id}/${photo.id}${path}?v=${photo.version}`;
  assert.deepEqual(photos(DestinationGallery({ destination })), [
    offered(address(first), address(first, "/large"), MAIN_COLUMN), none(address(first, "/thumbnail")), none(address(second, "/thumbnail")),
  ]);
  assert.deepEqual(photos(DestinationCardPhoto({ destination })), [offered(address(first), address(first, "/large"), CARD)]);
  assert.deepEqual(photos(DestinationCardPhoto({ destination: { ...destination, mainImageId: second.id } })), [none(address(second))]);
});

test("an idea's and a church's main photo offer its large version at the width of wherever its gallery shows, and a carousel's cards at theirs", () => {
  const photo = { id: randomUUID(), version: randomUUID(), widths };
  const hotel = { id: randomUUID(), name: "Ryokan", category: "hotels", included: false, images: [photo], mainImageId: photo.id, restaurantTypes: [], priceCents: null, description: "" };
  const address = (kind, path = "") => `/api/${kind}-images/${hotel.id}/${photo.id}${path}?v=${photo.version}`;
  for (const frame of [HALF_PAGE, DIALOG, MAIN_COLUMN, PAGE]) {
    assert.deepEqual(photos(CandidateGallery({ candidate: hotel, frame })), [offered(address("candidate"), address("candidate", "/large"), frame)]);
    assert.deepEqual(photos(CandidateGallery({ candidate: hotel, frame, imageKind: "church", browse: true })), [offered(address("church"), address("church", "/large"), frame)]);
  }
  const cards = photos(DestinationIdeas({ ideas: [hotel], city: "Kyoto", pages: "/destinations/kyoto", busy: false, onView() {}, onAdd() {}, onBudgetEdit() {}, like: () => null }));
  assert.deepEqual(cards, [offered(address("candidate"), address("candidate", "/large"), CAROUSEL_CARD)]);
});
