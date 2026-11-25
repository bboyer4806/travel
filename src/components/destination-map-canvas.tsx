"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MAP_PLACE_LABELS, type DestinationMarker, type MappedPlace } from "@/lib/destination-map";
import { popupPosition } from "@/lib/trip-map";
import type { CandidateImage } from "@/lib/types";
import { thumbnailUrl } from "./candidate-gallery";
import { GroupSymbol, PlaceSymbol } from "./destination-map-symbols";
import styles from "./destination-map.module.css";

// How close the map frames a single place, with the streets around it in view.
const MAX_ZOOM = 16;
const SIZE = 30;
// How far an opening popup keeps from the map's edges, and how much of a popup surrounds its content: Leaflet's margins
// above and below it (13 px each), the padding around them (1 px each) and its tip (20 px).
const PAN_PADDING = 16;
const POPUP_FRAME = 48;
// How long a marker's preview stays once the pointer leaves the marker and the preview, so the pointer can cross between
// the two, as long as the trip map's previews stay (TRA-143, TRA-188).
const PREVIEW_CLOSE_DELAY = 200;

/** The marker whose preview the pointer is over, on the marker or the preview, and whether it has left both. */
interface Hover { marker: DestinationMarker; leaving: boolean }
const leave = (hover: Hover | null): Hover | null => hover && { marker: hover.marker, leaving: true };

/** The address of a place's primary photo's thumbnail, from its gallery, which its popup (TRA-152) and preview (TRA-188) show. */
function photoUrl(place: MappedPlace, photo: CandidateImage): string {
  return thumbnailUrl(place.id, photo, place.category === "churches" ? "church" : "candidate");
}

/**
 * Where a marker's tooltip says a place is: the address OpenStreetMap has where it was found, or its saved coordinates,
 * which never name an address, so approximate ones aren't taken for a verified one (TRA-150).
 */
function shownAt(place: MappedPlace): string {
  return place.found !== null ? "Shown at " + place.found : place.approximate ? "Shown at its approximate coordinates" : "Shown at its saved coordinates";
}

function element(tag: "span" | "div", className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * A destination's saved places on an OpenStreetMap map (TRA-130): Leaflet places each marker and its popup, and React
 * draws what is in them. The map frames every marker when it opens and whenever their positions change, and leaves zoom
 * and panning alone otherwise, so a place saved far from its destination is in view too (TRA-150). Selecting a marker,
 * by pointer, touch, Enter or Space, opens its popup: for each place there, its primary photo when it has one (TRA-152),
 * then its name and category, whether it is shown at approximate coordinates, and View details. A popup taller than the
 * map has room for, as with several places' photos, scrolls. The popup takes focus as it opens, and Escape closes it and
 * returns focus to its marker.
 *
 * A marker shows a preview of its places (TRA-188), as the trip map previews a destination (TRA-143): for each, its primary
 * photo when it has one, then its name and category, while a mouse or pen is over the marker or the preview, and while
 * the keyboard is on the marker. It closes a moment after the pointer leaves both, when the keyboard moves on, on Escape,
 * and once the markers are drawn again, as when a checkbox hides places. Touch has no hover, so a tap opens the popup as
 * before, without one. Opening a popup closes the preview, and none shows while a popup is open, since it would cover it.
 */
export default function DestinationMapCanvas({ markers, onView }: { markers: DestinationMarker[]; onView: (place: MappedPlace) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  // The positions the map last framed.
  const framed = useRef("");
  // Each marker's symbol and popup, which Leaflet places on the map and React renders into.
  const elements = useMemo(() => new Map(markers.map((marker) => [marker.key, { symbol: element("span", styles.content), popup: element("div", styles.popup) }])), [markers]);
  const [hovered, setHovered] = useState<Hover | null>(null);
  // The marker the keyboard is on.
  const [focused, setFocused] = useState<DestinationMarker | null>(null);
  // Whether the map is moving, as when Leaflet brings a marker the keyboard reaches into view. The preview waits until it
  // stops, then shows beside its marker where the marker ends up.
  const [moving, setMoving] = useState(false);
  // Whether a marker's popup is open.
  const popupOpen = useRef(false);
  const preview = useRef<HTMLUListElement>(null);
  // A preview belongs to the markers drawn as it opened: once they are drawn again, it waits for the pointer or the
  // keyboard to reach a marker again.
  const reached = hovered?.marker ?? focused;
  const shown = reached && markers.includes(reached) ? reached : null;
  const previewed = moving ? null : shown;

  useLayoutEffect(() => {
    const instance = L.map(container.current!, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(instance);
    // The mouse wheel zooms only once the map is selected, so scrolling the page past it scrolls the page.
    instance.on("focus", () => instance.scrollWheelZoom.enable());
    instance.on("blur", () => instance.scrollWheelZoom.disable());
    instance.on("movestart zoomstart", () => setMoving(true));
    instance.on("moveend", () => setMoving(false));
    layers.current = L.layerGroup().addTo(instance);
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      layers.current = null;
      framed.current = "";
    };
  }, []);

  useLayoutEffect(() => {
    const instance = map.current, group = layers.current;
    if (!instance || !group) return;
    const positions = markers.map((marker) => marker.position);
    const frame = JSON.stringify([...positions].sort());
    if (frame !== framed.current) {
      instance.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: MAX_ZOOM, animate: false });
      framed.current = frame;
    }
    group.clearLayers();
    const closers: (() => void)[] = [];
    const maxHeight = instance.getSize().y - POPUP_FRAME - 2 * PAN_PADDING;
    for (const marker of markers) {
      const { symbol, popup } = elements.get(marker.key)!;
      const names = marker.places.map((place) => MAP_PLACE_LABELS[place.category] + ": " + place.name + (place.approximate ? " (approximate location)" : ""));
      const item = L.marker(marker.position, {
        icon: L.divIcon({ className: styles.anchor, html: symbol, iconSize: [SIZE, SIZE] }),
        title: marker.places.map((place, index) => names[index] + "\n" + shownAt(place)).join("\n"),
        keyboard: true,
      }).bindPopup(popup, { maxWidth: 280, maxHeight, autoPanPadding: [PAN_PADDING, PAN_PADDING] }).addTo(group);
      const target = item.getElement()!;
      target.setAttribute("aria-label", names.join("; "));
      // Pointing to the marker with a mouse or pen shows its preview, which touch, without hover, never does. Neither the
      // pointer nor the keyboard opens one while a popup is open.
      target.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch" && !popupOpen.current) setHovered({ marker, leaving: false }); });
      // React tells the preview the pointer has reached it before the marker hears it has left, so leaving the marker
      // straight for the preview leaves it open.
      target.addEventListener("pointerleave", (event) => { if (!preview.current?.contains(event.relatedTarget as Node | null)) setHovered(leave); });
      // Only the keyboard's focus shows it: a click or tap focuses the marker too, on its way to its popup.
      target.addEventListener("focus", () => { if (!popupOpen.current && target.matches(":focus-visible")) setFocused(marker); });
      target.addEventListener("blur", () => setFocused(null));
      // Leaflet opens a marker's popup on Enter, and Space, as for any button, opens it too.
      item.on("keydown", (event) => {
        const { originalEvent } = event as L.LeafletKeyboardEvent;
        if (originalEvent.key !== " ") return;
        originalEvent.preventDefault();
        item.openPopup();
      });
      // Leaflet measures a popup's width before it knows the popup scrolls, so a popup that scrolls is measured again, with
      // its scrollbar and the room for View details' focus ring around its content (TRA-152). Then focus moves without
      // scrolling, which would shift Leaflet's panes within the map. The popup closes the preview, which would cover it.
      item.on("popupopen", () => {
        popupOpen.current = true;
        setHovered(null);
        setFocused(null);
        const opened = item.getPopup()!;
        if (opened.getElement()!.querySelector(".leaflet-popup-scrolled")) opened.update();
        popup.querySelector("button")?.focus({ preventScroll: true });
      });
      // Focus a closing popup returns to its marker shows no preview, so closing a popup shows nothing new.
      item.on("popupclose", () => {
        const active = document.activeElement;
        if (active === document.body || item.getPopup()?.getElement()?.contains(active)) target.focus({ preventScroll: true });
        popupOpen.current = false;
      });
      // Leaflet closes a popup on Escape only while the map itself has focus.
      const close = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        item.closePopup();
      };
      popup.addEventListener("keydown", close);
      closers.push(() => popup.removeEventListener("keydown", close));
    }
    return () => { for (const remove of closers) remove(); };
  }, [markers, elements]);

  useEffect(() => {
    if (!hovered?.leaving) return;
    const timer = setTimeout(() => setHovered(null), PREVIEW_CLOSE_DELAY);
    return () => clearTimeout(timer);
  }, [hovered]);

  // Escape closes the preview without moving the pointer or the keyboard. It shows again once either comes back.
  useEffect(() => {
    if (shown === null) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHovered(null);
      setFocused(null);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [shown]);

  // The preview goes above or below its marker wherever the map has room for all of it, as the trip map's do, or else
  // beside it, as a connection's popup does, so the preview never covers the marker a click is meant for. One taller than
  // the map has room for fills the map's height and scrolls. It is placed once its size is known and before it shows.
  useLayoutEffect(() => {
    const instance = map.current, element = preview.current;
    if (!instance || !element || !previewed) return;
    const area = instance.getSize();
    const corner = popupPosition(instance.latLngToContainerPoint(previewed.position), { width: element.offsetWidth, height: element.offsetHeight }, { width: area.x, height: area.y }, { width: SIZE, height: SIZE });
    element.style.left = corner.x + "px";
    element.style.top = corner.y + "px";
  }, [previewed]);

  return <>
    <div ref={container} className={styles.map} />
    {markers.map((marker) => createPortal(marker.places.length === 1 ? <PlaceSymbol category={marker.places[0].category} approximate={marker.places[0].approximate} />
      : <GroupSymbol count={marker.places.length} approximate={marker.places.every((place) => place.approximate)} />, elements.get(marker.key)!.symbol, "symbol-" + marker.key))}
    {markers.map((marker) => createPortal(<ul className={styles.popupPlaces}>
      {marker.places.map((place) => <li key={place.id}>
        {/* Stored photos are resized and optimized on upload, and the thumbnail covers the photo's frame. Every popup is
            rendered before it opens, so its photo loads lazily, once the popup shows it. Its name follows, so it is decorative. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {place.photo && <img className={styles.popupPhoto} src={photoUrl(place, place.photo)} alt="" loading="lazy" decoding="async" />}
        <strong>{place.name}</strong>
        <span className={styles.category}>{MAP_PLACE_LABELS[place.category]}{place.approximate && " · Approximate location"}</span>
        <button type="button" className="text-button" onClick={() => onView(place)}>View details<span className="sr-only"> for {place.name}</span></button>
      </li>)}
    </ul>, elements.get(marker.key)!.popup, "popup-" + marker.key))}
    {/* A marker's preview (TRA-188): each place there, with the photo its popup shows, then its name and category. The
        marker's label already names its places for screen readers, so the preview, which repeats them, is hidden from
        them, and a scrolling preview is no stop for the keyboard, which reaches its places in the marker's popup. */}
    {previewed && <ul key={previewed.key} ref={preview} className={styles.preview} tabIndex={-1} aria-hidden="true"
      onPointerEnter={() => setHovered({ marker: previewed, leaving: false })} onPointerLeave={() => setHovered(leave)}>
      {previewed.places.map((place) => <li key={place.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {place.photo && <img className={styles.previewPhoto} src={photoUrl(place, place.photo)} alt="" decoding="async" />}
        <strong className={styles.previewName}>{place.name}</strong>
        <span className={styles.previewCategory}>{MAP_PLACE_LABELS[place.category]}</span>
      </li>)}
    </ul>}
  </>;
}
